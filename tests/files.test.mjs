import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {readDocument,saveDocument,hasConflict,localImage} from '../desktop/files.cjs';
import {markdown,markdownHeadings} from '../src/markdown.js';

async function fixture(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ancuo-writer-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;}
test('open/save preserves Chinese UTF-8, BOM and CRLF without temporary leftovers',async t=>{
  const dir=await fixture(t),file=path.join(dir,'中文.md');
  await fs.writeFile(file,'\ufeff# 标题\r\n\r\n正文\r\n');
  const doc=await readDocument(file);assert.equal(doc.content,'# 标题\n\n正文\n');assert.equal(doc.bom,true);
  const saved=await saveDocument(doc,file,doc.content+'新内容\n');
  assert.equal(await fs.readFile(file,'utf8'),'\ufeff# 标题\r\n\r\n正文\r\n新内容\r\n');
  assert.equal(await hasConflict(saved),false);assert.deepEqual(await fs.readdir(dir),['中文.md']);
});
test('external edits and deletion require explicit overwrite; save as leaves original alone',async t=>{
  const dir=await fixture(t),file=path.join(dir,'note.md'),copy=path.join(dir,'copy.md');
  await fs.writeFile(file,'original');const doc=await readDocument(file);await fs.writeFile(file,'external');
  assert.equal(await hasConflict(doc),true);await assert.rejects(saveDocument(doc,file,'edited'),/其他程序/);
  await saveDocument(doc,copy,'edited');assert.equal(await fs.readFile(file,'utf8'),'external');
  const saved=await saveDocument(doc,file,'edited',{force:true});assert.equal(await fs.readFile(file,'utf8'),'edited');
  await fs.unlink(file);assert.equal(await hasConflict(saved),true);
});
test('empty files open, binary and invalid UTF-8 files are rejected',async t=>{
  const dir=await fixture(t),file=path.join(dir,'empty.md');await fs.writeFile(file,'');assert.equal((await readDocument(file)).content,'');
  await fs.writeFile(file,Buffer.from([0xff,0xfe]));await assert.rejects(readDocument(file),/UTF-8/);
  await fs.writeFile(file,'\0');await assert.rejects(readDocument(file),/文本/);
  await assert.rejects(readDocument(path.join(dir,'app.js')),/Markdown/);
});
test('local images stay within document folder, including symlink and parent traversal',async t=>{
  const dir=await fixture(t),sub=path.join(dir,'document');await fs.mkdir(sub);
  const file=path.join(sub,'note.md');await fs.writeFile(file,'');await fs.writeFile(path.join(sub,'image.png'),'image');await fs.writeFile(path.join(dir,'outside.png'),'private');
  assert.equal((await localImage(file,'/image.png')).bytes.toString(),'image');
  await assert.rejects(localImage(file,'/../outside.png'),/文件夹/);
  await fs.symlink(path.join(dir,'outside.png'),path.join(sub,'link.png'));
  await assert.rejects(localImage(file,'/link.png'),/文件夹/);
  await assert.rejects(localImage(null,'/image.png'),/保存/);
});
test('preview preserves heading levels and escapes scripts and unsafe links',()=>{
  const source='# 一级\n\n## 二级\n\n<script>alert(1)</script>\n\n[x](javascript:alert(1))';
  const html=markdown(source);assert.match(html,/<h1>一级<\/h1>/);assert.ok(!html.includes('<script>'));assert.ok(!html.includes('href="javascript:'));
  assert.deepEqual(markdownHeadings(source).map(x=>x.level),[1,2]);
});
