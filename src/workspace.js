export function createWorkspace({api,command,getState,showSidebar,reportError,escapeHTML:esc}){
  const $=s=>document.querySelector(s);
  let root='',selected='',expanded=new Set(),cache=new Map(),revision=0,nameAction='',nameTarget='';
  function tab(which){
    $('#files-panel').hidden=which!=='files';$('#writer-outline').hidden=which!=='outline';
    $('#files-tab').setAttribute('aria-pressed',String(which==='files'));$('#outline-tab').setAttribute('aria-pressed',String(which==='outline'));
  }
  function currentRelative(){const state=getState();return root&&state.path.startsWith(root+'/')?state.path.slice(root.length+1):null;}
  function controls(){$('#files-refresh').disabled=!root;}
  function render(){
    const current=currentRelative();
    function rows(parent,depth=0){
      const entries=cache.get(parent)||[];
      return entries.map(entry=>{
        const active=entry.directory?entry.path===selected:entry.path===current;
        const button=`<button class="file-row${active?' selected':''}" data-path="${esc(entry.path)}" data-directory="${entry.directory}" style="--depth:${depth}" title="${esc(entry.path)}" ${entry.directory?`aria-expanded="${expanded.has(entry.path)}"`:active?'aria-current="page"':''}><span class="file-symbol" aria-hidden="true">${entry.directory?(expanded.has(entry.path)?'⌄':'›'):'≡'}</span><span>${esc(entry.name)}</span>${!entry.directory&&active&&getState().dirty?'<span class="file-dirty" aria-label="未保存">●</span>':''}</button>`;
        return button+(entry.directory&&expanded.has(entry.path)?`<div class="file-children">${cache.has(entry.path)?(rows(entry.path,depth+1)||'<p class="file-empty">空文件夹</p>'):'<p class="file-empty">读取中…</p>'}</div>`:'');
      }).join('');
    }
    $('#file-tree').innerHTML=root?(rows('')||'<p class="file-empty">还没有 Markdown 文件</p>'):'<button class="files-welcome" data-command="open-folder">打开文件夹</button><p class="file-empty">在这里管理本地文档</p>';
    controls();
  }
  async function refresh(){
    const id=++revision;if(!root){cache.clear();render();return;}
    const paths=['',...expanded],results=await Promise.all(paths.map(async p=>({path:p,result:await api.list(p)})));
    if(id!==revision)return;
    for(const {path,result} of results){if(result.error){cache.delete(path);expanded.delete(path);if(path==='')reportError(result.error);}else cache.set(path,result.entries);}
    // A removed directory must not remain the destination for newly created files.
    if(selected&&!Array.from(cache.values()).flat().some(e=>e.directory&&e.path===selected))selected='';
    render();
  }
  async function sync({reveal=false}={}){
    const next=getState().workspace,changed=root!==(next?.path||'');root=next?.path||'';
    if(changed){selected='';expanded.clear();cache.clear();}
    $('#folder-name').textContent=next?.name||'打开文件夹…';$('#folder-name').title=next?.path||'打开文件夹';
    const current=currentRelative();
    if(current){const parts=current.split('/');parts.pop();let parent='';for(const part of parts){parent=parent?parent+'/'+part:part;expanded.add(parent);}}
    if(reveal){tab('files');showSidebar();}
    await refresh();
  }
  $('#files-tab').addEventListener('click',()=>tab('files'));
  $('#outline-tab').addEventListener('click',()=>tab('outline'));
  $('#files-refresh').addEventListener('click',()=>refresh().catch(e=>reportError(e.message)));
  $('#file-tree').addEventListener('click',async event=>{
    const button=event.target.closest('[data-path]');if(!button)return;
    if(button.dataset.directory==='true'){
      selected=button.dataset.path;
      if(expanded.has(selected))expanded.delete(selected);else expanded.add(selected);
      render();await refresh();
    }else await command('open-entry',button.dataset.path);
  });
  function askName(action,target){
    nameAction=action;nameTarget=target;
    const name=target.split('/').pop();
    $('#file-name-title').textContent={'create-file':'新建文件','create-folder':'新建文件夹','rename-file':'重命名文件'}[nameAction];
    $('#file-name-location').textContent=nameAction==='rename-file'?name:(target||getState().workspace?.name||'');
    $('#file-name-input').value=nameAction==='rename-file'?name:'';
    $('#file-name-error').hidden=true;$('#file-name-dialog').showModal();$('#file-name-input').focus();$('#file-name-input').select();
  }
  let menuOpen=false;
  async function context(event){
    event.preventDefault();if(menuOpen)return;
    const row=event.target.closest('[data-path]'),target=row?.dataset.path||'';
    menuOpen=true;row?.classList.add('context-target');
    try{
      const result=await api.context(target);
      if(result?.error){reportError(result.error);return;}
      if(!result)return;
      if(['create-file','create-folder','rename-file'].includes(result.action))askName(result.action,result.path);
      else if(result.action==='refresh')await refresh();
      else await command(result.action,result.path);
    }catch(error){reportError(error.message);}
    finally{menuOpen=false;row?.classList.remove('context-target');}
  }
  $('#files-panel').addEventListener('contextmenu',context);
  $('#file-tree').addEventListener('keydown',event=>{
    if(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10')context(event);
  });
  $('#file-name-cancel').addEventListener('click',()=>$('#file-name-dialog').close());
  $('#file-name-form').addEventListener('submit',async event=>{
    event.preventDefault();const input=$('#file-name-input'),submit=$('#file-name-form [type="submit"]');submit.disabled=true;
    const result=await command(nameAction,nameAction==='rename-file'?{name:input.value,path:nameTarget}:{name:input.value,parent:nameTarget});submit.disabled=false;
    if(result?.error){$('#file-name-error').textContent=result.error;$('#file-name-error').hidden=false;}
    else $('#file-name-dialog').close();
  });
  return {sync,render,tab};
}
