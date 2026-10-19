import Editor,{createInteractions} from './editor-vendor.js';
import {markdown,markdownHeadings,escapeHTML as esc} from './markdown.js';
import {createWorkspace} from './workspace.js';
import './writer.css';
import './desktop.css';
const $=selector=>document.querySelector(selector),page=$('#editor-page'),api=window.writerDesktop;
let editor,baseline='',loadedContent='',loadedRepresentation='',state={name:'未命名.md',path:'',content:'',dirty:false},mode='wysiwyg',loading=false,busy=false,side=true,findIndex=-1,headings=[],typingFrame,outlineTimer;
const content=()=>{const text=editor?.getMarkdown()||'';return text===loadedRepresentation?loadedContent:text;};
const workspace=createWorkspace({api,command,getState:()=>({...state,dirty:content()!==baseline}),showSidebar:()=>{if(!side)toggleOutline();},reportError:message=>error(message),escapeHTML:esc});
function error(message=''){$('#writer-error').hidden=!message;$('#writer-error').textContent=message;}
const interactions=createInteractions(({block,language,inlineCode})=>{
  const enabled=mode==='wysiwyg';
  $('#writer-block-actions').hidden=!enabled||!block;
  $('#writer-block-label').textContent=block==='table'?'表格':'代码块';
  $('#writer-block-delete').textContent=block==='table'?'删除表格':'删除代码块';
  $('#writer-code-language').hidden=block!=='codeBlock';$('#writer-block-plain').hidden=block!=='codeBlock';
  if(document.activeElement!==$('#writer-code-language'))$('#writer-code-language').value=language||'';
  $('#writer-inline-hint').hidden=!enabled||!inlineCode||!!block;
  document.querySelectorAll('#writing-editor button.code').forEach(button=>{button.classList.toggle('active',!!inlineCode);button.setAttribute('aria-pressed',String(!!inlineCode));});
});
function status(){
  workspace.render();
  const text=content();$('#writer-count').textContent=`${text.replace(/\s/g,'').length.toLocaleString()} 字 · ${text.split('\n').length} 行`;
  $('#document-name').textContent=(text!==baseline?'● ':'')+state.name;
  $('#document-path').textContent=state.path;$('#document-path').title=state.path;
  $('#writer-status').textContent=text!==baseline?'未保存 · 草稿自动恢复开启':'已保存';
}
function changed(){
  if(loading||busy)return;
  status();api.change(content()).catch(()=>error('草稿恢复暂时不可用，请及时保存文件。'));
  clearTimeout(outlineTimer);outlineTimer=setTimeout(outline,150);
  if(!$('#writer-find').hidden)search(false);
}
function outline(){
  headings=markdownHeadings(content());
  $('#writer-outline').innerHTML=headings.length?headings.map((h,i)=>`<button data-heading="${i}" class="writer-level-${h.level}">${esc(h.text||'未命名标题')}</button>`).join(''):'<p>添加标题后显示大纲</p>';
}
function toggleOutline(){side=!side;page.classList.toggle('with-outline',side);$('#writer-sidebar').inert=!side;$('#writer-sidebar').setAttribute('aria-hidden',String(!side));$('#writer-outline-toggle').setAttribute('aria-expanded',String(side));}
function baseURL(){let base=document.querySelector('base');if(!base){base=document.createElement('base');document.head.append(base);}base.href='document-image://local/';}
function renderPreview(){
  $('#reading-preview').innerHTML=markdown(content());
  $('#reading-preview').querySelectorAll('h1,h2,h3,h4,h5,h6').forEach((h,i)=>h.id=`preview-heading-${i}`);
}
function setMode(next){
  if(!editor)return;
  const before=content();loading=true;
  if(mode==='preview')$('#reading-preview').hidden=true;
  mode=next;page.dataset.mode=next;$('#writing-mode').value=next;
  $('#writing-editor').hidden=next==='preview';
  if(next==='preview'){$('#reading-preview').hidden=false;renderPreview();}
  else{editor.changePreviewStyle(next==='split'?'vertical':'tab');editor.changeMode(next==='wysiwyg'?'wysiwyg':'markdown',true);}
  if(before===loadedContent)loadedRepresentation=editor.getMarkdown();
  loading=false;interactions.refresh();outline();status();
  if(!$('#writer-find').hidden){findIndex=-1;search(true);}
}
async function addImage(blob,callback){
  if(blob.size>8*1024*1024||!/^image\/(png|jpeg|gif|webp|avif|bmp)$/.test(blob.type)){error('请选择 8 MB 以内的 PNG、JPEG、GIF、WebP、AVIF 或 BMP 图片。');return;}
  const current=editor;
  const reader=new FileReader();reader.onload=()=>{if(editor===current){callback(reader.result,blob.name||'图片');changed();}};reader.onerror=()=>error('图片读取失败。');reader.readAsDataURL(blob);
}
function loadDocument(next){
  loading=true;interactions.dispose();editor?.destroy();
  state=next;baseline=next.baseline??next.content;loadedContent=next.content;baseURL();
  const historyGuard=({pmState:{Plugin}})=>({markdownPlugins:[()=>new Plugin({filterTransaction(tr){if(loading)tr.setMeta('addToHistory',false);return true;}})],wysiwygPlugins:[()=>new Plugin({filterTransaction(tr){if(loading)tr.setMeta('addToHistory',false);return true;}})]});
  editor=new Editor({el:$('#writing-editor'),height:'100%',minHeight:'200px',initialEditType:mode==='wysiwyg'?'wysiwyg':'markdown',initialValue:next.content,language:'zh-CN',usageStatistics:false,hideModeSwitch:true,autofocus:false,placeholder:'开始写吧…',plugins:[historyGuard,interactions.plugin],linkAttributes:{target:'_blank',rel:'noopener noreferrer'},toolbarItems:[['heading','bold','italic','strike'],['hr','quote'],[{name:'ul',className:'toastui-editor-toolbar-icons bullet-list',tooltip:'无序列表',command:'writerBullet',state:'bulletList'},{name:'ol',className:'toastui-editor-toolbar-icons ordered-list',tooltip:'有序列表',command:'writerOrdered',state:'orderedList'},{name:'task',className:'toastui-editor-toolbar-icons task-list',tooltip:'任务列表',command:'writerTask',state:'taskList'}],['table','image','link'],[{name:'code',className:'toastui-editor-toolbar-icons code',tooltip:'内嵌代码',command:'writerCode',state:'code'},{name:'codeblock',className:'toastui-editor-toolbar-icons codeblock',tooltip:'代码块',command:'writerCodeBlock',state:'codeBlock'}],[{name:'undo',text:'↶',tooltip:'撤销',command:'undo',className:'writer-history'},{name:'redo',text:'↷',tooltip:'重做',command:'redo',className:'writer-history'}]],hooks:{addImageBlobHook:addImage},events:{change:changed,caretChange:()=>{cancelAnimationFrame(typingFrame);if(page.classList.contains('typewriter-mode'))typingFrame=requestAnimationFrame(()=>interactions.centerCaret());}}});
  // Preserve the exact source until a real edit, even if Toast UI normalizes it.
  loadedRepresentation=editor.getMarkdown();
  $('#find-query').value='';$('#replace-query').value='';findIndex=-1;$('#writer-find').hidden=true;
  loading=false;setMode(mode);status();
  for(const [el,label] of [[editor.getEditorElements().mdEditor,'Markdown 正文'],[editor.getEditorElements().wwEditor,'文档正文']]){const box=el.querySelector('.ProseMirror');box?.setAttribute('role','textbox');box?.setAttribute('aria-label',label);}
  if(next.dirty)$('#writer-status').textContent='已恢复未保存草稿，请保存到文件';
}
function previewMatches(query){
  renderPreview();if(!query)return [];
  const root=$('#reading-preview'),walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT),nodes=[];
  while(walker.nextNode())if(walker.currentNode.textContent.includes(query))nodes.push(walker.currentNode);
  const marks=[];
  for(const node of nodes){const parts=node.textContent.split(query),fragment=document.createDocumentFragment();parts.forEach((part,i)=>{if(i){const mark=document.createElement('mark');mark.className='writer-search-match';mark.textContent=query;marks.push(mark);fragment.append(mark);}fragment.append(document.createTextNode(part));});node.replaceWith(fragment);}
  return marks;
}
function search(advance=false,step=1){
  const query=$('#find-query').value;
  const marks=mode==='preview'?previewMatches(query):null;
  const count=marks?marks.length:interactions.searchCount(query);
  if(!count)findIndex=-1;else if(advance)findIndex=(findIndex+step+count)%count;else findIndex=Math.min(findIndex,count-1);
  $('#find-count').textContent=count?`${Math.max(0,findIndex+1)} / ${count}`:'无匹配';
  $('#replace-one').disabled=$('#replace-all').disabled=mode==='preview';
  if(marks){marks[findIndex]?.classList.add('writer-search-current');if(advance)marks[findIndex]?.scrollIntoView({block:'center',behavior:'instant'});}
  else{interactions.search(query,findIndex);if(advance)requestAnimationFrame(()=>interactions.locateMatch());}
}
function toggleFind(open){$('#writer-find').hidden=!open;if(open){$('#find-query').focus();search(true);}else{interactions.search('',-1);if(mode==='preview')renderPreview();}}
const exportCSS='body{max-width:780px;margin:40px auto;padding:0 24px;color:#171717;font:16px/1.85 system-ui,sans-serif;overflow-wrap:anywhere}h1,h2,h3{line-height:1.4}pre{background:#f5f5f5;padding:18px;white-space:pre-wrap}img{max-width:100%}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:8px}blockquote{border-left:3px solid #ddd;margin-left:0;padding-left:20px}a{color:inherit}@media print{body{margin:0}pre,img{break-inside:avoid}}';
async function exportedHTML(){
  const root=document.createElement('div');root.innerHTML=markdown(content());
  for(const img of root.querySelectorAll('img')){
    const source=img.getAttribute('src')||'';img.removeAttribute('loading');
    if(!/^(?:data:|https?:|\/\/)/i.test(source)){
      const result=await api.action('image-data',content(),decodeURIComponent(new URL(source,'document-image://local/').pathname));
      if(result.error)throw Error(`无法导出图片 ${source}：${result.error}`);img.src=result.data;
    }
  }
  return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:;"><title>${esc(state.name)}</title><style>${exportCSS}</style></head><body>${root.innerHTML}</body></html>`;
}
async function command(name,extra){
  if(!editor||busy)return;
  $('#writing-menu').open=false;
  if(name==='recovery-error'){error('草稿备份失败，请及时保存文件。');return;}
  if(['wysiwyg','markdown','split','preview'].includes(name)){setMode(name);return;}
  if(name==='outline'){workspace.tab('outline');if(!side)toggleOutline();return;}
  if(name==='find'){toggleFind(true);return;}
  if(name==='focus'||name==='typewriter'){const active=page.classList.toggle(name+'-mode');$(`[data-command="${name}"]`).setAttribute('aria-pressed',String(active));return;}
  error();busy=true;page.inert=true;
  try{
    const text=content(),html=['html','pdf'].includes(name)?await exportedHTML():undefined;
    const next=await api.action(name,text,html??extra);
    if(next?.error)throw Error(next.error);
    if(next&&!next.cancelled&&typeof next.content==='string'){
      if(next.content!==text||next.path!==state.path&&!['rename-file','save-as','save'].includes(name)||['new','create-file'].includes(name)){if(['new','create-file','trash-file'].includes(name)&&mode==='preview')mode='wysiwyg';loadDocument(next);}
      else{state=next;if(!next.dirty)baseline=text;status();}
      await workspace.sync({reveal:name==='open-folder'});
    }
    return next;
  }catch(cause){error(cause.message);return {error:cause.message};}finally{busy=false;page.inert=false;}
}
document.addEventListener('click',event=>{const button=event.target.closest('[data-command]');if(button)command(button.dataset.command);});
$('#writing-mode').addEventListener('change',event=>setMode(event.target.value));
$('#writer-outline-toggle').addEventListener('click',toggleOutline);
$('#writer-outline').addEventListener('click',event=>{const button=event.target.closest('[data-heading]');if(!button)return;const index=Number(button.dataset.heading),heading=headings[index];if(mode==='preview')$(`#preview-heading-${index}`)?.scrollIntoView({block:'start',behavior:'smooth'});else if(editor.isMarkdownMode())editor.setSelection([heading.line,1]);else editor.getEditorElements().wwEditor.querySelectorAll('h1,h2,h3,h4,h5,h6')[index]?.scrollIntoView({block:'start',behavior:'smooth'});$('#writer-outline').querySelectorAll('button').forEach((b,i)=>{if(i===index)b.setAttribute('aria-current','location');else b.removeAttribute('aria-current');});});
$('#writer-block-delete').addEventListener('click',()=>interactions.removeBlock());
$('#writer-block-exit').addEventListener('click',()=>interactions.exitBlock());
$('#writer-block-plain').addEventListener('click',()=>interactions.toParagraph());
$('#writer-code-language').addEventListener('input',event=>interactions.language(event.target.value));
$('#writer-block-actions').addEventListener('mousedown',event=>{if(event.target.closest('button'))event.preventDefault();});
$('#writer-find-toggle').addEventListener('click',()=>toggleFind($('#writer-find').hidden));
$('#find-close').addEventListener('click',()=>toggleFind(false));
$('#find-query').addEventListener('input',()=>{findIndex=-1;search(true);});
$('#find-query').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();search(true,event.shiftKey?-1:1);}});
$('#find-next').addEventListener('click',()=>search(true));$('#find-prev').addEventListener('click',()=>search(true,-1));
$('#replace-one').addEventListener('click',()=>{const query=$('#find-query').value;if(findIndex<0)search(true);if(interactions.replace(query,$('#replace-query').value,findIndex)){findIndex=-1;changed();search(true);}});
$('#replace-all').addEventListener('click',()=>{if(interactions.replace($('#find-query').value,$('#replace-query').value)){findIndex=-1;changed();search(true);}});
document.addEventListener('keydown',event=>{
  if($('#file-name-dialog').open)return;
  const mod=event.metaKey||event.ctrlKey,key=event.key.toLowerCase();
  const shortcut=mod?({s:event.shiftKey?'save-as':'save',o:event.shiftKey?'outline':'open',n:'new',f:'find'}[key]):null;
  if(shortcut){event.preventDefault();event.stopImmediatePropagation();command(shortcut);return;}
  if(mod&&event.shiftKey&&key==='m'){event.preventDefault();event.stopImmediatePropagation();setMode(mode==='wysiwyg'?'markdown':'wysiwyg');}
  if(event.key==='Escape'){if(!$('#writer-find').hidden)toggleFind(false);else if($('#writing-menu').open)$('#writing-menu').open=false;else if(page.classList.contains('focus-mode'))command('focus');}
},true);
document.addEventListener('pointerdown',event=>{if(!event.target.closest('#writing-menu'))$('#writing-menu').open=false;});
if(api){api.onCommand(command);api.ready().then(async next=>{loadDocument(next);await workspace.sync();}).catch(cause=>error(cause.message));}
else error('请使用 TypeWriter 桌面程序打开此页面。');
