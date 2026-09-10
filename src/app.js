import { installDrawing } from './ui/drawing.js';
import { geometryBounds } from './core/drawing.js';
import { selectionBox } from './core/editing.js';
import { pageBounds, contentBounds, UNIT_SCALE } from './core/page.js';
import { DocumentStore } from './core/history.js';
import { createPage, createDocument, addNode, addEdge, uid, isVisible, isLocked, selectionBounds, descendants, assignParent } from './core/model.js';
import { getMaster, getPorts, shapeGeometry, isContainer } from './core/stencils.js';
import { SpatialIndex } from './core/spatial.js';
import { RoutingService } from './core/routing-service.js';
import { bounds, inflate, contains, intersects, pointInPolygon, polylineDistance, distance, clamp, round } from './core/geometry.js';
import { buildScene, labelForNode } from './render/scene.js';
import { Renderer } from './render/renderer.js';
import { Panels } from './ui/panels.js';
import { icon, esc } from './ui/icons.js';
import { installInteractions } from './ui/interactions.js';
import { installActions } from './ui/actions.js';
const $ = id => document.getElementById(id);
export class DiagramApp {
  constructor(doc, persistence) {
    this.store = new DocumentStore(doc); this.persistence = persistence; this.pageId = doc.pageOrder[0]; this.activeLayer = 'diagram'; this.selection = new Set(); this.tool = 'pointer';
    this.grid = true; this.snap = true; this.guides = true; this.minimap = false; this.maintainConstraints = true;
    this.camera = { x: 30, y: 30, zoom: .7, width: 1, height: 1, dpr: Math.min(2, window.devicePixelRatio || 1) }; this.pageCameras = new Map();
    this.index = new SpatialIndex(); this.indexRecords = new Map(); this.frame = 0; this.sceneDirty = true; this.drag = null; this.hover = null; this.connectSource = null; this.guideLines = []; this.clipboard = null;
    this.renderer = new Renderer($('gpu-canvas'), $('fallback-canvas')); this.routing = new RoutingService(); this.ui = new Panels(this); this.saveChain = Promise.resolve(); this.validationIssues = [];
    this.store.addEventListener('change', e => this.changed(e.detail));
    this.routing.addEventListener('updated', () => { this.syncIndex(); this.requestFrame(true); });
    this.routing.addEventListener('error', e => this.ui.showToast(`Routing: ${e.detail}`, true));
    this.renderer.addEventListener('backend', () => {
      $('backend-badge').innerHTML = `<i></i>${this.renderer.mode}`; $('backend-badge').title = this.renderer.reason || 'Hardware WebGPU renderer · retained geometry · native-shaped text atlas'; this.requestFrame(true);
    });
  }
  get doc() { return this.store.doc; }
  get page() { return this.doc.pages[this.pageId]; }
  async initialize() {
    installDrawing(this); this.ui.initialize(); installActions(this); installInteractions(this);
    this.resizeObserver = new ResizeObserver(() => this.resize()); this.resizeObserver.observe($('stage'));
    this.syncIndex(); this.routing.update(this.doc, this.page, true); this.resize(); this.fitPage();
    const first = Object.values(this.page.graph.nodes).find(n => n.data.key === 'REQ01'); if (first) this.select([first.id]);
    this.ui.setSaved('Saving…'); this.saveTimer = setTimeout(() => this.autosave(), 350);
    window.addEventListener('pagehide', () => { try { localStorage.setItem('nexora-recovery', JSON.stringify(this.doc)); } catch { } });
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.autosave(); });
    this.renderer.initialize(new URLSearchParams(location.search).get('renderer') === 'canvas');
    this.requestFrame(true);
  }
  changed(detail) {
    if (!this.doc.pages[this.pageId]) { this.pageId = this.doc.pageOrder[0]; this.selection.clear(); this.fitPage(); }
    this.selection = new Set([...this.selection].filter(id => (this.page.graph.nodes[id] || this.page.graph.edges[id]) && isVisible(this.page, id)));
    if (!this.page.layers.some(l => l.id === this.activeLayer)) this.activeLayer = this.page.layers[0].id;
    this.syncIndex(); this.routing.update(this.doc, this.page, detail.kind !== 'preview'); this.requestFrame(true);
    if (detail.kind === 'preview') {
      const n = this.page.view.nodes[[...this.selection][0]];
      if (n) for (const key of ['x', 'y', 'w', 'h']) { const input = document.querySelector(`[data-prop="${key}"]`); if (input && document.activeElement !== input) input.value = Math.round(n[key]); }
    } else {
      this.ui.renderAll(); this.ui.renderStencils(); this.ui.setStatus(detail.label || 'Ready'); this.ui.setSaved('Saving…'); clearTimeout(this.saveTimer); this.saveTimer = setTimeout(() => this.autosave(), 350);
      if (!$('validation-panel').hidden) this.runValidation(false);
    }
  }
  transact(label, action) {
    try { return this.store.transact(label, action); }
    catch (error) { this.ui.showToast(error.message, true); console.error(error); return false; }
  }
  async autosave() {
    if (this.store.pending) return; clearTimeout(this.saveTimer);
    const revision = this.store.revision, snapshot = structuredClone(this.doc);
    this.saveChain = this.saveChain.catch(() => {}).then(() => this.persistence.save(snapshot));
    try { await this.saveChain; if (revision === this.store.revision) { this.ui.setSaved('Saved on this device'); try { localStorage.removeItem('nexora-recovery'); } catch {} } }
    catch (error) { this.ui.setSaved('Save unavailable', true); this.ui.showToast(`Browser storage failed: ${error.message}. Download a project backup with Ctrl+S.`, true); }
  }
  syncIndex() {
    const p = this.page, live = new Set(); this.drawOrder = new Map(Object.keys(p.graph.nodes).map((id, i) => [id, i]));
    for (const n of Object.values(p.graph.nodes)) if (isVisible(p, n.id)) {
      const g = p.view.nodes[n.id], record = [g.x, g.y, g.w, g.h, g.rotation, g.strokeWidth, n.master].join(':'); live.add(n.id);
      if (this.indexRecords.get(n.id) !== record) { this.index.set(n.id, inflate(geometryBounds(g), (g.strokeWidth || 0) * 3 + 12), { id: n.id, kind: 'node' }); this.indexRecords.set(n.id, record); }
    }
    for (const e of Object.values(p.graph.edges)) if (isVisible(p, e.id)) {
      const route = this.routing.routes.get(e.id); if (!route?.points.length) continue; live.add(e.id);
      const b = inflate(bounds(route.points), 8), record = [b.x, b.y, b.w, b.h].join(':');
      if (this.indexRecords.get(e.id) !== record) { this.index.set(e.id, b, { id: e.id, kind: 'edge' }); this.indexRecords.set(e.id, record); }
    }
    for (const id of this.indexRecords.keys()) if (!live.has(id)) { this.index.delete(id); this.indexRecords.delete(id); }
  }
  clearIndex() { this.index.clear(); this.indexRecords.clear(); this.syncIndex(); }
  resize() {
    const r = $('stage').getBoundingClientRect(), oldWidth = this.camera.width, oldHeight = this.camera.height;
    this.camera.width = Math.max(1, r.width); this.camera.height = Math.max(1, r.height); this.camera.dpr = Math.min(2, window.devicePixelRatio || 1);
    if (oldWidth > 1) { this.camera.x += (r.width - oldWidth) / 2; this.camera.y += (r.height - oldHeight) / 2; }
    this.requestFrame(true);
  }
  screenToWorld(p) { return { x: (p.x - this.camera.x) / this.camera.zoom, y: (p.y - this.camera.y) / this.camera.zoom }; }
  worldToScreen(p) { return { x: p.x * this.camera.zoom + this.camera.x, y: p.y * this.camera.zoom + this.camera.y }; }
  pointerPosition(event) { const r = $('stage').getBoundingClientRect(); return { x: event.clientX - r.left, y: event.clientY - r.top }; }
  visibleBounds(padding = 0) { return inflate({ x: -this.camera.x / this.camera.zoom, y: -this.camera.y / this.camera.zoom, w: this.camera.width / this.camera.zoom, h: this.camera.height / this.camera.zoom }, padding); }
  setZoom(zoom, screen = { x: this.camera.width / 2, y: this.camera.height / 2 }) {
    const world = this.screenToWorld(screen); this.camera.zoom = clamp(zoom, .001, 4); this.camera.x = screen.x - world.x * this.camera.zoom; this.camera.y = screen.y - world.y * this.camera.zoom; this.cameraChanged();
  }
  cameraChanged() {
    const view = this.visibleBounds(); const b = this.cullingBounds;
    if (!b || !contains(b, { x: view.x, y: view.y }) || !contains(b, { x: view.x + view.w, y: view.y + view.h })) this.sceneDirty = true;
    this.ui.updateStatus(); this.requestFrame();
  }
  fitBounds(b, padding = 34) {
    if (!b) return this.fitPage(); const c = this.camera;
    c.zoom = clamp(Math.min((c.width - padding * 2) / Math.max(1, b.w), (c.height - padding * 2) / Math.max(1, b.h)), .001, 2);
    c.x = (c.width - b.w * c.zoom) / 2 - b.x * c.zoom; c.y = (c.height - b.h * c.zoom) / 2 - b.y * c.zoom; this.cameraChanged();
  }
  fitPage() { this.fitBounds(this.page.canvasMode === 'infinite' ? contentBounds(this.page, null, this.routing.routes) || pageBounds(this.page) : pageBounds(this.page), this.camera.width < 450 ? 17 : 35); }
  switchPage(id) {
    if (!this.doc.pages[id]) return; this.finishLabelEdit?.(); this.editor?.cancel(); if (this.store.pending) this.store.cancel(); this.drag = null; this.connectSource = null;
    this.pageCameras.set(this.pageId, { ...this.camera }); this.pageId = id; this.selection.clear(); this.activeLayer = this.page.layers[0].id;
    const previous = this.pageCameras.get(id); if (previous) Object.assign(this.camera, { x: previous.x, y: previous.y, zoom: previous.zoom }); else this.fitPage();
    this.routing.update(this.doc, this.page, true); this.clearIndex(); this.ui.renderAll(); this.requestFrame(true);
  }
  select(ids, additive = false) {
    if (!additive) this.selection.clear(); for (const id of ids) if ((this.page.graph.nodes[id] || this.page.graph.edges[id]) && isVisible(this.page, id)) this.selection.add(id);
    this.ui.renderInspector(); if (this.ui.leftTab === 'outline') this.ui.renderOutline(); this.ui.updateStatus(); this.requestFrame();
  }
  setTool(tool) { this.finishLabelEdit?.(); if (this.drag) this.cancelInteraction?.(); this.editor?.toolChanged(); this.tool = tool; this.connectSource = null; this.connectPoint = null; this.ui.renderRibbon(); this.ui.renderFloatingTools(); this.ui.setStatus(tool === 'connect' ? 'Drag from one shape to another, or click source then target' : tool === 'hand' ? 'Drag the canvas to pan' : 'Ready'); $('stage').style.cursor = tool === 'hand' ? 'grab' : !['pointer', 'hand'].includes(tool) ? 'crosshair' : 'default'; this.requestFrame(); }
  hitTest(point) {
    const candidates = this.index.query(inflate({ ...point, w: 0, h: 0 }, 7 / this.camera.zoom));
    const nodes = candidates.filter(c => c.kind === 'node').sort((a, b) => (this.page.view.nodes[b.id].z || 0) - (this.page.view.nodes[a.id].z || 0) || this.drawOrder.get(b.id) - this.drawOrder.get(a.id)), edges = candidates.filter(c => c.kind === 'edge').reverse();
    for (const hit of nodes) {
      const n = this.page.graph.nodes[hit.id], g = this.page.view.nodes[hit.id];
      if (isContainer(this.doc, n)) continue;
      const shape = shapeGeometry(getMaster(this.doc, n.master), g);
      if (n.master === 'path' ? (g.closed && g.fill !== 'none' && g.fill !== 'transparent' && pointInPolygon(point, shape.points)) || polylineDistance(point, g.closed ? [...shape.points, shape.points[0]] : shape.points) < Math.max(8 / this.camera.zoom, (g.strokeWidth || 0) / 2 + 3 / this.camera.zoom) : pointInPolygon(point, shape.points)) return hit;
    }
    for (const hit of edges) if (polylineDistance(point, this.routing.routes.get(hit.id)?.points || []) < 7 / this.camera.zoom) return hit;
    for (const hit of nodes) {
      const n = this.page.graph.nodes[hit.id], g = this.page.view.nodes[hit.id], margin = 6 / this.camera.zoom;
      if (isContainer(this.doc, n) && contains(inflate(g, margin), point) && (point.y < g.y + 38 || point.x < g.x + margin || point.x > g.x + g.w - margin || point.y > g.y + g.h - margin)) return hit;
    }
    return null;
  }
  findPort(point, anyNode = false) {
    const hits = this.index.query(inflate({ ...point, w: 0, h: 0 }, 13 / this.camera.zoom)).filter(h => h.kind === 'node').reverse();
    for (const hit of hits) {
      const n = this.page.graph.nodes[hit.id], g = this.page.view.nodes[hit.id]; if (isLocked(this.page, n.id)) continue;
      const ports = getPorts(this.doc, n, g); if (!ports.length) continue;
      const nearest = ports.reduce((a, b) => distance(a, point) < distance(b, point) ? a : b);
      if (distance(nearest, point) < 13 / this.camera.zoom || anyNode && contains(g, point)) return { nodeId: n.id, port: nearest.id, point: nearest };
    }
    return null;
  }
  selectedHandle(point) {
    if (this.selection.size !== 1) return null; const id = [...this.selection][0]; if (isLocked(this.page, id)) return null;
    const g = this.page.view.nodes[id];
    const edge = this.page.graph.edges[id];
    if (edge) {
      const route = this.routing.routes.get(id)?.points || [];
      for (const [endpoint, p] of [['from', route[0]], ['to', route.at(-1)]]) if (p && distance(point, p) < 8 / this.camera.zoom) return { kind: 'endpoint', id, endpoint };
      for (const [i, p] of (this.page.view.edges[id].waypoints || []).entries()) if (distance(point, p) < 8 / this.camera.zoom) return { kind: 'waypoint', id, index: i };
    }
    return null;
  }
  addShape(master, point) {
    let id; const m = getMaster(this.doc, master); const at = point || this.screenToWorld({ x: this.camera.width / 2, y: this.camera.height / 2 });
    let x = at.x - m.size[0] / 2, y = at.y - m.size[1] / 2;
    if (this.snap) { x = Math.round(x / 10) * 10; y = Math.round(y / 10) * 10; }
    const active = this.page.layers.find(l => l.id === this.activeLayer); if (active?.locked || !active?.visible) { this.ui.showToast('Choose a visible, unlocked layer before adding shapes.'); return; }
    this.transact(`Add ${m.name}`, () => { id = addNode(this.doc, this.page, master, x, y, { layerId: m.annotation && this.page.layers.some(l => l.id === 'annotations') ? 'annotations' : this.activeLayer }); assignParent(this.doc, this.page, id); });
    if (id && this.page.graph.nodes[id]) this.select([id]); return id;
  }
  requestFrame(sceneDirty = false) { this.sceneDirty ||= sceneDirty; if (!this.frame) this.frame = requestAnimationFrame(() => { this.frame = 0; this.render(); }); }
  render() {
    if (this.sceneDirty) {
      this.cullingBounds = this.visibleBounds(180 / this.camera.zoom); const visible = new Set(this.index.query(this.cullingBounds).map(h => h.id));
      this.renderer.setScene(buildScene(this.doc, this.page, this.routing.routes, visible), this.camera); this.sceneDirty = false;
    }
    this.renderer.draw(this.camera, this.page, this.grid); this.drawOverlay(); this.drawRulers(); if (this.minimap) this.drawMinimap();
    $('render-stats').textContent = `${this.renderer.cpuSubmitMs.toFixed(1)} ms CPU`; $('render-stats').title = 'CPU render submission time, not GPU execution time or FPS';
    $('empty-page').hidden = Object.keys(this.page.graph.nodes).length > 0;
  }
  drawOverlay() {
    const out = [], screen = p => this.worldToScreen(p), z = this.camera.zoom, selectionColor = '#8d62b7';
    const circle = (p, r, fill = '#ffffff', stroke = selectionColor) => { const s = screen(p); out.push(`<circle cx="${s.x}" cy="${s.y}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="1.3"/>`); };
    const rectangle = (g, stroke = selectionColor, dashed = false) => { const p = screen(g); out.push(`<rect x="${p.x}" y="${p.y}" width="${g.w * z}" height="${g.h * z}" rx="1" fill="none" stroke="${stroke}" stroke-width="1.2"${dashed ? ' stroke-dasharray="4 3"' : ''}/>`); };
    for (const id of this.selection) {
      const g = this.page.view.nodes[id], edge = this.page.graph.edges[id];
      if (g) {
        rectangle(inflate(geometryBounds(g), 3 / z), isLocked(this.page, id) ? '#a4aebd' : selectionColor);

      }
      if (edge) {
        const points = this.routing.routes.get(id)?.points || [];
        out.push(`<polyline points="${points.map(p => { const s = screen(p); return `${s.x},${s.y}`; }).join(' ')}" fill="none" stroke="${selectionColor}" stroke-width="3" stroke-opacity=".5" stroke-linejoin="round"/>`);
        if (points.length && !isLocked(this.page, id)) { circle(points[0], 5); circle(points.at(-1), 5); for (const p of this.page.view.edges[id].waypoints || []) { const s = screen(p); out.push(`<rect x="${s.x - 4}" y="${s.y - 4}" width="8" height="8" fill="#f1e7fc" stroke="${selectionColor}"/>`); } }
      }
    }
    if (this.selection.size > 1) { const b = selectionBounds(this.page, [...this.selection]); if (b) rectangle(inflate(b, 6 / z), '#a890bf', true); }
    const portIds = this.tool === 'connect' ? new Set([...this.selection, ...(this.hover?.kind === 'node' ? [this.hover.id] : [])]) : new Set();
    for (const id of portIds) {
      const n = this.page.graph.nodes[id]; if (!n || isLocked(this.page, id)) continue;
      for (const p of getPorts(this.doc, n, this.page.view.nodes[id])) circle(p, this.tool === 'connect' ? 4.2 : 3.2, '#ffffff', '#a282c1');
    }
    for (const guide of this.guideLines) {
      if (guide.axis === 'x') { const x = screen({ x: guide.value, y: 0 }).x; out.push(`<line x1="${x}" y1="0" x2="${x}" y2="${this.camera.height}" stroke="#ca83ba" stroke-width="1" stroke-dasharray="4 4"/>`); }
      else { const y = screen({ x: 0, y: guide.value }).y; out.push(`<line x1="0" y1="${y}" x2="${this.camera.width}" y2="${y}" stroke="#ca83ba" stroke-width="1" stroke-dasharray="4 4"/>`); }
    }
    if (this.drag?.kind === 'marquee') { const b = bounds([this.drag.start, this.drag.current]); const s = screen(b); out.push(`<rect x="${s.x}" y="${s.y}" width="${b.w * z}" height="${b.h * z}" fill="#a986c7" fill-opacity=".08" stroke="#a986c7" stroke-width="1" stroke-dasharray="4 3"/>`); }
    if (this.connectSource && this.connectPoint) {
      const source = this.page.graph.nodes[this.connectSource.nodeId]; const start = source && getPorts(this.doc, source, this.page.view.nodes[source.id]).find(p => p.id === this.connectSource.port);
      if (start) {
        const a = screen(start), b = screen(this.connectPoint), mid = (a.x + b.x) / 2;
        out.push(`<polyline points="${a.x},${a.y} ${mid},${a.y} ${mid},${b.y} ${b.x},${b.y}" fill="none" stroke="#9b6dbe" stroke-width="1.5" stroke-dasharray="5 4"/>`); circle(start, 5, '#eee4f9');
      }
      const port = this.findPort(this.connectPoint, true); if (port) circle(port.point, 7, '#e8f6f0', '#76ad97');
    }
    $('overlay').innerHTML = out.join('') + (this.editor?.overlay() || '');
  }
  drawRulers() {
    const c = this.camera, dpr = c.dpr; const desired = 100 / c.zoom; let major = 10 ** Math.floor(Math.log10(desired));
    if (desired / major >= 5) major *= 5; else if (desired / major >= 2) major *= 2;
    for (const horizontal of [true, false]) {
      const canvas = $(horizontal ? 'ruler-top' : 'ruler-left'), length = horizontal ? c.width : c.height, w = horizontal ? length : 21, h = horizontal ? 21 : length;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
      const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = '#f7f8fb'; ctx.fillRect(0, 0, w, h); ctx.strokeStyle = '#d5dce6'; ctx.fillStyle = '#a0aabb'; ctx.font = '8px Arial'; ctx.lineWidth = 1;
      const pan = horizontal ? c.x : c.y, start = Math.floor(-pan / c.zoom / (major / 5)) * (major / 5), end = (length - pan) / c.zoom;
      for (let value = start; value <= end; value += major / 5) { const pos = Math.round(value * c.zoom + pan) + .5, full = Math.abs(value % major) < .01;
        ctx.beginPath(); if (horizontal) { ctx.moveTo(pos, 21); ctx.lineTo(pos, full ? 12 : 17); if (full) ctx.fillText(String(+((value / (UNIT_SCALE[this.page.units || 'px'])) * (this.page.drawingScale || 1)).toFixed(2)), pos + 3, 10); }
        else { ctx.moveTo(21, pos); ctx.lineTo(full ? 12 : 17, pos); if (full) { ctx.save(); ctx.translate(9, pos + 3); ctx.rotate(-Math.PI / 2); ctx.fillText(String(+((value / (UNIT_SCALE[this.page.units || 'px'])) * (this.page.drawingScale || 1)).toFixed(2)), 0, 0); ctx.restore(); } } ctx.stroke();
      }
    }
  }
  drawMinimap() {
    const canvas = $('minimap'), ctx = canvas.getContext('2d'), p = this.page; const ext = p.canvasMode === 'infinite' ? contentBounds(p, null, this.routing.routes) || pageBounds(p) : pageBounds(p); const scale = Math.min(164 / Math.max(1, ext.w), 106 / Math.max(1, ext.h)), ox = (180 - ext.w * scale) / 2 - ext.x * scale, oy = (122 - ext.h * scale) / 2 - ext.y * scale;
    this.minimapTransform = { scale, ox, oy }; ctx.clearRect(0, 0, 180, 122); ctx.fillStyle = '#f4f6fa'; ctx.fillRect(0, 0, 180, 122); ctx.save(); ctx.translate(ox, oy); ctx.scale(scale, scale); ctx.fillStyle = '#fff'; ctx.fillRect(ext.x, ext.y, ext.w, ext.h);
    for (const n of Object.values(p.graph.nodes)) if (isVisible(p, n.id)) { const g = p.view.nodes[n.id]; ctx.fillStyle = g.fill === 'transparent' ? '#c9c1d4' : g.fill; ctx.strokeStyle = g.stroke === 'transparent' ? '#c9c1d4' : g.stroke; ctx.lineWidth = 1 / scale; ctx.fillRect(g.x, g.y, g.w, g.h); ctx.strokeRect(g.x, g.y, g.w, g.h); }
    ctx.strokeStyle = '#acbbc9'; ctx.lineWidth = 1 / scale;
    for (const [id, r] of this.routing.routes) if (isVisible(p, id)) { ctx.beginPath(); r.points.forEach((q, i) => i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)); ctx.stroke(); }
    const b = this.visibleBounds(); ctx.fillStyle = '#9064b015'; ctx.strokeStyle = '#a584bf'; ctx.lineWidth = 1.2 / scale; ctx.fillRect(b.x, b.y, b.w, b.h); ctx.strokeRect(b.x, b.y, b.w, b.h); ctx.restore();
  }
}
