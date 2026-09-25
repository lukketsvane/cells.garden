/** Retain approved image hashes while the designer continues editing live sources. */
export async function archiveApproval(figma,assets){
  if(figma.fileKey!=='Q9lb9XG2ftZZHswUg5zYkS')throw new Error('Confirmed master required');
  const page=await figma.getNodeByIdAsync('27:1966');
  if(!page||page.type!=='PAGE')throw new Error('ASSETS page is missing');
  await figma.setCurrentPageAsync(page);
  const name='PUBLISHER / immutable image checkpoints';
  const matches=page.children.filter(n=>n.name===name);
  if(matches.length>1||(matches[0]&&matches[0].type!=='SECTION'))throw new Error('Resolve the ambiguous publisher checkpoint section');
  const pending=[];
  for(const a of assets){const image=figma.getImageByHash(a.imageRef);if(!image)throw new Error(`Approved image is unavailable: ${a.path}`);const size=await image.getSizeAsync();if(size.width<1||size.height<1||size.width>4096||size.height>4096)throw new Error('Unsupported checkpoint image size');pending.push({...a,...size});}
  if(!pending.length)throw new Error('No approved artwork');
  let section=matches[0];
  if(!section){const x=Math.max(0,...page.children.map(n=>n.x+n.width))+120;section=figma.createSection();section.name=name;section.x=x;section.y=0;section.resizeWithoutConstraints(1100,100);}
  const bottom=Math.max(0,...section.children.map(n=>n.y+n.height));
  const bundle=figma.createFrame();bundle.name=`Dev ready checkpoint ${new Date().toISOString()}`;bundle.fills=[];bundle.resize(Math.max(1000,...pending.map(a=>a.width+48)),100);bundle.layoutMode='HORIZONTAL';bundle.layoutWrap='WRAP';bundle.primaryAxisSizingMode='FIXED';bundle.counterAxisSizingMode='AUTO';bundle.itemSpacing=12;bundle.counterAxisSpacing=12;bundle.paddingLeft=bundle.paddingRight=bundle.paddingTop=bundle.paddingBottom=24;section.appendChild(bundle);bundle.x=24;bundle.y=bottom+24;
  for(const a of pending){const node=figma.createRectangle();node.name=a.path;node.resize(a.width,a.height);node.fills=[{type:'IMAGE',imageHash:a.imageRef,scaleMode:'FILL'}];bundle.appendChild(node);}
  bundle.locked=true;section.resizeWithoutConstraints(Math.max(section.width,bundle.width+48),bundle.y+bundle.height+24);
  // No linked instances here: later source edits must not change approval pixels.
  // Figma's original-image endpoint can still resolve each retained hash.
  await new Promise(resolve=>setTimeout(resolve,1200));
  return bundle.id;
}
