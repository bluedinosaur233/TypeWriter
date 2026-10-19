import MarkdownIt from 'markdown-it';
export const escapeHTML=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const parser=new MarkdownIt({html:false,breaks:true,linkify:false});
const image=parser.renderer.rules.image;
parser.renderer.rules.image=(tokens,index,options,env,self)=>{
  tokens[index].attrSet('loading','lazy');tokens[index].attrSet('referrerpolicy','no-referrer');
  return image(tokens,index,options,env,self);
};
parser.renderer.rules.link_open=(tokens,index,options,env,self)=>{
  const href=tokens[index].attrGet('href')||'';
  if(/^https?:/i.test(href)){tokens[index].attrSet('target','_blank');tokens[index].attrSet('rel','noopener noreferrer');}
  return self.renderToken(tokens,index,options);
};
parser.core.ruler.after('inline','tasks',state=>{
  for(let i=2;i<state.tokens.length;i++){
    const token=state.tokens[i];
    if(token.type!=='inline'||state.tokens[i-2].type!=='list_item_open'||!/^\[[ xX]\] /.test(token.content))continue;
    const first=token.children[0];if(first?.type!=='text')continue;
    const checked=/^\[[xX]\]/.test(first.content);
    first.content=first.content.slice(4);
    const checkbox=new state.Token('html_inline','',0);
    checkbox.content=`<input class="task-checkbox" type="checkbox" disabled${checked?' checked':''} aria-label="${checked?'已完成':'未完成'}"> `;
    token.children.unshift(checkbox);
    state.tokens[i-2].attrSet('class','task-item');
  }
});
export function markdown(source){return parser.render(source);}
export function markdownHeadings(source){
  const tokens=parser.parse(source,{}),headings=[];
  for(let i=0;i<tokens.length;i++){
    if(tokens[i].type==='heading_open'){
      const inline=tokens[i+1];
      headings.push({line:tokens[i].map[0]+1,level:Number(tokens[i].tag.slice(1)),text:(inline.children||[]).map(t=>t.type==='image'?t.content:t.type==='text'||t.type==='code_inline'?t.content:'').join('')});
    }
  }
  return headings;
}
