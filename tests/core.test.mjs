import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, createPage, addNode, addEdge, assertDocument, parseDocument, descendants, duplicateItems, removeItems, isVisible, isLocked } from '../src/core/model.js';
import { createDemo } from '../src/core/template.js';
import { DocumentStore, diff, applyPatches } from '../src/core/history.js';
import { evaluate, resolveLabel, unresolvedBindings } from '../src/core/expression.js';
import { BUILTINS, shapeGeometry, validateMaster, SAMPLE_MASTER, getPorts } from '../src/core/stencils.js';
import { SpatialIndex, MinHeap } from '../src/core/spatial.js';
import { triangulate, polygonArea, isSimplePolygon, orthogonalSegmentHits, simplifyPolyline, distance } from '../src/core/geometry.js';
import { routeBetween, routeConnector } from '../src/core/router.js';
import { addAlignment, addDistribution, solveConstraints, constraintResiduals, stronglyConnected, autoLayout, fitContainers } from '../src/core/layout.js';
import { parseCSV, bindCSV } from '../src/core/persistence.js';
import { validateDiagram } from '../src/core/validation.js';
const blank = () => { const d = createDocument(); return [d, d.pages[d.pageOrder[0]]]; };

test('demo has separate semantic and visual records and valid stable identities', () => {
 const d=createDemo(); assert.equal(assertDocument(d),d); const p=d.pages[d.pageOrder[0]];
 assert.equal(Object.keys(p.graph.edges).length,9); assert.equal(Object.keys(p.graph.nodes).length,17);
 for(const n of Object.values(p.graph.nodes)){assert.equal(n.x,undefined);assert.ok(p.view.nodes[n.id]);}
});
test('safe expression interpreter supports arithmetic and functions', () => {
 assert.equal(evaluate('clamp(w*0.2 + max(2, h/4), 0, w)',{w:200,h:80}),60);
 assert.equal(evaluate('-w + 2*(h+1)',{w:10,h:5}),2);
 assert.throws(()=>evaluate('globalThis.alert(1)',{w:1,h:1})); assert.throws(()=>evaluate('w/0',{w:1,h:1}));
 assert.throws(()=>evaluate('constructor(1)',{w:1,h:1}));
});
test('bindings preserve missing-field diagnostics and block prototype traversal', () => {
 const n={label:'{{owner}} / {{data.status}} / {{missing}}',data:{owner:'A',status:'OK'}};
 assert.equal(resolveLabel(n),'A / OK / ⟨missing⟩');assert.deepEqual(unresolvedBindings(n),['missing']);
 assert.equal(resolveLabel({label:'{{constructor.name}}',data:{}}),'⟨constructor.name⟩');
});
test('all built-in shapes triangulate with area conservation', () => {
 for(const m of Object.values(BUILTINS).filter(m=>!m.hidden)){
   const points=shapeGeometry(m,{x:0,y:0,w:m.size[0],h:m.size[1]}).points;
   const indices=triangulate(points);let area=0;
   for(let i=0;i<indices.length;i+=3)area+=Math.abs(polygonArea([points[indices[i]],points[indices[i+1]],points[indices[i+2]]]));
   assert.ok(Math.abs(area-Math.abs(polygonArea(points)))<.001,`${m.id} triangulation conserves area`);
 }
});
test('custom concave programmable master is validated and triangulates', () => {
 const m=validateMaster(SAMPLE_MASTER);const p=shapeGeometry(m,{x:0,y:0,w:190,h:80}).points;assert.ok(isSimplePolygon(p));assert.equal(triangulate(p).length,12);
 const bad=structuredClone(m);bad.geometry.points=[['0','0'],['w','h'],['w','0'],['0','h']];assert.throws(()=>validateMaster(bad));
});
test('spatial index updates, deletes and handles oversized objects',()=>{
 const s=new SpatialIndex(10);s.set('a',{x:0,y:0,w:5,h:5});s.set('b',{x:20,y:0,w:5,h:5});s.set('big',{x:-1000,y:-1000,w:2000,h:2000});
 assert.deepEqual(new Set(s.query({x:1,y:1,w:1,h:1})),new Set(['a','big']));s.set('a',{x:100,y:100,w:1,h:1});assert.deepEqual(s.query({x:1,y:1,w:1,h:1}),['big']);s.delete('big');assert.equal(s.query({x:1,y:1,w:1,h:1}).length,0);
});
test('min heap returns stable increasing priorities',()=>{const h=new MinHeap();[6,4,10,1,7,2].forEach(priority=>h.push({priority}));assert.deepEqual(Array.from({length:6},()=>h.pop().priority),[1,2,4,6,7,10]);});
test('orthogonal router avoids a blocking wall and retains exact endpoints',()=>{
 const start={x:0,y:0},end={x:200,y:0},obstacles=[{x:80,y:-50,w:40,h:100}];const r=routeBetween(start,end,obstacles);
 assert.equal(r.status,'ok');assert.deepEqual(r.points[0],start);assert.deepEqual(r.points.at(-1),end);
 for(let i=1;i<r.points.length;i++){const a=r.points[i-1],b=r.points[i];assert.ok(a.x===b.x||a.y===b.y);assert.ok(!obstacles.some(o=>orthogonalSegmentHits(a,b,o)));}
});
test('router flags an impossible endpoint rather than claiming clearance',()=>{
 const r=routeBetween({x:5,y:5},{x:100,y:5},[{x:0,y:0,w:20,h:20}]);assert.equal(r.status,'blocked');
});
test('connector escapes endpoints and supports explicit waypoints',()=>{
 const r=routeConnector({id:'e',fromId:'a',toId:'b',start:{x:50,y:25},startStub:{x:75,y:25},endStub:{x:175,y:25},end:{x:200,y:25},waypoints:[{x:120,y:100}]},[{id:'a',x:-12,y:-12,w:74,h:74},{id:'b',x:188,y:-12,w:74,h:74}]);
 assert.equal(r.status,'ok');assert.ok(r.points.some(p=>p.x===120&&p.y===100));
});
test('patch transaction coalesces previews into a single reversible command',()=>{
 const [d,p]=blank(),id=addNode(d,p,'process',10,20),s=new DocumentStore(d);
 s.begin('drag');for(let i=0;i<40;i++){s.doc.pages[p.id].view.nodes[id].x=10+i;s.preview();}s.commit();
 assert.equal(s.undoStack.length,1);assert.equal(s.undoStack[0].patches.length,1);s.undo();assert.equal(s.doc.pages[p.id].view.nodes[id].x,10);s.redo();assert.equal(s.doc.pages[p.id].view.nodes[id].x,49);
});
test('failed transactions roll back geometry and do not enter history',()=>{
 const [d,p]=blank(),id=addNode(d,p,'process',0,0),s=new DocumentStore(d);
 assert.throws(()=>s.transact('bad',doc=>doc.pages[p.id].view.nodes[id].w=-5));assert.equal(s.doc.pages[p.id].view.nodes[id].w,170);assert.equal(s.undoStack.length,0);
});
test('history is bounded and branching invalidates redo',()=>{
 const [d,p]=blank(),id=addNode(d,p,'process',0,0),s=new DocumentStore(d,{maxCommands:3});for(let i=1;i<7;i++)s.transact('move',doc=>doc.pages[p.id].view.nodes[id].x=i);
 assert.equal(s.undoStack.length,3);s.undo();s.transact('branch',doc=>doc.pages[p.id].view.nodes[id].y=20);assert.equal(s.redoStack.length,0);
});
test('container ownership, visibility and layer locks are inherited',()=>{
 const[d,p]=blank(),c=addNode(d,p,'container',0,0),n=addNode(d,p,'process',30,70,{parentId:c,layerId:'annotations'});
 assert.deepEqual(descendants(p,c),[n]);p.layers[0].visible=false;assert.equal(isVisible(p,n),false);p.layers[0].visible=true;p.layers[0].locked=true;assert.equal(isLocked(p,n),true);
});
test('deletion removes incident edges, descendants and related constraints',()=>{
 const[d,p]=blank(),c=addNode(d,p,'container',0,0),n=addNode(d,p,'process',30,70,{parentId:c}),b=addNode(d,p,'process',700,70);addEdge(p,{nodeId:n,port:'e'},{nodeId:b,port:'w'});addAlignment(p,[n,b],'top');removeItems(p,[c]);
 assert.equal(Object.keys(p.graph.nodes).length,1);assert.equal(Object.keys(p.graph.edges).length,0);assert.equal(p.constraints.length,0);assertDocument(d);
});
test('duplicate rewires internal edges to new identities',()=>{
 const[d,p]=blank(),n=addNode(d,p,'process',0,0),b=addNode(d,p,'process',300,0);addEdge(p,{nodeId:n,port:'e'},{nodeId:b,port:'w'});const ids=duplicateItems(p,[n,b]);assert.equal(ids.length,2);assert.equal(Object.keys(p.graph.edges).length,2);const e=Object.values(p.graph.edges).at(-1);assert.ok(ids.includes(e.from.nodeId)&&ids.includes(e.to.nodeId));assertDocument(d);
});
test('persistent alignment follows the edited member',()=>{
 const[d,p]=blank(),a=addNode(d,p,'process',0,0),b=addNode(d,p,'process',300,100);addAlignment(p,[a,b],'top');assert.equal(p.view.nodes[b].y,0);p.view.nodes[b].y=150;solveConstraints(p,new Set([b]));assert.equal(p.view.nodes[a].y,150);assert.equal(constraintResiduals(p)[0].residual,0);
});
test('locked conflicting constraints report nonzero residual',()=>{
 const[d,p]=blank(),a=addNode(d,p,'process',0,0),b=addNode(d,p,'process',300,100);p.layers[0].locked=true;addAlignment(p,[a,b],'top');assert.equal(constraintResiduals(p)[0].residual,100);
});
test('distribution produces equal gaps and preserves endpoints',()=>{
 const[d,p]=blank(),ids=[0,300,800].map(x=>addNode(d,p,'process',x,0));addDistribution(p,ids,'x');assert.equal(p.view.nodes[ids[1]].x,400);assert.equal(p.view.nodes[ids[0]].x,0);assert.equal(p.view.nodes[ids[2]].x,800);
});
test('iterative SCC and auto layout support cycles without recursion',()=>{
 const ids=['a','b','c','d'];const parts=stronglyConnected(ids,[['a','b'],['b','a'],['b','c'],['c','d']]);assert.ok(parts.some(p=>p.includes('a')&&parts.length&&p.includes('b')));
 const[d,p]=blank();const ns=[0,1,2,3].map(i=>addNode(d,p,'process',100,100));for(let i=1;i<ns.length;i++)addEdge(p,{nodeId:ns[i-1],port:'e'},{nodeId:ns[i],port:'w'});autoLayout(d,p);assert.ok(p.view.nodes[ns[3]].x>p.view.nodes[ns[0]].x);assertDocument(d);
 const long=Array.from({length:20000},(_,i)=>String(i));assert.equal(stronglyConnected(long,long.slice(1).map((id,i)=>[String(i),id])).length,20000);
});
test('CSV parser handles escaped quotes, CRLF and quoted multiline fields',()=>{
 const csv=parseCSV('key,owner,note\r\na,"A, B","line 1\nline ""2"""\r\n');assert.equal(csv.rows[0].owner,'A, B');assert.equal(csv.rows[0].note,'line 1\nline "2"');assert.throws(()=>parseCSV('key,key\na,b'));
});
test('CSV binding changes shape data without changing identities',()=>{
 const[d,p]=blank(),id=addNode(d,p,'process',0,0,{label:'{{owner}}',data:{key:'A'}});const n=p.graph.nodes[id];assert.equal(bindCSV(p,parseCSV('key,owner\nA,Engineer')) ,1);assert.equal(resolveLabel(n),'Engineer');assert.equal(n.id,id);
});
test('project parser rejects cycles, corrupt endpoints and prototype keys',()=>{
 const[d,p]=blank(),a=addNode(d,p,'container',0,0),b=addNode(d,p,'container',10,10,{parentId:a});p.graph.nodes[a].parentId=b;assert.throws(()=>assertDocument(d));
 assert.throws(()=>parseDocument('{"__proto__":{}}'));assert.throws(()=>parseDocument('{"format":"other","version":1}'));
});
test('project roundtrip is lossless',()=>{const d=createDemo();assert.deepEqual(parseDocument(JSON.stringify(d)),d);});
test('validation reports unresolved labels and decisions with missing branches',()=>{
 const[d,p]=blank(),id=addNode(d,p,'decision',0,0,{label:'{{missing}}'});const issues=validateDiagram(d,p);assert.ok(issues.some(x=>x.code==='DECISION'));assert.ok(issues.some(x=>x.code==='BINDING'));
});

