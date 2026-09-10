/** Drawing, selection transforms, and page commands share the document transaction engine. */
import { compoundGeometry, pathContours, DRAW_TOOLS, DRAW_STYLE, handlePoints, pathControls, pathGeometry, flattenPath, simplifyPath, constrainPoint, resizeGeometry, rotatePoint, strokeDash, geometryBounds } from '../core/drawing.js';
import { selectionBox, editableSelection, captureSelection, translateSelection, resizeSelection, rotateSelection, flipSelection, groupSelection, ungroupSelection, groupRoot, selectInArea } from '../core/editing.js';
import { addNode, isLocked, isVisible, assignParent, descendants, assertDocument } from '../core/model.js';
import { getMaster, isContainer, validateStyle } from '../core/stencils.js';
import { fitContainers, solveConstraints } from '../core/layout.js';
import { PAGE_PRESETS, UNIT_SCALE, pageBounds, contentBounds, fitPageToContent } from '../core/page.js';
import { bounds, distance, contains, pointSegmentDistance, clamp, inflate } from '../core/geometry.js';
import { exportSVG, exportScene } from '../core/export-svg.js';
import { downloadText } from '../core/persistence.js';
import { esc } from './icons.js';
const $ = id => document.getElementById(id);
const names = { line: 'Line', arrow: 'Arrow', rectangle: 'Rectangle', ellipse: 'Ellipse', polyline: 'Polyline', polygon: 'Polygon', pencil: 'Freehand', arc: 'Arc', bezier: 'Bézier', circlearc:'Circular arc' };
const symbols = { line: '╱', arrow: '↗', rectangle: '▭', ellipse: '◯', polyline: '⌁', polygon: '⬠', pencil: '✎', arc: '⌒', bezier: '∿', circlearc:'◔' };
export function drawingRibbon(a) {
  return `<div class="ribbon-group"><div class="ribbon-items drawing-tools">${DRAW_TOOLS.map(tool => `<button class="tool-button small${a.tool === tool ? ' active' : ''}" data-action="tool-${tool}" title="${names[tool]}" aria-pressed="${a.tool === tool}"><span class="drawing-symbol" aria-hidden="true">${symbols[tool]}</span><span>${names[tool]}</span></button>`).join('')}</div><div class="group-label">Draw · Shift constrains · Escape cancels</div></div><div class="ribbon-group"><div class="ribbon-items"><div class="ribbon-stack"><button class="tool-button small" data-action="edit-points">Edit points</button><button class="tool-button small" data-action="close-path">Open / close path</button></div><div class="ribbon-stack"><button class="tool-button small" data-action="group">Group</button><button class="tool-button small" data-action="ungroup">Ungroup</button></div><div class="ribbon-stack"><button class="tool-button small" data-action="select-all">Select all</button><button class="tool-button small" data-action="tool-lasso">Lasso select</button></div></div><div class="group-label">Edit and select</div></div><div class="ribbon-group"><div class="ribbon-items"><div class="ribbon-stack"><button class="tool-button small" data-action="page-setup">Page setup</button><button class="tool-button small" data-action="fit-content">Fit page to drawing</button></div></div><div class="group-label">Fixed · Auto-size · Infinite</div></div>`;
}
const selectField = (key, label, values, current) => `<label class="field"><span>${label}</span><select data-draw-style="${key}" aria-label="${label}">${values.map(value => `<option value="${value}"${value === current ? ' selected' : ''}>${value}</option>`).join('')}</select></label>`;
export function drawingInspector(a) {
  const id = [...a.selection][0], node = a.page.graph.nodes[id], g = a.page.view.nodes[id] || a.page.view.edges[id] || a.drawStyle, s = { ...DRAW_STYLE, ...g };
  return `<section class="property-section drawing-properties"><div class="section-title">${a.selection.size ? 'Stroke & transform' : 'Drawing defaults'}</div><div class="property-grid"><label class="field"><span>Stroke color</span><input type="color" aria-label="Drawing stroke color" data-draw-style="stroke" value="${/^#[\da-f]{6}$/i.test(s.stroke) ? s.stroke : '#456a91'}"></label><label class="field"><span>Fill color</span><input type="color" aria-label="Drawing fill color" data-draw-style="fill" value="${/^#[\da-f]{6}$/i.test(s.fill) ? s.fill : '#dcecff'}"></label><label class="field"><span>Line weight</span><input type="number" min="0" max="64" step=".5" data-draw-style="strokeWidth" aria-label="Line weight" value="${s.strokeWidth}"></label><label class="field"><span>Opacity</span><input type="number" min="0" max="1" step=".05" data-draw-style="opacity" aria-label="Opacity" value="${s.opacity}"></label>${selectField('dash', 'Line pattern', ['solid', 'dash', 'dot', 'dashdot'], g.dash || (g.dashed ? 'dash' : 'solid'))}${selectField('lineCap', 'Line cap', ['round', 'butt', 'square'], s.lineCap)}${selectField('lineJoin', 'Line join', ['round', 'bevel', 'miter'], s.lineJoin)}${selectField('startArrow', 'Start marker', ['none', 'triangle', 'open', 'diamond', 'circle'], s.startArrow)}${selectField('endArrow', 'End marker', ['none', 'triangle', 'open', 'diamond', 'circle'], g.endArrow || (a.page.graph.edges[id] ? 'triangle' : s.endArrow))}</div><div class="drawing-command-row"><button data-action="no-fill">No fill</button><button data-action="no-stroke">No stroke</button><button data-action="copy-format">Copy format</button><button data-action="paste-format">Paste format</button></div>${a.selection.size ? `<div class="drawing-command-row"><button data-action="rotate-left">↶ 90°</button><button data-action="rotate-right">↷ 90°</button><button data-action="flip-x">Flip H</button><button data-action="flip-y">Flip V</button><button data-action="send-back">Send back</button><button data-action="bring-front">Bring front</button><button data-action="lock-selection">Lock</button><button data-action="unlock-selection">Unlock</button></div>${node && !isContainer(a.doc, node) ? `<label class="field"><span>Rotation (degrees)</span><input type="number" min="0" max="360" data-draw-style="rotation" value="${g.rotation || 0}" aria-label="Rotation"></label>` : ''}${node?.master === 'path' ? '<div class="drawing-command-row"><button data-action="edit-points">Edit points</button><button data-action="insert-point">Insert point</button><button data-action="delete-point">Delete point</button><button data-action="close-path">Open / close</button></div>' : ''}` : ''}<p class="subtle-note">Drag side grips for one-axis resizing. Shift preserves proportions; Alt resizes around the center. Select a line to adjust its endpoints.</p></section>`;
}
export function installDrawing(a) {
  a.drawStyle = { ...DRAW_STYLE }; a.extraActions = {}; let draft = null, pointEdit = false, pointIndex = -1, lastPoint = null, panFrame = 0, pointerEvent = null;
  const notify = error => a.ui.showToast(error.message || String(error), true);
  const snapshot = () => captureSelection(a.page, a.selection, a.routing.routes);
  const snap = (p, e = {}) => a.snap && !e.altKey ? { x: Math.round(p.x / (a.page.gridSize || 10)) * (a.page.gridSize || 10), y: Math.round(p.y / (a.page.gridSize || 10)) * (a.page.gridSize || 10) } : { x: p.x, y: p.y };
  const selectedPath = () => a.selection.size === 1 && a.page.graph.nodes[[...a.selection][0]]?.master === 'path' ? [...a.selection][0] : null;
  const selectionGeometry = () => {
    const ids = editableSelection(a.page, a.selection); if (!ids.length) return null;
    if (ids.length === 1 && a.page.view.nodes[ids[0]]) return a.page.view.nodes[ids[0]];
    return selectionBox(a.page, ids, a.routing.routes);
  };
  const minimum = id => ['path', 'rectangle', 'ellipse', 'group'].includes(a.page.graph.nodes[id]?.master) ? 1 : 24;
  const canRotateIds = ids => [...ids].every(id => !a.page.graph.nodes[id] || !isContainer(a.doc, a.page.graph.nodes[id]) || a.page.graph.nodes[id].master === 'group');
  const canRotate = snap => canRotateIds(snap.nodes.keys());
  const selectionCanRotate = () => canRotateIds([...a.selection].flatMap(id => [id, ...descendants(a.page, id)]));
  const finishTransform = () => { fitContainers(a.doc, a.page); if (a.maintainConstraints) solveConstraints(a.page, new Set(a.drag?.snapshot?.roots || [])); };
  function finishDraw(points, mode = 'linear', closed = false, tool = 'line', samples = null) {
    const layer = a.page.layers.find(l => l.id === a.activeLayer); if (!layer?.visible || layer.locked) throw new Error('Choose a visible, unlocked layer to draw.');
    if (points.length < 2 || distance(points[0], points.at(-1)) < .05 && !closed && points.length === 2) return;
    let id;
    a.store.transact(`Draw ${names[tool] || tool}`, () => {
      const style = { ...a.drawStyle, endArrow: tool === 'arrow' ? 'triangle' : a.drawStyle.endArrow };
      if (tool === 'rectangle' || tool === 'ellipse') {
        const b = bounds(points); id = addNode(a.doc, a.page, tool, b.x, b.y, { label: '', layerId: a.activeLayer, geometry: { ...style, w: Math.max(1, b.w), h: Math.max(1, b.h) } });
      } else id = addNode(a.doc, a.page, 'path', 0, 0, { label: '', layerId: a.activeLayer, geometry: { ...style, ...pathGeometry(points, mode, closed) } });
      if(samples && tool==='pencil') { const g=a.page.view.nodes[id];g.pressures=samples.pressures;g.tilts=samples.tilts;g.ink={...(a.inkStyle||{thinning:.85,gamma:1})}; }
      assignParent(a.doc, a.page, id); fitContainers(a.doc, a.page);
    });
    a.select([id]); return id;
  }
  function finishDraft() {
    if (!draft) return; const d = draft; draft = null; a.requestFrame();
    if (d.tool === 'polygon' && d.points.length < 3) throw new Error('A polygon requires at least three points.');
    finishDraw(d.points, d.tool==='circlearc'?'circular':'linear', d.tool === 'polygon', d.tool);
  }
  function drawPoints(d, current) {
    const p = d.start, q = current, dx = q.x - p.x, dy = q.y - p.y;
    if (d.tool === 'arc') return [p, { x: (p.x + q.x) / 2 - dy * .55, y: (p.y + q.y) / 2 + dx * .55 }, q];
    if (d.tool === 'bezier') return [p, { x: p.x + dx / 3 - dy / 2, y: p.y + dy / 3 + dx / 2 }, { x: p.x + 2 * dx / 3 + dy / 2, y: p.y + 2 * dy / 3 - dx / 2 }, q];
    if (d.tool === 'pencil') return d.points;
    return [p, q];
  }
  function handlesAt(p) {
    if (a.tool !== 'pointer') return null; const id = selectedPath(), g = selectionGeometry(); if (!g) return null;
    if (id && !isLocked(a.page, id)) {
      const points = pathControls(a.page.view.nodes[id]);
      for (const [index, point] of points.entries()) if ((pointEdit || index === 0 || index === points.length - 1) && distance(p, point) < 10 / a.camera.zoom) return { kind: 'edit-point', id, index };
    }
    if (a.selection.size === 1 && a.page.graph.edges[[...a.selection][0]]) return null;
    for (const point of handlePoints(g)) if (distance(p, point) < 9 / a.camera.zoom) return { kind: 'edit-resize', handle: point.name };
    const center = { x: g.x + g.w / 2, y: g.y + g.h / 2 }, rotate = rotatePoint({ x: center.x, y: g.y - 30 / a.camera.zoom }, center, g.rotation || 0);
    if (distance(p, rotate) < 10 / a.camera.zoom && selectionCanRotate()) return { kind: 'edit-rotate' };
    return null;
  }
  function beginHandle(h, e, p) {
    const s = snapshot(); a.store.begin(h.kind === 'edit-point' ? 'Edit path point' : h.kind === 'edit-rotate' ? 'Rotate selection' : 'Resize selection');
    const g = structuredClone(selectionGeometry()); a.drag = { ...h, start: p, snapshot: s, original: g, changed: false };
    if (h.kind === 'edit-point') { a.drag.points = pathControls(a.page.view.nodes[h.id]); a.drag.pathOriginal = structuredClone(a.page.view.nodes[h.id]); pointIndex = h.index; }
    return true;
  }
  function autoPan() {
    panFrame = 0; const d = a.drag, e = pointerEvent;
    if (!d?.kind?.startsWith('edit-') || !e) return;
    const s = a.pointerPosition(e), margin = 28;
    const speed = (value, end) => value < margin ? Math.min(18, (margin - value) / 3) : value > end - margin ? -Math.min(18, (value - end + margin) / 3) : 0;
    const dx = speed(s.x, a.camera.width), dy = speed(s.y, a.camera.height);
    if (dx || dy) { a.camera.x += dx; a.camera.y += dy; a.cameraChanged(); move(e, a.screenToWorld(s), false); }
    panFrame = requestAnimationFrame(autoPan);
  }
  function move(e, world, schedule = true) {
    lastPoint = world; if (draft) { draft.current = constrainPoint(draft.points.at(-1), snap(world, e), e.shiftKey); a.requestFrame(); }
    const d = a.drag; if (!d?.kind?.startsWith('edit-')) return false;
    if (schedule) { pointerEvent = e; if (!panFrame) panFrame = requestAnimationFrame(autoPan); }
    try {
      if (d.kind === 'edit-draw') {
        d.current = constrainPoint(d.start, d.tool === 'pencil' ? world : snap(world, e), e.shiftKey);
        if (d.tool === 'rectangle' || d.tool === 'ellipse') {
          if (e.shiftKey) { const dx = d.current.x - d.start.x, dy = d.current.y - d.start.y, side = Math.max(Math.abs(dx), Math.abs(dy)); d.current = { x: d.start.x + Math.sign(dx || 1) * side, y: d.start.y + Math.sign(dy || 1) * side }; }
        }
        if (d.tool === 'pencil') { const events=schedule && typeof e.getCoalescedEvents==='function'?e.getCoalescedEvents():[]; for(const event of events.length?events:[e]) {const at=a.screenToWorld(a.pointerPosition(event)),pressure=event.pointerType==='pen'?Math.max(0,Math.min(1,event.pressure||0)):.5; if(d.points.length<2000 && (distance(d.points.at(-1),at)*a.camera.zoom>.6 || Math.abs(d.pressures.at(-1)-pressure)>.03)) {d.points.push(at);d.pressures.push(pressure);d.tilts.push({x:event.tiltX||0,y:event.tiltY||0});} } }
        a.requestFrame(); return true;
      }
      if (d.kind === 'edit-marquee') {
        d.current = world;
        if (d.lasso && distance(d.points.at(-1), world) * a.camera.zoom > 3 && d.points.length < 2048) d.points.push({ ...world });
        a.select([...d.previous, ...selectInArea(a.page, bounds([d.start, world]), { crossing: world.x < d.start.x, lasso: d.lasso && d.points.length > 2 ? d.points : null, routes: a.routing.routes })]); a.requestFrame(); return true;
      }
      if (d.kind === 'edit-move') {
        let dx = world.x - d.start.x, dy = world.y - d.start.y;
        if (!d.changed && Math.hypot(dx, dy) * a.camera.zoom < 3) return true;
        if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
        if (a.snap && !e.altKey) { const step = a.page.gridSize || 10; dx = Math.round(dx / step) * step; dy = Math.round(dy / step) * step; }
        a.guideLines = [];
        if (a.guides && !e.altKey && d.snapshot.nodes.size) {
          const anchor = d.snapshot.nodes.get(d.snapshot.roots[0]), moved = { ...geometryBounds(anchor), x: geometryBounds(anchor).x + dx, y: geometryBounds(anchor).y + dy };
          let bestX = 7 / a.camera.zoom, bestY = bestX, offsetX = 0, offsetY = 0, gx = null, gy = null;
          for (const hit of a.index.query(inflate(moved, 90))) {
            if (hit.kind !== 'node' || d.snapshot.nodes.has(hit.id) || isContainer(a.doc, a.page.graph.nodes[hit.id])) continue;
            const g = geometryBounds(a.page.view.nodes[hit.id]);
            for (const target of [g.x, g.x + g.w / 2, g.x + g.w]) for (const x of [moved.x, moved.x + moved.w / 2, moved.x + moved.w]) if (Math.abs(target - x) < bestX) { bestX = Math.abs(target - x); offsetX = target - x; gx = target; }
            for (const target of [g.y, g.y + g.h / 2, g.y + g.h]) for (const y of [moved.y, moved.y + moved.h / 2, moved.y + moved.h]) if (Math.abs(target - y) < bestY) { bestY = Math.abs(target - y); offsetY = target - y; gy = target; }
          }
          if (!e.shiftKey || dx !== 0) { dx += offsetX; if (gx !== null) a.guideLines.push({ axis: 'x', value: gx }); }
          if (!e.shiftKey || dy !== 0) { dy += offsetY; if (gy !== null) a.guideLines.push({ axis: 'y', value: gy }); }
        }
        translateSelection(a.page, d.snapshot, clamp(dx, -900000, 900000), clamp(dy, -900000, 900000));
      } else if (d.kind === 'edit-resize') {
        const ids = [...d.snapshot.nodes.keys()], single = ids.length === 1 && a.page.graph.nodes[ids[0]].master !== 'group';
        const target = resizeGeometry(d.original, d.handle, snap(world, e), { minimum: single ? minimum(ids[0]) : 1, proportional: e.shiftKey || !single && ids.some(id => d.snapshot.nodes.get(id).rotation), centered: e.altKey });
        if (single) Object.assign(a.page.view.nodes[ids[0]], target);
        else {
          const sx = target.w / Math.max(1, d.snapshot.box.w), sy = target.h / Math.max(1, d.snapshot.box.h);
          if (ids.some(id => d.snapshot.nodes.get(id).w * sx < minimum(id) || d.snapshot.nodes.get(id).h * sy < minimum(id))) return true;
          resizeSelection(a.page, d.snapshot, target);
        }
      } else if (d.kind === 'edit-rotate') {
        const g = d.original, center = { x: g.x + g.w / 2, y: g.y + g.h / 2 };
        let angle = (Math.atan2(world.y - center.y, world.x - center.x) - Math.atan2(d.start.y - center.y, d.start.x - center.x)) * 180 / Math.PI;
        if (e.shiftKey) angle = Math.round(angle / 15) * 15; rotateSelection(a.page, d.snapshot, angle);
      } else if (d.kind === 'edit-point') {
        const points = d.points.map(p => ({ ...p })); points[d.index] = constrainPoint(d.points[d.index === 0 ? points.length - 1 : d.index - 1], snap(world, e), e.shiftKey);
        const g=a.page.view.nodes[d.id];if(d.pathOriginal.pathMode==='compound'){const rings=pathContours(d.pathOriginal);let at=d.index;for(const ring of rings){if(at<ring.length){ring[at]=points[d.index];break;}at-=ring.length;}Object.assign(g,compoundGeometry(rings));}else Object.assign(g, pathGeometry(points, d.pathOriginal.pathMode, d.pathOriginal.closed));
      }
      d.changed = true; finishTransform(); a.store.preview();
    } catch (error) { notify(error); a.cancelInteraction(); }
    return true;
  }
  function up(e, world, d) {
    if (!d?.kind?.startsWith('edit-')) return false;
    cancelAnimationFrame(panFrame); panFrame = 0; pointerEvent = null;
    try {
      if (d.kind === 'edit-draw') {
        if (distance(d.start, d.current) * a.camera.zoom < 2 && d.points.length < 3) return true;
        const points = d.tool === 'pencil' ? d.points : drawPoints(d, d.current);
        finishDraw(points, d.tool === 'arc' ? 'quadratic' : d.tool === 'bezier' ? 'cubic' : 'linear', false, d.tool, d.tool==='pencil'?{pressures:d.pressures,tilts:d.tilts}:null);
      } else if (d.kind !== 'edit-marquee') {
        if (d.kind === 'edit-move' && d.changed) for (const id of d.snapshot.roots) assignParent(a.doc, a.page, id);
        finishTransform(); if (d.changed) a.store.commit(); else a.store.cancel();
      }
    } catch (error) { if (a.store.pending) a.store.cancel(); notify(error); }
    a.requestFrame(); return true;
  }
  function down(e, world) {
    if (DRAW_TOOLS.includes(a.tool)) {
      const p = a.tool === 'pencil' ? world : snap(world, e);
      if (['polyline', 'polygon', 'circlearc'].includes(a.tool)) {
        if (!draft) draft = { tool: a.tool, points: [p], current: p };
        else if (draft.points.length > 2 && distance(p, draft.points[0]) * a.camera.zoom < 10) { try { draft.tool = 'polygon'; finishDraft(); } catch (error) { notify(error); } }
        else if (distance(p, draft.points.at(-1)) * a.camera.zoom > 2) {
          if (draft.points.length >= 4096) { notify('A path supports at most 4096 points.'); return true; }
          draft.points.push(constrainPoint(draft.points.at(-1), p, e.shiftKey)); draft.current = p;if(draft.tool==='circlearc' && draft.points.length===3){try{finishDraft();}catch(error){notify(error);}}
        }
        a.requestFrame(); return true;
      }
      a.drag = { kind: 'edit-draw', tool: a.tool, start: p, current: p, points: [p], pressures:[e.pointerType==='pen'?Math.max(0,Math.min(1,e.pressure||0)):.5],tilts:[{x:e.tiltX||0,y:e.tiltY||0}] }; return true;
    }
    if (a.tool === 'lasso') { a.drag = { kind: 'edit-marquee', lasso: true, start: world, current: world, points: [world], previous: e.shiftKey ? [...a.selection] : [] }; return true; }
    const handle = handlesAt(world); if (handle) return beginHandle(handle, e, world);
    return false;
  }
  function startMove(e, world, hit) {
    let id = hit?.id; if (id && !e.ctrlKey && !e.metaKey) id = groupRoot(a.page, id);
    if (id) {
      if (e.shiftKey) { const selected = new Set(a.selection); selected.has(id) ? selected.delete(id) : selected.add(id); a.select([...selected]); if (!selected.has(id)) return; }
      else if (!a.selection.has(id)) a.select([id]);
    }
    const s = snapshot(); if (!s.nodes.size && !s.edges.size) { a.ui.setStatus('The selection is locked.'); return; }
    a.store.begin('Move selection'); a.drag = { kind: 'edit-move', start: world, snapshot: s, changed: false }; $('stage').style.cursor = 'move';
  }
  function normalDown(e, world, hit) {
    const box = selectionBox(a.page, a.selection, a.routing.routes);
    if (hit || !e.shiftKey && a.selection.size > 1 && box && contains(box, world)) startMove(e, world, hit);
    else { const previous = e.shiftKey ? [...a.selection] : []; if (!e.shiftKey) a.select([]); a.drag = { kind: 'edit-marquee', start: world, current: world, points: [world], previous }; a.requestFrame(); }
  }
  function applyStyle(patch) {
    const s = { ...a.drawStyle, ...patch }; validateStyle(s); a.drawStyle = s;
    const ids = editableSelection(a.page, a.selection);
    if (ids.length) a.store.transact('Format selection', () => {
      for (const id of ids) {
        const g = a.page.view.nodes[id] || a.page.view.edges[id];
        if ('rotation' in patch && (!a.page.graph.nodes[id] || isContainer(a.doc, a.page.graph.nodes[id]))) continue;
        Object.assign(g, patch); if ('dash' in patch) g.dashed = false;
      }
    }); else a.ui.renderInspector();
  }
  function transformSelection(label, transform) {
    const s = snapshot(); if (!s.nodes.size) throw new Error('Select editable shapes first.');
    if (!canRotate(s)) throw new Error('Ungroup or select individual shapes to rotate or flip a layout container.');
    a.store.transact(label, () => { transform(a.page, s); fitContainers(a.doc, a.page); });
  }
  const cmd = a.extraActions;
  for (const tool of [...DRAW_TOOLS, 'lasso']) cmd[`tool-${tool}`] = () => a.setTool(tool);
  Object.assign(cmd, {
    group: () => { let id; a.store.transact('Group selection', () => { id = groupSelection(a.doc, a.page, a.selection, a.activeLayer); }); a.select([id]); },
    ungroup: () => { let ids; a.store.transact('Ungroup selection', () => { ids = ungroupSelection(a.page, a.selection); }); a.select(ids); },
    'rotate-left': () => transformSelection('Rotate left', (p, s) => rotateSelection(p, s, -90)),
    'rotate-right': () => transformSelection('Rotate right', (p, s) => rotateSelection(p, s, 90)),
    'flip-x': () => transformSelection('Flip horizontally', (p, s) => flipSelection(p, s, 'x')),
    'flip-y': () => transformSelection('Flip vertically', (p, s) => flipSelection(p, s, 'y')),
    'no-fill': () => applyStyle({ fill: 'none' }), 'no-stroke': () => applyStyle({ stroke: 'none' }),
    'copy-format': () => { const id = [...a.selection][0], g = a.page.view.nodes[id] || a.page.view.edges[id]; if (!g) throw new Error('Select a shape or connector.'); a.formatClipboard = Object.fromEntries(Object.keys(DRAW_STYLE).map(key => [key, g[key] ?? DRAW_STYLE[key]])); a.ui.showToast('Format copied.'); },
    'paste-format': () => { if (!a.formatClipboard) throw new Error('Copy a format first.'); applyStyle(a.formatClipboard); },
    'edit-points': () => { if (!selectedPath()) throw new Error('Select a drawing path first.'); a.setTool('pointer'); pointEdit = !pointEdit; a.requestFrame(); a.ui.setStatus('Drag point handles. Double-click a linear segment to insert a point.'); },
    'insert-point': () => insertPoint(lastPoint),
    'delete-point': () => {
      const id = selectedPath(); if (!id || isLocked(a.page, id)) throw new Error('Select an editable path.');
      const g = a.page.view.nodes[id], points = pathControls(g); if (g.pathMode !== 'linear' || points.length <= (g.closed ? 3 : 2)) throw new Error('Only extra vertices in linear paths can be deleted.');
      if (pointIndex < 0 || pointIndex >= points.length) throw new Error('Click a point handle first.'); points.splice(pointIndex, 1);
      a.store.transact('Delete path point', () => {Object.assign(g, pathGeometry(points, 'linear', g.closed));g.pressures?.splice(pointIndex,1);g.tilts?.splice(pointIndex,1);}); pointIndex = -1;
    },
    'close-path': () => { const id = selectedPath(); if (!id || isLocked(a.page, id)) throw new Error('Select an editable path.'); a.store.transact('Open or close path', () => { a.page.view.nodes[id].closed = !a.page.view.nodes[id].closed; }); },
    'send-back': () => a.store.transact('Send to back', () => { const min = Math.min(0, ...Object.values(a.page.view.nodes).map(g => g.z || 0)); editableSelection(a.page, a.selection).forEach((id, i) => { if (a.page.view.nodes[id]) a.page.view.nodes[id].z = min - a.selection.size + i; }); }),
    'lock-selection': () => a.store.transact('Lock selection', () => { for (const id of editableSelection(a.page, a.selection)) (a.page.graph.nodes[id] || a.page.graph.edges[id]).locked = true; }),
    'unlock-selection': () => a.store.transact('Unlock selection', () => { for (const id of a.selection) { const item = a.page.graph.nodes[id] || a.page.graph.edges[id]; if (item) item.locked = false; } }),
    'invert-selection': () => a.select(editableSelection(a.page, [...Object.keys(a.page.graph.nodes), ...Object.keys(a.page.graph.edges)]).filter(id => !a.selection.has(id))),
    'page-setup': () => pageSetup(a),
    'fit-content': () => { a.store.transact('Fit page to drawing', () => fitPageToContent(a.page, 40, a.routing.routes)); a.fitPage(); },
    'fit-drawing': () => a.fitBounds(contentBounds(a.page, null, a.routing.routes)),
    'page-left': () => movePage(-1), 'page-right': () => movePage(1),
    'export-selection': async () => { await a.routing.flush(a.doc, a.page); if (!a.selection.size) throw new Error('Select objects to export.'); downloadText('Nexora-selection.svg', exportSVG(a.doc, a.page, a.routing.routes, { ids: a.selection }), 'image/svg+xml'); },
    'export-png': () => exportPNG(a),
    'print-page': () => printPage(a),
    'find-shape': () => a.ui.prompt('Find shapes', '', query => { const q = query.toLowerCase(), ids = Object.values(a.page.graph.nodes).filter(n => isVisible(a.page, n.id) && (n.label.toLowerCase().includes(q) || JSON.stringify(n.data).toLowerCase().includes(q))).map(n => n.id); a.select(ids); if (ids.length) a.fitBounds(selectionBox(a.page, ids)); else a.ui.showToast('No matching shapes.'); }, 'Label or data contains'),
  });
  function movePage(delta) { a.store.transact('Reorder page', () => { const index = a.doc.pageOrder.indexOf(a.pageId), next = clamp(index + delta, 0, a.doc.pageOrder.length - 1); a.doc.pageOrder.splice(index, 1); a.doc.pageOrder.splice(next, 0, a.pageId); }); }
  function insertPoint(p) {
    const id = selectedPath(); if (!id || isLocked(a.page, id)) throw new Error('Select an editable linear path.');
    const g = a.page.view.nodes[id], points = pathControls(g); if (g.pathMode !== 'linear' || points.length >= 4096) throw new Error('Curve control points are edited by dragging; vertices can only be added to linear paths.');
    let index = 1, best = Infinity; const count = points.length + (g.closed ? 1 : 0);
    for (let i = 1; i < count; i++) { const d = p ? pointSegmentDistance(p, points[i - 1], points[i % points.length]) : i; if (d < best) { best = d; index = i; } }
    const from = points[index - 1], to = points[index % points.length]; points.splice(index, 0, { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 });
    a.store.transact('Insert path point', () => {Object.assign(g, pathGeometry(points, 'linear', g.closed));if(g.pressures)g.pressures.splice(index,0,(g.pressures[index-1]+g.pressures[index%g.pressures.length])/2);if(g.tilts){const a=g.tilts[index-1],b=g.tilts[index%g.tilts.length];g.tilts.splice(index,0,{x:(a.x+b.x)/2,y:(a.y+b.y)/2});}}); pointEdit = true; pointIndex = index; a.requestFrame();
  }
  document.addEventListener('change', e => {
    const key = e.target.dataset.drawStyle; if (!key) return;
    try { const value = ['strokeWidth', 'opacity', 'rotation'].includes(key) ? Number(e.target.value) : e.target.value; applyStyle({ [key]: value }); } catch (error) { notify(error); a.ui.renderInspector(); }
  });
  a.editor = {
    down, normalDown, move, up, handlesAt,
    numericProperty(prop, value) {
      if (!['x', 'y', 'w', 'h'].includes(prop)) return false;
      const s = snapshot(), ids = [...s.nodes.keys()]; if (!ids.length) throw new Error('Select editable shapes to change geometry.');
      const single = ids.length === 1, first = s.nodes.get(ids[0]);
      a.store.transact(`Change ${prop}`, () => {
        if (prop === 'x' || prop === 'y') { const delta = value - (single ? first[prop] : s.box[prop]); translateSelection(a.page, s, prop === 'x' ? delta : 0, prop === 'y' ? delta : 0); }
        else if (single) a.page.view.nodes[ids[0]][prop] = value;
        else { if (ids.some(id => s.nodes.get(id).rotation)) throw new Error('Use proportional grips for a rotated multi-selection.'); resizeSelection(a.page, s, { ...s.box, [prop]: value }); }
        fitContainers(a.doc, a.page); if (a.maintainConstraints) solveConstraints(a.page, new Set(s.roots));
      }); return true;
    },
    cancel() { draft = null; cancelAnimationFrame(panFrame); panFrame = 0; pointerEvent = null; a.requestFrame(); },
    toolChanged() { draft = null; pointEdit = false; pointIndex = -1; },
    doubleClick(e, p) {
      if (draft) { try { finishDraft(); } catch (error) { notify(error); } return true; }
      if (DRAW_TOOLS.includes(a.tool)) return true;
      if (pointEdit && selectedPath()) { try { insertPoint(p); } catch (error) { notify(error); } return true; } return false;
    },
    key(e) {
      const mod = e.ctrlKey || e.metaKey, key = e.key.toLowerCase();
      if (draft && !mod && ['enter', 'backspace', 'escape'].includes(key)) { e.preventDefault(); try { if (key === 'enter') finishDraft(); else if (key === 'escape') { draft = null; a.requestFrame(); } else { draft.points.pop(); if (!draft.points.length) draft = null; a.requestFrame(); } } catch (error) { notify(error); } return true; }
      if (mod && (key === 'g' || key === 'f' || key === 'p')) { e.preventDefault(); a.action(key === 'g' ? e.shiftKey ? 'ungroup' : 'group' : key === 'f' ? 'find-shape' : 'print-page'); return true; }
      if (!mod && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        e.preventDefault(); const s = snapshot(), step = e.shiftKey ? a.page.gridSize || 10 : 1;
        if (s.nodes.size || s.edges.size) a.transact('Nudge selection', () => { translateSelection(a.page, s, e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0, e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0); fitContainers(a.doc, a.page); }); return true;
      }
      if (!mod && !e.altKey && { l: 'line', p: 'pencil', b: 'bezier', r: 'rectangle', e: 'ellipse' }[key]) { e.preventDefault(); a.setTool({ l: 'line', p: 'pencil', b: 'bezier', r: 'rectangle', e: 'ellipse' }[key]); return true; }
      return false;
    },
    overlay() {
      const out = [], screen = p => a.worldToScreen(p), line = (points, attrs = '') => { const ps = points.map(screen); out.push(`<polyline points="${ps.map(p => `${p.x},${p.y}`).join(' ')}" fill="none" stroke="#8055ad" stroke-width="1.5" ${attrs}/>`); }, dot = (p, type, label) => { const q = screen(p); out.push(`<${type === 'rotate' ? 'circle' : 'rect'} ${type === 'rotate' ? `cx="${q.x}" cy="${q.y}" r="5"` : `x="${q.x - 4}" y="${q.y - 4}" width="8" height="8" rx="1"`} data-grip="${label}" fill="white" stroke="#8055ad" stroke-width="1.5"/>`); };
      const d = a.drag;
      if (d?.kind === 'edit-draw') {
        let ps = drawPoints(d, d.current);
        if (d.tool === 'rectangle') { const b = bounds(ps); ps = [{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y }, { x: b.x + b.w, y: b.y + b.h }, { x: b.x, y: b.y + b.h }, { x: b.x, y: b.y }]; }
        else if (d.tool === 'ellipse') { const b = bounds(ps); ps = Array.from({ length: 65 }, (_, i) => ({ x: b.x + b.w / 2 + b.w / 2 * Math.cos(i / 32 * Math.PI), y: b.y + b.h / 2 + b.h / 2 * Math.sin(i / 32 * Math.PI) })); }
        else if (['arc', 'bezier'].includes(d.tool)) ps = flattenPath(pathGeometry(ps, d.tool === 'arc' ? 'quadratic' : 'cubic'));
        line(ps, 'stroke-dasharray="5 3"');
      }
      if (draft) { line([...draft.points, draft.current], 'stroke-dasharray="5 3"'); draft.points.forEach((p, i) => dot(p, 'point', `draft-${i}`)); }
      if (d?.kind === 'edit-marquee') { if (d.lasso) line([...d.points, d.points[0]], 'stroke-dasharray="4 3"'); else { const b = bounds([screen(d.start), screen(d.current)]); out.push(`<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="#8055ad12" stroke="#8055ad" stroke-dasharray="${d.current.x < d.start.x ? '5 3' : '0'}"/>`); } }
      const g = selectionGeometry(); if (!g || a.tool !== 'pointer') return out.join('');
      const id = selectedPath(); if (id) {
        const nodeGeometry=a.page.view.nodes[id],ps = pathControls(nodeGeometry); if (pointEdit) {if(nodeGeometry.pathMode==='compound')pathContours(nodeGeometry).forEach(r=>line([...r,r[0]],'stroke-dasharray="3 3"'));else line(ps, 'stroke-dasharray="3 3"');}
        ps.forEach((p, i) => { if (pointEdit || i === 0 || i === ps.length - 1) dot(p, 'point', `point-${i}`); });
      }
      if (a.selection.size === 1 && a.page.graph.edges[[...a.selection][0]]) return out.join('');
      const handles = handlePoints(g); line([handles[0], handles[2], handles[4], handles[6], handles[0]], 'stroke-dasharray="3 3"'); handles.forEach(p => dot(p, 'resize', p.name));
      if (selectionCanRotate()) { const center = { x: g.x + g.w / 2, y: g.y + g.h / 2 }, end = rotatePoint({ x: center.x, y: g.y - 30 / a.camera.zoom }, center, g.rotation || 0); line([handles[1], end]); dot(end, 'rotate', 'rotate'); }
      return out.join('');
    },
  };
}
export function pageSetup(a) {
  const p = a.page, units = p.units || 'px', unit = UNIT_SCALE[units];
  a.ui.dialog('Page & canvas setup', `<div class="property-grid"><label class="field"><span>Canvas mode</span><select id="page-mode">${['fixed', 'auto', 'infinite'].map(mode => `<option${mode === (p.canvasMode || 'fixed') ? ' selected' : ''}>${mode}</option>`).join('')}</select></label><label class="field"><span>Paper preset</span><select id="page-preset"><option value="">Custom</option>${Object.keys(PAGE_PRESETS).map(name => `<option>${name}</option>`).join('')}</select></label><label class="field"><span>Units</span><select id="page-units">${Object.keys(UNIT_SCALE).map(u => `<option${u === units ? ' selected' : ''}>${u}</option>`).join('')}</select></label><label class="field"><span>Orientation</span><select id="page-orientation"><option${p.width <= p.height ? ' selected' : ''}>portrait</option><option${p.width > p.height ? ' selected' : ''}>landscape</option></select></label><label class="field"><span>Width</span><input id="page-width" type="number" step="any" value="${+(p.width / unit).toFixed(3)}"></label><label class="field"><span>Height</span><input id="page-height" type="number" step="any" value="${+(p.height / unit).toFixed(3)}"></label><label class="field"><span>Grid spacing (document px)</span><input id="page-grid" type="number" min="1" max="1000" value="${p.gridSize || 10}"></label><label class="field"><span>Drawing scale (1 : n)</span><input id="page-scale" type="number" min=".001" max="1000000" step="any" value="${p.drawingScale || 1}"></label></div><p>Infinite mode has no paper edge; exports fit the drawing. Auto-size grows the page in every direction. Geometry remains in document pixels. Page dimensions support 200–100,000 document pixels.</p>`, () => {
    a.store.transact('Configure page', () => { const p = a.page; p.canvasMode = $('page-mode').value; p.units = $('page-units').value; p.width = Number($('page-width').value) * UNIT_SCALE[p.units]; p.height = Number($('page-height').value) * UNIT_SCALE[p.units]; p.gridSize = Number($('page-grid').value); p.drawingScale = Number($('page-scale').value); }); a.fitPage();
  });
  let previousUnit = unit;
  $('page-units').addEventListener('change', () => { const next = UNIT_SCALE[$('page-units').value]; for (const name of ['width', 'height']) $(`page-${name}`).value = +(Number($(`page-${name}`).value) * previousUnit / next).toFixed(4); previousUnit = next; });
  const preset = () => { const size = PAGE_PRESETS[$('page-preset').value]; if (size) { let [w, h] = size; if ($('page-orientation').value === 'landscape') [w, h] = [h, w]; const u = UNIT_SCALE[$('page-units').value]; $('page-width').value = +(w / u).toFixed(4); $('page-height').value = +(h / u).toFixed(4); } };
  $('page-preset').addEventListener('change', preset);
  $('page-orientation').addEventListener('change', () => { if ($('page-preset').value) preset(); else { const w = Number($('page-width').value), h = Number($('page-height').value); $('page-width').value = $('page-orientation').value === 'landscape' ? Math.max(w, h) : Math.min(w, h); $('page-height').value = $('page-orientation').value === 'landscape' ? Math.min(w, h) : Math.max(w, h); } });
}
export async function exportPNG(a) {
  await a.routing.flush(a.doc, a.page);
  const { box } = exportScene(a.doc, a.page, a.routing.routes), scale = Math.min(2, 8192 / Math.max(box.w, box.h), Math.sqrt(32000000 / (box.w * box.h)));
  const width = Math.max(1, Math.ceil(box.w * scale)), height = Math.max(1, Math.ceil(box.h * scale));
  const source = exportSVG(a.doc, a.page, a.routing.routes).replace(/(<svg[^>]*?)width="[^"]*" height="[^"]*"/, `$1width="${width}" height="${height}"`);
  const url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml' }));
  try {
    const image = new Image(); image.src = url; await image.decode(); const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; canvas.getContext('2d').drawImage(image, 0, 0, width, height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png')); if (!blob) throw new Error('The browser could not encode this image.');
    const download = URL.createObjectURL(blob), link = document.createElement('a'); link.href = download; link.download = 'Nexora-diagram.png'; link.click(); setTimeout(() => URL.revokeObjectURL(download), 30000);
  } finally { URL.revokeObjectURL(url); }
}
export async function printPage(a) {
  await a.routing.flush(a.doc, a.page);
  const frame = document.createElement('iframe'); frame.className = 'print-frame'; frame.title = 'Print diagram'; frame.setAttribute('aria-hidden', 'true');
  const svg = exportSVG(a.doc, a.page, a.routing.routes).replace(/<\?xml[^>]*\?>/, '');
  frame.srcdoc = `<!doctype html><html><head><title>Nexora Diagram</title><style>@page{margin:10mm}body{margin:0}svg{width:100%;height:auto;max-height:95vh}@media print{svg{max-height:95vh}}</style></head><body>${svg}</body></html>`;
  frame.addEventListener('load', () => { frame.contentWindow.focus(); frame.contentWindow.print(); }); document.body.append(frame); setTimeout(() => frame.remove(), 120000);
}
