/** Run only through an authorized Figma Plugin API session in the confirmed file.
 * This module contains no network calls, tokens, file moves or permission changes.
 * Existing source artwork is never resized, replaced, deleted or detached.
 */
export async function linkMaster(figma, payload) {
  const MASTER = 'Q9lb9XG2ftZZHswUg5zYkS';
  const PAGE = '27:1966';
  if (figma.fileKey !== MASTER || payload.fileKey !== MASTER) {
    throw new Error('Open the confirmed master with verified editing access; file identity is required.');
  }
  if (!['link', 'report'].includes(payload.mode)) throw new Error('Unknown migration operation');
  const page = await figma.getNodeByIdAsync(PAGE);
  if (!page || page.type !== 'PAGE') throw new Error('Confirmed ASSETS page is missing');
  await figma.setCurrentPageAsync(page);
  const createdNodeIds = [], mutatedNodeIds = [], rows = [];
  const unique = (list, what) => {
    if (list.length > 1) throw new Error(`Ambiguous ${what}; resolve duplicates before retrying.`);
    return list[0] || null;
  };
  const decode = (s) => {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const out = []; let bits = 0, value = 0;
    for (const c of s.replace(/=+$/, '')) {
      const n = alphabet.indexOf(c);
      if (n < 0) throw new Error('Invalid embedded PNG');
      value = (value << 6) | n; bits += 6;
      if (bits >= 8) { bits -= 8; out.push((value >> bits) & 255); }
    }
    return new Uint8Array(out);
  };
  const pngSize = (b) => {
    const sig = [137,80,78,71,13,10,26,10];
    if (b.length < 24 || !sig.every((v,i)=>b[i]===v)) throw new Error('Source is not a native PNG');
    const u32 = (p) => b[p]*16777216+b[p+1]*65536+b[p+2]*256+b[p+3];
    return {width:u32(16),height:u32(20)};
  };
  function refs(node, set = new Set()) {
    if ('fills' in node && Array.isArray(node.fills)) {
      for (const p of node.fills) if (p.type === 'IMAGE' && p.imageHash) set.add(p.imageHash);
    }
    if ('children' in node) for (const child of node.children) refs(child, set);
    return set;
  }
  const within = (n, ancestor) => {
    for (let p=n; p; p=p.parent) if (p.id === ancestor.id) return true;
    return false;
  };
  let section = unique(page.children.filter(n=>n.type==='SECTION'&&n.name==='EXPORTS'), 'EXPORTS section');
  const additions = unique(page.children.filter(n=>n.type==='SECTION'&&n.name==='GIT SOURCE ADDITIONS'), 'source additions section');
  const pending = [];
  const paths = new Set();
  // All assets in this batch are inspected before the first mutation.
  for (const asset of payload.assets) {
    if (!/^src\/assets\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.png$/.test(asset.path) || asset.path.includes('..')) throw new Error('Unsafe asset path');
    if (paths.has(asset.path)) throw new Error(`Duplicate path: ${asset.path}`);
    paths.add(asset.path);
    if (!Number.isInteger(asset.width) || !Number.isInteger(asset.height) || asset.width < 1 || asset.height < 1 || asset.width > 4096 || asset.height > 4096) throw new Error(`Invalid native size: ${asset.path}`);
    const sourceName = asset.path === 'src/assets/void_tile.png' ? 'Source/Environment/Void Tile' : `Source/Repository/${asset.path}`;
    let wrapper = section ? unique(section.findAll(n=>n.name===asset.path), asset.path) : null;
    let source = null;
    if (wrapper) {
      if (wrapper.type !== 'FRAME' || wrapper.width !== asset.width || wrapper.height !== asset.height || wrapper.children.length !== 1 || wrapper.children[0].type !== 'INSTANCE') throw new Error(`Export frame drift: ${asset.path}`);
      source = await wrapper.children[0].getMainComponentAsync();
      if (!source) throw new Error(`Detached source: ${asset.path}`);
    } else {
      source = unique(page.findAll(n=>n.type==='COMPONENT'&&n.name===sourceName), sourceName);
      if (!source && asset.candidateId) source = await figma.getNodeByIdAsync(asset.candidateId);
    }
    if (source) {
      if (source.type !== 'COMPONENT' || !within(source, page)) throw new Error(`Source is not a local ASSETS component: ${asset.path}`);
      const imageRefs = [...refs(source)];
      if (imageRefs.length !== 1) throw new Error(`Expected one original image fill: ${asset.path}`);
      const image = figma.getImageByHash(imageRefs[0]);
      if (!image) throw new Error(`Image fill unavailable: ${asset.path}`);
      const native = pngSize(await image.getBytesAsync());
      if (native.width !== asset.width || native.height !== asset.height) throw new Error(`Native image size differs for ${asset.path}; review the designer's edit, do not overwrite it.`);
    } else if (payload.mode === 'report') {
      throw new Error(`Source has not been linked: ${asset.path}`);
    } else {
      const b = decode(asset.png || ''); const size = pngSize(b);
      if (size.width !== asset.width || size.height !== asset.height) throw new Error(`Embedded image size differs: ${asset.path}`);
    }
    if (payload.mode === 'report' && !wrapper) throw new Error(`Missing export: ${asset.path}`);
    pending.push({asset,sourceName,source,wrapper});
  }
  if (payload.mode === 'report') {
    const actual = section.findAll(n=>n.type==='FRAME'&&n.name.startsWith('src/assets/')&&n.name.endsWith('.png'));
    if (actual.length !== paths.size || actual.some(n=>!paths.has(n.name))) throw new Error('Unexpected or missing export paths');
  }
  const right = () => Math.max(0, ...page.children.map(n=>n.x+n.width)) + 120;
  const remember = (node) => {createdNodeIds.push(node.id); return node;};
  const nativeSize = (node,w,h) => {node.resize(w,h); node.fills=[]; node.clipsContent=true;};
  let sourceSection = additions;
  for (const p of pending) {
    const a = p.asset;
    if (!section) {
      section = remember(figma.createSection()); section.name='EXPORTS'; section.x=right(); section.y=0; section.resizeWithoutConstraints(1100,200);
    }
    if (!p.source) {
      if (!sourceSection) {
        sourceSection = remember(figma.createSection()); sourceSection.name='GIT SOURCE ADDITIONS'; sourceSection.x=right(); sourceSection.y=0; sourceSection.resizeWithoutConstraints(1100,200);
      }
      const bottom = Math.max(0,...sourceSection.children.map(n=>n.y+n.height));
      const image = figma.createImage(decode(a.png));
      p.source = remember(figma.createComponent());
      p.source.name=p.sourceName; p.source.resize(a.width,a.height);
      p.source.fills=[{type:'IMAGE',imageHash:image.hash,scaleMode:'FILL'}];
      p.source.description=`Native ${a.width}x${a.height} PNG. Git: https://github.com/lukketsvane/cells.garden/blob/main/${a.path}. Replace the image fill, not the component. The sync reads original PNG bytes, not vector layers or a resized render.`;
      sourceSection.appendChild(p.source);p.source.x=24;p.source.y=bottom+24;
      sourceSection.resizeWithoutConstraints(Math.max(sourceSection.width,a.width+48),p.source.y+a.height+24);
      mutatedNodeIds.push(sourceSection.id);
    }
    if (!p.wrapper) {
      const folderName = a.path.slice(0,a.path.lastIndexOf('/'));
      let folder = unique(section.children.filter(n=>n.name===folderName),folderName);
      if (folder && folder.type !== 'FRAME') throw new Error(`Export folder is not a frame: ${folderName}`);
      if (!folder) {
        folder = remember(figma.createFrame());folder.name=folderName;folder.fills=[];
        folder.resize(Math.max(1000,a.width+48),50);folder.layoutMode='HORIZONTAL';folder.layoutWrap='WRAP';
        folder.primaryAxisSizingMode='FIXED';folder.counterAxisSizingMode='AUTO';folder.itemSpacing=12;folder.counterAxisSpacing=12;
        folder.paddingTop=folder.paddingBottom=folder.paddingLeft=folder.paddingRight=24;
        section.appendChild(folder);
      }
      if (folder.width < a.width+48) {folder.resize(a.width+48,folder.height);folder.counterAxisSizingMode='AUTO';}
      p.wrapper=remember(figma.createFrame());p.wrapper.name=a.path;nativeSize(p.wrapper,a.width,a.height);
      p.wrapper.exportSettings=[{format:'PNG',suffix:'',constraint:{type:'SCALE',value:1}}];
      folder.appendChild(p.wrapper);
      const instance=remember(p.source.createInstance());p.wrapper.appendChild(instance);instance.x=0;instance.y=0;instance.resize(a.width,a.height);
      mutatedNodeIds.push(folder.id,section.id);
    }
    rows.push({path:a.path,width:a.width,height:a.height,sourceComponentId:p.source.id,exportNodeId:p.wrapper.id,sourceWidth:p.source.width,sourceHeight:p.source.height});
  }
  if (payload.mode === 'link' && section) {
    let y=32, width=0;
    for (const folder of section.children) {folder.x=24;folder.y=y;y+=folder.height+24;width=Math.max(width,folder.width);mutatedNodeIds.push(folder.id);}
    section.resizeWithoutConstraints(width+48,y+8);mutatedNodeIds.push(section.id);
  }
  return {kind:'cells.garden-master-migration',fileKey:MASTER,pageId:PAGE,exportSectionId:section.id,snapshot:payload.snapshot,rows,createdNodeIds,mutatedNodeIds:[...new Set(mutatedNodeIds)]};
}
