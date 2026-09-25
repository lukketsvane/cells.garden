import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { deflateSync } from 'node:zlib';
import { inventory, migrationScripts, candidateManifest, adopt, prepare } from './figma-migrate.mjs';
import { FIGMA_MASTER } from './figma-source.mjs';
import { linkMaster } from '../figma/master-linker.mjs';

const root = process.cwd();
const tile = fs.readFileSync(path.join(root, 'src/assets/void_tile.png'));
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'figma-migration-test-'));
  t.after(() => fs.rmSync(dir, {recursive:true, force:true}));
  fs.mkdirSync(path.join(dir, 'figma'));
  fs.mkdirSync(path.join(dir, 'src/assets'), {recursive:true});
  for (const name of ['a.png', 'void_tile.png']) fs.writeFileSync(path.join(dir, 'src/assets', name), tile);
  fs.writeFileSync(path.join(dir, 'src/assets/stars.gif'), 'GIF89a-preserved-animation');
  fs.writeFileSync(path.join(dir, 'figma/exports.json'), JSON.stringify({
    schemaVersion:1, figma:{fileKey:'legacy'}, policy:{format:'PNG',scale:1,pixelArt:'native-1x'},
    items:[{path:'src/assets/a.png',width:32,height:32,sourceComponentId:'29:1',exportNodeId:'40:1'}],
    references:[{path:'src/assets/void_tile.png'},{path:'src/assets/stars.gif'}]
  }));
  return dir;
}
function reportFor(state) {
  return {kind:'cells.garden-master-migration',fileKey:FIGMA_MASTER.fileKey,pageId:FIGMA_MASTER.pageId,
    exportSectionId:'900:1',snapshot:state.snapshot,rows:state.assets.map((a,i)=>({path:a.path,width:a.width,height:a.height,
      sourceComponentId:`901:${i+1}`,exportNodeId:`902:${i+1}`,sourceWidth:a.width,sourceHeight:a.height}))};
}
function fakeFigma() {
  const nodes=new Map(),images=new Map(),calls=[];
  let next=1,figma;
  function node(type,id=`900:${next++}`) {
    const n={id,type,name:type,width:100,height:100,x:0,y:0,fills:[],children:[],parent:null,
      resize(w,h){this.width=w;this.height=h;},
      resizeWithoutConstraints(w,h){this.resize(w,h);},
      appendChild(child){if(child.parent)child.parent.children.splice(child.parent.children.indexOf(child),1);child.parent=this;this.children.push(child);},
      findAll(fn){const out=[];for(const c of this.children){if(fn(c))out.push(c);out.push(...c.findAll(fn));}return out;},
      createInstance(){const i=node('INSTANCE');i.componentId=this.id;i.width=this.width;i.height=this.height;figma.currentPage.appendChild(i);calls.push(i.id);return i;},
      async getMainComponentAsync(){return nodes.get(this.componentId)||null;}
    };
    nodes.set(id,n);return n;
  }
  const page=node('PAGE','27:1966');page.name='ASSETS';
  const create=type=>{const n=node(type);figma.currentPage.appendChild(n);calls.push(n.id);return n;};
  figma={fileKey:FIGMA_MASTER.fileKey,currentPage:page,
    async getNodeByIdAsync(id){return nodes.get(id)||null;},async setCurrentPageAsync(p){this.currentPage=p;},
    createFrame:()=>create('FRAME'),createSection:()=>create('SECTION'),createComponent:()=>create('COMPONENT'),
    createImage(bytes){const hash=`image-${images.size}`,b=new Uint8Array(bytes);const image={hash,async getBytesAsync(){return b;}};images.set(hash,image);return image;},
    getImageByHash(hash){return images.get(hash)||null;}
  };
  function source(id,bytes,w=32,h=32){const n=node('COMPONENT',id);n.name='Existing artist component';n.resize(w,h);const image=figma.createImage(bytes);n.fills=[{type:'IMAGE',imageHash:image.hash,scaleMode:'FILL'}];page.appendChild(n);return n;}
  return {figma,nodes,images,calls,source};
}
const payload=(state,mode='link')=>({fileKey:FIGMA_MASTER.fileKey,snapshot:state.snapshot,mode,assets:state.assets});

