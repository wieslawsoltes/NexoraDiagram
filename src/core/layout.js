import { geometryBounds } from './drawing.js';
import { uid, descendants, isLocked, ancestors, movementLockedIds } from './model.js';
import { isContainer, getMaster } from './stencils.js';
import { round, union, intersects, inflate } from './geometry.js';
function move(page, id, axis, value) {
  const g = page.view.nodes[id], delta = value - g[axis]; if (Math.abs(delta) < .001) return;
  g[axis] = round(value); for (const child of descendants(page, id)) page.view.nodes[child][axis] = round(page.view.nodes[child][axis] + delta);
}
function anchorOffset(g, mode) { return mode === 'center' ? g.w / 2 : mode === 'right' ? g.w : mode === 'middle' ? g.h / 2 : mode === 'bottom' ? g.h : 0; }
export function addAlignment(page, ids, mode) {
  if (ids.length < 2) throw new Error('Select at least two shapes.');
  const axis = ['left', 'center', 'right'].includes(mode) ? 'x' : 'y';
  const c = { id: uid('constraint'), kind: 'align', ids: [...ids], mode, axis }; page.constraints.push(c); solveConstraints(page, new Set([ids[0]])); return c;
}
export function addDistribution(page, ids, axis) {
  if (ids.length < 3) throw new Error('Select at least three shapes.');
  const sorted = [...ids].sort((a, b) => page.view.nodes[a][axis] - page.view.nodes[b][axis]);
  const c = { id: uid('constraint'), kind: 'distribute', ids: sorted, axis }; page.constraints.push(c); solveConstraints(page); return c;
}
/** Bounded projection solver. Locked shapes are fixed variables; residuals remain inspectable. */
export function solveConstraints(page, preferred = new Set()) {
  const fixed = movementLockedIds(page);
  for (let pass = 0; pass < 12; pass++) {
    let maxDelta = 0;
    for (const c of page.constraints) {
      const ids = c.ids.filter(id => page.view.nodes[id]); if (ids.length < 2) continue;
      if (c.kind === 'align') {
        const reference = ids.find(id => fixed.has(id)) || ids.find(id => preferred.has(id)) || ids[0];
        const value = page.view.nodes[reference][c.axis] + anchorOffset(page.view.nodes[reference], c.mode);
        for (const id of ids) if (!fixed.has(id)) { const g = page.view.nodes[id], target = value - anchorOffset(g, c.mode); maxDelta = Math.max(maxDelta, Math.abs(g[c.axis] - target)); move(page, id, c.axis, target); }
      } else {
        const axis = c.axis, size = axis === 'x' ? 'w' : 'h';
        const first = page.view.nodes[ids[0]], last = page.view.nodes[ids.at(-1)];
        const used = ids.reduce((sum, id) => sum + page.view.nodes[id][size], 0);
        const gap = (last[axis] + last[size] - first[axis] - used) / (ids.length - 1); let cursor = first[axis];
        for (const id of ids) { const g = page.view.nodes[id]; if (!fixed.has(id)) { maxDelta = Math.max(maxDelta, Math.abs(g[axis] - cursor)); move(page, id, axis, cursor); } cursor += g[size] + gap; }
      }
    }
    if (maxDelta < .01) break;
  }
  return constraintResiduals(page);
}
export function constraintResiduals(page) {
  return page.constraints.map(c => {
    const gs = c.ids.map(id => page.view.nodes[id]).filter(Boolean); let residual = 0;
    if (gs.length < 2) return { ...c, residual: 0 };
    if (c.kind === 'align') { const values = gs.map(g => g[c.axis] + anchorOffset(g, c.mode)); residual = Math.max(...values) - Math.min(...values); }
    else { const size = c.axis === 'x' ? 'w' : 'h', gaps = gs.slice(1).map((g, i) => g[c.axis] - gs[i][c.axis] - gs[i][size]); residual = Math.max(...gaps) - Math.min(...gaps); }
    return { ...c, residual };
  });
}
export function fitContainers(doc, page) {
  const containers = Object.values(page.graph.nodes).filter(n => isContainer(doc, n)).sort((a, b) => ancestors(page, b.id).length - ancestors(page, a.id).length);
  for (const c of containers) {
    if (isLocked(page, c.id)) continue;
    const children = Object.values(page.graph.nodes).filter(n => n.parentId === c.id); if (!children.length) continue;
    let box; for (const n of children) box = union(box, geometryBounds(page.view.nodes[n.id])); const g = page.view.nodes[c.id];
    if (c.master === 'group') { Object.assign(g, box, { rotation: 0, flipX: false, flipY: false }); continue; }
    const left = Math.min(g.x, box.x - 20), top = Math.min(g.y, box.y - 52);
    g.w = round(Math.max(g.x + g.w, box.x + box.w + 20) - left); g.h = round(Math.max(g.y + g.h, box.y + box.h + 20) - top); g.x = round(left); g.y = round(top);
  }
}
/** Iterative Kosaraju SCC decomposition, avoiding call-stack limits on long process chains. */
export function stronglyConnected(ids, edges) {
  const adjacency = new Map(ids.map(id => [id, []])), reverse = new Map(ids.map(id => [id, []]));
  for (const [a, b] of edges) if (adjacency.has(a) && adjacency.has(b)) { adjacency.get(a).push(b); reverse.get(b).push(a); }
  const visited = new Set(), order = [];
  for (const root of ids) if (!visited.has(root)) {
    const stack = [[root, 0]]; visited.add(root);
    while (stack.length) { const item = stack.at(-1), next = adjacency.get(item[0]); if (item[1] < next.length) { const child = next[item[1]++]; if (!visited.has(child)) { visited.add(child); stack.push([child, 0]); } } else { order.push(item[0]); stack.pop(); } }
  }
  visited.clear(); const components = [];
  for (const root of order.reverse()) if (!visited.has(root)) {
    const component = [], stack = [root]; visited.add(root);
    while (stack.length) { const id = stack.pop(); component.push(id); for (const child of reverse.get(id)) if (!visited.has(child)) { visited.add(child); stack.push(child); } } components.push(component);
  }
  return components;
}
/** Cycle-aware layered layout, preserving semantic container membership and locked shapes. */
export function autoLayout(doc, page, { direction = 'horizontal', gap = 72 } = {}) {
  const nodes = Object.values(page.graph.nodes).filter(n => !isContainer(doc, n) && !getMaster(doc, n.master).annotation), ids = nodes.map(n => n.id);
  const edges = Object.values(page.graph.edges).map(e => [e.from.nodeId, e.to.nodeId]); const components = stronglyConnected(ids, edges), comp = new Map();
  components.forEach((c, i) => c.forEach(id => comp.set(id, i)));
  const adjacent = components.map(() => new Set()), degree = new Int32Array(components.length), rank = new Int32Array(components.length);
  for (const [a, b] of edges) { const x = comp.get(a), y = comp.get(b); if (x !== undefined && y !== undefined && x !== y && !adjacent[x].has(y)) { adjacent[x].add(y); degree[y]++; } }
  const queue = []; degree.forEach((v, i) => { if (!v) queue.push(i); });
  for (let k = 0; k < queue.length; k++) { const c = queue[k]; for (const next of adjacent[c]) { rank[next] = Math.max(rank[next], rank[c] + 1); if (--degree[next] === 0) queue.push(next); } }
  const horizontal = direction === 'horizontal', axis = horizontal ? 'x' : 'y', cross = horizontal ? 'y' : 'x', size = horizontal ? 'w' : 'h', crossSize = horizontal ? 'h' : 'w';
  const maxRank = rank.length ? Math.max(...rank) : 0, widths = Array(maxRank + 1).fill(0);
  for (const n of nodes) widths[rank[comp.get(n.id)]] = Math.max(widths[rank[comp.get(n.id)]], page.view.nodes[n.id][size]);
  const offsets = [0]; for (let i = 0; i < widths.length; i++) offsets.push(offsets[i] + widths[i] + gap);
  const rows = new Map();
  for (const n of nodes) {
    if (isLocked(page, n.id)) continue;
    const g = page.view.nodes[n.id], parent = page.view.nodes[n.parentId], r = rank[comp.get(n.id)], key = `${n.parentId || 'page'}:${r}`;
    const base = parent ? { x: parent.x + 30, y: parent.y + 58 } : { x: 90, y: 160 };
    const cursor = rows.get(key) || 0; g[axis] = round(base[axis] + offsets[r]); g[cross] = round(base[cross] + cursor); rows.set(key, cursor + g[crossSize] + 34);
  }
  fitContainers(doc, page); solveConstraints(page);
  // Separate top-level containers after expansion; move their children as a unit.
  const containers = Object.values(page.graph.nodes).filter(n => isContainer(doc, n) && !n.parentId).sort((a, b) => page.view.nodes[a.id].y - page.view.nodes[b.id].y);
  const fixedContainers = movementLockedIds(page);
  for (let i = 1; i < containers.length; i++) {
    const prev = page.view.nodes[containers[i - 1].id], curr = page.view.nodes[containers[i].id];
    if (intersects(inflate(prev, 8), curr) && !fixedContainers.has(containers[i].id)) move(page, containers[i].id, 'y', prev.y + prev.h + 16);
  }
  let extent; for (const g of Object.values(page.view.nodes)) extent = union(extent, g);
  if (extent) { page.width = Math.min(100000, Math.max(page.width, extent.x + extent.w + 60)); page.height = Math.min(100000, Math.max(page.height, extent.y + extent.h + 60)); }
}
