const {app,BrowserWindow,Menu,dialog,ipcMain,protocol,shell}=require('electron');
const fs=require('node:fs/promises');
const path=require('node:path');
app.setName('TypeWriter');
// Keep the existing storage location so renaming never loses recovery drafts or folder settings.
app.setPath('userData',path.join(app.getPath('appData'),'ancuo-writer'));
const {atomicWrite,readDocument,saveDocument,hasConflict,localImage,MAX_BYTES}=require('./files.cjs');
protocol.registerSchemesAsPrivileged([{scheme:'typewriter',privileges:{standard:true,secure:true,supportFetchAPI:true}},{scheme:'document-image',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
let win,doc,baseline='',closing=false,busy=false,recoveryTimer,recoveryQueue=Promise.resolve(),queuedFile,ready=false;
const {resolveEntry,listDirectory,createEntry,renameDocument}=require('./workspace.cjs');
let workspace=null;
const workspaceState=()=>workspace?{path:workspace,name:path.basename(workspace)}:null;
const workspaceSettings=()=>path.join(app.getPath('userData'),'workspace.json');
const blank=()=>({file:null,content:'',eol:'\n',bom:false,diskHash:null});
if(!app.requestSingleInstanceLock()){app.quit();return;}
const argumentFile=args=>args.find(arg=>path.isAbsolute(arg)&&/\.(md|markdown|txt)$/i.test(arg));
queuedFile=argumentFile(process.argv.slice(app.isPackaged?1:2));
app.on('second-instance',(_,argv)=>{const file=argumentFile(argv);if(file){queuedFile=file;if(ready)command('open-queued');}if(win?.isMinimized())win.restore();win?.focus();});
const dirty=()=>doc.content!==baseline;
const recoveryPath=()=>path.join(app.getPath('userData'),'recovery.json');
function publicState(){return {content:doc.content,baseline,workspace:workspaceState(),name:doc.file?path.basename(doc.file):'未命名.md',path:doc.file||'',dirty:dirty()};}
function updateWindow(){win?.setTitle(`${dirty()?'● ':''}${doc.file?path.basename(doc.file):'未命名.md'} — TypeWriter`);win?.setDocumentEdited(dirty());win?.setRepresentedFilename(doc.file||'');}
function validate(content){if(typeof content!=='string'||Buffer.byteLength(content)>MAX_BYTES)throw Error('文档需小于 20 MB。');}
function checkpoint(){
  clearTimeout(recoveryTimer);
  const snapshot=dirty()?JSON.stringify({doc,baseline}):null;
  recoveryQueue=recoveryQueue.catch(()=>{}).then(async()=>{if(snapshot)await atomicWrite(recoveryPath(),snapshot);else await fs.rm(recoveryPath(),{force:true});});
  return recoveryQueue;
}
function change(content){validate(content);doc.content=content;updateWindow();clearTimeout(recoveryTimer);recoveryTimer=setTimeout(()=>checkpoint().catch(()=>win?.webContents.send('writer:command','recovery-error')),400);}
async function save(as=false){
  let target=doc.file;
  if(as||!target){const chosen=await dialog.showSaveDialog(win,{title:'保存 Markdown',defaultPath:target||'未命名.md',filters:[{name:'Markdown',extensions:['md','markdown','txt']}]});if(chosen.canceled)return false;target=chosen.filePath;}
  let force=false;
  if(target===doc.file&&await hasConflict(doc)){
    const {response}=await dialog.showMessageBox(win,{type:'warning',message:'磁盘上的文件已被修改或删除',detail:'直接保存会覆盖外部修改。你可以另存为一份新文件。',buttons:['取消','另存为','覆盖磁盘文件'],defaultId:0,cancelId:0});
    if(response===0)return false;if(response===1)return save(true);force=true;
  }
  doc=await saveDocument(doc,target,doc.content,{force});baseline=doc.content;app.addRecentDocument(target);updateWindow();await checkpoint();return true;
}
async function mayLeave(){
  if(!dirty())return true;
  const {response}=await dialog.showMessageBox(win,{type:'question',message:'保存当前文档的修改？',detail:'未保存的修改将在关闭或切换文档后丢弃。',buttons:['保存','取消','不保存'],defaultId:0,cancelId:1});
  if(response===1)return false;if(response===0)return save();return true;
}
async function openFile(file){const next=await readDocument(file);if(!await mayLeave())return false;doc=next;baseline=next.content;app.addRecentDocument(next.file);updateWindow();await checkpoint();return true;}
const command=name=>win?.webContents.send('writer:command',name);
function menu(){
  const item=(label,action,accelerator)=>({label,accelerator,click:()=>command(action)});
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform==='darwin'?[{label:'TypeWriter',submenu:[{role:'about'},{type:'separator'},{role:'hide'},{role:'hideOthers'},{role:'unhide'},{type:'separator'},{role:'quit'}]}]:[]),
    {label:'文件',submenu:[item('新建','new','CmdOrCtrl+N'),item('打开…','open','CmdOrCtrl+O'),item('打开文件夹…','open-folder'),item('保存','save','CmdOrCtrl+S'),item('另存为…','save-as','CmdOrCtrl+Shift+S'),{type:'separator'},item('导出 HTML…','html'),item('导出 PDF…','pdf'),{type:'separator'},{role:'close'}]},
    {label:'编辑',submenu:[{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'},{type:'separator'},item('查找与替换','find','CmdOrCtrl+F')]},
    {label:'视图',submenu:[item('即时编辑','wysiwyg'),item('Markdown 源码','markdown'),item('分栏预览','split'),item('阅读预览','preview'),{type:'separator'},item('大纲','outline','CmdOrCtrl+Shift+O'),item('专注模式','focus'),item('打字机模式','typewriter'),{role:'resetZoom'},{role:'zoomIn'},{role:'zoomOut'},{role:'togglefullscreen'}]},
    {label:'窗口',submenu:[{role:'minimize'},{role:'zoom'}]}
  ]));
}
function validSender(event){return event.sender===win?.webContents&&event.senderFrame===win.webContents.mainFrame&&event.senderFrame.url.startsWith('typewriter://app/');}
async function exportDocument(kind,html){
  if(typeof html!=='string'||Buffer.byteLength(html)>60*1024*1024)throw Error('导出内容过大。');
  const selected=await dialog.showSaveDialog(win,{title:`导出 ${kind.toUpperCase()}`,defaultPath:(doc.file||'未命名.md').replace(/\.[^.]+$/,'.'+kind),filters:[{name:kind.toUpperCase(),extensions:[kind]}]});
  if(selected.canceled)return;
  if(kind==='html'){await atomicWrite(selected.filePath,html);return;}
  const print=new BrowserWindow({show:false,webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true,webSecurity:true}});
  print.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  try{await print.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html));await print.webContents.executeJavaScript('Promise.all([document.fonts.ready,...Array.from(document.images,img=>img.decode().catch(()=>{}))])');const pdf=await print.webContents.printToPDF({printBackground:true,pageSize:'A4'});await atomicWrite(selected.filePath,pdf);}finally{print.destroy();}
}
app.on('open-file',(event,file)=>{event.preventDefault();queuedFile=file;if(ready)command('open-queued');});
app.on('window-all-closed',()=>app.quit());
app.whenReady().then(async()=>{
  await fs.mkdir(app.getPath('userData'),{recursive:true});doc=blank();
  try{const settings=JSON.parse(await fs.readFile(workspaceSettings(),'utf8'));workspace=await fs.realpath(settings.path);if(!(await fs.stat(workspace)).isDirectory())workspace=null;}catch{workspace=null;}
  protocol.handle('typewriter',async request=>{
    const url=new URL(request.url),allowed={'/index.html':['index.html','text/html'],'/app.js':['app.js','text/javascript'],'/app.css':['app.css','text/css']},entry=allowed[url.pathname];
    if(url.host!=='app'||!entry)return new Response('Not found',{status:404});
    return new Response(await fs.readFile(path.join(__dirname,'../dist',entry[0])),{headers:{'Content-Type':entry[1]+'; charset=utf-8','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: document-image:; connect-src 'self'; font-src 'self' data:; base-uri document-image:; object-src 'none'; frame-src 'none'"}});
  });
  protocol.handle('document-image',async request=>{
    try{const url=new URL(request.url);if(url.host!=='local')throw Error('Invalid host');const image=await localImage(doc.file,decodeURIComponent(url.pathname));return new Response(image.bytes,{headers:{'Content-Type':image.type,'Cache-Control':'no-store'}});}catch{return new Response('',{status:404});}
  });
  win=new BrowserWindow({width:1180,height:820,minWidth:720,minHeight:500,backgroundColor:'#ffffff',title:'TypeWriter',webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
  win.webContents.setWindowOpenHandler(({url})=>{if(/^https?:\/\//i.test(url))shell.openExternal(url);return {action:'deny'};});
  win.webContents.on('will-navigate',event=>event.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_,__,callback)=>callback(false));
  win.webContents.session.setPermissionCheckHandler(()=>false);
  win.on('close',event=>{if(!closing){event.preventDefault();command('close');}});
  win.webContents.on('render-process-gone',()=>{checkpoint().catch(()=>{});dialog.showMessageBox(win,{type:'error',message:'编辑窗口意外退出',detail:'请重新启动 TypeWriter，恢复最近的草稿。'}).then(()=>{closing=true;app.quit();});});
  ipcMain.handle('writer:ready',async event=>{
    if(!validSender(event))throw Error('Invalid sender');
    if(!ready){
      ready=true;
      try{const recovered=JSON.parse(await fs.readFile(recoveryPath(),'utf8'));validate(recovered.doc.content);validate(recovered.baseline);
        if(typeof recovered.doc.file!=='string'&&recovered.doc.file!==null)throw Error('Invalid recovery');
        const {response}=await dialog.showMessageBox(win,{type:'question',message:'发现上次未保存的草稿',detail:recovered.doc.file||'未命名文档',buttons:['恢复草稿','丢弃草稿'],defaultId:0,cancelId:0});
        if(response===0){doc=recovered.doc;baseline=recovered.baseline;}else await fs.rm(recoveryPath(),{force:true});
      }catch(error){if(error.code!=='ENOENT')console.error('Recovery:',error.message);}
      if(queuedFile){const file=queuedFile;queuedFile=null;try{await openFile(file);}catch(error){await dialog.showMessageBox(win,{type:'error',message:error.message});}}
    }
    updateWindow();return publicState();
  });
  ipcMain.handle('writer:context',async(event,relative)=>{
    if(!validSender(event)||busy)return null;
    try{
      const file=workspace?await resolveEntry(workspace,relative||''):null;
      const directory=file?(await fs.stat(file)).isDirectory():true;
      const item=(label,action,enabled=true)=>({label,enabled,click:()=>{choice={action,path:relative||'',directory};}});
      let choice=null;
      const items=directory?[item('新建文件…','create-file',!!workspace),item('新建文件夹…','create-folder',!!workspace),{type:'separator'},item('打开文件夹…','open-folder'),item('刷新','refresh',!!workspace)]:[item('打开','open-entry'),{type:'separator'},item('重命名…','rename-file'),item('在访达中显示','reveal-file'),{type:'separator'},item('移到废纸篓','trash-file')];
      return await new Promise(resolve=>Menu.buildFromTemplate(items).popup({window:win,callback:()=>setImmediate(()=>resolve(choice))}));
    }catch(error){return {error:error.message};}
  });
  ipcMain.handle('writer:list',async(event,relative)=>{if(!validSender(event))throw Error('Invalid sender');try{return {entries:await listDirectory(workspace,relative)};}catch(error){return {error:error.message};}});
  ipcMain.handle('writer:change',async(event,content)=>{if(!validSender(event))throw Error('Invalid sender');if(busy)return;change(content);return {dirty:dirty()};});
  ipcMain.handle('writer:action',async(event,action,content,extra)=>{
    if(!validSender(event)||busy)return {cancelled:true};busy=true;
    try{
      change(content);await checkpoint();
      if(action==='save'||action==='save-as'){if(!await save(action==='save-as'))return {cancelled:true};}
      else if(action==='open'){const selected=await dialog.showOpenDialog(win,{properties:['openFile'],filters:[{name:'Markdown',extensions:['md','markdown','txt']}]});if(selected.canceled||!await openFile(selected.filePaths[0]))return {cancelled:true};}
      else if(action==='open-queued'&&queuedFile){const file=queuedFile;queuedFile=null;if(!await openFile(file))return {cancelled:true};}
      else if(action==='open-folder'){
        const selected=await dialog.showOpenDialog(win,{title:'打开写作文件夹',properties:['openDirectory']});if(selected.canceled)return {cancelled:true};
        workspace=await fs.realpath(selected.filePaths[0]);await atomicWrite(workspaceSettings(),JSON.stringify({path:workspace}));
      }
      else if(action==='open-entry'){
        const file=await resolveEntry(workspace,extra);if(file===doc.file)return publicState();if(!await openFile(file))return {cancelled:true};
      }
      else if(action==='create-file'||action==='create-folder'){
        if(action==='create-file'&&!await mayLeave())return {cancelled:true};
        const file=await createEntry(workspace,extra?.parent||'',extra?.name,action==='create-folder');
        if(action==='create-file'){doc=await readDocument(file);baseline=doc.content;await checkpoint();}
      }
      else if(action==='rename-file'){
        const source=await resolveEntry(workspace,extra?.path);
        const file=await renameDocument(workspace,extra.path,extra.name);
        if(source===doc.file){doc.file=file;await checkpoint();}
      }
      else if(action==='reveal-file'){const file=await resolveEntry(workspace,extra);shell.showItemInFolder(file);}
      else if(action==='trash-file'){
        const file=await resolveEntry(workspace,extra);
        if(!(await fs.stat(file)).isFile()||! /\.(md|markdown|txt)$/i.test(file))throw Error('请选择 Markdown 文件。');
        const current=file===doc.file;
        const {response}=await dialog.showMessageBox(win,{type:'warning',message:`将「${path.basename(file)}」移到废纸篓？`,detail:current&&dirty()?'当前未保存的修改会丢弃。磁盘文件可以从废纸篓恢复。':'可以从系统废纸篓恢复。',buttons:['取消','移到废纸篓'],defaultId:0,cancelId:0});
        if(response!==1)return {cancelled:true};await shell.trashItem(file);if(current){doc=blank();baseline='';await checkpoint();}
      }
      else if(action==='new'){if(!await mayLeave())return {cancelled:true};doc=blank();baseline='';await checkpoint();}
      else if(action==='close'){if(await mayLeave()){baseline=doc.content;await checkpoint();closing=true;win.close();}}
      else if(action==='html'||action==='pdf')await exportDocument(action,extra);
      else if(action==='image-data'){const image=await localImage(doc.file,extra);return {data:`data:${image.type};base64,${image.bytes.toString('base64')}`};}
      else if(!['new','open','open-queued','close'].includes(action))throw Error('未知操作');
      updateWindow();return publicState();
    }catch(error){return {error:error.message};}finally{busy=false;}
  });
  menu();await win.loadURL('typewriter://app/index.html');
});
