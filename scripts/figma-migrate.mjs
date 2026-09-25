import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { FIGMA_MASTER, assertFigmaMaster } from './figma-source.mjs';
import { linkMaster } from '../figma/master-linker.mjs';

const digest = b => createHash('sha256').update(b).digest('hex');
const pngSignature = Buffer.from([137,80,78,71,13,10,26,10]);
export function pngSize(b) {
  if (b.length < 24 || !b.subarray(0,8).equals(pngSignature)) throw new Error('Invalid native PNG');
  const width=b.readUInt32BE(16),height=b.readUInt32BE(20);
  if (!width || !height || width>4096 || height>4096) throw new Error('Native PNG exceeds supported dimensions');
  return {width,height};
}
function filesUnder(dir) {
  return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>{
    if(e.isSymbolicLink()) throw new Error('Symlinked assets are not permitted');
    const p=path.join(dir,e.name);return e.isDirectory()?filesUnder(p):[p];
  });
}
export function inventory(root) {
  const manifestBytes=fs.readFileSync(path.join(root,'figma/exports.json'));
  const manifest=JSON.parse(manifestBytes);
  const entries=filesUnder(path.join(root,'src/assets')).map(p=>{
    const relative=path.relative(root,p).split(path.sep).join('/');
    if(!/^src\/assets\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.(png|gif)$/.test(relative)||relative.includes('..')) throw new Error(`Unsupported asset path: ${relative}`);
    const bytes=fs.readFileSync(p);return {path:relative,bytes,sha256:digest(bytes)};
  }).sort((a,b)=>a.path<b.path?-1:1);
  const covered=new Set([...manifest.items,...manifest.references].map(a=>a.path));
  if(covered.size!==entries.length||entries.some(e=>!covered.has(e.path))) throw new Error('Repository asset coverage drift; verify the contract first');
  const snapshot=digest(Buffer.concat([manifestBytes,Buffer.from(JSON.stringify(entries.map(e=>[e.path,e.sha256])))]));
  const knownReferences={'src/assets/grass.png':'88:3753','src/assets/pets/gnome.png':'56:1008'};
  const assets=entries.filter(e=>e.path.endsWith('.png')).map(e=>{
    const old=manifest.items.find(a=>a.path===e.path);
    const candidateId=e.path==='src/assets/void_tile.png'?null:(old?.sourceComponentId||knownReferences[e.path]||null);
    return {path:e.path,...pngSize(e.bytes),candidateId,sha256:e.sha256,...(!candidateId?{png:e.bytes.toString('base64')}:{} )};
  });
  const references=entries.filter(e=>!e.path.endsWith('.png')).map(e=>({path:e.path,policy:'repo-source-of-truth',note:'Animated source preserved in Git. Do not replace with a flattened PNG export.'}));
  return {manifest,snapshot,assets,references,entries};
}
const scriptFor = payload => `${linkMaster.toString()}\nreturn await linkMaster(figma, ${JSON.stringify(payload)});\n`;
export function migrationScripts(state, limit=50000) {
  const {assets,snapshot}=state;
  const scripts=[];const regular=[];
  for(const a of assets) {
    if(a.png && scriptFor({fileKey:FIGMA_MASTER.fileKey,snapshot,mode:'link',assets:[a]}).length>limit) {
      // One Unicode code point encodes one byte. Unlike base64 this fits the
      // 3200px logos inside the tool's character budget without altering PNG data.
      const bytes=Buffer.from(a.png,'base64');
      const encoded=Array.from(bytes,b=>String.fromCharCode(256+b)).join('');
      const name=`Source/Repository/${a.path}`;
      const script=`if(figma.fileKey!==${JSON.stringify(FIGMA_MASTER.fileKey)})throw new Error('Confirmed master required');\nconst p=await figma.getNodeByIdAsync('27:1966');if(!p||p.type!=='PAGE')throw new Error('ASSETS page missing');await figma.setCurrentPageAsync(p);\nconst name=${JSON.stringify(name)};const found=p.findAll(n=>n.type==='COMPONENT'&&n.name===name);if(found.length>1)throw new Error('Duplicate source');if(found.length)return {createdNodeIds:[],existingNodeId:found[0].id};\nconst bytes=Uint8Array.from(${JSON.stringify(encoded)},c=>c.charCodeAt(0)-256);const image=figma.createImage(bytes);const n=figma.createComponent();n.name=name;n.resize(${a.width},${a.height});n.fills=[{type:'IMAGE',imageHash:image.hash,scaleMode:'FILL'}];n.x=Math.max(0,...p.children.filter(c=>c.id!==n.id).map(c=>c.x+c.width))+120;n.y=0;n.description=${JSON.stringify(`Original PNG from ${a.path}. Git: https://github.com/lukketsvane/cells.garden/blob/main/${a.path}. Replace image fill; preserve native dimensions.`)};return {createdNodeIds:[n.id],sourceComponentId:n.id};\n`;
      if(script.length>limit)throw new Error(`Asset requires the normal Figma upload tool: ${a.path}`);
      scripts.push({label:'import-native',code:script});
      const {png,...withoutBytes}=a;regular.push(withoutBytes);
    } else regular.push(a);
  }
  let batch=[];
  const emit=()=>{if(batch.length)scripts.push({label:'link-assets',code:scriptFor({fileKey:FIGMA_MASTER.fileKey,snapshot,mode:'link',assets:batch})});batch=[];};
  for(const a of regular){const next=[...batch,a];if(scriptFor({fileKey:FIGMA_MASTER.fileKey,snapshot,mode:'link',assets:next}).length>limit)emit();batch.push(a);}
  emit();
  const assetsForReport=assets.map(({png,sha256,...a})=>a);
  const reportCode=scriptFor({fileKey:FIGMA_MASTER.fileKey,snapshot,mode:'report',assets:assetsForReport});
  if(reportCode.length>limit)throw new Error('Report exceeds tool budget; split report validation before executing');
  scripts.push({label:'collect-report',code:reportCode});
  return scripts;
}
export function candidateManifest(state, report) {
  if(report?.kind!=='cells.garden-master-migration'||report.snapshot!==state.snapshot) throw new Error('Stale or invalid migration report; prepare again from current Git');
  const figma={fileKey:report.fileKey,pageId:report.pageId,exportSectionId:report.exportSectionId};assertFigmaMaster({figma});
  if(!Array.isArray(report.rows)||report.rows.length!==state.assets.length)throw new Error('Migration report must cover every PNG');
  const rows=new Map(),sources=new Set(),exports=new Set();
  for(const row of report.rows){
    if(rows.has(row.path))throw new Error('Duplicate report path');
    for(const key of ['sourceComponentId','exportNodeId']) if(!/^\d+:\d+$/.test(row[key]||''))throw new Error('Invalid node ID');
    if(sources.has(row.sourceComponentId)||exports.has(row.exportNodeId))throw new Error('Duplicate source/export node');
    if(row.sourceComponentId===row.exportNodeId)throw new Error('Source must differ from export');
    sources.add(row.sourceComponentId);exports.add(row.exportNodeId);rows.set(row.path,row);
  }
  const items=state.assets.map(a=>{
    const r=rows.get(a.path);
    if(!r||r.width!==a.width||r.height!==a.height)throw new Error(`Path or dimension mismatch: ${a.path}`);
    if(!Number.isFinite(r.sourceWidth)||!Number.isFinite(r.sourceHeight)||r.sourceWidth<=0||r.sourceHeight<=0)throw new Error(`Invalid source geometry: ${a.path}`);
    return {path:a.path,width:a.width,height:a.height,sourceComponentId:r.sourceComponentId,exportNodeId:r.exportNodeId,sourceWidth:r.sourceWidth,sourceHeight:r.sourceHeight};
  });
  return {schemaVersion:1,figma,policy:{...state.manifest.policy},coverage:{assetFiles:state.entries.length,figmaExports:items.length,repoSourceReferences:state.references.length},references:state.references,count:items.length,items};
}
export function adopt(root, report, verify) {
  const state=inventory(root);const candidate=candidateManifest(state,report);
  verify(candidate); // Must succeed against live, authenticated Figma before any write.
  if(inventory(root).snapshot!==state.snapshot)throw new Error('Repository changed during verification; nothing adopted');
  const target=path.join(root,'figma/exports.json');const temp=target+'.migration-'+process.pid;
  try {fs.writeFileSync(temp,JSON.stringify(candidate,null,2)+'\n',{flag:'wx'});fs.renameSync(temp,target);} finally {if(fs.existsSync(temp))fs.unlinkSync(temp);}
  return candidate;
}
export function prepare(root, destination) {
  const state=inventory(root),scripts=migrationScripts(state);
  if(fs.existsSync(destination))throw new Error('Output already exists; choose a new directory rather than overwrite a pending migration');
  fs.mkdirSync(destination,{recursive:true});
  const steps=scripts.map((s,i)=>{const name=`${String(i+1).padStart(2,'0')}-${s.label}.js`;fs.writeFileSync(path.join(destination,name),s.code);return {name,characters:s.code.length};});
  fs.writeFileSync(path.join(destination,'plan.json'),JSON.stringify({master:FIGMA_MASTER,snapshot:state.snapshot,pngCount:state.assets.length,references:state.references,steps},null,2)+'\n');
  fs.writeFileSync(path.join(destination,'README.txt'),`Migration preparation only: no Figma or Git writes have happened.\nRestore authorized access to ${FIGMA_MASTER.url}.\nRun the numbered files in order through use_figma, on this exact file only.\nEach script rejects an unverified file identity. Read the normal figma-use guidance first.\nIf any call fails, inspect actual state before retrying; do not switch to a copy.\nThe last script is read-only; save its JSON return as report.json.\nThen run: node scripts/figma-migrate.mjs adopt /path/to/report.json\nThis requires a locally configured FIGMA_TOKEN and performs live no-write validation.\nNo file moves, permission changes, token storage or quota workarounds are performed.\nPNG sources: ${state.assets.length}; protected non-PNG sources: ${state.references.length}.\n`);
  return {destination,pngCount:state.assets.length,protectedReferences:state.references.length,steps};
}
function main() {
  const [command,arg]=process.argv.slice(2);const root=process.cwd();
  if(command==='prepare')console.log(JSON.stringify(prepare(root,path.resolve(arg||'dist-figma-migration')),null,2));
  else if(command==='adopt'){
    if(!arg)throw new Error('Provide the actual JSON report from the master Figma');
    const report=JSON.parse(fs.readFileSync(arg,'utf8'));
    const candidate=adopt(root,report,m=>{
      const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cells-figma-'));
      try{const p=path.join(dir,'candidate.json');fs.writeFileSync(p,JSON.stringify(m));
        execFileSync(process.execPath,[path.join(root,'scripts/sync-figma-assets.mjs')],{cwd:root,stdio:'inherit',env:{...process.env,FIGMA_MANIFEST_PATH:p,FIGMA_CHECK_ONLY:'1',FIGMA_ASSET_PATH:''}});
      }finally{fs.rmSync(dir,{recursive:true,force:true});}
    });
    console.log(`Adopted ${candidate.count} verified mappings. Artwork is unchanged. Review the manifest diff, then commit it before syncing art.`);
  }else throw new Error('Usage: node scripts/figma-migrate.mjs prepare [directory] | adopt report.json');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  try{main();}catch(e){console.error(e instanceof Error?e.message:String(e));process.exitCode=1;}
}
