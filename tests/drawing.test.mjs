import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, addNode, addEdge, assertDocument, parseDocument, isLocked, movementLockedIds, duplicateItems } from '../src/core/model.js';
import { DocumentStore } from '../src/core/history.js';
import { pathGeometry, pathControls, flattenPath, validatePath, simplifyPath, handlePoints, resizeGeometry, rotatePoint, geometryBounds, strokeDash } from '../src/core/drawing.js';
import { captureSelection, translateSelection, resizeSelection, rotateSelection, flipSelection, groupSelection, ungroupSelection, selectInArea, editableSelection } from '../src/core/editing.js';
import { contentBounds, fitPageToContent, autoSizePage, validatePageSettings, pageBounds } from '../src/core/page.js';
import { shapeGeometry, getMaster, getPorts, validateStyle, BUILTINS } from '../src/core/stencils.js';
import { fitContainers } from '../src/core/layout.js';
import { buildScene } from '../src/render/scene.js';
import { exportSVG } from '../src/core/export-svg.js';
import { dashRuns, markerPrimitives, tessellateScene } from '../src/render/stroke.js';
import { triangulate } from '../src/core/geometry.js';
// Text layout uses a deterministic measurement stub here; browser tests cover real shaping.
globalThis.document ||= { createElement: () => ({ getContext: () => ({ measureText: s => ({ width: String(s).length * 7 }) }) }) };
const blank = () => { const d = createDocument(), p = d.pages[d.pageOrder[0]]; return [d, p]; };
const near = (a, b, epsilon = 1e-7) => assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`);
const path = (d,p,points,mode='linear',closed=false,style={}) => addNode(d,p,'path',0,0,{label:'',geometry:{...pathGeometry(points,mode,closed),...style}});

test('drawing types are internal records, not malformed polygon stencils', () => {
  assert.equal(BUILTINS.path.hidden,true); assert.equal(BUILTINS.group.hidden,true);
  const [d,p]=blank();const id=path(d,p,[{x:5,y:7},{x:305,y:7}]); assertDocument(d);
  assert.deepEqual(pathControls(p.view.nodes[id]),[{x:5,y:7},{x:305,y:7}]); assert.equal(p.view.nodes[id].h,1);
});
test('horizontal, vertical, negative, flipped and rotated paths round-trip without loss', () => {
  const [d,p]=blank();for(const points of [[{x:-50,y:-60},{x:30,y:-60}],[{x:-50,y:10},{x:-50,y:100}]]){
    const id=path(d,p,points,'linear',false,{rotation:37,flipX:true});const q=parseDocument(JSON.stringify(d));
    assert.deepEqual(q.pages[p.id].view.nodes[id],p.view.nodes[id]); const a=pathControls(p.view.nodes[id]); assert.ok(a.every(v=>Number.isFinite(v.x)&&Number.isFinite(v.y)));
  }
});
test('quadratic and cubic controls are retained, while adaptive tessellation resolves their shape', () => {
  for (const [mode,points] of [['quadratic',[{x:0,y:0},{x:70,y:170},{x:200,y:0}]],['cubic',[{x:0,y:0},{x:50,y:250},{x:100,y:-200},{x:200,y:30}]]]){
    const g=pathGeometry(points,mode);validatePath(g);pathControls(g).forEach((p,i)=>{near(p.x,points[i].x);near(p.y,points[i].y)});const flat=flattenPath(g,.1);assert.ok(flat.length>10);assert.deepEqual(flat[0],points[0]);near(flat.at(-1).x,points.at(-1).x);near(flat.at(-1).y,points.at(-1).y);
  }
});
test('freehand simplification preserves endpoints and changes genuine turns', () => {
  const points=Array.from({length:1000},(_,i)=>({x:i,y:Math.sin(i/70)*30})); const reduced=simplifyPath(points,.5);assert.ok(reduced.length<100);assert.deepEqual(reduced[0],points[0]);assert.deepEqual(reduced.at(-1),points.at(-1));
});
test('malformed or self-intersecting filled paths are rejected atomically', () => {
  const [d,p]=blank(),store=new DocumentStore(d),id=path(d,p,[{x:0,y:0},{x:60,y:60},{x:0,y:60},{x:60,y:0}]);
  assert.throws(()=>store.transact('Close invalid path',()=>p.view.nodes[id].closed=true),/non-self-intersecting/);assert.equal(store.doc.pages[p.id].view.nodes[id].closed,false);assert.equal(store.undoStack.length,0);
  for(const patch of [{pathMode:'unknown'},{path:[{x:NaN,y:0},{x:1,y:1}]},{pathMode:'cubic'},{closed:'yes'}]) assert.throws(()=>validatePath({...pathGeometry([{x:0,y:0},{x:10,y:10}]),...patch}));
});
test('all eight handles honor anchored dimensions at arbitrary rotation', () => {
  for(const angle of [0,30,90,217]) for(const handle of ['n','s','e','w','nw','ne','se','sw']){
    const g={x:100,y:100,w:160,h:80,rotation:angle},center={x:180,y:140},h=handlePoints(g).find(h=>h.name===handle),local=rotatePoint(h,center,-angle);
    local.x+=handle.includes('e')?30:handle.includes('w')?-30:0; local.y+=handle.includes('s')?20:handle.includes('n')?-20:0;
    const changed=resizeGeometry(g,handle,rotatePoint(local,center,angle),{minimum:24});
    near(changed.w,160+(handle.includes('e')||handle.includes('w')?30:0));near(changed.h,80+(handle.includes('n')||handle.includes('s')?20:0));
    const opposite=handle.replace(/[nesw]/g,c=>({n:'s',s:'n',e:'w',w:'e'})[c]);const old=handlePoints(g).find(h=>h.name===opposite.split('').sort().join(''));
    // Opposite labels retain conventional north/south before east/west ordering.
    const oppositeName=({'n':'s','s':'n','e':'w','w':'e','nw':'se','ne':'sw','se':'nw','sw':'ne'})[handle];
    const before=handlePoints(g).find(h=>h.name===oppositeName),after=handlePoints(changed).find(h=>h.name===oppositeName);near(before.x,after.x);near(before.y,after.y);
  }
});
test('centered and proportional resizing works for side as well as corner grips', () => {
  const g={x:0,y:0,w:100,h:50};const a=resizeGeometry(g,'e',{x:150,y:25},{centered:true});near(a.x+a.w/2,50);near(a.w,200);near(a.h,50);
  const b=resizeGeometry(g,'n',{x:50,y:-50},{proportional:true});near(b.w/b.h,2);near(b.x+b.w/2,50);near(b.y+b.h,50);
});
test('rotation transforms shape outlines and connector port normals', () => {
  const [d,p]=blank(),id=addNode(d,p,'rectangle',0,0,{geometry:{w:100,h:50,rotation:90}}),g=p.view.nodes[id],n=p.graph.nodes[id];
  const b=geometryBounds(g);near(b.w,50);near(b.h,100);const east=getPorts(d,n,g).find(v=>v.id==='e');near(east.x,50);near(east.y,75);assert.equal(east.dx,0);assert.equal(east.dy,1);
  assert.ok(shapeGeometry(getMaster(d,'rectangle'),g).points.length>=4);
});
test('selection transforms translate internal manual waypoints exactly once', () => {
  const [d,p]=blank(),a=addNode(d,p,'process',100,100),b=addNode(d,p,'process',400,100),e=addEdge(p,{nodeId:a,port:'e'},{nodeId:b,port:'w'},'',{waypoints:[{x:330,y:30}]});
  const s=captureSelection(p,[a,b,e]);translateSelection(p,s,40,75);near(p.view.nodes[a].x,140);assert.deepEqual(p.view.edges[e].waypoints,[{x:370,y:105}]);
  translateSelection(p,s,50,80);near(p.view.nodes[a].x,150);assert.deepEqual(p.view.edges[e].waypoints,[{x:380,y:110}]);
});
test('groups have exact bounds and movement never double-translates selected descendants', () => {
  const [d,p]=blank(),a=addNode(d,p,'rectangle',100,100),b=addNode(d,p,'ellipse',400,200),group=groupSelection(d,p,[a,b],'diagram');assertDocument(d);fitContainers(d,p);
  const before={...p.view.nodes[a]},s=captureSelection(p,[group,a,b]);assert.equal(s.roots.length,1);translateSelection(p,s,30,40);fitContainers(d,p);near(p.view.nodes[a].x,before.x+30);near(p.view.nodes[a].y,before.y+40);
  assert.deepEqual(new Set(ungroupSelection(p,[group])),new Set([a,b]));assertDocument(d);
});
test('locked descendants make their entire group immovable and resize-safe', () => {
  const [d,p]=blank(),a=addNode(d,p,'rectangle',0,0),b=addNode(d,p,'rectangle',200,0),g=groupSelection(d,p,[a,b],'diagram');p.graph.nodes[a].locked=true;
  assert.ok(movementLockedIds(p).has(g));assert.deepEqual(editableSelection(p,[a,g]),[]);const s=captureSelection(p,[g,a]);assert.equal(s.nodes.size,0);assert.equal(isLocked(p,a),true);
});
test('multi-object resize and flip preserve normalized path data', () => {
  const [d,p]=blank(),a=path(d,p,[{x:10,y:10},{x:110,y:110}]),b=addNode(d,p,'rectangle',300,100),s=captureSelection(p,[a,b]),controls=structuredClone(p.view.nodes[a].path);
  resizeSelection(p,s,{...s.box,w:s.box.w*2,h:s.box.h*2});near(p.view.nodes[a].w,200);assert.deepEqual(p.view.nodes[a].path,controls);
  const t=captureSelection(p,[a,b]);flipSelection(p,t,'x');assert.equal(p.view.nodes[a].flipX,true);assertDocument(d);
});
test('group rotation rotates all children around the common center', () => {
  const [d,p]=blank(),a=addNode(d,p,'rectangle',0,0),b=addNode(d,p,'rectangle',300,0),g=groupSelection(d,p,[a,b],'diagram'),s=captureSelection(p,[g]);
  rotateSelection(p,s,90);fitContainers(d,p);assert.equal(p.view.nodes[a].rotation,90);near(p.view.nodes[a].x,p.view.nodes[b].x);assert.ok(p.view.nodes[b].y>p.view.nodes[a].y);assertDocument(d);
});
test('select-area includes crossing connectors and excludes locked objects', () => {
  const [d,p]=blank(),a=addNode(d,p,'rectangle',100,100),b=addNode(d,p,'rectangle',400,100),e=addEdge(p,{nodeId:a,port:'e'},{nodeId:b,port:'w'});p.graph.nodes[b].locked=true;
  const routes=new Map([[e,{points:[{x:260,y:140},{x:400,y:140}]}]]);const ids=selectInArea(p,{x:0,y:0,w:600,h:400},{routes});assert.ok(ids.includes(a));assert.ok(ids.includes(e));assert.ok(!ids.includes(b));
});
test('auto-size expands negative origins and remains undoable in one transaction', () => {
  const [d,p]=blank(),store=new DocumentStore(d);p.canvasMode='auto';store.transact('Draw outside paper',()=>path(d,p,[{x:-600,y:-250},{x:-100,y:-50}]));assert.ok(p.originX<=-640&&p.originY<=-290);assert.ok(p.width>1320);assertDocument(d);
  store.undo();assert.equal(p.originX,0);assert.equal(Object.keys(p.graph.nodes).length,0);store.redo();assert.ok(p.originX<0);
});
test('infinite canvas does not grow a large backing paper allocation', () => {
  const [d,p]=blank();p.canvasMode='infinite';path(d,p,[{x:-200000,y:-200000},{x:200000,y:200000}]);autoSizePage(p);assert.equal(p.width,1320);assert.equal(p.height,900);
  // Large geometry is intentionally bounded independently of paper dimensions.
  assert.doesNotThrow(()=>assertDocument(d));
});
test('page setup rejects invalid dimensions, origins, spacing and units', () => {
  const [d,p]=blank();for(const patch of [{canvasMode:'wat'},{originX:Infinity},{gridSize:0},{units:'unknown'},{drawingScale:-1}])assert.throws(()=>validatePageSettings({...p,...patch}));
  path(d,p,[{x:-100,y:-200},{x:50,y:50}]);fitPageToContent(p,40);assert.ok(p.originX<0&&p.originY<0);assertDocument(d);assert.equal(pageBounds(p).x,p.originX);
});
test('styles validate widths, opacity, dash, markers, joins and rotations', () => {
  assert.doesNotThrow(()=>validateStyle({strokeWidth:0,opacity:0,rotation:360,dash:'dashdot',lineCap:'square',lineJoin:'miter',endArrow:'diamond'}));
  for(const patch of [{strokeWidth:65},{opacity:-1},{rotation:Infinity},{dash:'arbitrary'},{lineCap:'arbitrary'},{lineJoin:'arbitrary'},{endArrow:'arbitrary'}])assert.throws(()=>validateStyle(patch));
  assert.deepEqual(strokeDash({strokeWidth:2,dash:'dashdot'}),[8,4,2,4]);
});
test('dash phase remains continuous through polyline corners', () => {
  const runs=dashRuns([{x:0,y:0},{x:5,y:0},{x:5,y:15}],[10,5]);assert.deepEqual(runs,[[{x:0,y:0},{x:5,y:0},{x:5,y:5}],[{x:5,y:10},{x:5,y:15}]]);
});
test('all endpoint marker types produce finite backend-neutral geometry', () => {
  for(const type of ['triangle','open','diamond','circle']){const markers=markerPrimitives([{x:0,y:0},{x:100,y:10}],{stroke:'#000000',strokeWidth:3,startArrow:type,endArrow:type});assert.equal(markers.length,2);assert.ok(markers.every(p=>p.points.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y))));}
});
test('GPU tessellation generates visible triangles for fills, all caps, joins and patterns', () => {
  for(const cap of ['round','butt','square'])for(const join of ['round','bevel','miter']){
    const data=tessellateScene({primitives:[{kind:'line',points:[{x:10,y:10},{x:80,y:100},{x:150,y:10}],stroke:'#456a91',width:6,lineCap:cap,lineJoin:join,dashArray:[10,5],opacity:.5}]});assert.ok(data.length>36);assert.equal(data.length%18,0);assert.ok([...data].every(Number.isFinite));
  }
});
test('SVG export matches infinite bounds, rotation, markers, dashes and alpha', () => {
  const [d,p]=blank();p.canvasMode='infinite';const id=path(d,p,[{x:-300,y:-100},{x:-100,y:0}],'linear',false,{rotation:30,strokeWidth:4,dash:'dot',lineCap:'square',lineJoin:'bevel',opacity:.6,endArrow:'diamond'});const scene=buildScene(d,p,new Map());assert.ok(scene.primitives.length>=2);
  const svg=exportSVG(d,p,new Map());assert.match(svg,/viewBox="-/);assert.match(svg,/stroke-dasharray="4 8"/);assert.match(svg,/stroke-linecap="square"/);assert.match(svg,/opacity="0.6"/);assert.match(svg,new RegExp(id));assert.ok(!svg.includes('NaN'));
});
test('selection export includes group descendants but excludes unrelated shapes', () => {
  const [d,p]=blank(),a=addNode(d,p,'rectangle',0,0),b=addNode(d,p,'ellipse',200,0),c=addNode(d,p,'rectangle',500,0),g=groupSelection(d,p,[a,b],'diagram');
  const svg=exportSVG(d,p,new Map(),{ids:[g]});assert.ok(svg.includes(a)&&svg.includes(b)&&!svg.includes(c));
});
test('copying a path preserves geometry, transform and formatting independently', () => {
  const [d,p]=blank(),a=path(d,p,[{x:10,y:20},{x:50,y:80}],'linear',false,{dash:'dot',startArrow:'circle',rotation:15}),result=duplicateItems(p,[a],{x:30,y:40}),id=[...result][0];
  assert.ok(id);assert.deepEqual(p.view.nodes[id].path,p.view.nodes[a].path);assert.equal(p.view.nodes[id].x,p.view.nodes[a].x+30);assert.equal(p.view.nodes[id].rotation,15);assertDocument(d);
});
