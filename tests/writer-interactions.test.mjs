import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Schema} from 'prosemirror-model';
import {EditorState,TextSelection} from 'prosemirror-state';
import {history,undo} from 'prosemirror-history';
import {listKind,selectedBlock,removeSelectedBlock,exitSelectedBlock,searchDecorations,searchMatches,replaceMatches} from '../src/writer-interactions.js';
const schema=new Schema({nodes:{
  doc:{content:'block+'},text:{group:'inline'},paragraph:{group:'block',content:'inline*'},image:{group:'inline',inline:true},hardBreak:{group:'inline',inline:true},
  codeBlock:{group:'block',content:'text*',code:true,marks:'',attrs:{language:{default:null}}},
  bulletList:{group:'block',content:'listItem+'},orderedList:{group:'block',content:'listItem+'},
  listItem:{content:'paragraph block*',attrs:{task:{default:false}}},
  table:{group:'block',content:'row+'},row:{content:'cell+'},cell:{content:'paragraph+'}
},marks:{strong:{},em:{}}});
const p=text=>schema.nodes.paragraph.create(null,text?schema.text(text):null);
const code=text=>schema.nodes.codeBlock.create({language:'js'},schema.text(text));
function at(nodes,offset){const doc=schema.nodes.doc.create(null,nodes);return EditorState.create({doc,selection:TextSelection.create(doc,offset),plugins:[history()]});}
test('list toggle detection distinguishes ordered, bullet, task and nested list items',()=>{
  const item=task=>schema.nodes.listItem.create({task},p('item'));
  for(const [type,task,expected] of [['bulletList',false,'bulletList'],['orderedList',false,'orderedList'],['bulletList',true,'taskList']])assert.equal(listKind(at([schema.nodes[type].create(null,item(task))],3)),expected);
  const nested=schema.nodes.bulletList.create(null,schema.nodes.listItem.create(null,[p('x'),schema.nodes.orderedList.create(null,item(false))]));
  assert.equal(listKind(at([nested],8)),'orderedList');assert.equal(listKind(at([p('plain')],1)),null);
});
test('delete a code block without touching adjacent prose and restore it with undo',()=>{
  let state=at([p('before'),code('hello'),p('after')],9),original=state.doc.toJSON();
  assert.equal(selectedBlock(state).node.type.name,'codeBlock');
  assert.ok(removeSelectedBlock(state,tr=>state=state.apply(tr)));
  assert.deepEqual([...Array(state.doc.childCount)].map((_,i)=>state.doc.child(i).type.name),['paragraph','paragraph','paragraph']);
  assert.equal(state.doc.textContent,'beforeafter');
  undo(state,tr=>state=state.apply(tr));assert.deepEqual(state.doc.toJSON(),original);
});
test('delete a sole table leaves an editable paragraph, with undo restoring its cells',()=>{
  const table=schema.nodes.table.create(null,schema.nodes.row.create(null,schema.nodes.cell.create(null,p('cell'))));
  let state=at([table],4),original=state.doc.toJSON();
  removeSelectedBlock(state,tr=>state=state.apply(tr));
  assert.equal(state.doc.firstChild.type.name,'paragraph');assert.equal(state.selection.from,1);
  undo(state,tr=>state=state.apply(tr));assert.deepEqual(state.doc.toJSON(),original);
});
test('continue after code retains its content and reuses an existing following paragraph',()=>{
  let state=at([code('x'),p('after')],1);
  exitSelectedBlock(state,tr=>state=state.apply(tr));assert.equal(state.doc.childCount,2);assert.equal(state.selection.$from.parent.textContent,'after');
  state=at([code('x')],1);exitSelectedBlock(state,tr=>state=state.apply(tr));assert.equal(state.doc.childCount,2);assert.equal(state.selection.$from.parent.type.name,'paragraph');assert.equal(state.doc.firstChild.textContent,'x');
});
test('find highlights literal matches including multi-line ranges and can clear them',()=>{
  const doc=schema.nodes.doc.create(null,[p('草稿 one'),p('草稿 two')]);
  const all=searchDecorations(doc,'草稿',1).find();assert.equal(all.length,2);assert.match(all[1].type.attrs.class,/writer-search-current/);assert.equal(all[0].from,1);
  assert.equal(searchDecorations(doc,'one\n草稿',0).find().length,2);
  assert.equal(searchDecorations(doc,'missing',0).find().length,0);assert.equal(searchDecorations(doc,'',0).find().length,0);
});
test('rich-text search spans formatting and maps positions after inline atoms',()=>{
  const para=schema.nodes.paragraph.create(null,[schema.text('安',[schema.marks.strong.create()]),schema.text('厝'),schema.nodes.image.create(),schema.text('安厝'),schema.nodes.hardBreak.create(),schema.text('安厝')]);
  const doc=schema.nodes.doc.create(null,para),found=searchMatches(doc,'安厝');
  assert.deepEqual(found.map(({from,to})=>[from,to]),[[1,3],[4,6],[7,9]]);
  assert.equal(searchMatches(doc,'厝安').length,0);
  assert.equal(searchDecorations(doc,'安厝',1).find().filter(d=>d.type.attrs.class.includes('current'))[0].from,4);
});
test('replace rich-text matches retains list/table structure and unrelated formatting; undo restores all',()=>{
  const strong=schema.nodes.paragraph.create(null,schema.text('安厝',[schema.marks.strong.create()]));
  const list=schema.nodes.bulletList.create(null,schema.nodes.listItem.create(null,strong));
  const table=schema.nodes.table.create(null,schema.nodes.row.create(null,schema.nodes.cell.create(null,p('安厝'))));
  let state=at([list,table,p('keep')],3),original=state.doc.toJSON();
  state=state.apply(replaceMatches(state,'安厝','Ancuo'));
  assert.equal(state.doc.textContent,'AncuoAncuokeep');
  assert.equal(state.doc.child(0).type.name,'bulletList');assert.equal(state.doc.child(1).type.name,'table');
  assert.equal(state.doc.firstChild.firstChild.firstChild.firstChild.marks[0].type.name,'strong');
  undo(state,tr=>state=state.apply(tr));assert.deepEqual(state.doc.toJSON(),original);
  state=state.apply(replaceMatches(state,'安厝','',1));assert.equal(state.doc.textContent,'安厝keep');
  assert.equal(replaceMatches(state,'absent','text'),null);
});