test('fractional ports preserve exact endpoints after obstacle routing', () => {
 const start={x:.1234567,y:.9876543},end={x:210.876543,y:40.9876543};
 const r=routeBetween(start,end,[{x:80,y:-50,w:40,h:170}]);
 assert.equal(r.status,'ok'); assert.deepEqual(r.points[0],start);assert.deepEqual(r.points.at(-1),end);
 for(let i=1;i<r.points.length;i++)assert.ok(r.points[i].x===r.points[i-1].x||r.points[i].y===r.points[i-1].y);
});
test('locked container descendants are fixed variables in the layout solver', () => {
 const[d,p]=blank(),c=addNode(d,p,'container',0,0),child=addNode(d,p,'process',30,70,{parentId:c,layerId:'annotations'}),b=addNode(d,p,'process',700,200);
 p.layers.find(l=>l.id==='annotations').locked=true;const original=structuredClone(p.view.nodes[child]);
 addAlignment(p,[b,c],'top');assert.equal(p.view.nodes[c].y,0);assert.deepEqual(p.view.nodes[child],original);assert.equal(p.view.nodes[b].y,0);
});
test('imports reject unsafe identities, unknown masters and renderer style injection', () => {
 const[d,p]=blank(),id=addNode(d,p,'process',0,0);
 for(const mutate of [g=>g.weight='400" onload="alert(1)',g=>g.fontSize=Infinity,g=>g.fill='url(javascript:bad)',g=>g.headerFill='url(bad)']) {
   const copy=structuredClone(d);mutate(copy.pages[p.id].view.nodes[id]);assert.throws(()=>assertDocument(copy));
 }
 const unknown=structuredClone(d);unknown.pages[p.id].graph.nodes[id].master='missing';assert.throws(()=>assertDocument(unknown));
 const bad=structuredClone(d),old=bad.pageOrder[0],key='bad" onmouseover="';bad.pages[key]=bad.pages[old];bad.pages[key].id=key;delete bad.pages[old];bad.pageOrder=[key];assert.throws(()=>assertDocument(bad));
});
test('imports reject missing connector layers and invalid constraint axes', () => {
 const[d,p]=blank(),a=addNode(d,p,'process',0,0),b=addNode(d,p,'process',300,0),e=addEdge(p,{nodeId:a,port:'e'},{nodeId:b,port:'w'});
 p.graph.edges[e].layerId='missing';assert.throws(()=>assertDocument(d));p.graph.edges[e].layerId='diagram';
 addAlignment(p,[a,b],'top');p.constraints[0].axis='__proto__';assert.throws(()=>assertDocument(d));
});
test('duplicates receive a higher draw order than the original shape', () => {
 const[d,p]=blank(),id=addNode(d,p,'process',0,0);p.view.nodes[id].z=400;
 const [copy]=duplicateItems(p,[id]);assert.ok(p.view.nodes[copy].z>400);assert.ok(p.view.nextZ>p.view.nodes[copy].z);
});
test('all built-in silhouettes can be saved as reusable polygon stencils', () => {
 for (const m of Object.values(BUILTINS).filter(m => !m.hidden)) {
   const g={x:0,y:0,w:m.size[0],h:m.size[1]};const points=shapeGeometry(m,g).points;
   const custom={id:`custom-${m.id}`,name:m.name,size:m.size,geometry:{kind:'polygon',points:points.map(p=>[`w*${(p.x/g.w).toFixed(6)}`,`h*${(p.y/g.h).toFixed(6)}`])},ports:[]};
   assert.doesNotThrow(()=>validateMaster(custom),m.id);
 }
});
test('shapes and connectors work after deleting the default diagram layer', () => {
 const[d,p]=blank();p.layers=p.layers.filter(l=>l.id!=='diagram');const a=addNode(d,p,'process',0,0),b=addNode(d,p,'process',300,0);
 const e=addEdge(p,{nodeId:a,port:'e'},{nodeId:b,port:'w'});assert.equal(p.graph.edges[e].layerId,p.layers[0].id);assert.doesNotThrow(()=>assertDocument(d));
});
