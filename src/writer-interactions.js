import {Plugin,TextSelection} from 'prosemirror-state';
import {Decoration,DecorationSet} from 'prosemirror-view';
import {toggleMark,setBlockType} from 'prosemirror-commands';
import {closeHistory} from 'prosemirror-history';

export function selectedBlock(state){
  const {$from}=state.selection;
  for(let depth=$from.depth;depth>0;depth--){
    const node=$from.node(depth);
    if(['table','codeBlock'].includes(node.type.name))return {node,pos:$from.before(depth)};
  }
  const node=state.selection.node;
  return node&&['table','codeBlock'].includes(node.type.name)?{node,pos:state.selection.from}:null;
}
export function listKind(state){
  const {$from}=state.selection;let task=false;
  for(let depth=$from.depth;depth>0;depth--){
    const node=$from.node(depth);
    if(node.type.name==='listItem')task=node.attrs.task;
    if(node.type.name==='bulletList')return task?'taskList':'bulletList';
    if(node.type.name==='orderedList')return task?'taskList':'orderedList';
  }
  return null;
}
export function removeSelectedBlock(state,dispatch){
  const block=selectedBlock(state);if(!block)return false;
  // Replace with an empty paragraph, ensuring even a document with only one block stays editable.
  const tr=closeHistory(state.tr).replaceWith(block.pos,block.pos+block.node.nodeSize,state.schema.nodes.paragraph.create());
  tr.setSelection(TextSelection.create(tr.doc,block.pos+1));
  dispatch(tr.scrollIntoView());return true;
}
export function exitSelectedBlock(state,dispatch){
  const block=selectedBlock(state);if(!block)return false;
  const pos=block.pos+block.node.nodeSize,tr=closeHistory(state.tr);
  const after=tr.doc.nodeAt(pos);
  if(!after||after.type!==state.schema.nodes.paragraph)tr.insert(pos,state.schema.nodes.paragraph.create());
  tr.setSelection(TextSelection.create(tr.doc,pos+1));dispatch(tr.scrollIntoView());return true;
}
// A plain contentDOM keeps the caret inside an empty code block and lets ProseMirror
// handle typing, IME, Enter and deletion instead of swallowing all DOM events.
export function codeBlockView(node){
  const dom=document.createElement('div');dom.className='writer-code-block';
  const label=document.createElement('span');label.className='writer-code-language';label.contentEditable='false';
  const pre=document.createElement('pre'),code=document.createElement('code');pre.append(code);dom.append(label,pre);
  const render=current=>{label.textContent=current.attrs.language||'代码';code.dataset.language=current.attrs.language||'';};render(node);
  return {dom,contentDOM:code,update(next){if(next.type!==node.type)return false;node=next;render(next);return true;},ignoreMutation(mutation){return mutation.target===label||label.contains(mutation.target);}};
}
export function searchMatches(doc,query){
  if(!query)return [];
  let text='',blocks=[];
  doc.descendants((node,pos)=>{
    if(!node.isTextblock)return;
    if(blocks.length)text+='\n';
    // Inline atoms occupy a document position too; don't let images or breaks
    // shift the matches that follow them or join unrelated words.
    const value=node.textBetween(0,node.content.size,'','\ufffc');
    blocks.push({offset:text.length,pos:pos+1,length:value.length});text+=value;return false;
  });
  const found=[];let from=0;
  while((from=text.indexOf(query,from))!==-1){
    const ranges=[];
    for(const block of blocks){
      const start=Math.max(from,block.offset),end=Math.min(from+query.length,block.offset+block.length);
      if(start<end)ranges.push({from:block.pos+start-block.offset,to:block.pos+end-block.offset});
    }
    if(ranges.length)found.push({from:ranges[0].from,to:ranges.at(-1).to,ranges});
    from+=query.length;
  }
  return found;
}
export function searchDecorations(doc,query,current){
  const decorations=searchMatches(doc,query).flatMap((match,index)=>match.ranges.map(({from,to})=>Decoration.inline(from,to,{class:index===current?'writer-search-match writer-search-current':'writer-search-match'})));
  return DecorationSet.create(doc,decorations);
}
export function replaceMatches(state,query,replacement,index=null){
  const found=searchMatches(state.doc,query),targets=index===null?found:found.slice(index,index+1);
  if(!targets.length)return null;
  const tr=closeHistory(state.tr);
  // Work backwards so every position still refers to the original document.
  for(const {from,to} of targets.toReversed())tr.insertText(replacement,from,to);
  return tr;
}
export function createInteractions(onContext){
  let wwView,mdView,query='',current=-1,instance;
  const currentView=()=>instance?.isWysiwygMode()?wwView:mdView;
  const searchProps={decorations(state){return searchDecorations(state.doc,query,current);}};
  const notify=view=>{
    const block=selectedBlock(view.state),marks=view.state.storedMarks||view.state.selection.$from.marks();
    onContext({block:block?.node.type.name||null,language:block?.node.attrs.language||'',inlineCode:!!view.state.schema.marks.code.isInSet(marks)});
  };
  function plugin(context){
    instance=context.instance;
    const command=(name)=>(payload,state,dispatch,view)=>{
      dispatch(closeHistory(state.tr));
      if(listKind(view.state)===name)instance.exec('outdent');
      else instance.exec(name);
      view.focus();notify(view);return true;
    };
    return {
      wysiwygNodeViews:{codeBlock:codeBlockView},
      wysiwygPlugins:[()=>new Plugin({view(view){wwView=view;return {update:notify,destroy(){wwView=null;}};},props:searchProps})],
      markdownPlugins:[()=>new Plugin({view(view){mdView=view;return {destroy(){mdView=null;}};},props:searchProps})],
      wysiwygCommands:{
        writerBullet:command('bulletList'),writerOrdered:command('orderedList'),writerTask:command('taskList'),
        writerCode:(_,state,dispatch,view)=>{toggleMark(state.schema.marks.code)(state,dispatch);view.focus();notify(view);return true;},
        writerCodeBlock:(_,state,dispatch,view)=>{
          dispatch(closeHistory(state.tr));
          const target=view.state.selection.$from.parent.type===state.schema.nodes.codeBlock?state.schema.nodes.paragraph:state.schema.nodes.codeBlock;
          setBlockType(target)(view.state,dispatch);
          const tr=view.state.tr;tr.setSelection(TextSelection.create(tr.doc,tr.selection.from));dispatch(tr.scrollIntoView());view.focus();return true;
        }
      },
      markdownCommands:Object.fromEntries([['writerBullet','bulletList'],['writerOrdered','orderedList'],['writerTask','taskList'],['writerCode','code'],['writerCodeBlock','codeBlock']].map(([custom,builtin])=>[custom,()=>{instance.exec(builtin);instance.focus();return true;}]))
    };
  }
  return {plugin,
    refresh(){if(instance?.isWysiwygMode()&&wwView)notify(wwView);else onContext({block:null,inlineCode:false});},
    removeBlock(){if(wwView){removeSelectedBlock(wwView.state,wwView.dispatch);wwView.focus();}},
    exitBlock(){if(wwView){exitSelectedBlock(wwView.state,wwView.dispatch);wwView.focus();}},
    toParagraph(){if(wwView){setBlockType(wwView.state.schema.nodes.paragraph)(wwView.state,wwView.dispatch);wwView.focus();}},
    language(value){if(wwView){const block=selectedBlock(wwView.state);if(block?.node.type.name==='codeBlock')wwView.dispatch(wwView.state.tr.setNodeMarkup(block.pos,null,{...block.node.attrs,language:value.trim()||null}));}},
    searchCount(text){const view=currentView();return view?searchMatches(view.state.doc,text).length:0;},
    search(text,index){query=text;current=index;for(const view of [mdView,wwView])if(view)view.dispatch(view.state.tr.setMeta('addToHistory',false));},
    locateMatch(){currentView()?.dom.querySelector('.writer-search-current')?.scrollIntoView({block:'center',behavior:'instant'});},
    replace(text,replacement,index=null){const view=currentView();if(!view)return false;const tr=replaceMatches(view.state,text,replacement,index);if(!tr)return false;view.dispatch(tr);return true;},
    centerCaret(){
      const view=currentView();if(!view?.hasFocus()||!view.state.selection.empty)return;
      const pane=instance.isWysiwygMode()?instance.getEditorElements().wwEditor:instance.getEditorElements().mdEditor;
      const caret=view.coordsAtPos(view.state.selection.head),rect=pane.getBoundingClientRect();
      const delta=caret.top-rect.top-pane.clientHeight*.45;
      if(Math.abs(delta)>1)instance.setScrollTop(instance.getScrollTop()+delta);
    },
    dispose(){query='';current=-1;}
  };
}
