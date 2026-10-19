import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {listDirectory,resolveEntry,createEntry,renameDocument} from '../desktop/workspace.cjs';
async function fixture(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'writer-workspace-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return fs.realpath(dir);}
test('file tree lists folders first, includes documents and skips hidden/build/symlink entries',async t=>{
  const root=await fixture(t);await fs.mkdir(path.join(root,'笔记'));await fs.mkdir(path.join(root,'node_modules'));
  for(const name of ['文章.md','说明.txt','README.markdown','image.png','.private.md'])await fs.writeFile(path.join(root,name),'');
  await fs.symlink(path.join(root,'文章.md'),path.join(root,'link.md'));
  const entries=await listDirectory(root);assert.equal(entries[0].name,'笔记');assert.equal(entries.length,4);assert.ok(entries.slice(1).every(e=>!e.directory));
});
test('create and rename never overwrite existing files and preserve document bytes',async t=>{
  const root=await fixture(t);await createEntry(root,'','随笔',true);const file=await createEntry(root,'随笔','新文章');
  assert.equal(path.basename(file),'新文章.md');await fs.writeFile(file,'\ufeff# 中文\r\n');
  await createEntry(root,'随笔','已有.md');await assert.rejects(createEntry(root,'随笔','已有.md'),/已存在/);
  await assert.rejects(renameDocument(root,'随笔/新文章.md','已有.md'),/已存在/);
  assert.equal(await fs.readFile(file,'utf8'),'\ufeff# 中文\r\n');
  const renamed=await renameDocument(root,'随笔/新文章.md','改名');assert.equal(await fs.readFile(renamed,'utf8'),'\ufeff# 中文\r\n');await assert.rejects(fs.stat(file),{code:'ENOENT'});
});
test('workspace operations reject traversal, invalid names and symlinks escaping the root',async t=>{
  const dir=await fixture(t),root=path.join(dir,'root');await fs.mkdir(root);await fs.writeFile(path.join(dir,'outside.md'),'private');
  await fs.symlink(dir,path.join(root,'escape'));
  await assert.rejects(resolveEntry(root,'../outside.md'),/当前文件夹/);
  await assert.rejects(resolveEntry(root,'escape/outside.md'),/当前文件夹/);
  for(const name of ['../a','a/b','','.hidden','a:b'])await assert.rejects(createEntry(root,'',name),/名称/);
  await assert.rejects(renameDocument(root,'','new'),/Markdown/);
});
