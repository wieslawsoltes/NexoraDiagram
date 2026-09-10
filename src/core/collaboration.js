/** Offline-capable operation CRDT. Registers are field-level except geometry/rich text/image
 * records, whose correlated fields are atomic. Tombstones prevent stale edits resurrecting
 * deleted entities. Ordered Lamport stamps make merge idempotent and arrival-order independent.
 */
import { assertDocument, createPage, parseDocument } from './model.js';
import { BUILTINS, getPorts, isContainer } from './stencils.js';
const copy=v=>v===undefined?undefined:structuredClone(v), same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const safe=s=>typeof s==='string' && /^[a-zA-Z][\w-]{0,127}$/.test(s) && !['constructor','prototype','__proto__'].includes(s);
const geoKeys=new Set(['x','y','w','h','rotation','flipX','flipY','path','pathMode','closed','contours','pressures','tilts','ink']);
const paperKeys=new Set(['width','height','originX','originY','canvasMode','units','gridSize','drawingScale']);
const compare=(a,b)=>a[0]-b[0] || (a[1]<b[1]?-1:a[1]>b[1]?1:0);
const key=(...parts)=>JSON.stringify(parts);
function recordFields(n,g){
  const fields={},geometry={}; for(const [name,value] of Object.entries(g))if(geoKeys.has(name))geometry[name]=copy(value);else fields[`g:${name}`]=copy(value);
  fields.shape={master:n.master,geometry};if(n.ports)fields.shape.ports=copy(n.ports);if(n.image)fields.shape.image=copy(n.image);
  fields.label={label:n.label};if(n.richText)fields.label.richText=copy(n.richText);
  for(const [name,value] of Object.entries(n))if(!['id','master','ports','image','label','richText','data'].includes(name))fields[`n:${name}`]=copy(value);
  for(const [name,value] of Object.entries(n.data||{}))fields[`data:${name}`]=copy(value);return fields;
}
export function collaborationEntities(doc){
  const entities=new Map(),root={};for(const [name,value] of Object.entries(doc))if(!['pages','stencils'].includes(name))root[name]=copy(value);entities.set(key('document'),root);
  for(const [id,m] of Object.entries(doc.stencils))entities.set(key('stencil',id),{master:copy(m)});
  for(const p of Object.values(doc.pages)){
    const fields={paper:{}};for(const [name,value] of Object.entries(p))if(paperKeys.has(name))fields.paper[name]=copy(value);else if(!['graph','view','id'].includes(name))fields[name]=copy(value);entities.set(key('page',p.id),fields);
    for(const n of Object.values(p.graph.nodes))entities.set(key('node',p.id,n.id),recordFields(n,p.view.nodes[n.id]));
    for(const e of Object.values(p.graph.edges))entities.set(key('edge',p.id,e.id),{semantic:copy(e),geometry:copy(p.view.edges[e.id])});
  }return entities;
}
function validateEntry(k,field,value){
  let parts;try{parts=JSON.parse(k);}catch{throw new Error('Invalid collaboration entity.');}
  if(!Array.isArray(parts)||!['document','page','node','edge','stencil'].includes(parts[0])||parts.length!==({document:1,page:2,node:3,edge:3,stencil:2}[parts[0]])||parts.slice(1).some(s=>!safe(s)))throw new Error('Invalid collaboration identity.');
  if(typeof field!=='string'||field.length>256||['__proto__','constructor','prototype'].includes(field)||field.split(':').some(s=>['__proto__','constructor','prototype'].includes(s)))throw new Error('Invalid collaboration property.');
  // Serialization also rejects recursive objects and non-JSON scalar values.
  if(value!==undefined && JSON.stringify(value)===undefined)throw new Error('Unsupported collaboration value.');
}
export function collaborationKeyForPath(path){
  if(path[0]==='pages'){
    const p=path[1];if(path.length<3)return [key('page',p),'$alive'];
    if(['graph','view'].includes(path[2]) && ['nodes','edges'].includes(path[3])){
      const id=path[4],kind=path[3]==='nodes'?'node':'edge';if(path.length<6)return [key(kind,p,id),'$alive'];
      const f=path[5];if(kind==='edge')return [key(kind,p,id),path[2]==='graph'?'semantic':'geometry'];
      return [key(kind,p,id),path[2]==='view'?(geoKeys.has(f)?'shape':`g:${f}`):['master','ports','image'].includes(f)?'shape':['label','richText'].includes(f)?'label':f==='data'?`data:${path[6]}`:`n:${f}`];
    }
    return [key('page',p),paperKeys.has(path[2])?'paper':path[2]];
  }
  if(path[0]==='stencils')return [key('stencil',path[1]),'master'];return [key('document'),path[0]];
}
export class CollaborationDocument {
  constructor(doc,peer){if(!safe(peer))throw new Error('Invalid peer identity.');assertDocument(doc);this.peer=peer;this.clock=0;this.records=new Map();this.last=copy(doc);
    for(const [k,fields] of collaborationEntities(doc))this.records.set(k,{alive:{stamp:[0,''],value:true},fields:new Map(Object.entries(fields).map(([f,value])=>[f,{stamp:[0,''],value}]))});
  }
  local(doc){
    assertDocument(doc);const before=collaborationEntities(this.last),after=collaborationEntities(doc),changes=[];
    for(const k of new Set([...before.keys(),...after.keys()])){
      const a=before.get(k),b=after.get(k);if(!b){changes.push({key:k,field:'$alive',value:false});continue;}
      if(!a)changes.push({key:k,field:'$alive',value:true});
      for(const f of new Set([...Object.keys(a||{}),...Object.keys(b)]))if(!a||!same(a[f],b[f]))changes.push({key:k,field:f,...(b[f]===undefined?{deleted:true}:{value:copy(b[f])})});
    }
    if(!changes.length)return null;const message={protocol:'nexora.sync.v1',type:'operation',stamp:[++this.clock,this.peer],changes};this.apply(message);return message;
  }
  stamp(entity,field){return copy(field==='$alive'?this.records.get(entity)?.alive?.stamp:this.records.get(entity)?.fields.get(field)?.stamp);}
  snapshot(){return {protocol:'nexora.sync.v1',type:'state',records:[...this.records].map(([entity,r])=>({entity,alive:r.alive,fields:[...r.fields]}))};}
  apply(message){
    // Never let inherited or magic object keys cross a transport boundary.
    const input=JSON.stringify(message);if(input.length>50*1024*1024)throw new Error('Collaboration packet exceeds 50 MB.');
    message=JSON.parse(input,(k,v)=>{if(['__proto__','constructor','prototype'].includes(k))throw new Error('Unsafe collaboration payload.');return v;});
    if(message.protocol!=='nexora.sync.v1'||!['operation','state'].includes(message.type))throw new Error('Unknown collaboration protocol.');
    const updates=[],stampOK=s=>Array.isArray(s)&&s.length===2&&Number.isSafeInteger(s[0])&&s[0]>=0&&(s[0]===0&&s[1]===''||safe(s[1]));
    if(message.type==='operation'){
      if(!stampOK(message.stamp)||!Array.isArray(message.changes)||message.changes.length>500000)throw new Error('Malformed collaboration operation.');
      for(const c of message.changes)updates.push({entity:c.key,field:c.field,stamp:message.stamp,...(c.deleted?{deleted:true}:{value:c.value})});
    }else{
      if(!Array.isArray(message.records)||message.records.length>100501)throw new Error('Collaboration snapshot is too large.');
      for(const r of message.records){if(!r.alive||!Array.isArray(r.fields)||r.fields.length>10000)throw new Error('Invalid snapshot record.');updates.push({entity:r.entity,field:'$alive',...r.alive});for(const [field,v]of r.fields)updates.push({entity:r.entity,field,...v});}
    }
    const old=this.records;this.records=new Map(old);const cloned=new Set();let changed=false,maxClock=this.clock;
    try{
      for(const u of updates){validateEntry(u.entity,u.field,u.value);if(!stampOK(u.stamp)||u.field==='$alive'&&typeof u.value!=='boolean')throw new Error('Invalid collaboration register.');maxClock=Math.max(maxClock,u.stamp[0]);let r=this.records.get(u.entity);
        const existing=u.field==='$alive'?r?.alive:r?.fields.get(u.field);if(existing && compare(existing.stamp,u.stamp)>=0)continue;
        if(!cloned.has(u.entity)){r=r?{alive:r.alive,fields:new Map(r.fields)}:{alive:{stamp:[0,''],value:false},fields:new Map()};this.records.set(u.entity,r);cloned.add(u.entity);}
        const v={stamp:copy(u.stamp),...(u.deleted?{deleted:true}:{value:copy(u.value)})};if(u.field==='$alive')r.alive=v;else r.fields.set(u.field,v);changed=true;
      }
      const doc=changed?this.materialize():copy(this.last);this.clock=maxClock;this.last=doc;return {changed,doc:copy(doc)};
    }catch(error){this.records=old;throw error;}
  }
  materialize(){
    const live=new Map();for(const [k,r] of [...this.records].sort(([a],[b])=>a.localeCompare(b)))if(r.alive.value){const fields={};for(const [name,v]of [...r.fields].sort(([a],[b])=>a.localeCompare(b)))if(!v.deleted&&compare(v.stamp,r.alive.stamp)>=0)fields[name]=copy(v.value);live.set(k,fields);}
    const doc={...live.get(key('document')),pages:{},stencils:{}};for(const [k,v]of live){const [kind,p]=JSON.parse(k);if(kind==='stencil'&&v.master)doc.stencils[p]=v.master;if(kind==='page')doc.pages[p]={...v,...v.paper,id:p,graph:{nodes:{},edges:{}},view:{nodes:{},edges:{},nextZ:1}};}
    for(const p of Object.values(doc.pages))delete p.paper;
    for(const [k,v]of live){const [kind,p,id]=JSON.parse(k),page=doc.pages[p];if(!page)continue;
      if(kind==='node' && v.shape){const shape=v.shape,n={id,master:shape.master,data:{},label:v.label?.label||'',parentId:null,layerId:page.layers?.[0]?.id},g=copy(shape.geometry);if(shape.ports)n.ports=shape.ports;if(shape.image)n.image=shape.image;if(v.label?.richText)n.richText=v.label.richText;
        for(const [f,value]of Object.entries(v))if(f.startsWith('g:'))g[f.slice(2)]=value;else if(f.startsWith('n:'))n[f.slice(2)]=value;else if(f.startsWith('data:'))n.data[f.slice(5)]=value;
        if(!BUILTINS[n.master]&&!doc.stencils[n.master])continue;page.graph.nodes[id]=n;page.view.nodes[id]=g;
      }else if(kind==='edge'&&v.semantic&&v.geometry){page.graph.edges[id]=v.semantic;page.view.edges[id]=v.geometry;}
    }
    for(const p of Object.values(doc.pages)){
      const nodes=p.graph.nodes;for(const n of Object.values(nodes)){if(!p.layers?.some(l=>l.id===n.layerId))n.layerId=p.layers?.[0]?.id;if(n.parentId&&(!nodes[n.parentId]||!isContainer(doc,nodes[n.parentId])))n.parentId=null;}
      // Concurrent parent moves may form a cycle. Break the lexically first member deterministically.
      for(const id of Object.keys(nodes).sort()){const chain=[],seen=new Set();let n=nodes[id];while(n?.parentId){if(seen.has(n.id)){const cycle=chain.slice(chain.indexOf(n.id)).sort();nodes[cycle[0]].parentId=null;break;}seen.add(n.id);chain.push(n.id);n=nodes[n.parentId];}}
      for(const [id,e]of Object.entries(p.graph.edges)){const valid=end=>{const n=nodes[end?.nodeId];return n&&getPorts(doc,n,p.view.nodes[n.id]).length&&(end.port==='auto'||getPorts(doc,n,p.view.nodes[n.id]).some(port=>port.id===end.port));};if(!valid(e.from)||!valid(e.to)){delete p.graph.edges[id];delete p.view.edges[id];}else if(!p.layers?.some(l=>l.id===e.layerId))e.layerId=p.layers?.[0]?.id;}
      p.constraints=(p.constraints||[]).filter(c=>c.ids.every(id=>nodes[id]));p.view.nextZ=Math.max(0,...Object.values(p.view.nodes).map(g=>g.z||0))+1;
    }
    doc.pageOrder=[...new Set([...(doc.pageOrder||[]).filter(id=>doc.pages[id]),...Object.keys(doc.pages).sort()])];
    if(!doc.pageOrder.length){const p=createPage('Recovered page');p.id='page_collaboration_recovery';doc.pages[p.id]=p;doc.pageOrder=[p.id];}
    return parseDocument(JSON.stringify(doc));
  }
}
