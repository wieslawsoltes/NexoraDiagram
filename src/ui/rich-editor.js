import { richFromPlain, validateRichText, plainText, TEXT_FONTS } from '../core/rich-text.js';
import { isLocked } from '../core/model.js';
import { esc } from './icons.js';
const $=id=>document.getElementById(id);
const colorHex=value=>{if(/^#[\da-f]{6}$/i.test(value||''))return value;const colors={black:'#000000',white:'#ffffff',red:'#ff0000',blue:'#0000ff',green:'#008000',gray:'#808080'};if(colors[value])return colors[value];const m=String(value).match(/^rgb\(\s*(\d+)[, ]+\s*(\d+)[, ]+\s*(\d+)\s*\)$/i);return m?'#'+m.slice(1).map(n=>(+n).toString(16).padStart(2,'0')).join(''):undefined;};
export function richEditorHTML(rich){
  validateRichText(rich);return rich.paragraphs.map(p=>`<p style="text-align:${p.align||'left'};margin:0 0 .25em;margin-left:${(p.indent||0)*16}px" data-list="${p.list||'none'}">${p.runs.map(r=>{
    const style=`font-family:${r.font||'sans-serif'};${r.size?`font-size:${r.size}px;`:''}${r.color?`color:${r.color};`:''}${r.bold?'font-weight:700;':''}${r.italic?'font-style:italic;':''}text-decoration:${[r.underline?'underline':'',r.strike?'line-through':''].filter(Boolean).join(' ')||'none'};`;
    let text=`<span style="${style}">${esc(r.text).replace(/\n/g,'<br>')||'<br>'}</span>`;if(r.script&&r.script!=='normal')text=`<${r.script==='super'?'sup':'sub'}>${text}</${r.script==='super'?'sup':'sub'}>`;return r.link?`<a href="${esc(r.link)}">${text}</a>`:text;
  }).join('')}</p>`).join('');
}
/** Serialize only recognized text marks. DOM content is never saved as executable HTML. */
export function richFromEditor(editor){
  const paragraphs=[];let current={align:'left',list:'none',indent:0,runs:[]};
  const flush=()=>{if(!current.runs.length)current.runs.push({text:''});paragraphs.push(current);current={align:'left',list:'none',indent:0,runs:[]};};
  const visit=(node,mark={},list='none')=>{
    if(node.nodeType===Node.TEXT_NODE){if(node.textContent)current.runs.push({...mark,text:node.textContent});return;}
    if(node.nodeType!==Node.ELEMENT_NODE)return;const tag=node.tagName.toLowerCase();if(['script','style','iframe','object','img'].includes(tag))return;
    if(tag==='br'){current.runs.push({...mark,text:'\n'});return;}
    const block=['p','div','li','h1','h2','h3','h4','blockquote'].includes(tag);if(block){if(current.runs.length)flush();current.align=['left','center','right','justify'].includes(node.style.textAlign)?node.style.textAlign:'left';current.list=tag==='li'?list:['none','bullet','number'].includes(node.dataset.list)?node.dataset.list:'none';current.indent=Math.min(8,Math.max(0,(parseFloat(node.style.marginLeft)||0)/16));}
    const m={...mark};if(['b','strong'].includes(tag))m.bold=true;if(['i','em'].includes(tag))m.italic=true;if(tag==='u')m.underline=true;if(['s','strike','del'].includes(tag))m.strike=true;if(tag==='sub')m.script='sub';if(tag==='sup')m.script='super';if(tag==='a' && /^(https?:\/\/|mailto:)[^\s<>"']+$/i.test(node.getAttribute('href')||''))m.link=node.getAttribute('href');
    const s=node.style;if(s.fontWeight)m.bold=s.fontWeight==='bold'||Number(s.fontWeight)>=600;if(s.fontStyle)m.italic=s.fontStyle==='italic';if(s.textDecoration){m.underline=s.textDecoration.includes('underline');m.strike=s.textDecoration.includes('line-through');}
    const size=parseFloat(s.fontSize);if(Number.isFinite(size))m.size=Math.min(120,Math.max(6,size*(s.fontSize.endsWith('pt')?4/3:1)));if(tag==='font' && node.size)m.size=[0,10,13,16,18,24,32,48][Number(node.size)]||16;
    const font=(s.fontFamily||node.getAttribute('face')||'').replace(/["']/g,'').split(',')[0].trim();if(TEXT_FONTS.includes(font))m.font=font;
    const color=colorHex(s.color||node.getAttribute('color'));if(color)m.color=color;
    for(const child of node.childNodes)visit(child,m,tag==='ul'?'bullet':tag==='ol'?'number':list);
    if(block)flush();
  };
  for(const child of editor.childNodes)visit(child);if(current.runs.length||!paragraphs.length)flush();
  for(const p of paragraphs){if(p.runs.length===1&&p.runs[0].text==='\n')p.runs[0].text='';const merged=[];for(const run of p.runs){const prev=merged.at(-1);if(prev&&JSON.stringify({...prev,text:''})===JSON.stringify({...run,text:''}))prev.text+=run.text;else merged.push(run);}p.runs=merged;}
  return validateRichText({version:1,paragraphs});
}
export function editRichText(a,id=[...a.selection][0]){
  const n=a.page.graph.nodes[id],g=a.page.view.nodes[id];if(!n||isLocked(a.page,id))throw new Error('Select one editable shape for rich text.');
  const rich=n.richText||richFromPlain(n.label),btn=(command,label)=>`<button type="button" data-rich-command="${command}" title="${label}">${label}</button>`;
  a.ui.dialog('Rich text',`<div id="rich-toolbar" class="rich-toolbar">${btn('bold','Bold')}${btn('italic','Italic')}${btn('underline','Underline')}${btn('strikeThrough','Strike')}${btn('subscript','Sub')}${btn('superscript','Super')}<label>Size <input id="rich-size" type="number" min="6" max="120" value="${g.fontSize||16}"></label><select id="rich-font" aria-label="Font family">${TEXT_FONTS.map(f=>`<option>${f}</option>`).join('')}</select><input id="rich-color" type="color" aria-label="Text color" value="${g.textColor||'#334155'}">${btn('justifyLeft','Left')}${btn('justifyCenter','Center')}${btn('justifyRight','Right')}${btn('justifyFull','Justify')}${btn('insertUnorderedList','Bullets')}${btn('insertOrderedList','Numbered')}${btn('indent','Indent')}${btn('outdent','Outdent')}${btn('removeFormat','Clear')}<button type="button" id="rich-link-button">Link</button></div><div id="rich-editor" class="rich-editor" contenteditable="true" role="textbox" aria-label="Rich text content" aria-multiline="true" spellcheck="true" style="font-size:${g.fontSize||16}px">${richEditorHTML(rich)}</div><label class="field"><span>Link for selected text (HTTP, HTTPS, or mailto)</span><input id="rich-link" type="text" placeholder="https://example.org/"></label><p id="rich-summary">Formatting is stored as editable runs. Pasted content is inserted as plain text.</p>`,()=>{
    const value=richFromEditor($('rich-editor'));a.store.transact('Edit rich text',()=>{const node=a.page.graph.nodes[id];node.richText=value;node.label=plainText(value);});
  });
  const editor=$('rich-editor');let range;
  const capture=()=>{const selection=getSelection();if(selection?.rangeCount&&editor.contains(selection.anchorNode))range=selection.getRangeAt(0).cloneRange();};
  editor.addEventListener('keyup',capture);editor.addEventListener('mouseup',capture);editor.addEventListener('input',()=>{capture();$('rich-summary').textContent=`${editor.innerText.length} / 10,000 characters`;});
  const restore=()=>{editor.focus();if(range){const s=getSelection();s.removeAllRanges();s.addRange(range);}};
  const command=(name,value)=>{restore();document.execCommand(name,false,value);capture();};
  $('rich-toolbar').addEventListener('mousedown',e=>{if(e.target.closest('[data-rich-command]'))e.preventDefault();else capture();});
  $('rich-toolbar').addEventListener('click',e=>{const b=e.target.closest('[data-rich-command]');if(b)command(b.dataset.richCommand);});
  $('rich-font').onchange=e=>command('fontName',e.target.value);$('rich-color').onchange=e=>command('foreColor',e.target.value);
  $('rich-size').onchange=e=>{const size=Number(e.target.value);if(!Number.isFinite(size)||size<6||size>120)return;command('fontSize','7');for(const el of editor.querySelectorAll('font[size="7"]')){el.removeAttribute('size');el.style.fontSize=`${size}px`;}};
  $('rich-link-button').onclick=()=>{const url=$('rich-link').value.trim();if(!url){command('unlink');return;}try{validateRichText({version:1,paragraphs:[{runs:[{text:'link',link:url}]}]});command('createLink',url);}catch(error){a.ui.showToast(error.message,true);}};
  editor.addEventListener('paste',e=>{e.preventDefault();command('insertText',e.clipboardData.getData('text/plain'));});editor.addEventListener('drop',e=>e.preventDefault());
  editor.addEventListener('click',e=>{if(e.target.closest('a'))e.preventDefault();});
  editor.focus();const selection=getSelection(),r=document.createRange();r.selectNodeContents(editor);r.collapse(false);selection.removeAllRanges();selection.addRange(r);capture();
}
