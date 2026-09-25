/** Local/private Figma plugin. No network requests, tokens or permission changes. */
export async function runPublisher(figma,data,linkMaster,keepImages=async()=>{}){
  const MASTER='Q9lb9XG2ftZZHswUg5zYkS',LABEL='cells.garden / Dev ready';
  let busy=false,inspecting=false;
  const send=value=>figma.ui.postMessage(value),wait=ms=>new Promise(r=>setTimeout(r,ms));
  function assertFile(){if(figma.fileKey!==MASTER||figma.editorType!=='figma')throw new Error('Open the original cells.garden ASSETS file with edit access. Copies are not accepted.');}
  function within(node,ancestor){for(let n=node;n;n=n.parent)if(n.id===ancestor.id)return true;return false;}
  function images(n,out=new Set()){if('fills'in n&&Array.isArray(n.fills))for(const f of n.fills)if(f.type==='IMAGE'&&f.imageHash)out.add(f.imageHash);if('children'in n)for(const c of n.children)images(c,out);return out;}
  async function inspect(){
    assertFile();const selected=[...figma.currentPage.selection];
    const report=await linkMaster(figma,{fileKey:MASTER,snapshot:data.snapshot,mode:'report',assets:data.assets.map(({png,...a})=>a)});
    const rows=[];
    for(const a of report.rows){const source=await figma.getNodeByIdAsync(a.sourceComponentId),frame=await figma.getNodeByIdAsync(a.exportNodeId);if(selected.some(n=>within(source,n)||within(frame,n)||within(n,source)||within(n,frame)))rows.push(a);}
    return {report,selected:rows};
  }
  async function refresh(){
    if(busy||inspecting)return;inspecting=true;
    try{const {report,selected}=await inspect();send({type:'selection',connected:true,total:report.rows.length,paths:selected.map(a=>a.path)});}
    catch(error){send({type:'selection',connected:false,total:data.assets.length,paths:[],message:error.message});}
    finally{inspecting=false;}
  }
  async function approved(rows){
    const result=[];
    for(const a of rows){const source=await figma.getNodeByIdAsync(a.sourceComponentId),refs=[...images(source)];if(refs.length!==1||! /^[a-f0-9]{40,64}$/.test(refs[0]))throw new Error(`Replace the single original PNG image fill for ${a.path}; vector overlays are not exported.`);const size=await figma.getImageByHash(refs[0]).getSizeAsync();if(size.width!==a.width||size.height!==a.height)throw new Error(`Keep the native PNG dimensions for ${a.path}.`);result.push({path:a.path,imageRef:refs[0]});}
    return result.sort((a,b)=>a.path.localeCompare(b.path));
  }
  figma.ui.onmessage=async message=>{
    if(message?.type==='open-status'){figma.openExternal('https://github.com/lukketsvane/cells.garden/actions/workflows/figma-publish.yml');return;}
    if(message?.type==='open-preview'){figma.openExternal('https://dev.cells.garden');return;}
    if(message?.type==='refresh'){await refresh();return;}
    if(busy||inspecting||!['connect','ready'].includes(message?.type))return;
    busy=true;send({type:'busy',value:true});
    try{
      assertFile();
      if(message.type==='connect'){
        send({type:'status',text:'Checking sources and connecting native PNGs. Existing drawings will not be replaced.'});
        const report=await linkMaster(figma,{fileKey:MASTER,snapshot:data.snapshot,mode:'link',assets:data.assets});
        await wait(1200);const section=await figma.getNodeByIdAsync(report.exportSectionId);figma.currentPage.selection=[section];figma.viewport.scrollAndZoomIntoView([section]);
        send({type:'status',text:`${report.rows.length} PNGs connected. The animated GIF stays in Git. Nothing is published. Select the artwork you want to approve.`});
      }else{
        const {report,selected}=await inspect(),rows=message.all===true?report.rows:selected;
        if(!rows.length)throw new Error('Select connected artwork, or explicitly approve the whole collection.');
        const assets=await approved(rows);send({type:'status',text:`Saving an approval checkpoint for ${assets.length} PNGs…`});
        await keepImages(figma,assets);
        await wait(1200);if(JSON.stringify(assets)!==JSON.stringify(await approved(rows)))throw new Error('Artwork changed during approval. Wait for edits to finish and try again.');
        const description=JSON.stringify({kind:'cells.garden-ready',fileKey:MASTER,target:'dev',assets});
        if(description.length>60000)throw new Error('Select a smaller group of assets.');
        const version=await figma.saveVersionHistoryAsync(LABEL,description);
        if(!version?.id)throw new Error('Figma did not confirm a saved version. Nothing was queued.');
        send({type:'queued',versionId:version.id,text:`Approval saved for ${assets.length} PNGs. GitHub will verify this exact checkpoint before publishing to dev.cells.garden. Queued, not yet live. Production is unchanged.`});
      }
    }catch(error){send({type:'error',text:error.message});}
    finally{busy=false;send({type:'busy',value:false});await refresh();}
  };
  figma.on('selectionchange',()=>{if(!busy&&!inspecting)void refresh();});
  await refresh();
}
