import { getMaster, getPorts, isContainer } from '../core/stencils.js';
import { addEdge, descendants, isLocked, movementLockedIds, isVisible, assignParent, selectionBounds } from '../core/model.js';
import { solveConstraints, fitContainers } from '../core/layout.js';
import { bounds, inflate, contains, clamp, distance, round, pointSegmentDistance } from '../core/geometry.js';
import { labelForNode, FONT } from '../render/scene.js';
const editable = target => target instanceof Element && Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
function pathPosition(point, path) {
  let prefix = 0, bestDistance = Infinity, bestPosition = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], len = distance(a, b), d = pointSegmentDistance(point, a, b);
    const t = clamp(((point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y)) / (len * len || 1), 0, 1);
    if (d < bestDistance) { bestDistance = d; bestPosition = prefix + t * len; } prefix += len;
  }
  return bestPosition;
}
export function installInteractions(a) {
  const stage = document.getElementById('stage'), pointers = new Map(); let pinch = null, space = false, activePointer = null;
  const capture = e => { activePointer = e.pointerId; try { stage.setPointerCapture(e.pointerId); } catch {} };
  function cancel() {
    a.editor?.cancel(); if (a.store.pending) a.store.cancel(); a.drag = null; a.connectPoint = null; a.connectSource = null; a.guideLines = []; pinch = null; pointers.clear(); activePointer = null; a.requestFrame();
  }
  a.cancelInteraction = cancel;
  function portEndpoint(p) { return { nodeId: p.nodeId, port: p.port }; }
  stage.addEventListener('pointerdown', e => {
    if (e.target.closest('button,textarea,#minimap')) return;
    if (e.pointerType === 'touch') {
      pointers.set(e.pointerId, a.pointerPosition(e));
      if (pointers.size === 2) {
        a.editor?.cancel(); if (a.store.pending) a.store.cancel(); a.drag = null; a.connectSource = null;
        const ps = [...pointers.values()], middle = { x: (ps[0].x + ps[1].x) / 2, y: (ps[0].y + ps[1].y) / 2 };
        pinch = { distance: distance(ps[0], ps[1]), zoom: a.camera.zoom, anchor: a.screenToWorld(middle) }; capture(e); return;
      }
    }
    if (pinch || a.drag) return;
    a.finishLabelEdit?.(); stage.focus({ preventScroll: true }); e.preventDefault();
    const screen = a.pointerPosition(e), world = a.screenToWorld(screen); capture(e);
    if (e.button === 1 || e.button === 2 || space || a.tool === 'hand') {
      a.drag = { kind: 'pan', screen, camera: { x: a.camera.x, y: a.camera.y } }; stage.style.cursor = 'grabbing'; return;
    }
    if (a.editor.down(e, world)) return;
    const handle = a.selectedHandle(world);
    if (handle) {
      a.store.begin(handle.kind === 'resize' ? 'Resize shape' : handle.kind === 'waypoint' ? 'Move connector waypoint' : 'Reconnect endpoint');
      a.drag = { ...handle, start: world, original: structuredClone(a.page.view.nodes[handle.id] || a.page.view.edges[handle.id]) };
      if (handle.kind === 'endpoint') { const edge = a.page.graph.edges[handle.id]; a.connectSource = { ...edge[handle.endpoint === 'from' ? 'to' : 'from'] }; a.connectPoint = world; }
      return;
    }
    const hit = a.hitTest(world), near = a.findPort(world, a.tool === 'connect');
    if (a.tool === 'connect') {
      const source = a.connectSource || near;
      if (source) { a.connectSource = portEndpoint(source); a.connectPoint = world; a.drag = { kind: 'connect', start: world, from: a.connectSource, fromClick: Boolean(a.connectSource && !near), keepTool: a.tool === 'connect' }; a.requestFrame(); }
      else a.ui.showToast('Start on a shape or one of its connection points.');
      return;
    }
    a.editor.normalDown(e, world, hit);
  });
  stage.addEventListener('pointermove', e => {
    const screen = a.pointerPosition(e), world = a.screenToWorld(screen);
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, screen);
    if (pinch && pointers.size >= 2) {
      const ps = [...pointers.values()], midpoint = { x: (ps[0].x + ps[1].x) / 2, y: (ps[0].y + ps[1].y) / 2 };
      a.camera.zoom = clamp(pinch.zoom * distance(ps[0], ps[1]) / Math.max(1, pinch.distance), .001, 4);
      a.camera.x = midpoint.x - pinch.anchor.x * a.camera.zoom; a.camera.y = midpoint.y - pinch.anchor.y * a.camera.zoom; a.cameraChanged(); return;
    }
    const drag = a.drag;
    if (drag && activePointer !== null && activePointer !== e.pointerId) return;
    if (a.editor.move(e, world)) return;
    if (!drag) {
      if (a.connectSource) { a.connectPoint = world; a.requestFrame(); }
      const hit = a.hitTest(world), changed = hit?.id !== a.hover?.id;
      a.hover = hit;
      const handle = a.editor.handlesAt(world) || a.selectedHandle(world), port = a.tool === 'connect' && a.findPort(world);
      stage.style.cursor = space || a.tool === 'hand' ? 'grab' : handle?.kind === 'edit-resize' ? `${handle.handle}-resize` : handle || port || a.tool === 'connect' ? 'crosshair' : hit?.kind === 'node' && !isLocked(a.page, hit.id) ? 'move' : hit ? 'pointer' : 'default';
      if (changed) a.requestFrame(); return;
    }
    if (drag.kind === 'pan') { a.camera.x = drag.camera.x + screen.x - drag.screen.x; a.camera.y = drag.camera.y + screen.y - drag.screen.y; a.cameraChanged(); return; }
    if (drag.kind === 'waypoint') {
      a.page.view.edges[drag.id].waypoints[drag.index] = { x: a.snap && !e.altKey ? Math.round(world.x / 10) * 10 : round(world.x), y: a.snap && !e.altKey ? Math.round(world.y / 10) * 10 : round(world.y) }; a.store.preview();
    } else if (drag.kind === 'connect' || drag.kind === 'endpoint') { a.connectPoint = world; a.requestFrame(); }
    else if (drag.kind === 'marquee') { drag.current = world; const box = bounds([drag.start, world]); a.select([...drag.previous, ...a.index.query(box).filter(hit => hit.kind === 'node' && !isContainer(a.doc, a.page.graph.nodes[hit.id])).map(hit => hit.id)]); a.requestFrame(); }
  });
  stage.addEventListener('pointerup', e => {
    pointers.delete(e.pointerId);
    if (pinch) { if (pointers.size < 2) pinch = null; a.drag = null; activePointer = null; return; }
    const drag = a.drag; if (!drag || activePointer !== e.pointerId) return;
    const world = a.screenToWorld(a.pointerPosition(e)); a.drag = null; activePointer = null; a.guideLines = [];
    try {
      if (a.editor.up(e, world, drag)) { /* Atomic drawing/transform completed. */ }
      else if (drag.kind === 'move') {
        if (drag.moved) { for (const id of drag.roots) assignParent(a.doc, a.page, id); fitContainers(a.doc, a.page); } a.store.commit();
      } else if (drag.kind === 'resize' || drag.kind === 'waypoint') a.store.commit();
      else if (drag.kind === 'connect') {
        const target = a.findPort(world, true);
        if (target && (target.nodeId !== drag.from.nodeId || target.port !== drag.from.port)) {
          let id; a.transact('Connect shapes', () => { id = addEdge(a.page, drag.from, portEndpoint(target)); }); a.connectSource = null; a.connectPoint = null; if (id) a.select([id]);
          if (!drag.keepTool) a.setTool('pointer'); else a.ui.setStatus('Connected. Choose the next source shape.');
        } else { a.connectSource = drag.from; a.connectPoint = world; a.ui.setStatus('Now click the target shape. Escape cancels.'); }
      } else if (drag.kind === 'endpoint') {
        const target = a.findPort(world, true);
        if (target) { a.page.graph.edges[drag.id][drag.endpoint] = portEndpoint(target); a.store.commit(); } else a.store.cancel();
        a.connectSource = null; a.connectPoint = null;
      }
    } catch (error) { a.store.cancel(); a.ui.showToast(error.message, true); }
    stage.style.cursor = a.tool === 'hand' ? 'grab' : a.tool === 'connect' ? 'crosshair' : 'default'; a.requestFrame();
  });
  stage.addEventListener('pointercancel', cancel);
  stage.addEventListener('lostpointercapture', () => { if (a.drag && activePointer !== null) cancel(); });
  stage.addEventListener('contextmenu', e => e.preventDefault());
  stage.addEventListener('wheel', e => {
    if (e.target.closest('textarea')) return; e.preventDefault();
    const factor = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? a.camera.height : 1;
    if (e.ctrlKey || e.metaKey || e.altKey) a.setZoom(a.camera.zoom * Math.exp(-e.deltaY * factor * .002), a.pointerPosition(e));
    else { a.camera.x -= (e.shiftKey ? e.deltaY : e.deltaX) * factor; a.camera.y -= (e.shiftKey ? e.deltaX : e.deltaY) * factor; a.cameraChanged(); }
  }, { passive: false });
  stage.addEventListener('dblclick', e => {
    if (e.target.closest('button,textarea,#minimap')) return; const point = a.screenToWorld(a.pointerPosition(e)); if (a.editor.doubleClick(e, point)) return; const hit = a.hitTest(point); if (!hit || isLocked(a.page, hit.id)) return;
    a.select([hit.id]);
    if (hit.kind === 'node') a.editLabel(hit.id);
    else {
      const route = a.routing.routes.get(hit.id)?.points || [];
      a.transact('Add connector waypoint', () => { const waypoints = a.page.view.edges[hit.id].waypoints; waypoints.push({ x: round(point.x), y: round(point.y) }); waypoints.sort((p, q) => pathPosition(p, route) - pathPosition(q, route)); });
      a.ui.showToast('Waypoint added. Drag its square handle to guide the route.');
    }
  });
  a.editLabel = id => {
    a.finishLabelEdit?.(); const node = a.page.graph.nodes[id], g = a.page.view.nodes[id]; if (!node || isLocked(a.page, id)) return;
    const label = labelForNode(a.doc, node, g), at = a.worldToScreen(label), editor = document.createElement('textarea'); editor.className = 'node-label-editor'; editor.setAttribute('aria-label', 'Edit shape label'); editor.value = node.label;
    Object.assign(editor.style, { left: `${at.x - 5}px`, top: `${at.y - 5}px`, width: `${Math.max(90, label.w * a.camera.zoom + 10)}px`, height: `${Math.max(40, label.h * a.camera.zoom + 14)}px`, fontSize: `${label.fontSize * a.camera.zoom}px`, fontFamily: FONT, fontWeight: label.weight, textAlign: label.align });
    stage.append(editor); editor.focus(); editor.select(); let finished = false;
    a.finishLabelEdit = (save = true) => {
      if (finished) return; finished = true; const value = editor.value.slice(0, 10000); editor.remove(); a.finishLabelEdit = null;
      if (save && value !== node.label) a.transact('Edit shape label', () => { a.page.graph.nodes[id].label = value; delete a.page.graph.nodes[id].richText; });
    };
    editor.addEventListener('blur', () => a.finishLabelEdit?.());
    editor.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); a.finishLabelEdit?.(false); stage.focus(); } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); a.finishLabelEdit?.(); stage.focus(); } });
  };
  document.addEventListener('dragstart', e => {
    const button = e.target.closest('[data-master]'); if (!button) return; e.dataTransfer.setData('application/x-nexora-stencil', button.dataset.master); e.dataTransfer.setData('text/plain', button.dataset.master); e.dataTransfer.effectAllowed = 'copy'; a.stencilDragging = true;
  });
  document.addEventListener('dragend', () => { setTimeout(() => a.stencilDragging = false, 100); document.getElementById('viewport').classList.remove('drop-target'); });
  stage.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('application/x-nexora-stencil')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; document.getElementById('viewport').classList.add('drop-target'); } });
  stage.addEventListener('dragleave', () => document.getElementById('viewport').classList.remove('drop-target'));
  stage.addEventListener('drop', e => { const master = e.dataTransfer.getData('application/x-nexora-stencil'); if (!master) return; e.preventDefault(); document.getElementById('viewport').classList.remove('drop-target'); a.addShape(master, a.screenToWorld(a.pointerPosition(e))); });
  document.getElementById('minimap').addEventListener('pointerdown', e => {
    e.stopPropagation(); const t = a.minimapTransform; if (!t) return; const r = e.target.getBoundingClientRect();
    const x = ((e.clientX - r.left) * 180 / r.width - t.ox) / t.scale, y = ((e.clientY - r.top) * 122 / r.height - t.oy) / t.scale;
    a.camera.x = a.camera.width / 2 - x * a.camera.zoom; a.camera.y = a.camera.height / 2 - y * a.camera.zoom; a.cameraChanged();
  });
  document.addEventListener('keydown', e => {
    if (document.getElementById('dialog').open) return;
    if (editable(e.target)) return;
    if (a.editor.key(e)) return;
    const mod = e.ctrlKey || e.metaKey, key = e.key.toLowerCase();
    if (mod) {
      const actions = { z: e.shiftKey ? 'redo' : 'undo', y: 'redo', c: 'copy', x: 'cut', v: 'paste', d: 'duplicate', a: 'select-all', s: 'save-project', o: 'open-project', '0': 'fit' };
      if (actions[key]) { e.preventDefault(); a.action(actions[key]); } return;
    }
    if (e.code === 'Space') { e.preventDefault(); space = true; stage.style.cursor = 'grab'; return; }
    if (e.key === 'Escape') { e.preventDefault(); cancel(); a.select([]); a.setTool('pointer'); return; }
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      e.preventDefault(); const d = e.shiftKey ? 10 : 1, dx = e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0, dy = e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0;
      const fixed = movementLockedIds(a.page);
      const ids = new Set([...a.selection].filter(id => a.page.graph.nodes[id] && !fixed.has(id))); [...ids].forEach(id => descendants(a.page, id).forEach(child => { if (!isLocked(a.page, child)) ids.add(child); }));
      if (ids.size) a.transact('Nudge shapes', () => { for (const id of ids) { a.page.view.nodes[id].x += dx; a.page.view.nodes[id].y += dy; } solveConstraints(a.page, ids); fitContainers(a.doc, a.page); }); return;
    }
    if (e.key === 'Enter' && a.selection.size === 1) { e.preventDefault(); a.editLabel([...a.selection][0]); return; }
    const actions = { v: 'tool-pointer', c: 'tool-connect', h: 'tool-hand', t: 'add-text', f: 'fit', delete: 'delete', backspace: 'delete', '+': 'zoom-in', '=': 'zoom-in', '-': 'zoom-out' };
    if (actions[key]) { e.preventDefault(); a.action(actions[key]); }
  });
  document.addEventListener('keyup', e => { if (e.code === 'Space') { space = false; stage.style.cursor = a.tool === 'hand' ? 'grab' : 'default'; } });
  window.addEventListener('blur', () => { space = false; if (a.drag) cancel(); });
}
