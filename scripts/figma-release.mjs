/** Immutable designer approval checkpoints. Drafts and production are never automatic. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {inflateSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {FIGMA_MASTER, assertFigmaMaster} from './figma-source.mjs';
import {inventory, candidateManifest} from './figma-migrate.mjs';

export const LABEL = 'cells.garden / Dev ready';
export const digest = value => createHash('sha256').update(value).digest('hex');
const VERSION = /^\d{1,120}$/;
const HASH = /^[a-f0-9]{64}$/;
const IMAGE = /^[a-f0-9]{40,64}$/;
const RECEIPT = 'figma/releases/dev.json';
const PRODUCTION = 'figma/releases/production.json';
const MARKER = 'public/art-release.json';
const readJSON = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const writeJSON = (root,p,value) => {const full=path.join(root,p);fs.mkdirSync(path.dirname(full),{recursive:true});fs.writeFileSync(full,JSON.stringify(value,null,2)+'\n');};
const jsonBytes = value => Buffer.from(JSON.stringify(value,null,2)+'\n');
const existing = p => fs.existsSync(p)?fs.readFileSync(p):null;

export function approval(version, paths) {
  if(version?.label!==LABEL || !VERSION.test(version.id||'') || !Number.isFinite(Date.parse(version.created_at))) throw new Error('Invalid approval checkpoint');
  if(typeof version.description!=='string' || version.description.length>60000) throw new Error('Missing or oversized approval manifest');
  let value;try{value=JSON.parse(version.description);}catch{throw new Error('Invalid approval manifest JSON');}
  if(value.kind!=='cells.garden-ready'||value.fileKey!==FIGMA_MASTER.fileKey||value.target!=='dev'||!Array.isArray(value.assets)||!value.assets.length||value.assets.length>paths.size)throw new Error('Wrong or empty approval manifest');
  const seen=new Set();
  for(const item of value.assets){if(!paths.has(item.path)||seen.has(item.path)||!IMAGE.test(item.imageRef||''))throw new Error('Unknown, duplicate or invalid approved asset');seen.add(item.path);}
  return value;
}
export function nextRelease(versions, previous, notBefore) {
  const floor=Date.parse(notBefore);if(!Number.isFinite(floor))throw new Error('Invalid activation date');
  const compare=(a,b)=>Date.parse(a.created_at)-Date.parse(b.created_at)||(BigInt(a.id)<BigInt(b.id)?-1:BigInt(a.id)>BigInt(b.id)?1:0);
  const approved=versions.filter(v=>v.label===LABEL);
  if(approved.some(v=>!VERSION.test(v.id||'')||!Number.isFinite(Date.parse(v.created_at))))throw new Error('Invalid Figma approval version');
  const ordered=approved.filter(v=>Date.parse(v.created_at)>=floor).sort(compare);
  if(!previous)return ordered[0]||null;
  // A consumed checkpoint may later be renamed without replaying it.
  const cursor=versions.find(v=>v.id===previous.versionId);
  if(!cursor||!VERSION.test(cursor.id)||!Number.isFinite(Date.parse(cursor.created_at)))throw new Error('The previous published checkpoint is absent from history; refusing to replay or skip approvals');
  return ordered.find(v=>compare(v,cursor)>0)||null;
}
export function mappingFromDocument(state,payload,version) {
  if(payload?.version!==version||payload.document?.type!=='DOCUMENT')throw new Error('Figma did not return the exact approved version');
  const page=payload.document.children?.find(p=>p.id===FIGMA_MASTER.pageId&&p.type==='CANVAS');
  const sections=page?.children?.filter(n=>n.name==='EXPORTS'&&n.type==='SECTION')||[];
  if(sections.length!==1)throw new Error('Run Connect artwork first: exactly one EXPORTS section is required in ASSETS');
  const section=sections[0],nodes=new Map(),frames=new Map();
  function collect(n){if(nodes.has(n.id))throw new Error('Duplicate Figma node');nodes.set(n.id,n);for(const c of n.children||[])collect(c);}collect(page);
  const folders=[...new Set(state.assets.map(a=>path.posix.dirname(a.path)))].sort();
  if(JSON.stringify((section.children||[]).map(n=>n.name).sort())!==JSON.stringify(folders))throw new Error('EXPORTS folders differ from the repository inventory');
  for(const folder of section.children){if(folder.type!=='FRAME')throw new Error('Invalid EXPORTS folder');for(const n of folder.children||[]){if(frames.has(n.name))throw new Error('Duplicate export path');frames.set(n.name,n);}}
  if(frames.size!==state.assets.length)throw new Error('EXPORTS must map every PNG exactly once');
  function images(n,set=new Set()){for(const f of Array.isArray(n.fills)?n.fills:[])if(f.type==='IMAGE'&&f.imageRef)set.add(f.imageRef);for(const c of n.children||[])images(c,set);return set;}
  const refs=new Map();
  const rows=state.assets.map(a=>{
    const n=frames.get(a.path),b=n?.absoluteBoundingBox;
    if(n?.type!=='FRAME'||b?.width!==a.width||b?.height!==a.height||n.children?.length!==1||n.children[0].type!=='INSTANCE')throw new Error(`Invalid native export: ${a.path}`);
    const source=nodes.get(n.children[0].componentId),size=source?.absoluteBoundingBox;
    if(source?.type!=='COMPONENT'||!size)throw new Error(`Source is not local to ASSETS: ${a.path}`);
    const found=[...images(source)];if(found.length!==1||!IMAGE.test(found[0]))throw new Error(`Expected one original PNG fill: ${a.path}`);refs.set(a.path,found[0]);
    return {path:a.path,width:a.width,height:a.height,sourceComponentId:source.id,exportNodeId:n.id,sourceWidth:size.width,sourceHeight:size.height};
  });
  const manifest=candidateManifest(state,{kind:'cells.garden-master-migration',snapshot:state.snapshot,fileKey:FIGMA_MASTER.fileKey,pageId:page.id,exportSectionId:section.id,rows});
  return {manifest,refs};
}
export function checkApprovedImages(value,refs){for(const a of value.assets)if(refs.get(a.path)!==a.imageRef)throw new Error(`The saved checkpoint does not contain the approved image: ${a.path}. Rename this rejected checkpoint in Figma history, wait for saving and approve again.`);}
function crc32(bytes){let c=0xffffffff;for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;}
export function validatePNG(bytes,width,height){
  const sig=Buffer.from([137,80,78,71,13,10,26,10]);
  if(bytes.length<45||!bytes.subarray(0,8).equals(sig)||bytes.readUInt32BE(16)!==width||bytes.readUInt32BE(20)!==height)throw new Error('Original PNG signature or native dimensions differ');
  let offset=8,ended=false;const idat=[];
  while(offset+12<=bytes.length){const length=bytes.readUInt32BE(offset),end=offset+12+length,type=bytes.toString('ascii',offset+4,offset+8);if(end>bytes.length||ended)throw new Error('Truncated or trailing PNG data');if(offset===8&&(type!=='IHDR'||length!==13))throw new Error('Missing PNG header');if(crc32(bytes.subarray(offset+4,end-4))!==bytes.readUInt32BE(end-4))throw new Error('PNG checksum failed');if(type==='IDAT')idat.push(bytes.subarray(offset+8,end-4));if(type==='IEND'){if(length!==0)throw new Error('Invalid PNG end');ended=true;}offset=end;}
  if(!ended||offset!==bytes.length||!idat.length)throw new Error('Incomplete PNG');
  inflateSync(Buffer.concat(idat),{maxOutputLength:width*height*8+height*16+1024});return bytes;
}
export function comparablePNG(bytes){
  const parts=[],idat=[];let at=8;
  while(at+12<=bytes.length){const length=bytes.readUInt32BE(at),end=at+12+length,type=bytes.toString('ascii',at+4,at+8);if(end>bytes.length)throw new Error('Truncated PNG');if(type==='IDAT')idat.push(bytes.subarray(at+8,end-4));else if(!['iTXt','tEXt','zTXt','pHYs','tIME'].includes(type))parts.push(bytes.subarray(at,end-4));at=end;}
  if(at!==bytes.length||!idat.length)throw new Error('Malformed PNG');return Buffer.concat([...parts,...idat]);
}
export function retryTime(value,now=Date.now()){
  const seconds=value===null?NaN:Number(value),date=Date.parse(value||'');
  return Math.max(now+60000,Number.isFinite(seconds)&&seconds>=0?now+seconds*1000:Number.isFinite(date)?date:now+86400000);
}
function paused(){const p=process.env.FIGMA_BACKOFF_PATH;if(!p||!fs.existsSync(p))return null;const b=readJSON(p);return Number.isFinite(b.nextRequestAt)&&Date.now()<b.nextRequestAt?new Date(b.nextRequestAt).toISOString():null;}
async function responseBytes(response,max=16*1024*1024){let size=0;const chunks=[];for await(const c of response.body){size+=c.length;if(size>max)throw new Error('Remote response exceeded the size limit');chunks.push(Buffer.from(c));}return Buffer.concat(chunks);}
async function api(url,token){
  const u=new URL(url);if(u.origin!=='https://api.figma.com'||!u.pathname.startsWith(`/v1/files/${FIGMA_MASTER.fileKey}`))throw new Error('Unapproved API destination');
  const r=await fetch(u,{headers:{'X-Figma-Token':token},redirect:'error',signal:AbortSignal.timeout(30000)});
  if(r.status===429&&process.env.FIGMA_BACKOFF_PATH)fs.writeFileSync(process.env.FIGMA_BACKOFF_PATH,JSON.stringify({nextRequestAt:retryTime(r.headers.get('Retry-After'))}));
  if(!r.ok)throw new Error(`Figma HTTP ${r.status}${r.status===429?'; publishing is paused until Retry-After permits another request':''}`);
  return JSON.parse((await responseBytes(r)).toString('utf8'));
}
async function versionsSince(token,previous,floor){
  const result=[],seen=new Set();let next=`https://api.figma.com/v1/files/${FIGMA_MASTER.fileKey}/versions?page_size=50`;
  for(let i=0;next&&i<20;i++){
    const u=new URL(next);if(u.origin!=='https://api.figma.com'||u.pathname!==`/v1/files/${FIGMA_MASTER.fileKey}/versions`||seen.has(u.href))throw new Error('Unsafe version pagination');seen.add(u.href);
    const data=await api(u,token);if(!Array.isArray(data.versions))throw new Error('Version history is missing');result.push(...data.versions);
    if(previous?data.versions.some(v=>v.id===previous.versionId):data.versions.some(v=>Date.parse(v.created_at)<Date.parse(floor)))return result;
    next=data.pagination?.next_page;
  }
  if(next)throw new Error('Version history exceeded the safe pagination limit');return result;
}
export function makeReceipt(version,approved,originals,root,manifestBytes,previous=null,read=p=>fs.readFileSync(path.join(root,p))){
  const all=new Map((previous?.assets||[]).map(a=>[a.path,{...a}]));
  for(const p of approved)all.set(p,{path:p,before:all.get(p)?.before||digest(originals.get(p)),after:digest(read(p))});
  const body={schemaVersion:1,target:'dev',fileKey:FIGMA_MASTER.fileKey,versionId:version.id,createdAt:version.created_at,manifestSha256:digest(manifestBytes),assets:[...all.values()].sort((a,b)=>a.path.localeCompare(b.path))};return {...body,releaseId:digest(JSON.stringify(body))};
}
export function validateReceipt(receipt,manifest,read){
  assertFigmaMaster(manifest);const {releaseId,...body}=receipt;
  if(receipt.schemaVersion!==1||receipt.target!=='dev'||receipt.fileKey!==FIGMA_MASTER.fileKey||!VERSION.test(receipt.versionId||'')||!Number.isFinite(Date.parse(receipt.createdAt))||!HASH.test(receipt.manifestSha256||'')||digest(JSON.stringify(body))!==releaseId||!Array.isArray(receipt.assets)||!receipt.assets.length)throw new Error('Invalid release receipt');
  const paths=new Set(manifest.items.map(a=>a.path)),seen=new Set();
  for(const a of receipt.assets){if(!paths.has(a.path)||seen.has(a.path)||!HASH.test(a.before)||!HASH.test(a.after)||digest(read(a.path))!==a.after)throw new Error('Approved artwork was changed outside the publishing transaction');seen.add(a.path);}
}
export function transaction(root,replacements){
  const originals=new Map();
  for(const p of replacements.keys()){
    if(!['figma/exports.json',RECEIPT,PRODUCTION,MARKER].includes(p)&&!(/^src\/assets\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.png$/.test(p)&&!p.includes('..')))throw new Error('Unsafe publishing path');
    let part=root;for(const s of p.split('/')){part=path.join(part,s);if(fs.existsSync(part)&&fs.lstatSync(part).isSymbolicLink())throw new Error('Symlinked publishing path');}originals.set(p,existing(path.join(root,p)));
  }
  const written=[];
  const restore=paths=>{const failures=[];for(const p of paths){try{const f=path.join(root,p),b=originals.get(p);if(b===null)fs.rmSync(f,{force:true});else fs.writeFileSync(f,b);}catch(e){failures.push(e);}}if(failures.length)throw new AggregateError(failures,'Artwork rollback failed; inspect the checkout before retrying');};
  try{for(const[p,b]of replacements){const f=path.join(root,p);fs.mkdirSync(path.dirname(f),{recursive:true});written.push(p);fs.writeFileSync(f,b);}}
  catch(error){restore(written);throw error;}
  return()=>restore(written);
}
export async function stage(root,checkOnly=true,services={}){
  const backoff=paused();if(backoff)return{status:'backoff',nextRequestAt:backoff};
  const token=process.env.FIGMA_TOKEN;if(!token&&!services.api)return{status:'setup-required',missing:['Repository secret FIGMA_TOKEN with file_content:read and file_versions:read']};
  const remote=services.api||((url)=>api(url,token)),state=inventory(root),config=readJSON(new URL('../figma/publishing.json',import.meta.url));
  const previousBytes=existing(path.join(root,RECEIPT)),previous=previousBytes?JSON.parse(previousBytes):null;
  if(previous)validateReceipt(previous,state.manifest,p=>fs.readFileSync(path.join(root,p)));
  const versions=services.versions||await versionsSince(token,previous,config.notBefore);
  const version=nextRelease(versions,previous,config.notBefore);if(!version)return{status:'idle',releaseId:previous?.releaseId||null};
  const approved=approval(version,new Set(state.assets.map(a=>a.path)));
  const payload=await remote(`https://api.figma.com/v1/files/${FIGMA_MASTER.fileKey}?ids=${encodeURIComponent(FIGMA_MASTER.pageId)}&version=${version.id}`);
  const {manifest,refs}=mappingFromDocument(state,payload,version.id);checkApprovedImages(approved,refs);
  const manifestBytes=jsonBytes(manifest),paths=approved.assets.map(a=>a.path),selected=new Set(paths);
  const verifyAll=!manifestBytes.equals(fs.readFileSync(path.join(root,'figma/exports.json')));
  const images=await remote(`https://api.figma.com/v1/files/${FIGMA_MASTER.fileKey}/images`),urls=images.images||images.meta?.images||{};
  const download=services.download||async function(url){const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password||!(u.hostname.endsWith('.figma.com')||u.hostname.endsWith('.amazonaws.com')))throw new Error('Unapproved image download host');const r=await fetch(u,{redirect:'error',signal:AbortSignal.timeout(30000)});if(!r.ok)throw new Error(`Original image download failed: HTTP ${r.status}`);return responseBytes(r,8*1024*1024);};
  const replacements=new Map(),originals=new Map();
  for(const a of state.assets){
    if(!verifyAll&&!selected.has(a.path))continue;
    const url=urls[refs.get(a.path)];if(!url)throw new Error(`Approved original image is unavailable: ${a.path}; no fallback to a newer draft`);
    const bytes=validatePNG(await download(url),a.width,a.height);
    if(selected.has(a.path)){
      const original=fs.readFileSync(path.join(root,a.path));originals.set(a.path,original);let output=bytes;
      try{if(comparablePNG(original).equals(comparablePNG(bytes)))output=original;}catch{/* An explicitly approved valid PNG may repair a malformed local image. */}
      replacements.set(a.path,output);
    }
  }
  if(inventory(root).snapshot!==state.snapshot)throw new Error('Repository artwork changed during verification; nothing published');
  const now=existing(path.join(root,RECEIPT));if((previousBytes===null)!==(now===null)||(previousBytes&&!previousBytes.equals(now)))throw new Error('The publishing receipt changed during verification; nothing published');
  if(checkOnly)return{status:'checked',versionId:version.id,selected:paths.length,verified:verifyAll?state.assets.length:paths.length};
  const receipt=makeReceipt(version,paths,originals,root,manifestBytes,previous,p=>replacements.get(p)||fs.readFileSync(path.join(root,p)));
  replacements.set('figma/exports.json',manifestBytes);replacements.set(RECEIPT,jsonBytes(receipt));replacements.set(MARKER,jsonBytes({schemaVersion:1,releaseId:receipt.releaseId,versionId:version.id,target:'dev',assets:receipt.assets.length}));
  transaction(root,replacements);return{status:'staged',releaseId:receipt.releaseId,versionId:version.id,selected:paths.length};
}
export async function verifyLive(root,host,attempts=40){
  if(!['dev.cells.garden','cells.garden'].includes(host))throw new Error('Unapproved deployment host');
  const expected=readJSON(path.join(root,MARKER));if(!HASH.test(expected.releaseId||'')||!VERSION.test(expected.versionId||'')||!['dev','production'].includes(expected.target))throw new Error('Invalid deployment receipt');
  for(let i=0;i<attempts;i++){
    try{const r=await fetch(`https://${host}/art-release.json?release=${expected.releaseId}`,{headers:{'Cache-Control':'no-cache'},redirect:'error',signal:AbortSignal.timeout(10000)});if(r.ok){const actual=JSON.parse((await responseBytes(r,32768)).toString());if(actual.releaseId===expected.releaseId&&actual.versionId===expected.versionId&&actual.target===expected.target)return{status:'live',host,releaseId:expected.releaseId};}}catch{/* bounded retry */}
    if(i+1<attempts)await new Promise(resolve=>setTimeout(resolve,15000));
  }
  throw new Error(`The commit is not verified live at ${host}. Check the Vercel branch/domain binding. A successful Git push is not a successful deployment.`);
}
export function checkProductionConflicts(assets,current,last=new Map()){
  for(const a of assets){const now=digest(current(a.path));if(now!==a.before&&now!==a.after&&now!==last.get(a.path))throw new Error(`Production was edited independently: ${a.path}; resolve the conflict before promotion`);}
}
export async function promote(root,commit){
  if(!/^[a-f0-9]{40}$/.test(commit||''))throw new Error('Use the exact approved 40-character dev commit SHA');
  const git=(...a)=>execFileSync('git',a,{cwd:root}),read=p=>git('show',`${commit}:${p}`);
  git('merge-base','--is-ancestor',commit,'origin/dev');
  const receipt=JSON.parse(read(RECEIPT)),manifestBytes=read('figma/exports.json'),manifest=JSON.parse(manifestBytes);
  validateReceipt(receipt,manifest,read);if(digest(manifestBytes)!==receipt.manifestSha256)throw new Error('Approved mapping checksum differs');
  const marker=JSON.parse(read(MARKER));if(marker.releaseId!==receipt.releaseId||marker.target!=='dev')throw new Error('Dev marker differs from its receipt');
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'figma-dev-check-'));
  try{writeJSON(tmp,MARKER,marker);await verifyLive(tmp,'dev.cells.garden',1);}finally{fs.rmSync(tmp,{recursive:true,force:true});}
  const previous=fs.existsSync(path.join(root,PRODUCTION))?readJSON(path.join(root,PRODUCTION)):null;
  const last=new Map((previous?.assets||[]).map(a=>[a.path,a.after]));
  checkProductionConflicts(receipt.assets,p=>fs.readFileSync(path.join(root,p)),last);
  const state=inventory(root);candidateManifest(state,{kind:'cells.garden-master-migration',snapshot:state.snapshot,...manifest.figma,rows:manifest.items});
  const replacements=new Map(receipt.assets.map(a=>[a.path,read(a.path)]));replacements.set('figma/exports.json',manifestBytes);
  replacements.set(PRODUCTION,jsonBytes({...receipt,target:'production',approvedDevCommit:commit}));replacements.set(MARKER,jsonBytes({...marker,target:'production',approvedDevCommit:commit}));
  transaction(root,replacements);return{status:'staged',target:'production',releaseId:receipt.releaseId};
}
export async function preflight(root){
  const b=paused();if(b)return{status:'backoff',nextRequestAt:b};
  const token=process.env.FIGMA_TOKEN;if(!token)return{status:'setup-required',missing:['Repository secret FIGMA_TOKEN'],master:FIGMA_MASTER.url};
  const data=await api(`https://api.figma.com/v1/files/${FIGMA_MASTER.fileKey}?depth=2`,token);
  const page=data.document?.children?.find(p=>p.id===FIGMA_MASTER.pageId&&p.type==='CANVAS');if(!page)throw new Error('The confirmed ASSETS page is not accessible');
  const history=await api(`https://api.figma.com/v1/files/${FIGMA_MASTER.fileKey}/versions?page_size=1`,token);if(!Array.isArray(history.versions))throw new Error('Version-history scope is unavailable');
  const sections=(page.children||[]).filter(n=>n.type==='SECTION'&&n.name==='EXPORTS');return{status:sections.length===1?'ready-for-checkpoint':'setup-required',missing:sections.length===1?[]:['Run Connect artwork in the master Figma file'],pngCount:inventory(root).assets.length,master:FIGMA_MASTER.url};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const mode=process.argv[2]||'check',root=path.resolve(process.argv[3]||'.');
  try{let result;if(mode==='preflight')result=await preflight(root);else if(mode==='check'||mode==='stage')result=await stage(root,mode==='check');else if(mode==='promote')result=await promote(root,process.env.FIGMA_DEV_COMMIT);else if(mode==='verify-live')result=await verifyLive(root,process.env.FIGMA_DEPLOY_HOST||'dev.cells.garden');else throw new Error('Unknown publishing operation');const text=JSON.stringify(result);console.log(text);if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,text+'\n');if(process.env.GITHUB_OUTPUT)fs.appendFileSync(process.env.GITHUB_OUTPUT,`status=${result.status}\nrelease_id=${result.releaseId||''}\n`);}
  catch(error){const message=`Publishing stopped: ${error.message}`;console.error(message);if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,message+'\n');process.exitCode=1;}
}
