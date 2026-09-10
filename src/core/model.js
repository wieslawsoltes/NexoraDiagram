import { getMaster, getPorts, isContainer, validateMaster, validateStyle, validatePorts, BUILTINS, shapeGeometry } from './stencils.js';
import { validatePath, geometryBounds } from './drawing.js';
import { validatePageSettings } from './page.js';
import { contains, union, round, isSimplePolygon } from './geometry.js';
export const FORMAT = 'nexora.diagram';
export const VERSION = 1;
let fallbackId = 0;
export const uid = (prefix = 'n') => `${prefix}_${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}_${++fallbackId}`}`;
export function createPage(name = 'Page 1') {
  return { id: uid('page'), name, width: 1320, height: 900, canvasMode: 'fixed', originX: 0, originY: 0, units: 'px', gridSize: 10, drawingScale: 1, graph: { nodes: {}, edges: {} }, view: { nodes: {}, edges: {}, nextZ: 1 },
    layers: [{ id: 'diagram', name: 'Diagram', visible: true, locked: false }, { id: 'annotations', name: 'Annotations', visible: true, locked: false }], constraints: [] };
}
export function createDocument(title = 'Untitled diagram') {
  const page = createPage(); return { format: FORMAT, version: VERSION, id: uid('doc'), title, pages: { [page.id]: page }, pageOrder: [page.id], stencils: {}, createdAt: new Date().toISOString() };
}
export function addNode(doc, page, masterId, x, y, options = {}) {
  const m = getMaster(doc, masterId), id = options.id || uid();
  const node = { id, master: masterId, label: options.label ?? m.defaultLabel ?? m.name, data: { ...(m.defaultData || {}), ...(options.data || {}) }, parentId: options.parentId || null, layerId: options.layerId || (page.layers.some(l => l.id === (m.annotation ? 'annotations' : 'diagram')) ? (m.annotation ? 'annotations' : 'diagram') : page.layers[0].id) };
  page.graph.nodes[id] = node;
  if (!Number.isFinite(page.view.nextZ)) page.view.nextZ = Math.max(0, ...Object.values(page.view.nodes).map(g => g.z || 0)) + 1;
  page.view.nodes[id] = { x: round(x), y: round(y), w: m.size[0], h: m.size[1], z: page.view.nextZ++, ...m.style, ...(options.geometry || {}) };
  return id;
}
export function addEdge(page, from, to, label = '', style = {}) {
  if (!page.graph.nodes[from.nodeId] || !page.graph.nodes[to.nodeId]) throw new Error('Both connector endpoints must reference shapes.');
  const id = uid('edge'); page.graph.edges[id] = { id, from: { ...from }, to: { ...to }, label, data: {}, layerId: page.graph.nodes[from.nodeId].layerId };
  page.view.edges[id] = { stroke: '#788da4', strokeWidth: 1.6, dashed: false, waypoints: [], ...style }; return id;
}
export function descendants(page, parentId) {
  const children = new Map(); for (const n of Object.values(page.graph.nodes)) { if (!children.has(n.parentId)) children.set(n.parentId, []); children.get(n.parentId).push(n.id); }
  const found = [], visited = new Set([parentId]), stack = [...(children.get(parentId) || [])];
  while (stack.length) { const id = stack.pop(); if (visited.has(id)) continue; visited.add(id); found.push(id); stack.push(...(children.get(id) || [])); } return found;
}
export function ancestors(page, id) { const found = [], seen = new Set([id]); let n = page.graph.nodes[id]; while (n?.parentId && !seen.has(n.parentId)) { found.push(n.parentId); seen.add(n.parentId); n = page.graph.nodes[n.parentId]; } return found; }
export function isVisible(page, id) {
  const n = page.graph.nodes[id] || page.graph.edges[id]; if (!n) return false;
  if (page.layers.find(l => l.id === n.layerId)?.visible === false) return false;
  if (page.graph.nodes[id]) return ancestors(page, id).every(p => page.layers.find(l => l.id === page.graph.nodes[p].layerId)?.visible !== false);
  return isVisible(page, n.from.nodeId) && isVisible(page, n.to.nodeId);
}
export function isLocked(page, id) {
  const n = page.graph.nodes[id] || page.graph.edges[id]; if (!n) return true;
  if (n.locked || page.layers.find(l => l.id === n.layerId)?.locked) return true;
  return page.graph.nodes[id] ? ancestors(page, id).some(p => page.graph.nodes[p].locked || page.layers.find(l => l.id === page.graph.nodes[p].layerId)?.locked) : false;
}
/** An unlocked container cannot translate its locked descendants. */
export function movementLockedIds(page) {
  const fixed = new Set();
  for (const n of Object.values(page.graph.nodes)) if (isLocked(page, n.id)) {
    fixed.add(n.id); for (const parent of ancestors(page, n.id)) fixed.add(parent);
  }
  return fixed;
}
export function assignParent(doc, page, id) {
  const n = page.graph.nodes[id], g = page.view.nodes[id]; if (!n || isContainer(doc, n)) return;
  if (n.parentId && page.graph.nodes[n.parentId]?.master === 'group') return;
  const center = { x: g.x + g.w / 2, y: g.y + g.h / 2 };
  const choices = Object.values(page.graph.nodes).filter(p => p.id !== id && p.master !== 'group' && isContainer(doc, p) && isVisible(page, p.id) && !isLocked(page, p.id) && contains(page.view.nodes[p.id], center));
  choices.sort((a, b) => page.view.nodes[a.id].w * page.view.nodes[a.id].h - page.view.nodes[b.id].w * page.view.nodes[b.id].h);
  n.parentId = choices[0]?.id || null;
}
export function removeItems(page, ids) {
  const removed = new Set(ids);
  for (const id of ids) if (page.graph.nodes[id]) for (const child of descendants(page, id)) removed.add(child);
  for (const e of Object.values(page.graph.edges)) if (removed.has(e.from.nodeId) || removed.has(e.to.nodeId)) removed.add(e.id);
  for (const id of removed) { delete page.graph.nodes[id]; delete page.view.nodes[id]; delete page.graph.edges[id]; delete page.view.edges[id]; }
  page.constraints = page.constraints.filter(c => !c.ids.some(id => removed.has(id)));
}
export function duplicateItems(page, ids, offset = { x: 28, y: 28 }, source = page) {
  page.view.nextZ = Math.max(page.view.nextZ || 1, ...Object.values(page.view.nodes).map(g => (g.z || 0) + 1));
  const all = new Set(ids); for (const id of ids) if (source.graph.nodes[id]) for (const child of descendants(source, id)) all.add(child);
  const map = new Map();
  for (const id of all) if (source.graph.nodes[id]) map.set(id, uid());
  const result = [];
  for (const [oldId, id] of map) {
    const n = structuredClone(source.graph.nodes[oldId]), g = structuredClone(source.view.nodes[oldId]); n.id = id; n.parentId = map.get(n.parentId) || null;
    if (!page.layers.some(l => l.id === n.layerId)) n.layerId = page.layers[0].id;
    if (n.data?.key) n.data.key += '-copy'; g.x += offset.x; g.y += offset.y; g.z = page.view.nextZ++; page.graph.nodes[id] = n; page.view.nodes[id] = g;
    if (ids.includes(oldId)) result.push(id);
  }
  for (const e of Object.values(source.graph.edges)) if (map.has(e.from.nodeId) && map.has(e.to.nodeId)) {
    const id = uid('edge'), clone = structuredClone(e), g = structuredClone(source.view.edges[e.id]);
    clone.id = id; clone.from.nodeId = map.get(e.from.nodeId); clone.to.nodeId = map.get(e.to.nodeId);
    if (!page.layers.some(l => l.id === clone.layerId)) clone.layerId = page.layers[0].id;
    g.waypoints = (g.waypoints || []).map(p => ({ x: p.x + offset.x, y: p.y + offset.y })); page.graph.edges[id] = clone; page.view.edges[id] = g;
  }
  return result;
}
/** Structural invariants, distinct from domain validation warnings. Reject corrupt imports atomically. */
export function assertDocument(doc) {
  const safeId = id => typeof id === 'string' && /^[a-zA-Z][\w-]{0,127}$/.test(id) && !['__proto__', 'prototype', 'constructor'].includes(id);
  const record = object => object && typeof object === 'object' && !Array.isArray(object);
  if (!doc || doc.format !== FORMAT || doc.version !== VERSION) throw new Error('This is not a supported Nexora Diagram v1 project.');
  if (typeof doc.title !== 'string' || doc.title.length > 500) throw new Error('Invalid document title.');
  if (!Array.isArray(doc.pageOrder) || !doc.pageOrder.length || doc.pageOrder.length > 100 || new Set(doc.pageOrder).size !== doc.pageOrder.length) throw new Error('A document must have 1–100 unique pages.');
  if (!record(doc.stencils) || Object.keys(doc.stencils).length > 500) throw new Error('Missing stencil registry.');
  for (const [id, m] of Object.entries(doc.stencils)) { if (id !== m.id) throw new Error('Stencil identity mismatch.'); validateMaster(m); }
  let count = 0;
  for (const pageId of doc.pageOrder) {
    if (!safeId(pageId)) throw new Error('Invalid page identity.');
    const p = doc.pages?.[pageId]; if (!p || p.id !== pageId || !p.graph?.nodes || !p.graph.edges || !p.view?.nodes || !p.view.edges) throw new Error('Invalid page structure.');
    if (typeof p.name !== 'string' || p.name.length > 100) throw new Error('Invalid page name.');
    if (![p.width, p.height].every(n => Number.isFinite(n) && n >= 200 && n <= 100000)) throw new Error('Page size must be between 200 and 100000 document units.');
    validatePageSettings(p);
    if (!Array.isArray(p.layers) || !p.layers.length || p.layers.length > 100 || new Set(p.layers.map(l => l.id)).size !== p.layers.length) throw new Error('Invalid layer definitions.');
    if (p.layers.some(l => !safeId(l.id) || typeof l.name !== 'string' || l.name.length > 100 || typeof l.visible !== 'boolean' || typeof l.locked !== 'boolean')) throw new Error('Invalid layer properties.');
    const nodeIds = Object.keys(p.graph.nodes);
    if ([...nodeIds, ...Object.keys(p.graph.edges)].some(id => !safeId(id))) throw new Error('Invalid shape or connector identity.');
    if (Object.keys(p.view.nodes).length !== nodeIds.length || Object.keys(p.view.edges).length !== Object.keys(p.graph.edges).length) throw new Error('Semantic and visual identities must correspond one-to-one.'); count += nodeIds.length + Object.keys(p.graph.edges).length;
    if (count > 50000) throw new Error('Projects are limited to 50000 total shapes and connectors.');
    for (const id of nodeIds) {
      const n = p.graph.nodes[id], g = p.view.nodes[id];
      if (!record(n) || !record(g)) throw new Error('Invalid shape record.');
      if (typeof n.master !== 'string' || !(Object.hasOwn(BUILTINS, n.master) || Object.hasOwn(doc.stencils, n.master))) throw new Error('Shape references an unknown stencil.');
      if (n.id !== id || !g || typeof n.label !== 'string' || n.label.length > 10000 || !n.data || typeof n.data !== 'object' || Array.isArray(n.data)) throw new Error(`Invalid shape ${id}.`);
      if (!p.layers.some(l => l.id === n.layerId)) throw new Error(`Missing layer for ${id}.`);
      if (!['x', 'y', 'w', 'h'].every(k => Number.isFinite(g[k]) && Math.abs(g[k]) <= 1e6) || g.w < (['path', 'group', 'rectangle', 'ellipse'].includes(n.master) ? 1 : 24) || g.h < (['path', 'group', 'rectangle', 'ellipse'].includes(n.master) ? 1 : 24)) throw new Error(`Invalid geometry for ${id}.`);
      validateStyle(g);
      if (n.locked !== undefined && typeof n.locked !== 'boolean') throw new Error('Invalid object lock.');
      if (n.master === 'path') validatePath(g);
      if (n.ports) validatePorts(n.ports, g);
      if (Object.hasOwn(doc.stencils, n.master) && !isSimplePolygon(shapeGeometry(getMaster(doc, n.master), g).points)) throw new Error('Custom shape is not simple at its current size.');
      if (n.parentId && (!p.graph.nodes[n.parentId] || !isContainer(doc, p.graph.nodes[n.parentId]))) throw new Error('Container parent is missing or is not a container.');
      const seen = new Set([id]); let parent = n.parentId;
      while (parent) { if (seen.has(parent)) throw new Error('Container ownership cycle.'); seen.add(parent); parent = p.graph.nodes[parent]?.parentId; }
      const ports = getPorts(doc, n, g); if (new Set(ports.map(port => port.id)).size !== ports.length) throw new Error('Duplicate connection point id.');
    }
    for (const [id, e] of Object.entries(p.graph.edges)) {
      if (!record(e) || e.id !== id || !record(p.view.edges[id]) || typeof e.label !== 'string' || e.label.length > 10000 || !record(e.data) || !p.layers.some(l => l.id === e.layerId)) throw new Error('Invalid connector.');
      validateStyle(p.view.edges[id]);
      if (e.locked !== undefined && typeof e.locked !== 'boolean') throw new Error('Invalid connector lock.');
      for (const ep of [e.from, e.to]) {
        const n = p.graph.nodes[ep?.nodeId]; if (!n) throw new Error('Connector endpoint references a missing shape.');
        if (!getPorts(doc, n, p.view.nodes[n.id]).length) throw new Error('Connector references a shape without connection points.');
        if (ep.port !== 'auto' && !getPorts(doc, n, p.view.nodes[n.id]).some(port => port.id === ep.port)) throw new Error('Connector endpoint references a missing connection point.');
      }
      const points = p.view.edges[id].waypoints || [];
      if (!Array.isArray(points) || points.length > 100 || points.some(q => !Number.isFinite(q.x) || !Number.isFinite(q.y) || Math.abs(q.x) > 1e6 || Math.abs(q.y) > 1e6)) throw new Error('Invalid connector waypoints.');
    }
    if (!Array.isArray(p.constraints) || p.constraints.length > 10000 || p.constraints.some(c => !['align', 'distribute'].includes(c.kind) || !['x', 'y'].includes(c.axis) || c.kind === 'align' && !['left', 'center', 'right', 'top', 'middle', 'bottom'].includes(c.mode) || !Array.isArray(c.ids) || c.ids.length < 2 || new Set(c.ids).size !== c.ids.length || c.ids.some(id => !p.graph.nodes[id]))) throw new Error('Invalid diagram constraint.');
  }
  return doc;
}
export function parseDocument(text) {
  if (text.length > 50 * 1024 * 1024) throw new Error('Project file exceeds 50 MB.');
  const doc = JSON.parse(text, (key, value) => { if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('Unsafe object key in project.'); return value; });
  return assertDocument(doc);
}
export function selectionBounds(page, ids) { let b; for (const id of ids) if (page.view.nodes[id]) b = union(b, geometryBounds(page.view.nodes[id])); return b; }
