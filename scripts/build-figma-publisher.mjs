import fs from 'node:fs';
import path from 'node:path';
import {deflateRawSync} from 'node:zlib';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {inventory} from './figma-migrate.mjs';
import {linkMaster} from '../figma/master-linker.mjs';
import {runPublisher} from '../figma/publisher/plugin.mjs';
import {archiveApproval} from '../figma/publisher/checkpoints.mjs';
function crc32(bytes){let c=0xffffffff;for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;}
export function zipFiles(files){
  const local=[],central=[];let offset=0;
  for(const [name,value]of Object.entries(files)){
    const filename=Buffer.from(name),raw=Buffer.from(value),packed=deflateRawSync(raw,{level:9}),crc=crc32(raw),h=Buffer.alloc(30),c=Buffer.alloc(46);
    h.writeUInt32LE(0x04034b50);h.writeUInt16LE(20,4);h.writeUInt16LE(0x800,6);h.writeUInt16LE(8,8);h.writeUInt16LE(33,12);h.writeUInt32LE(crc,14);h.writeUInt32LE(packed.length,18);h.writeUInt32LE(raw.length,22);h.writeUInt16LE(filename.length,26);
    c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(0x800,8);c.writeUInt16LE(8,10);c.writeUInt16LE(33,14);c.writeUInt32LE(crc,16);c.writeUInt32LE(packed.length,20);c.writeUInt32LE(raw.length,24);c.writeUInt16LE(filename.length,28);c.writeUInt32LE(offset,42);
    local.push(h,filename,packed);central.push(c,filename);offset+=h.length+filename.length+packed.length;
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22),count=Object.keys(files).length;
  end.writeUInt32LE(0x06054b50);end.writeUInt16LE(count,8);end.writeUInt16LE(count,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,directory,end]);
}
export function buildPublisher(root,destination,web=false){
  const state=inventory(root),data={snapshot:state.snapshot,assets:state.assets};
  const code=`${linkMaster.toString()}\n${archiveApproval.toString()}\n${runPublisher.toString()}\nfigma.showUI(__html__,{width:420,height:660,themeColors:true});\nrunPublisher(figma,${JSON.stringify(data)},linkMaster,archiveApproval).catch(error=>figma.ui.postMessage({type:'error',text:error.message}));\n`;
  const manifest={name:'cells.garden — Dev ready',api:'1.0.0',main:'code.js',ui:'ui.html',editorType:['figma'],documentAccess:'dynamic-page',enablePrivatePluginApi:true,networkAccess:{allowedDomains:['none']}};
  const files={
    'manifest.json':JSON.stringify(manifest,null,2)+'\n',
    'code.js':code,
    'ui.html':fs.readFileSync(fileURLToPath(new URL('../figma/publisher/ui.html',import.meta.url)),'utf8'),
    'README.txt':'cells.garden — Dev ready\n\nOne-time installation in Figma desktop:\nPlugins > Development > Import plugin from manifest. Select manifest.json. This is a local/private plugin, not a published Community listing. If Figma asks for a plugin ID, create a new development plugin once and retain the ID Figma assigns in this manifest. Do not invent or reuse another plugin ID.\n\nOpen the original master Q9lb9XG2ftZZHswUg5zYkS with editing access. Run Connect artwork once. Select the changed artwork and press Dev ready. This retains the approved image hashes and saves an approval checkpoint, not an immediate deployment. Publishing status opens the actual GitHub result; Open dev opens the preview.\n\nNo tokens, external network requests, file moves or sharing changes. Native PNG image fills only; overlays and effects are not exported. The animated GIF stays in Git. New asset paths or dimensions require a reviewed contract update and a fresh plugin build.\n\nAdmin setup: https://github.com/lukketsvane/cells.garden/blob/main/figma/PUBLISHING.md\n'
  };
  fs.mkdirSync(destination,{recursive:true});for(const [name,value]of Object.entries(files))fs.writeFileSync(path.join(destination,name),value);
  const archive=zipFiles(files);fs.writeFileSync(path.join(destination,'cells-garden-dev-ready.zip'),archive);
  if(web){fs.mkdirSync(path.join(root,'public'),{recursive:true});fs.writeFileSync(path.join(root,'public/figma-publisher.zip'),archive);}
  return {destination,pngCount:state.assets.length,snapshot:state.snapshot,archiveBytes:archive.length};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){const web=process.argv.includes('--web');const destination=path.resolve(web?'dist-figma-publisher':process.argv[2]||'dist-figma-publisher');console.log(JSON.stringify(buildPublisher(process.cwd(),destination,web),null,2));}
