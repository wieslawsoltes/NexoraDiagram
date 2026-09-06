import { getPort, isContainer, getMaster } from './stencils.js';
import { isVisible } from './model.js';
import { bounds, inflate, intersects, union } from './geometry.js';
import { routeConnector } from './router.js';
const signature = value => JSON.stringify(value);
const center = g => ({ x: g.x + g.w / 2, y: g.y + g.h / 2 });
function escapePort(port, g, margin) {
  return { x: port.dx < 0 ? Math.min(port.x - margin, g.x - margin) : port.dx > 0 ? Math.max(port.x + margin, g.x + g.w + margin) : port.x,
    y: port.dy < 0 ? Math.min(port.y - margin, g.y - margin) : port.dy > 0 ? Math.max(port.y + margin, g.y + g.h + margin) : port.y };
}
/** Routes are a derived cache, never document truth. Stale worker results are discarded by generation. */
export class RoutingService extends EventTarget {
  constructor() {
    super(); this.routes = new Map(); this.nodes = new Map(); this.edges = new Map(); this.dirty = new Set(); this.revision = 0; this.pageId = null; this.timer = null; this.pendingMessage = null; this.inFlight = false;
    try { this.worker = new Worker(new URL('./router.worker.js', import.meta.url), { type: 'module' });
      this.worker.onmessage = e => { this.inFlight = false; this.receive(e.data); if (this.pendingMessage) this.dispatch(); };
      this.worker.onerror = () => { this.worker.terminate(); this.worker = null; this.inFlight = false; if (this.pendingMessage) this.dispatch(); else this.refresh?.(); };
    } catch { this.worker = null; }
  }
  receive(data) {
    if (data.revision !== this.revision || data.pageId !== this.pageId) return;
    if (data.error) { this.dispatchEvent(new CustomEvent('error', { detail: data.error })); return; }
    for (const route of data.routes) { this.routes.set(route.id, route); this.dirty.delete(route.id); }
    this.dispatchEvent(new Event('updated'));
  }
  dispatch() {
    const message = this.pendingMessage; if (!message) return; this.pendingMessage = null;
    if (this.worker) { this.inFlight = true; this.worker.postMessage(message); }
    else {
      try { this.receive({ ...message, routes: message.requests.map(r => routeConnector(r, message.obstacles)) }); }
      catch (error) { this.dispatchEvent(new CustomEvent('error', { detail: error.message })); }
    }
  }
  update(doc, page, immediate = false) {
    this.refresh = () => this.update(doc, page, true);
    const switched = this.pageId !== page.id;
    if (switched) { this.pageId = page.id; this.nodes.clear(); this.edges.clear(); this.routes.clear(); this.dirty.clear(); }
    const changedAreas = [], changedIds = new Set(), newNodes = new Map(), obstacles = [];
    for (const n of Object.values(page.graph.nodes)) {
      const g = page.view.nodes[n.id]; const visible = isVisible(page, n.id), obstacle = visible && !isContainer(doc, n) && !getMaster(doc, n.master).annotation;
      const record = { x: g.x, y: g.y, w: g.w, h: g.h, visible, obstacle, master: n.master, ports: n.ports };
      const old = this.nodes.get(n.id);
      if (signature(old) !== signature(record)) { changedIds.add(n.id); if (old) changedAreas.push(inflate(old, 24)); changedAreas.push(inflate(g, 24)); }
      newNodes.set(n.id, record); if (obstacle) obstacles.push({ ...inflate(g, 12), id: n.id });
    }
    for (const [id, old] of this.nodes) if (!newNodes.has(id)) { changedIds.add(id); changedAreas.push(inflate(old, 24)); }
    this.nodes = newNodes;
    let anyChanged = switched || changedIds.size > 0;
    for (const [id, edge] of Object.entries(page.graph.edges)) {
      const view = page.view.edges[id], sig = signature([edge.from, edge.to, view.waypoints]);
      const route = this.routes.get(id);
      if (sig !== this.edges.get(id) || changedIds.has(edge.from.nodeId) || changedIds.has(edge.to.nodeId) || !route || changedAreas.some(a => intersects(a, inflate(bounds(route.points), 10)))) { this.dirty.add(id); anyChanged = true; }
      this.edges.set(id, sig);
    }
    for (const id of this.edges.keys()) if (!page.graph.edges[id]) { this.edges.delete(id); this.routes.delete(id); this.dirty.delete(id); anyChanged = true; }
    if (!anyChanged && !this.dirty.size) return;
    this.revision++; const requests = [];
    for (const id of this.dirty) {
      const e = page.graph.edges[id]; if (!e) continue;
      const fg = page.view.nodes[e.from.nodeId], tg = page.view.nodes[e.to.nodeId];
      const start = getPort(doc, page, e.from, center(tg)), end = getPort(doc, page, e.to, center(fg)); if (!start || !end) continue;
      const request = { id, fromId: e.from.nodeId, toId: e.to.nodeId, start, end, startStub: escapePort(start, fg, 22), endStub: escapePort(end, tg, 22), waypoints: page.view.edges[id].waypoints || [] };
      requests.push(request);
      // Endpoint-correct preview avoids detached connectors while a worker route is pending.
      const old = this.routes.get(id);
      if (!old || changedIds.has(e.from.nodeId) || changedIds.has(e.to.nodeId)) this.routes.set(id, { id, status: 'pending', points: [start, request.startStub, { x: request.startStub.x, y: request.endStub.y }, request.endStub, end] });
    }
    this.pendingMessage = { revision: this.revision, pageId: page.id, requests, obstacles };
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { if (!this.inFlight) this.dispatch(); }, immediate ? 0 : 45);
  }
  async flush(doc, page) {
    this.update(doc, page, true); clearTimeout(this.timer);
    // Deterministic synchronous completion for vector export, independent of pending workers.
    if (this.pendingMessage) { const m = this.pendingMessage; this.pendingMessage = null; this.receive({ ...m, routes: m.requests.map(r => routeConnector(r, m.obstacles)) }); }
    else if (this.dirty.size) {
      this.nodes.clear(); this.update(doc, page, true); return this.flush(doc, page);
    }
    return this.routes;
  }
  dispose() { clearTimeout(this.timer); this.worker?.terminate(); }
}