test('preparation includes every PNG, protects animation and leaves the mapping unchanged',t=>{
  const dir=fixture(t),before=fs.readFileSync(path.join(dir,'figma/exports.json')),state=inventory(dir);
  assert.equal(state.assets.length,2);assert.equal(state.references.length,1);
  assert.equal(prepare(dir,path.join(dir,'output')).pngCount,2);
  assert.ok(before.equals(fs.readFileSync(path.join(dir,'figma/exports.json'))));
  assert.throws(()=>prepare(dir,path.join(dir,'output')),/already exists/);
});
test('current artwork fits native, bounded executable batches',()=>{
  const state=inventory(root),scripts=migrationScripts(state);
  assert.equal(state.assets.length,state.entries.filter(e=>e.path.endsWith('.png')).length);
  assert.ok(state.references.some(e=>e.path.endsWith('.gif')));
  for(const s of scripts){assert.ok(s.code.length<=50000);new vm.Script(`(async()=>{${s.code}})()`);}
});
test('wrong copy or unavailable file identity fails before mutation',async t=>{
  const state=inventory(fixture(t));
  for(const key of ['WJgKfsKcxUpuNkDvxI9gEx',undefined]){
    const f=fakeFigma();f.figma.fileKey=key;
    await assert.rejects(linkMaster(f.figma,payload(state)),/identity is required/);
    assert.equal(f.calls.length,0);
  }
});
test('links native pixels without changing designer geometry and reruns without duplicates',async t=>{
  const state=inventory(fixture(t)),f=fakeFigma(),n=f.source('29:1',tile,80,50),fill=JSON.stringify(n.fills);
  const result=await linkMaster(f.figma,payload(state));assert.equal(result.rows.length,2);
  assert.equal(n.width,80);assert.equal(n.height,50);assert.equal(JSON.stringify(n.fills),fill);
  assert.equal(result.rows[0].sourceWidth,80);assert.equal(result.rows[0].width,32);
  const count=f.calls.length;await linkMaster(f.figma,payload(state));assert.equal(f.calls.length,count);
  const report=await linkMaster(f.figma,payload(state,'report'));assert.equal(f.calls.length,count);
  assert.equal(candidateManifest(state,report).items.length,2);
});
test('a native image size conflict aborts the batch before any mutation',async t=>{
  const state=inventory(fixture(t)),f=fakeFigma(),bad=Buffer.from(tile);bad.writeUInt32BE(33,16);f.source('29:1',bad);
  await assert.rejects(linkMaster(f.figma,payload(state)),/Native image size differs/);assert.equal(f.calls.length,0);
});
test('ambiguous fills fail rather than selecting arbitrary artwork',async t=>{
  const state=inventory(fixture(t)),f=fakeFigma(),n=f.source('29:1',tile);
  n.fills.push({type:'IMAGE',imageHash:f.figma.createImage(tile).hash});
  await assert.rejects(linkMaster(f.figma,payload(state)),/one original image/);assert.equal(f.calls.length,0);
});
test('missing, duplicate, foreign, malformed and stale mappings are rejected',t=>{
  const state=inventory(fixture(t)),valid=reportFor(state);
  const edits=[r=>r.rows.pop(),r=>r.rows[1].path=r.rows[0].path,r=>r.rows[1].exportNodeId=r.rows[0].exportNodeId,
    r=>r.rows[0].path='../oops.png',r=>r.rows[0].sourceComponentId='pending',r=>r.snapshot='stale',
    r=>r.fileKey='WJgKfsKcxUpuNkDvxI9gEx',r=>r.rows[0].width++];
  for(const edit of edits){const report=structuredClone(valid);edit(report);assert.throws(()=>candidateManifest(state,report));}
});
test('failed live verification leaves the mapping and all artwork untouched',t=>{
  const dir=fixture(t),state=inventory(dir),before=fs.readFileSync(path.join(dir,'figma/exports.json'));
  assert.throws(()=>adopt(dir,reportFor(state),()=>{throw new Error('Figma unavailable');}),/unavailable/);
  assert.ok(before.equals(fs.readFileSync(path.join(dir,'figma/exports.json'))));assert.equal(inventory(dir).snapshot,state.snapshot);
});
test('adoption cannot overwrite concurrent edits',t=>{
  const dir=fixture(t),state=inventory(dir);
  assert.throws(()=>adopt(dir,reportFor(state),()=>fs.appendFileSync(path.join(dir,'src/assets/a.png'),'edit')),/changed during/);
});
test('verified adoption changes only the mapping and retains animation',t=>{
  const dir=fixture(t),state=inventory(dir);let checked=false;
  const result=adopt(dir,reportFor(state),m=>{checked=true;assert.equal(m.figma.fileKey,FIGMA_MASTER.fileKey);});
  assert.ok(checked);assert.equal(result.items.length,2);assert.equal(result.references[0].path,'src/assets/stars.gif');
  for(const e of state.entries)assert.ok(e.bytes.equals(fs.readFileSync(path.join(dir,e.path))));
});
test('full generated migration is idempotent in a simulated current-asset file',async()=>{
  const state=inventory(root),f=fakeFigma(),originals=[];
  for(const a of state.assets)if(a.candidateId){const n=f.source(a.candidateId,fs.readFileSync(path.join(root,a.path)),a.width,a.height);originals.push([n,JSON.stringify(n.fills),n.width,n.height]);}
  const scripts=migrationScripts(state),context=vm.createContext({figma:f.figma,Uint8Array,Set,Map,Number,Math,JSON,Error});
  let report;
  for(const s of scripts)report=await new vm.Script(`(async()=>{${s.code}})()`).runInContext(context);
  assert.equal(report.rows.length,state.assets.length);assert.equal(candidateManifest(state,report).items.length,state.assets.length);
  const count=f.calls.length;
  for(const s of scripts)await new vm.Script(`(async()=>{${s.code}})()`).runInContext(context);
  assert.equal(f.calls.length,count);
  for(const [n,fill,w,h] of originals){assert.equal(JSON.stringify(n.fills),fill);assert.equal(n.width,w);assert.equal(n.height,h);}
  for(const a of state.assets.filter(a=>a.path.includes('CG_logo'))){
    const n=f.figma.currentPage.findAll(n=>n.name===`Source/Repository/${a.path}`)[0];
    const bytes=await f.figma.getImageByHash(n.fills[0].imageHash).getBytesAsync();
    assert.ok(fs.readFileSync(path.join(root,a.path)).equals(Buffer.from(bytes)));
  }
});
function png(color) {
  const crc=b=>{let c=0xffffffff;for(const v of b){c^=v;for(let j=0;j<8;j++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;};
  const chunk=(name,data)=>{const k=Buffer.from(name),n=Buffer.alloc(4),c=Buffer.alloc(4);n.writeUInt32BE(data.length);c.writeUInt32BE(crc(Buffer.concat([k,data])));return Buffer.concat([n,k,data,c]);};
  const h=Buffer.alloc(13);h.writeUInt32BE(32,0);h.writeUInt32BE(32,4);h[8]=8;h[9]=6;
  const pixels=Buffer.alloc(32*129);
  for(let y=0;y<32;y++)for(let x=0;x<32;x++){const p=y*129+1+x*4;pixels[p]=color;pixels[p+3]=255;}
  return Buffer.concat([tile.subarray(0,8),chunk('IHDR',h),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
}
function syncFixture(t,{badLast=false,checkOnly=true}={}) {
  const dir=fixture(t),state=inventory(dir),m=candidateManifest(state,reportFor(state));
  fs.writeFileSync(path.join(dir,'figma/exports.json'),JSON.stringify(m));fs.mkdirSync(path.join(dir,'scripts'));
  for(const file of ['sync-figma-assets.mjs','figma-source.mjs','verify-figma-assets.mjs'])fs.copyFileSync(path.join(root,'scripts',file),path.join(dir,'scripts',file));
  const source=i=>({id:m.items[i].sourceComponentId,type:'COMPONENT',absoluteBoundingBox:{width:32,height:32},fills:[{type:'IMAGE',imageRef:`image-${i}`}]});
  const section={id:m.figma.exportSectionId,type:'SECTION',children:[{id:'950:1',name:'src/assets',type:'FRAME',children:m.items.map(i=>({id:i.exportNodeId,name:i.path,type:'FRAME',absoluteBoundingBox:{width:32,height:32},children:[{id:`instance-${i.exportNodeId}`,type:'INSTANCE',componentId:i.sourceComponentId}]}))}]};
  const docs={[m.figma.pageId]:{id:m.figma.pageId,type:'CANVAS',children:[section]},[section.id]:section};m.items.forEach((_,i)=>docs[m.items[i].sourceComponentId]=source(i));
  const bytes=[png(120),png(200)];if(badLast)bytes[1]=Buffer.from('not-a-png');
  const mock=`const docs=${JSON.stringify(docs)},bytes=${JSON.stringify(bytes.map(b=>b.toString('base64')))};globalThis.fetch=async(url)=>{const u=new URL(url);if(u.pathname.endsWith('/nodes')){const nodes={};for(const id of u.searchParams.get('ids').split(','))nodes[id]={document:docs[id]};return Response.json({nodes});}if(u.pathname.endsWith('/images'))return Response.json({images:{'image-0':'https://assets.example/0','image-1':'https://assets.example/1'}});if(u.hostname==='assets.example')return new Response(Buffer.from(bytes[Number(u.pathname.slice(1))],'base64'));throw new Error('Unexpected request');};`;
  const mockPath=path.join(dir,'mock.mjs');fs.writeFileSync(mockPath,mock);
  const before=m.items.map(i=>fs.readFileSync(path.join(dir,i.path)));
  const result=spawnSync(process.execPath,['--import',mockPath,path.join(dir,'scripts/sync-figma-assets.mjs')],{cwd:dir,encoding:'utf8',timeout:10000,env:{...process.env,FIGMA_TOKEN:'test-only-placeholder',FIGMA_CHECK_ONLY:checkOnly?'1':'0',FIGMA_MANIFEST_PATH:'',FIGMA_ASSET_PATH:''}});
  return {dir,m,before,bytes,result};
}
test('read-only live-protocol verification never writes images',t=>{
  const {dir,m,before,result}=syncFixture(t);assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/No files written/);
  m.items.forEach((i,n)=>assert.ok(before[n].equals(fs.readFileSync(path.join(dir,i.path)))));
});
test('a bad final remote image cannot partially replace earlier images',t=>{
  const {dir,m,before,result}=syncFixture(t,{badLast:true,checkOnly:false});assert.notEqual(result.status,0);
  m.items.forEach((i,n)=>assert.ok(before[n].equals(fs.readFileSync(path.join(dir,i.path)))));
});
test('successful sync writes validated changes only after all downloads',t=>{
  const {dir,m,bytes,result}=syncFixture(t,{checkOnly:false});assert.equal(result.status,0,result.stderr);
  m.items.forEach((i,n)=>assert.ok(bytes[n].equals(fs.readFileSync(path.join(dir,i.path)))));
});
