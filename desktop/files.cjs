const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const MAX_BYTES=20*1024*1024;
const digest=text=>createHash('sha256').update(text).digest('hex');
async function atomicWrite(file,content){
  const temp=path.join(path.dirname(file),'.'+path.basename(file)+'.'+randomUUID()+'.tmp');
  try{
    let mode=0o600;try{mode=(await fs.stat(file)).mode&0o777;}catch(error){if(error.code!=='ENOENT')throw error;}
    await fs.writeFile(temp,content,{flag:'wx',mode});
    await fs.rename(temp,file);
  }finally{await fs.rm(temp,{force:true}).catch(()=>{});}
}
async function readDocument(file){
  if(!/\.(md|markdown|txt)$/i.test(file))throw Error('请选择 Markdown 或 TXT 文件。');
  const resolved=await fs.realpath(file),info=await fs.stat(resolved);
  if(!info.isFile()||info.size>MAX_BYTES)throw Error('文件需小于 20 MB。');
  const bytes=await fs.readFile(resolved);
  let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw Error('文件不是 UTF-8 编码，请先转换编码再打开。');}
  if(text.includes('\0'))throw Error('无法作为文本打开该文件。');
  const bom=bytes[0]===239&&bytes[1]===187&&bytes[2]===191;
  return {file:resolved,content:text.replace(/\r\n/g,'\n'),eol:text.includes('\r\n')?'\r\n':'\n',bom,diskHash:digest(bytes)};
}
async function hasConflict(doc){
  if(!doc.file)return false;
  try{return digest(await fs.readFile(doc.file))!==doc.diskHash;}catch(error){if(error.code==='ENOENT')return true;throw error;}
}
async function saveDocument(doc,target,content,{force=false}={}){
  if(typeof content!=='string'||Buffer.byteLength(content)>MAX_BYTES)throw Error('文档需小于 20 MB。');
  try{target=await fs.realpath(target);}catch(error){if(error.code!=='ENOENT')throw error;target=path.join(await fs.realpath(path.dirname(target)),path.basename(target));}
  if(target===doc.file&&!force&&await hasConflict(doc))throw Error('文件已被其他程序修改。');
  const bytes=Buffer.from((doc.bom?'\ufeff':'')+content.replace(/\r\n/g,'\n').replace(/\n/g,doc.eol||'\n'));
  await atomicWrite(target,bytes);
  return {...doc,file:target,content,diskHash:digest(bytes)};
}
const imageTypes={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.avif':'image/avif','.bmp':'image/bmp'};
async function localImage(documentFile,requestPath){
  if(!documentFile)throw Error('请先保存文档以确定图片所在目录。');
  const root=await fs.realpath(path.dirname(documentFile));
  const file=await fs.realpath(path.resolve(root,'.'+requestPath));
  const relative=path.relative(root,file),type=imageTypes[path.extname(file).toLowerCase()];
  if(relative.startsWith('..'+path.sep)||relative==='..'||path.isAbsolute(relative)||!type)throw Error('图片必须在文档所在文件夹或其子文件夹中。');
  if((await fs.stat(file)).size>MAX_BYTES)throw Error('图片过大。');
  return {bytes:await fs.readFile(file),type};
}
module.exports={atomicWrite,readDocument,hasConflict,saveDocument,localImage,digest,MAX_BYTES};
