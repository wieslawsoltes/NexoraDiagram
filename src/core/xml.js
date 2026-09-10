/** Small inert XML reader for interchange. Never inserts imported markup into the browser DOM. */
const forbidden = new Set(['__proto__','prototype','constructor']);
export const xmlEscape = s => String(s).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
export function xmlDecode(s) {
  if(/&(?!(?:lt|gt|amp|quot|apos|#x[\da-f]+|#\d+);)/i.test(s))throw new Error('Malformed XML entity.');
  return s.replace(/&([^;\s]+);/g,(_,entity)=> {
    const named={lt:'<',gt:'>',amp:'&',quot:'"',apos:"'"}; if(Object.hasOwn(named,entity))return named[entity];
    if(!/^#(?:x[\da-f]+|\d+)$/i.test(entity))throw new Error('Unknown XML entity.');
    const code=entity[1].toLowerCase()==='x'?parseInt(entity.slice(2),16):Number(entity.slice(1));
    if(!Number.isInteger(code)||code<=0||code>0x10ffff||code>=0xd800&&code<=0xdfff)throw new Error('Invalid XML codepoint.');return String.fromCodePoint(code);
  });
}
export function parseXML(source,{maxBytes=50*1024*1024,maxNodes=200000,maxDepth=128}={}) {
  if(typeof source!=='string'||source.length>maxBytes)throw new Error('XML exceeds the import size limit.');
  if(/<!DOCTYPE|<!ENTITY/i.test(source))throw new Error('DTD and entity declarations are not permitted.');
  const root={name:'#document',local:'#document',attrs:Object.create(null),children:[]}, stack=[root];let at=0,count=0;
  while(at<source.length) {
    if(source.startsWith('<!--',at)){const end=source.indexOf('-->',at+4);if(end<0)throw new Error('Unclosed XML comment.');at=end+3;continue;}
    if(source.startsWith('<?',at)){const end=source.indexOf('?>',at+2);if(end<0)throw new Error('Unclosed XML instruction.');at=end+2;continue;}
    if(source.startsWith('<![CDATA[',at)){const end=source.indexOf(']]>',at+9);if(end<0)throw new Error('Unclosed CDATA section.');stack.at(-1).children.push(source.slice(at+9,end));at=end+3;continue;}
    if(source[at]!=='<'){const end=source.indexOf('<',at);stack.at(-1).children.push(xmlDecode(source.slice(at,end<0?source.length:end)));at=end<0?source.length:end;continue;}
    const close=/^<\/\s*([\w:.-]+)\s*>/.exec(source.slice(at));
    if(close){if(stack.length===1||stack.at(-1).name!==close[1])throw new Error('Mismatched XML closing tag.');stack.pop();at+=close[0].length;continue;}
    const open=/^<([A-Za-z_][\w:.-]*)/.exec(source.slice(at));if(!open)throw new Error('Invalid XML element.');at+=open[0].length;
    const node={name:open[1],local:open[1].split(':').at(-1),attrs:Object.create(null),children:[]};let self=false;
    while(at<source.length) {
      const whitespace=/^\s*/.exec(source.slice(at))[0];at+=whitespace.length;
      if(source.startsWith('/>',at)){at+=2;self=true;break;}if(source[at]==='>'){at++;break;}
      const attribute=/^([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(source.slice(at));
      if(!attribute||/[<]/.test(attribute[2]??attribute[3])||Object.hasOwn(node.attrs,attribute[1])||forbidden.has(attribute[1]))throw new Error('Invalid or duplicate XML attribute.');
      node.attrs[attribute[1]]=xmlDecode(attribute[2]??attribute[3]);at+=attribute[0].length;
    }
    if(++count>maxNodes)throw new Error('XML node count exceeds the import limit.');stack.at(-1).children.push(node);
    if(!self){stack.push(node);if(stack.length>maxDepth)throw new Error('XML nesting is too deep.');}
  }
  if(stack.length!==1)throw new Error('Unclosed XML element.');
  const roots=root.children.filter(n=>typeof n!=='string');if(roots.length!==1||root.children.some(n=>typeof n==='string'&&n.trim()))throw new Error('XML requires one document element.');return roots[0];
}
export const xmlChildren=(node,name)=>node?.children?.filter(n=>typeof n!=='string'&&(!name||n.local===name))||[];
export const xmlChild=(node,name)=>xmlChildren(node,name)[0];
export function xmlAll(node,name) { const found=[],stack=[node];while(stack.length){const n=stack.pop();if(!n||typeof n==='string')continue;if(n.local===name)found.push(n);stack.push(...[...n.children].reverse());}return found; }
export function xmlText(node) { return typeof node==='string'?node:(node?.children||[]).map(xmlText).join(''); }
export function xmlString(node) { return typeof node==='string'?xmlEscape(node):`<${node.name}${Object.entries(node.attrs).map(([k,v])=>` ${k}="${xmlEscape(v)}"`).join('')}>${node.children.map(xmlString).join('')}</${node.name}>`; }
