import { evaluate } from './expression.js';
/** Independent OPC drawing and legacy XML interchange. Technical namespace URIs are protocol IDs.
 * No macros, linked objects, executable formulas, or external relationships are executed.
 */
import { readZIP, writeZIP, archiveText, crc32 } from './archive.js';
import { parseXML, xmlChild, xmlChildren, xmlAll, xmlText, xmlEscape } from './xml.js';
import { createDocument, createPage, addNode, addEdge, assertDocument, parseDocument } from './model.js';
import { pathGeometry, compoundGeometry, pathContours, flattenPath } from './drawing.js';
import { circleThrough, arcSamples } from './curves.js';
import { getMaster, shapeGeometry, getPorts } from './stencils.js';
import { rasterFromBytes } from './assets.js';
import { plainText } from './rich-text.js';
const NS='http://schemas.microsoft.com/office/visio/2012/main', REL='http://schemas.openxmlformats.org/package/2006/relationships', R='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const TYPES='http://schemas.microsoft.com/visio/2010/relationships/', MIME='application/vnd.ms-visio.';
const E=xmlEscape,cell=(name,value)=>`<Cell N="${name}" V="${E(value)}"/>`,identity=[1,0,0,1,0,0];
const matrix=(a,b)=>[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
const point=(m,p)=>({x:m[0]*p.x+m[2]*p.y+m[4],y:m[1]*p.x+m[3]*p.y+m[5]});
function cells(element, inherited={}){
  const result={...inherited}; if(!element)return result;
  for(const c of xmlChildren(element,'Cell')){if(c.attrs.F==='Inh'&&c.attrs.V===undefined)continue;result[c.attrs.N]=c.attrs.V??c.attrs.F??'';}
  // Older XML stores cells as named elements inside functional sections.
  for(const group of xmlChildren(element)) if(['XForm','XForm1D','Line','Fill','Char','Para','TextBlock','PageProps','Misc'].includes(group.local))for(const c of xmlChildren(group))result[c.local]=xmlText(c)||c.attrs.F||'';
  return result;
}
function coordinate(value,context={}) {
  if(typeof value==='number')return value;if(value===undefined||value==='')return 0;
  let source=String(value).trim();if(/^[-+\d.e]+DA$/i.test(source))return parseFloat(source)*Math.PI/180;
  for(let i=0;i<4&&/^GUARD\([\s\S]*\)$/i.test(source);i++)source=source.slice(6,-1);
  source=source.replace(/Geometry\d+\.[XYABCD]\d+|\b(?:Width|Height|BeginX|BeginY|EndX|EndY)\b/gi,name=>{const actual=Object.keys(context).find(k=>k.toLowerCase()===name.toLowerCase());if(actual===undefined||!Number.isFinite(Number(context[actual])))throw new Error(`Unresolved coordinate ${name}.`);return `(${Number(context[actual])})`;}).replace(/\b(MIN|MAX|ABS|SIN|COS|SQRT|PI)\b/g,name=>name.toLowerCase());
  return evaluate(source,{w:Number(context.Width)||1,h:Number(context.Height)||1});
}
function coordinateCells(values){const result={...values};for(let pass=0;pass<3;pass++)for(const k of ['BeginX','BeginY','EndX','EndY','Width','Height','PinX','PinY','LocPinX','LocPinY','Angle'])if(result[k]!==undefined){try{result[k]=coordinate(result[k],result);}catch{}}return result;}
function number(value,fallback=0){if(value===undefined||value==='')return fallback;const n=Number(value);return Number.isFinite(n)?n:fallback;}
function color(value,fallback='#ffffff'){if(/^#[\da-f]{6}$/i.test(value||''))return value;const palette=['#000000','#ffffff','#ff0000','#00ff00','#0000ff','#ffff00','#ff00ff','#00ffff'];return palette[Number(value)]||fallback;}
function resolvePath(base,target){if(!target||/^[a-z]+:/i.test(target)||target.startsWith('//'))throw new Error('External package relationships are not loaded.');const stack=target.startsWith('/')?[]:base.split('/').slice(0,-1);for(const part of target.split('/')){if(!part||part==='.')continue;if(part==='..'){if(!stack.length)throw new Error('Relationship escapes the package.');stack.pop();}else stack.push(part);}return stack.join('/');}
function relPath(path){const p=path.split('/'),name=p.pop();return [...p,'_rels',`${name}.rels`].join('/');}
function relationships(entries,path){const data=entries.get(path?relPath(path):'_rels/.rels');if(!data)return new Map();return new Map(xmlChildren(parseXML(archiveText(data)),'Relationship').filter(r=>r.attrs.TargetMode!=='External').map(r=>[r.attrs.Id,{type:r.attrs.Type,target:resolvePath(path,r.attrs.Target)}]));}
function signature(entries){return [...entries].filter(([name])=>!name.startsWith('nexora/')).sort(([a],[b])=>a.localeCompare(b)).map(([name,bytes])=>`${name}:${bytes.length}:${crc32(bytes)}`).join('\n');}
const nativePorts=[{id:'north',x:'w/2',y:0,dx:0,dy:-1},{id:'east',x:'w',y:'h/2',dx:1,dy:0},{id:'south',x:'w/2',y:'h',dx:0,dy:1},{id:'west',x:0,y:'h/2',dx:-1,dy:0}];
function xform(c){const w=number(c.Width,1),h=number(c.Height,1),angle=number(c.Angle),co=Math.cos(angle),si=Math.sin(angle),fx=number(c.FlipX)?-1:1,fy=number(c.FlipY)?-1:1,lx=number(c.LocPinX,w/2),ly=number(c.LocPinY,h/2),a=co*fx,b=si*fx,d=co*fy,cc=-si*fy;return [a,b,cc,d,number(c.PinX,w/2)-a*lx-cc*ly,number(c.PinY,h/2)-b*lx-d*ly];}
function shapeRings(shape,c,report,label){
  const w=number(c.Width,1),h=number(c.Height,1),sections=xmlChildren(shape,'Section').filter(s=>s.attrs.N==='Geometry').concat(xmlChildren(shape,'Geom')),rings=[];let curved=false;const refs={...c,Width:w,Height:h};
  for(const section of sections){const flags=cells(section);if(number(flags.NoShow))continue;let ring=[],current={x:0,y:0};
    const rows=xmlChildren(section,'Row').length?xmlChildren(section,'Row'):xmlChildren(section).filter(n=>!['NoFill','NoLine','NoShow','NoSnap','NoQuickDrag'].includes(n.local));
    for(const row of rows){if(row.attrs.Del==='1')continue;const type=row.attrs.T||row.local,r=cells(row);for(const ch of xmlChildren(row))if(ch.local!=='Cell')r[ch.local]=xmlText(ch)||ch.attrs.F||'';for(const name of ['X','Y','A','B','C','D'])if(r[name]!==undefined && !/^POLYLINE/i.test(r[name])){try{r[name]=coordinate(r[name],refs);}catch(error){report.push({severity:'warning',code:'COORDINATE_FORMULA',object:label,message:error.message});r[name]=0;}}const rowIndex=Number(row.attrs.IX)||rows.indexOf(row)+1,sectionIndex=Number(section.attrs.IX||0)+1;for(const name of ['X','Y','A','B','C','D'])if(Number.isFinite(Number(r[name])))refs[`Geometry${sectionIndex}.${name}${rowIndex}`]=Number(r[name]);
      const relative=type.startsWith('Rel'),end={x:number(r.X)*(relative?w:1),y:number(r.Y)*(relative?h:1)};
      if(type==='MoveTo'||type==='RelMoveTo'){if(ring.length>1)rings.push({points:ring,closed:!number(flags.NoFill)});ring=[end];current=end;}
      else if(type==='LineTo'||type==='RelLineTo'){ring.push(end);current=end;}
      else if(type==='PolylineTo'||type==='PolyLineTo'){
        const data=String(r.A||'').match(/^POLYLINE\((.*)\)$/i);if(!data)throw new Error('Missing polyline coordinate data.');const values=data[1].split(',').map(v=>coordinate(v,refs));if(values.length<4||(values.length-2)%2)throw new Error('Invalid polyline coordinate count.');for(let i=2;i<values.length;i+=2)ring.push({x:values[i]*(values[0]===0?w:1),y:values[i+1]*(values[1]===0?h:1)});ring.push(end);current=end;
      }else if(type==='NURBSTo'){
        const data=String(r.E||'').match(/^NURBS\((.*)\)$/i);if(!data)throw new Error('Missing spline coordinate data.');const values=data[1].split(',').map(v=>coordinate(v,refs)),degree=values[1],controls=[current],weights=[number(r.D,1)],knots=[];if((values.length-4)%4)throw new Error('Invalid spline control count.');for(let i=4;i<values.length;i+=4){controls.push({x:values[i]*(values[2]===0?w:1),y:values[i+1]*(values[3]===0?h:1)});knots.push(values[i+2]);weights.push(values[i+3]);}if(Math.hypot(controls.at(-1).x-end.x,controls.at(-1).y-end.y)>1e-9){controls.push(end);weights.push(number(r.B,1));}
        if([2,3].includes(degree)&&controls.length===degree+1&&weights.every(v=>Math.abs(v-1)<1e-9)&&knots.every(v=>v===knots[0])){ring.push(...flattenPath(pathGeometry(controls,degree===2?'quadratic':'cubic'),.002).slice(1));curved=true;}
        else{ring.push(end);report.push({severity:'warning',code:'SPLINE_APPROXIMATION',object:label,message:'This spline knot/weight configuration is outside the supported polynomial subset; its endpoint chord is retained.'});}current=end;
      }else if(type==='ArcTo'){
        const sag=number(r.A),dx=end.x-current.x,dy=end.y-current.y,len=Math.hypot(dx,dy);if(Math.abs(sag)<1e-9||len<1e-9)ring.push(end);else{const through={x:(current.x+end.x)/2-dy/len*sag,y:(current.y+end.y)/2+dx/len*sag};ring.push(...arcSamples(circleThrough(current,through,end),.002).slice(1));curved=true;}current=end;
      }else if(type==='RelQuadBezTo'||type==='RelCubBezTo'){
        const controls=[current,{x:number(r.A)*w,y:number(r.B)*h}];if(type==='RelCubBezTo')controls.push({x:number(r.C)*w,y:number(r.D)*h});controls.push(end);ring.push(...flattenPath(pathGeometry(controls,type==='RelCubBezTo'?'cubic':'quadratic'),.002).slice(1));current=end;curved=true;
      }else if(type==='Ellipse'){
        const center=end,u={x:number(r.A)-center.x,y:number(r.B)-center.y},v={x:number(r.C)-center.x,y:number(r.D)-center.y};ring=Array.from({length:96},(_,i)=>{const a=i*Math.PI/48;return {x:center.x+u.x*Math.cos(a)+v.x*Math.sin(a),y:center.y+u.y*Math.cos(a)+v.y*Math.sin(a)};});curved=true;
      }else if(type==='EllipticalArcTo'){
        const angle=number(r.C),ratio=number(r.D,1),co=Math.cos(angle),si=Math.sin(angle);if(ratio<=0)throw new Error('Invalid ellipse ratio.');const normalize=p=>({x:p.x*co+p.y*si,y:(-p.x*si+p.y*co)*ratio}),denormalize=p=>({x:p.x*co-p.y/ratio*si,y:p.x*si+p.y/ratio*co});const arc=circleThrough(normalize(current),normalize({x:number(r.A),y:number(r.B)}),normalize(end));ring.push(...arcSamples(arc,.002).slice(1).map(denormalize));current=end;curved=true;
      }else{report.push({severity:'warning',code:'GEOMETRY_ROW',object:label,message:`Geometry row ${type} was not evaluated; the supported outline is retained.`});}
    }
    if(ring.length>1)rings.push({points:ring,closed:!number(flags.NoFill)});
  }
  for(const r of rings){r.points=r.points.filter((p,i,list)=>!i||Math.hypot(p.x-list[i-1].x,p.y-list[i-1].y)>1e-10);if(r.points.length>2&&Math.hypot(r.points[0].x-r.points.at(-1).x,r.points[0].y-r.points.at(-1).y)<1e-9){r.points.pop();r.closed=true;}}
  if(curved)report.push({severity:'info',code:'CURVE_TESSELLATED',object:label,message:'Imported native curves use vector subdivision at 0.192 document-pixel tolerance.'});
  return rings.filter(r=>r.points.length>=2);
}
function readRich(shape,style){
  const text=xmlChild(shape,'Text');if(!text)return null;
  const chars=new Map(xmlChildren(shape,'Section').filter(s=>s.attrs.N==='Character').flatMap(s=>xmlChildren(s,'Row').map(r=>[r.attrs.IX||'0',cells(r)]))),pars=new Map(xmlChildren(shape,'Section').filter(s=>s.attrs.N==='Paragraph').flatMap(s=>xmlChildren(s,'Row').map(r=>[r.attrs.IX||'0',cells(r)])));
  let mark={...cells(shape),...(chars.get('0')||{})},para={...cells(shape),...(pars.get('0')||{})},runs=[],paragraphs=[];
  const flush=()=>{paragraphs.push({align:['left','center','right','justify'][number(para.HorzAlign)]||'left',runs:runs.length?runs:[{text:''}]});runs=[];};
  const visit=node=>{if(typeof node==='string'){const pieces=node.split('\n');pieces.forEach((part,i)=>{if(i)flush();if(part){const bits=number(mark.Style);runs.push({text:part,bold:!!(bits&1),italic:!!(bits&2),underline:!!(bits&4),size:Math.max(6,Math.min(120,number(mark.Size,number(style.Size,16/96))*96)),color:color(mark.Color,style.textColor||'#334155')});}});}else if(node.local==='cp')mark=chars.get(node.attrs.IX)||mark;else if(node.local==='pp')para=pars.get(node.attrs.IX)||para;else node.children.forEach(visit);};text.children.forEach(visit);flush();return {version:1,paragraphs};
}
export function importLegacyXML(source){const root=parseXML(source),report=[];if(root.local!=='VisioDocument')throw new Error('Unsupported XML document root.');return importParts(root,xmlAll(root,'Page').map(p=>({metadata:p,contents:p,rels:new Map()})),new Map(),report);}
export function importNativePackage(bytes){
  const entries=readZIP(bytes),report=[];
  if(entries.has('nexora/document.json')&&entries.has('nexora/manifest.json')){
    try{const manifest=JSON.parse(archiveText(entries.get('nexora/manifest.json')));if(manifest.standardParts===signature(entries))return {doc:parseDocument(archiveText(entries.get('nexora/document.json'))),report:[{severity:'info',code:'LOSSLESS_EXTENSION',message:'Unmodified standard parts verified; the full Nexora document extension was restored.'}]};}catch(error){report.push({severity:'warning',code:'EXTENSION_REJECTED',message:error.message});}
  }
  for(const name of entries.keys())if(/vba|activex|embeddings/i.test(name))report.push({severity:'warning',code:'ACTIVE_CONTENT_IGNORED',message:`Active or embedded-object part ${name} was not executed or imported.`});
  const rootRels=relationships(entries,''),documentPath=[...rootRels.values()].find(r=>r.type.endsWith('/document'))?.target||'visio/document.xml';
  if(!entries.has(documentPath))throw new Error('Package contains no supported drawing document.');const root=parseXML(archiveText(entries.get(documentPath))),rels=relationships(entries,documentPath);
  const pagesPath=[...rels.values()].find(r=>r.type.endsWith('/pages'))?.target||'visio/pages/pages.xml',pageRels=relationships(entries,pagesPath),pages=[];
  if(!entries.has(pagesPath))throw new Error('This package contains no drawing pages.');
  for(const metadata of xmlChildren(parseXML(archiveText(entries.get(pagesPath))),'Page')){const rel=xmlChild(metadata,'Rel'),target=pageRels.get(rel?.attrs['r:id']||rel?.attrs.id)?.target;if(!target||!entries.has(target))throw new Error('Drawing page relationship is missing.');pages.push({metadata,contents:parseXML(archiveText(entries.get(target))),rels:relationships(entries,target)});}
  const masters=new Map(),mastersPath=[...rels.values()].find(r=>r.type.endsWith('/masters'))?.target;
  if(mastersPath&&entries.has(mastersPath)){const masterRels=relationships(entries,mastersPath);for(const master of xmlChildren(parseXML(archiveText(entries.get(mastersPath))),'Master')){const rel=xmlChild(master,'Rel'),target=masterRels.get(rel?.attrs['r:id'])?.target;if(target&&entries.has(target))masters.set(master.attrs.ID,parseXML(archiveText(entries.get(target))));}}
  return importParts(root,pages,masters,report,entries);
}
function importParts(root,pages,masters,report,entries=new Map()){
  if(!pages.length||pages.length>100)throw new Error('Drawing must contain 1–100 pages.');const doc=createDocument('Imported drawing');doc.pages={};doc.pageOrder=[];
  const styles=new Map(xmlAll(root,'StyleSheet').map(s=>[s.attrs.ID,s]));
  const styleCells=(shape,seen=new Set())=>{let result={};for(const key of ['LineStyle','FillStyle','TextStyle']){const id=shape?.attrs?.[key];if(id&&!seen.has(id)&&styles.has(id)){seen.add(id);result={...result,...styleCells(styles.get(id),seen),...cells(styles.get(id))};}}return result;};
  for(const item of pages){const p=createPage((item.metadata.attrs.Name||item.metadata.attrs.NameU||`Page ${doc.pageOrder.length+1}`).slice(0,100)),pc=cells(xmlChild(item.metadata,'PageSheet')||item.metadata);p.width=Math.max(200,Math.min(100000,number(pc.PageWidth,13.75)*96));p.height=Math.max(200,Math.min(100000,number(pc.PageHeight,9.375)*96));doc.pages[p.id]=p;doc.pageOrder.push(p.id);const ids=new Map(),edgeShapes=[],rootMatrix=[96,0,0,-96,0,p.height];
    function visit(shape,parentId=null,parentMatrix=rootMatrix,masterContext=null){
      const externalId=shape.attrs.ID||String(ids.size+1),master=masters.get(shape.attrs.Master)||masterContext,masterShape=master&&(xmlAll(master,'Shape').find(s=>s.attrs.ID===shape.attrs.MasterShape)||xmlChild(xmlChild(master,'Shapes'),'Shape'));
      const c=coordinateCells(cells(shape,{...styleCells(shape),...cells(masterShape)})),w=number(c.Width,1),h=number(c.Height,1);
      if(w<=0||h<=0||!Number.isFinite(w*h))report.push({severity:'warning',code:'ZERO_EXTENT',object:externalId,message:'A zero extent was expanded to the minimum editable size.'});
      if(number(c.OneD)||c.BeginX!==undefined&&c.EndX!==undefined){edgeShapes.push({shape,c,parentMatrix,id:externalId});return;}
      const transform=matrix(parentMatrix,xform(c)),childShapes=xmlChildren(xmlChild(shape,'Shapes'),'Shape'),isGroup=shape.attrs.Type==='Group'||childShapes.length>0, corners=[{x:0,y:0},{x:Math.max(.01,w),y:0},{x:Math.max(.01,w),y:Math.max(.01,h)},{x:0,y:Math.max(.01,h)}].map(pt=>point(transform,pt));
      let rings=shapeRings(shape,c,report,externalId);if(!rings.length&&masterShape)rings=shapeRings(masterShape,c,report,externalId);if(!rings.length)rings=[{points:[{x:0,y:0},{x:Math.max(.01,w),y:0},{x:Math.max(.01,w),y:Math.max(.01,h)},{x:0,y:Math.max(.01,h)}],closed:true}];
      const multiOpen=rings.length>1&&!rings.every(r=>r.closed);const world=rings.map(r=>r.points.map(pt=>point(transform,pt))),closed=rings.every(r=>r.closed),geo=isGroup||multiOpen?compoundGeometry([corners]):closed&&world[0].length>=3?compoundGeometry(world):pathGeometry(world[0],'linear',false);
      const fill=number(c.FillPattern,1)===0?'none':color(c.FillForegnd),stroke=number(c.LinePattern,1)===0?'none':color(c.LineColor,'#456a91'),geometry={...geo,fill,stroke,strokeWidth:Math.max(0,Math.min(64,number(c.LineWeight,1.5/96)*96)),fontSize:16,textColor:'#334155',opacity:1-number(c.FillForegndTrans,0),dash:number(c.LinePattern,1)>1?'dash':'solid'};
      if(isGroup||multiOpen){delete geometry.path;delete geometry.contours;delete geometry.pathMode;delete geometry.closed;geometry.fill='none';geometry.stroke='none';}
      const id=addNode(doc,p,isGroup||multiOpen?'group':'path',geometry.x,geometry.y,{parentId,label:xmlText(xmlChild(shape,'Text')).slice(0,10000),geometry});ids.set(externalId,id);const n=p.graph.nodes[id];n.ports=structuredClone(nativePorts);n.data.sourceId=externalId;
      const rich=readRich(shape,geometry);if(rich){n.richText=rich;n.label=plainText(rich);}
      for(const section of xmlChildren(shape,'Section').filter(s=>s.attrs.N==='Property'))for(const row of xmlChildren(section,'Row')){const prop=cells(row),name=prop.Label||row.attrs.N||`Property ${row.attrs.IX}`;if(!['__proto__','constructor','prototype'].includes(name))n.data[name]=prop.Value??'';}
      for(const cnode of xmlAll(shape,'Cell'))if(cnode.attrs.F&&!/^(?:Inh|No Formula)$/i.test(cnode.attrs.F)) {report.push({severity:'info',code:'CACHED_FORMULA',object:externalId,message:'Cached cell values were imported; native formula execution is disabled.'});break;}
      const foreign=xmlChild(shape,'ForeignData'),rel=xmlChild(foreign,'Rel'),media=rel&&item.rels.get(rel.attrs['r:id'])?.target;
      if(media&&entries.has(media)){try{n.image=embeddedRaster(entries.get(media),media);n.master='image';const g=p.view.nodes[id];delete g.path;delete g.pathMode;delete g.contours;delete g.closed;g.w=Math.max(24,g.w);g.h=Math.max(24,g.h);}catch(error){report.push({severity:'warning',code:'IMAGE_UNSUPPORTED',object:externalId,message:error.message});}}
      if(multiOpen){
        rings.forEach((r,index)=>{const pts=world[index],child=addNode(doc,p,'path',0,0,{parentId:id,label:'',geometry:{...geometry,...(r.closed&&pts.length>=3?compoundGeometry([pts]):pathGeometry(pts)),fill:r.closed?fill:'none',stroke}});p.graph.nodes[child].data.sourceGeometry=index;});
        if(n.label||n.richText){const text=addNode(doc,p,'text',geometry.x,geometry.y,{parentId:id,label:n.label,geometry:{x:geometry.x,y:geometry.y,w:Math.max(24,geometry.w),h:Math.max(24,geometry.h),fill:'none',stroke:'none'}});if(n.richText)p.graph.nodes[text].richText=structuredClone(n.richText);}
      }
      childShapes.forEach(child=>visit(child,id,transform,master));
    }
    for(const shape of xmlChildren(xmlChild(item.contents,'Shapes'),'Shape'))visit(shape);
    const connects=xmlChildren(xmlChild(item.contents,'Connects'),'Connect');
    for(const edge of edgeShapes){let ps=[point(edge.parentMatrix,{x:number(edge.c.BeginX),y:number(edge.c.BeginY)}),point(edge.parentMatrix,{x:number(edge.c.EndX),y:number(edge.c.EndY)})],links=connects.filter(c=>c.attrs.FromSheet===edge.id),from=links.find(c=>/^Begin/.test(c.attrs.FromCell||'')),to=links.find(c=>/^End/.test(c.attrs.FromCell||'')),style={stroke:color(edge.c.LineColor,'#788da4'),strokeWidth:Math.max(0,Math.min(64,number(edge.c.LineWeight,1.6/96)*96)),endArrow:number(edge.c.EndArrow)?'triangle':'none'};const routeRings=shapeRings(edge.shape,edge.c,report,edge.id);if(routeRings[0]?.points.length>1){const m=matrix(edge.parentMatrix,xform(edge.c));ps=routeRings[0].points.map(pt=>point(m,pt));}
      if(from&&to&&ids.has(from.attrs.ToSheet)&&ids.has(to.attrs.ToSheet)){const id=addEdge(p,{nodeId:ids.get(from.attrs.ToSheet),port:'auto'},{nodeId:ids.get(to.attrs.ToSheet),port:'auto'},xmlText(xmlChild(edge.shape,'Text')),{...style,waypoints:ps.slice(1,-1).slice(0,100)});if(ps.length>102)report.push({severity:'warning',code:'CONNECTOR_POINTS',object:edge.id,message:'Connector route exceeded 100 interior waypoints; remaining route samples were not imported.'});ids.set(edge.id,id);}
      else{const id=addNode(doc,p,'path',0,0,{label:xmlText(xmlChild(edge.shape,'Text')),geometry:{...pathGeometry(ps),...style,fill:'none'}});ids.set(edge.id,id);report.push({severity:'info',code:'FREE_CONNECTOR',object:edge.id,message:'Unglued connector was imported as an editable standalone line.'});}
    }
  }
  doc.importReport=report;assertDocument(doc);return {doc,report};
}
export function embeddedRaster(bytes,name){return rasterFromBytes(bytes,name);}
function nativeStyle(g){return cell('LineColor',g.stroke&&g.stroke!=='none'?g.stroke:'#000000')+cell('LineWeight',(g.strokeWidth??1.5)/96)+cell('LinePattern',g.stroke==='none'||g.strokeWidth===0?0:g.dash&&g.dash!=='solid'?2:1)+cell('FillForegnd',g.fill&&g.fill!=='none'&&g.fill!=='transparent'?g.fill:'#ffffff')+cell('FillPattern',!g.fill||['none','transparent'].includes(g.fill)?0:1)+cell('FillForegndTrans',1-(g.opacity??1));}
export function exportNativePackage(doc,routesByPage=new Map()){
  assertDocument(doc);const entries=new Map(),pageRecords=[],pageRelationships=[],contentTypes=[],encoder=new TextEncoder();
  doc.pageOrder.forEach((pageId,index)=>{
    const p=doc.pages[pageId],number=index+1,ids=new Map([...Object.keys(p.graph.nodes),...Object.keys(p.graph.edges)].map((id,i)=>[id,i+1])),images=[],links=[];
    const shapeXML=(id,parent=null)=>{const n=p.graph.nodes[id],g=p.view.nodes[id],parentGeo=parent?p.view.nodes[parent]:null,baseX=parentGeo?.x||0,baseY=parentGeo?parentGeo.y+parentGeo.h:p.height,w=g.w/96,h=g.h/96;
      const children=Object.values(p.graph.nodes).filter(child=>child.parentId===id),isGroup=n.master==='group'||children.length>0;
      const geo=shapeGeometry(getMaster(doc,n.master),g),rings=n.master==='path'?pathContours(g):[geo.points];
      let body=cell('PinX',(g.x-baseX+g.w/2)/96)+cell('PinY',(baseY-g.y-g.h/2)/96)+cell('Width',w)+cell('Height',h)+cell('LocPinX',w/2)+cell('LocPinY',h/2)+nativeStyle(g);
      if(!isGroup&&!n.image)body+=rings.map((ring,i)=>`<Section N="Geometry" IX="${i}">${cell('NoFill',n.master==='path'&&!g.closed?1:0)}${ring.concat(n.master!=='path'||g.closed?[ring[0]]:[]).map((pt,j)=>`<Row T="${j?'LineTo':'MoveTo'}" IX="${j+1}">${cell('X',(pt.x-g.x)/96)}${cell('Y',(g.y+g.h-pt.y)/96)}</Row>`).join('')}</Section>`).join('');
      if(n.richText){const all=n.richText.paragraphs.flatMap(par=>par.runs);body+=`<Section N="Character">${all.map((run,i)=>`<Row IX="${i}">${cell('Style',(run.bold?1:0)+(run.italic?2:0)+(run.underline?4:0))}${cell('Size',(run.size||g.fontSize||16)/96)}${cell('Color',run.color||g.textColor||'#334155')}</Row>`).join('')}</Section><Text>`;let runIndex=0;body+=n.richText.paragraphs.map(par=>par.runs.map(run=>`<cp IX="${runIndex++}"/>${E(run.text)}`).join('')).join('\n')+'</Text>';}else if(n.label)body+=`<Text>${E(n.label)}</Text>`;
      if(Object.keys(n.data).length)body+=`<Section N="Property">${Object.entries(n.data).map(([key,value],i)=>`<Row N="Prop${i}" IX="${i}">${cell('Label',key)}${cell('Value',typeof value==='object'?JSON.stringify(value):value)}</Row>`).join('')}</Section>`;
      if(n.image){const ext=n.image.mime.split('/')[1],name=`image${number}-${images.length+1}.${ext}`,relId=`image${images.length+1}`,binary=atob(n.image.data.split(',')[1]);entries.set(`visio/media/${name}`,Uint8Array.from(binary,c=>c.charCodeAt(0)));images.push({id:relId,target:`../media/${name}`,mime:n.image.mime,name});body+=`<ForeignData ForeignType="Bitmap" CompressionType="${ext==='jpeg'?'JPEG':ext==='png'?'PNG':'WebP'}"><Rel r:id="${relId}"/></ForeignData>`;}
      if(children.length)body+=`<Shapes>${children.map(child=>shapeXML(child.id,id)).join('')}</Shapes>`;
      return `<Shape ID="${ids.get(id)}" NameU="${E(n.label.slice(0,100)||n.master)}" Type="${isGroup?'Group':n.image?'Foreign':'Shape'}">${body}</Shape>`;
    };
    const shapes=Object.values(p.graph.nodes).filter(n=>!n.parentId).map(n=>shapeXML(n.id));
    for(const e of Object.values(p.graph.edges)){const g=p.view.edges[e.id],fromGeo=p.view.nodes[e.from.nodeId],toGeo=p.view.nodes[e.to.nodeId],ps=routesByPage.get(pageId)?.get(e.id)?.points||[{x:fromGeo.x+fromGeo.w/2,y:fromGeo.y+fromGeo.h/2},{x:toGeo.x+toGeo.w/2,y:toGeo.y+toGeo.h/2}],a=ps[0],b=ps.at(-1);
      const minX=Math.min(...ps.map(p=>p.x)),maxX=Math.max(...ps.map(p=>p.x)),minY=Math.min(...ps.map(p=>p.y)),maxY=Math.max(...ps.map(p=>p.y)),cw=Math.max(1,maxX-minX),ch=Math.max(1,maxY-minY);
      shapes.push(`<Shape ID="${ids.get(e.id)}" Type="Shape">${cell('PinX',(minX+cw/2)/96)}${cell('PinY',(p.height-minY-ch/2)/96)}${cell('Width',cw/96)}${cell('Height',ch/96)}${cell('LocPinX',cw/192)}${cell('LocPinY',ch/192)}<Section N="Geometry" IX="0">${cell('NoFill',1)}${ps.map((pt,j)=>`<Row T="${j?'LineTo':'MoveTo'}" IX="${j+1}">${cell('X',(pt.x-minX)/96)}${cell('Y',(minY+ch-pt.y)/96)}</Row>`).join('')}</Section>${cell('OneD',1)}${cell('BeginX',a.x/96)}${cell('BeginY',(p.height-a.y)/96)}${cell('EndX',b.x/96)}${cell('EndY',(p.height-b.y)/96)}${nativeStyle({...g,fill:'none'})}${cell('EndArrow',g.endArrow==='none'?0:4)}<Text>${E(e.label)}</Text></Shape>`);links.push(`<Connect FromSheet="${ids.get(e.id)}" FromCell="BeginX" FromPart="9" ToSheet="${ids.get(e.from.nodeId)}" ToCell="PinX" ToPart="3"/><Connect FromSheet="${ids.get(e.id)}" FromCell="EndX" FromPart="12" ToSheet="${ids.get(e.to.nodeId)}" ToCell="PinX" ToPart="3"/>`);
    }
    entries.set(`visio/pages/page${number}.xml`,`<?xml version="1.0" encoding="UTF-8"?><PageContents xmlns="${NS}" xmlns:r="${R}"><Shapes>${shapes.join('')}</Shapes><Connects>${links.join('')}</Connects></PageContents>`);
    if(images.length)entries.set(`visio/pages/_rels/page${number}.xml.rels`,`<Relationships xmlns="${REL}">${images.map(i=>`<Relationship Id="${i.id}" Type="${R}/image" Target="${i.target}"/>`).join('')}</Relationships>`);
    images.forEach(i=>contentTypes.push(`<Override PartName="/visio/media/${i.name}" ContentType="${i.mime}"/>`));
    pageRecords.push(`<Page ID="${index}" Name="${E(p.name)}" NameU="${E(p.name)}"><PageSheet>${cell('PageWidth',p.width/96)}${cell('PageHeight',p.height/96)}</PageSheet><Rel r:id="rId${number}"/></Page>`);pageRelationships.push(`<Relationship Id="rId${number}" Type="${TYPES}page" Target="page${number}.xml"/>`);contentTypes.push(`<Override PartName="/visio/pages/page${number}.xml" ContentType="${MIME}page+xml"/>`);
  });
  entries.set('_rels/.rels',`<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${TYPES}document" Target="visio/document.xml"/></Relationships>`);
  entries.set('visio/document.xml',`<VisioDocument xmlns="${NS}"><DocumentSettings/><StyleSheets><StyleSheet ID="0" NameU="No Style"/></StyleSheets></VisioDocument>`);
  entries.set('visio/_rels/document.xml.rels',`<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${TYPES}pages" Target="pages/pages.xml"/><Relationship Id="nexora" Type="urn:nexora:document" Target="../nexora/document.json"/></Relationships>`);
  entries.set('visio/pages/pages.xml',`<Pages xmlns="${NS}" xmlns:r="${R}">${pageRecords.join('')}</Pages>`);entries.set('visio/pages/_rels/pages.xml.rels',`<Relationships xmlns="${REL}">${pageRelationships.join('')}</Relationships>`);
  entries.set('[Content_Types].xml',`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="json" ContentType="application/json"/><Override PartName="/visio/document.xml" ContentType="${MIME}drawing.main+xml"/><Override PartName="/visio/pages/pages.xml" ContentType="${MIME}pages+xml"/>${contentTypes.join('')}</Types>`);
  const binary=new Map([...entries].map(([name,data])=>[name,typeof data==='string'?encoder.encode(data):data]));binary.set('nexora/document.json',encoder.encode(JSON.stringify(doc)));binary.set('nexora/manifest.json',encoder.encode(JSON.stringify({version:1,standardParts:signature(binary)})));return writeZIP(binary);
}
