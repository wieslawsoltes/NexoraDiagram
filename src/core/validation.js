import { pageBounds } from './page.js';
import { geometryBounds } from './drawing.js';
import { isVisible, isLocked, ancestors } from './model.js';
import { getMaster, isContainer, getPorts } from './stencils.js';
import { unresolvedBindings } from './expression.js';
import { SpatialIndex } from './spatial.js';
import { intersects, inflate } from './geometry.js';
import { constraintResiduals } from './layout.js';
export function validateDiagram(doc, page, routes = new Map()) {
  const issues = [], nodes = Object.values(page.graph.nodes), edges = Object.values(page.graph.edges), degree = new Map(nodes.map(n => [n.id, { incoming: 0, outgoing: [] }]));
  const push = (severity, code, message, ids = []) => issues.push({ severity, code, message, ids });
  const keys = new Map();
  for (const e of edges) {
    if (!degree.has(e.from.nodeId) || !degree.has(e.to.nodeId)) { push('error', 'ENDPOINT', 'A connector references a missing shape.', [e.id]); continue; }
    degree.get(e.from.nodeId).outgoing.push(e); degree.get(e.to.nodeId).incoming++;
    for (const endpoint of [e.from, e.to]) {
      const n = page.graph.nodes[endpoint.nodeId];
      if (endpoint.port !== 'auto' && !getPorts(doc, n, page.view.nodes[n.id]).some(p => p.id === endpoint.port)) push('error', 'PORT', 'A connector references an unknown connection point.', [e.id]);
    }
    if (routes.get(e.id)?.status === 'blocked') push('warning', 'ROUTE', 'No obstacle-free orthogonal route was found. Move shapes or edit the waypoints.', [e.id]);
  }
  const index = new SpatialIndex();
  for (const n of nodes) {
    const m = getMaster(doc, n.master), g = page.view.nodes[n.id], d = degree.get(n.id);
    if (!n.label.trim() && !m.annotation) push('warning', 'LABEL', 'A shape has an empty label.', [n.id]);
    for (const key of unresolvedBindings(n)) push('warning', 'BINDING', `Label refers to missing data field “${key}”.`, [n.id]);
    if (n.data.key) { const old = keys.get(String(n.data.key)); if (old) push('warning', 'KEY', `Duplicate external key “${n.data.key}”.`, [old, n.id]); else keys.set(String(n.data.key), n.id); }
    if (!m.annotation && !m.container && !d.incoming && !d.outgoing.length && nodes.length > 1) push('warning', 'ISOLATED', `“${n.label.split('\n')[0]}” is not connected.`, [n.id]);
    if (n.master === 'decision') {
      if (d.outgoing.length < 2) push('warning', 'DECISION', 'A decision needs at least two outgoing branches.', [n.id]);
      if (d.outgoing.some(e => !e.label.trim())) push('warning', 'BRANCH', 'Decision branches should have labels.', [n.id]);
    }
    if (n.parentId && page.graph.nodes[n.parentId].master !== 'group') {
      const p = page.view.nodes[n.parentId];
      if (g.x < p.x + 8 || g.y < p.y + 40 || g.x + g.w > p.x + p.w - 8 || g.y + g.h > p.y + p.h - 8) push('warning', 'CONTAINMENT', 'A member extends outside the content area of its container.', [n.id, n.parentId]);
    }
    const pb = pageBounds(page), gb = geometryBounds(g);
    if (page.canvasMode !== 'infinite' && (gb.x < pb.x || gb.y < pb.y || gb.x + gb.w > pb.x + pb.w || gb.y + gb.h > pb.y + pb.h)) push('warning', 'PAGE', 'A shape extends beyond the exported page.', [n.id]);
    if (isVisible(page, n.id) && !m.annotation && !m.container) {
      for (const other of index.query(inflate(g, -2))) {
        if (page.graph.nodes[other].parentId === n.parentId) push('warning', 'OVERLAP', 'Two peer shapes overlap.', [other, n.id]);
      }
      index.set(n.id, inflate(g, -2));
    }
  }
  for (const c of constraintResiduals(page)) if (c.residual > .5) push('error', 'CONSTRAINT', `Conflicting ${c.kind} constraint: ${c.residual.toFixed(1)} units of residual.`, c.ids);
  return issues.sort((a, b) => (a.severity === 'error' ? 0 : 1) - (b.severity === 'error' ? 0 : 1));
}
