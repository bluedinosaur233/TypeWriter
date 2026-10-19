const fs=require('node:fs/promises');
const path=require('node:path');
const documentName=name=>/\.(md|markdown|txt)$/i.test(name);
async function resolveEntry(root,relative=''){
  if(!root||typeof relative!=='string'||path.isAbsolute(relative))throw Error('请先打开文件夹。');
  const target=await fs.realpath(path.resolve(root,relative)),rel=path.relative(root,target);
  if(rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel))throw Error('只能操作当前文件夹中的内容。');
  return target;
}
async function listDirectory(root,relative=''){
  const folder=await resolveEntry(root,relative),entries=await fs.readdir(folder,{withFileTypes:true});
  return entries.filter(e=>!e.name.startsWith('.')&&!['node_modules','dist','release'].includes(e.name)&&!e.isSymbolicLink()&&(e.isDirectory()||e.isFile()&&documentName(e.name)))
    .sort((a,b)=>Number(b.isDirectory())-Number(a.isDirectory())||a.name.localeCompare(b.name,'zh-CN',{numeric:true}))
    .map(e=>({name:e.name,path:path.relative(root,path.join(folder,e.name)),directory:e.isDirectory()}));
}
function validName(name,{document=false}={}){
  if(typeof name!=='string'||!name.trim()||name!==name.trim()||/[\\/\x00-\x1f:]/.test(name)||name.startsWith('.')||name.length>180)throw Error('名称不能为空，不能含路径分隔符或以点开头。');
  if(document&&!documentName(name))name+='.md';
  return name;
}
async function createEntry(root,parent,name,directory=false){
  const folder=await resolveEntry(root,parent),target=path.join(folder,validName(name,{document:!directory}));
  try{if(directory)await fs.mkdir(target);else await fs.writeFile(target,'',{flag:'wx'});}catch(error){if(error.code==='EEXIST')throw Error('同名文件或文件夹已存在。');throw error;}
  return target;
}
async function renameDocument(root,relative,name){
  const source=await resolveEntry(root,relative);
  if(!(await fs.stat(source)).isFile()||!documentName(source))throw Error('请选择 Markdown 文件。');
  const target=path.join(path.dirname(source),validName(name,{document:true}));
  if(source===target)return source;
  // Exclusive link avoids overwriting a file created by another process between checks.
  try{await fs.link(source,target);}catch(error){if(error.code==='EEXIST')throw Error('同名文件已存在。');throw error;}
  try{await fs.unlink(source);}catch(error){await fs.unlink(target).catch(()=>{});throw error;}
  return target;
}
module.exports={resolveEntry,listDirectory,validName,createEntry,renameDocument};
