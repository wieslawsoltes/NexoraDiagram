/** Selection transforms preserve graph attachments, manual routes, grouping, and locks. */
import { descendants, ancestors, movementLockedIds, isLocked, isVisible, addNode } from './model.js';
import { geometryBounds, rotatePoint, normalizeAngle } from './drawing.js';
import { bounds, union, contains, intersects, pointInPolygon } from './geometry.js';
export function selectionBox(page, ids, routes = new Map()) {
  let box;
  for (const id of ids) {
    const g = page.view.nodes[id];
    if (g) box = union(box, geometryBounds(g));
    else if (routes.get(id)?.points.length) box = union(box, bounds(routes.get(id).points));
  }
  return box;
}
export function groupRoot(page, id) {
  let root = id;
  for (const parent of ancestors(page, id)) { if (page.graph.nodes[parent].master === 'group') root = parent; }
  return root;
}
export function editableSelection(page, ids) {
  const fixed = movementLockedIds(page);
  return [...ids].filter(id => isVisible(page, id) && !isLocked(page, id) && !fixed.has(id));
}
export function captureSelection(page, ids, routes = new Map()) {
  const selected = new Set(editableSelection(page, ids)), nodes = new Map(), edges = new Map();
  const roots = [...selected].filter(id => page.graph.nodes[id] && !ancestors(page, id).some(parent => selected.has(parent)));
  for (const id of roots) for (const member of [id, ...descendants(page, id)]) if (!isLocked(page, member)) nodes.set(member, structuredClone(page.view.nodes[member]));
  for (const e of Object.values(page.graph.edges)) {
    if (isLocked(page, e.id)) continue;
    const internal = nodes.has(e.from.nodeId) && nodes.has(e.to.nodeId);
    if (!internal && !selected.has(e.id)) continue;
    const original = page.view.edges[e.id].waypoints || [];
    let points = original;
    if (!internal && !original.length) { const route = routes.get(e.id)?.points || []; points = route.slice(1, -1).slice(0, 100); if (!points.length && route.length > 1) points = [{ x: (route[0].x + route.at(-1).x) / 2, y: (route[0].y + route.at(-1).y) / 2 }]; }
    edges.set(e.id, { points: structuredClone(points), internal });
  }
  return { nodes, edges, roots, box: selectionBox(page, selected, routes) };
}
export function translateSelection(page, snapshot, dx, dy) {
  for (const [id, g] of snapshot.nodes) { page.view.nodes[id].x = g.x + dx; page.view.nodes[id].y = g.y + dy; }
  for (const [id, edge] of snapshot.edges) page.view.edges[id].waypoints = edge.points.map(p => ({ x: p.x + dx, y: p.y + dy }));
}
export function resizeSelection(page, snapshot, target) {
  const old = snapshot.box; if (!old) return;
  const sx = target.w / Math.max(1, old.w), sy = target.h / Math.max(1, old.h);
  const map = p => ({ x: target.x + (p.x - old.x) * sx, y: target.y + (p.y - old.y) * sy });
  for (const [id, g] of snapshot.nodes) {
    const center = map({ x: g.x + g.w / 2, y: g.y + g.h / 2 }), w = g.w * sx, h = g.h * sy;
    Object.assign(page.view.nodes[id], { x: center.x - w / 2, y: center.y - h / 2, w, h });
  }
  for (const [id, edge] of snapshot.edges) page.view.edges[id].waypoints = edge.points.map(map);
}
export function rotateSelection(page, snapshot, angle) {
  const box = snapshot.box; if (!box) return;
  const center = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  for (const [id, g] of snapshot.nodes) {
    if (page.graph.nodes[id].master === 'group') continue;
    const point = rotatePoint({ x: g.x + g.w / 2, y: g.y + g.h / 2 }, center, angle);
    Object.assign(page.view.nodes[id], { x: point.x - g.w / 2, y: point.y - g.h / 2, rotation: normalizeAngle((g.rotation || 0) + angle) });
  }
  for (const [id, edge] of snapshot.edges) page.view.edges[id].waypoints = edge.points.map(p => rotatePoint(p, center, angle));
}
export function flipSelection(page, snapshot, axis) {
  const b = snapshot.box; if (!b) return;
  const center = { x: b.x + b.w / 2, y: b.y + b.h / 2 }, flip = p => ({ x: axis === 'x' ? 2 * center.x - p.x : p.x, y: axis === 'y' ? 2 * center.y - p.y : p.y });
  for (const [id, g] of snapshot.nodes) {
    const point = flip({ x: g.x + g.w / 2, y: g.y + g.h / 2 });
    Object.assign(page.view.nodes[id], { x: point.x - g.w / 2, y: point.y - g.h / 2, rotation: normalizeAngle(-(g.rotation || 0)), [axis === 'x' ? 'flipX' : 'flipY']: !g[axis === 'x' ? 'flipX' : 'flipY'] });
  }
  for (const [id, edge] of snapshot.edges) page.view.edges[id].waypoints = edge.points.map(flip);
}
export function groupSelection(doc, page, ids, layerId) {
  const selected = editableSelection(page, ids).filter(id => page.graph.nodes[id]);
  const roots = selected.filter(id => !ancestors(page, id).some(p => selected.includes(p)));
  if (roots.length < 2) throw new Error('Select at least two editable shapes to group.');
  const b = selectionBox(page, roots), parent = page.graph.nodes[roots[0]].parentId;
  const id = addNode(doc, page, 'group', b.x, b.y, { label: 'Group', layerId, geometry: { w: Math.max(1, b.w), h: Math.max(1, b.h) }, parentId: roots.every(n => page.graph.nodes[n].parentId === parent) ? parent : null });
  roots.forEach(n => page.graph.nodes[n].parentId = id); return id;
}
export function ungroupSelection(page, ids) {
  const result = [];
  for (const id of editableSelection(page, ids)) {
    const group = page.graph.nodes[id]; if (group?.master !== 'group') continue;
    for (const n of Object.values(page.graph.nodes)) if (n.parentId === id) { n.parentId = group.parentId; result.push(n.id); }
    delete page.graph.nodes[id]; delete page.view.nodes[id]; page.constraints = page.constraints.filter(c => !c.ids.includes(id));
  }
  if (!result.length) throw new Error('Select an editable group to ungroup.'); return result;
}
export function segmentIntersectsBox(a, b, box) {
  let low = 0, high = 1; const dx = b.x - a.x, dy = b.y - a.y;
  for (const [p, q] of [[-dx, a.x - box.x], [dx, box.x + box.w - a.x], [-dy, a.y - box.y], [dy, box.y + box.h - a.y]]) {
    if (Math.abs(p) < 1e-10) { if (q < 0) return false; continue; }
    const t = q / p; if (p < 0) low = Math.max(low, t); else high = Math.min(high, t);
    if (low > high) return false;
  }
  return true;
}
export function selectInArea(page, area, { crossing = true, lasso = null, routes = new Map() } = {}) {
  const fixed = movementLockedIds(page), result = new Set();
  for (const [id, g] of Object.entries(page.view.nodes)) {
    if (!isVisible(page, id) || isLocked(page, id) || fixed.has(id)) continue;
    const b = geometryBounds(g), corners = [{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y }, { x: b.x + b.w, y: b.y + b.h }, { x: b.x, y: b.y + b.h }];
    const matches = lasso ? corners.every(p => pointInPolygon(p, lasso)) : crossing ? intersects(area, b) : corners.every(p => contains(area, p));
    if (matches) result.add(groupRoot(page, id));
  }
  for (const [id, route] of routes) if (isVisible(page, id) && !isLocked(page, id) && route.points.length) {
    const points = route.points;
    const matches = lasso ? points.every(p => pointInPolygon(p, lasso)) : crossing ? points.slice(1).some((p, i) => segmentIntersectsBox(points[i], p, area)) : points.every(p => contains(area, p));
    if (matches) result.add(id);
  }
  return [...result].filter(id => !isLocked(page, id) && !fixed.has(id));
}
