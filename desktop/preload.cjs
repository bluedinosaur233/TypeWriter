const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('writerDesktop',{
  context:relative=>ipcRenderer.invoke('writer:context',relative),
  list:relative=>ipcRenderer.invoke('writer:list',relative),
  ready:()=>ipcRenderer.invoke('writer:ready'),
  change:content=>ipcRenderer.invoke('writer:change',content),
  action:(command,content,extra)=>ipcRenderer.invoke('writer:action',command,content,extra),
  onCommand:callback=>{const listener=(_,command)=>callback(command);ipcRenderer.on('writer:command',listener);return()=>ipcRenderer.removeListener('writer:command',listener);}
});
