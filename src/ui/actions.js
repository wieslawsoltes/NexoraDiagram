import { editableSelection, selectionBox } from '../core/editing.js';
import { createDocument, createPage, parseDocument, addNode, uid, removeItems, duplicateItems, isLocked, movementLockedIds, isVisible, descendants, selectionBounds, ancestors } from '../core/model.js';
import { createDemo } from '../core/template.js';
import { getMaster, allMasters, isContainer, validateMaster, SAMPLE_MASTER } from '../core/stencils.js';
import { addAlignment, addDistribution, autoLayout, solveConstraints, fitContainers, constraintResiduals } from '../core/layout.js';
import { validateDiagram } from '../core/validation.js';
import { parseCSV, bindCSV, downloadText } from '../core/persistence.js';
import { exportSVG } from '../core/export-svg.js';
import { clamp, round } from '../core/geometry.js';
import { esc, icon } from './icons.js';
const $ = id => document.getElementById(id);
export const SAMPLE_CSV = 'key,owner,status,sla,amount\r\nREQ01,Alex Morgan,Submitted,1 day,2450\r\nOPS01,Jordan Lee,In review,2 days,2450\r\nFIN01,Sam Patel,Awaiting approval,1 day,2450\r\n';
const basename = title => title.replace(/[^\p{L}\p{N}_ -]/gu, '').trim().replace(/\s+/g, '-').toLowerCase().slice(0, 80) || 'diagram';
export function installActions(a) {
  const selectedNodes = () => [...a.selection].filter(id => a.page.graph.nodes[id] && !isLocked(a.page, id));
  const selectedObjects = () => [...a.selection].filter(id => !isLocked(a.page, id));
  const requireSelection = () => { if (!selectedObjects().length) throw new Error('Select an editable shape or connector first.'); };
  const single = () => { if (a.selection.size !== 1) throw new Error('Select one shape or connector.'); const id = [...a.selection][0]; if (isLocked(a.page, id)) throw new Error('Unlock this layer before editing.'); return a.page.graph.nodes[id] || a.page.graph.edges[id]; };
  const setInspector = tab => { a.ui.inspectorTab = tab; a.ui.renderInspector(); if (window.innerWidth <= 950) $('inspector').classList.add('mobile-open'); else { $('inspector').classList.remove('collapsed'); document.querySelector('.workspace').classList.remove('hide-inspector'); } };
  const applyFill = color => { const ids = selectedNodes(); if (!ids.length) return a.ui.showToast('Select a shape to change its fill.'); a.transact('Change shape fill', () => ids.forEach(id => a.page.view.nodes[id].fill = color)); };
  const align = (mode, distribution = false) => {
    const ids = selectedNodes(); if (ids.some(id => ancestors(a.page, id).some(parent => ids.includes(parent)))) throw new Error('Align peer shapes, not a container and its own member.');
    a.store.transact(distribution ? 'Distribute shapes' : `Align ${mode}`, () => {
      const c = distribution ? addDistribution(a.page, ids, mode) : addAlignment(a.page, ids, mode);
      if (!a.maintainConstraints) a.page.constraints = a.page.constraints.filter(other => other.id !== c.id);
      fitContainers(a.doc, a.page);
    });
    a.ui.showToast(a.maintainConstraints ? 'Layout constraint applied. Release it in Design to move shapes independently.' : 'Shapes arranged.');
  };
  function replace(doc) { a.cancelInteraction(); a.store.replace(doc); a.pageId = doc.pageOrder[0]; a.selection.clear(); a.fitPage(); a.routing.nodes.clear(); a.routing.update(a.doc, a.page, true); a.clearIndex(); a.ui.renderAll(); a.ui.renderStencils(); a.requestFrame(true); }
  function confirmReplace(title, docFactory) { a.ui.dialog(title, '<p>This replaces the current local workspace. Download a project backup first to keep the current diagram.</p><button type="button" class="full-button" data-action="save-project">Download current project</button>', () => replace(docFactory()), 'Continue'); }
  a.runValidation = async (show = true) => {
    const revision = a.store.revision, pageId = a.pageId, seq = a.validationSequence = (a.validationSequence || 0) + 1;
    await a.routing.flush(a.doc, a.page);
    if (revision !== a.store.revision || pageId !== a.pageId || seq !== a.validationSequence) return;
    a.validationIssues = validateDiagram(a.doc, a.page, a.routing.routes);
    if (show || !$('validation-panel').hidden) a.ui.showValidation(a.validationIssues);
    return a.validationIssues;
  };
  function openCSVDialog(csv) {
    const fields = [...new Set(['key', 'id', ...Object.values(a.page.graph.nodes).flatMap(n => Object.keys(n.data))])];
    a.ui.dialog('Link external data', `<p><strong>${csv.rows.length}</strong> rows are ready to match against shape identities. Data is copied into the current page; labels such as <code>{{owner}}</code> update immediately.</p><div class="form-row"><label for="csv-key">CSV key column</label><select id="csv-key">${csv.headers.map(h => `<option value="${esc(h)}" ${h === 'key' ? 'selected' : ''}>${esc(h)}</option>`).join('')}</select></div><div class="form-row"><label for="csv-field">Match shape field</label><select id="csv-field">${fields.map(f => `<option value="${esc(f)}">${esc(f)}</option>`).join('')}</select></div><p class="muted">Columns: ${csv.headers.map(esc).join(', ')}. Unmatched shapes are left unchanged. Duplicate CSV keys are rejected.</p>`, () => {
      let count = 0; a.store.transact('Bind CSV data', () => { count = bindCSV(a.page, csv, $('csv-key').value, $('csv-field').value); if (!count) throw new Error('No shape keys matched. Choose a different key mapping.'); }); a.ui.showToast(`Updated ${count} shapes from CSV.`); setInspector('data');
    }, 'Link data');
  }
  const actions = {
    'tool-pointer': () => a.setTool('pointer'), 'tool-connect': () => a.setTool('connect'), 'tool-hand': () => a.setTool('hand'),
    undo: () => { a.finishLabelEdit?.(); a.cancelInteraction(); a.store.undo(); }, redo: () => { a.finishLabelEdit?.(); a.cancelInteraction(); a.store.redo(); },
    'add-process': () => a.addShape('process'), 'add-decision': () => a.addShape('decision'), 'add-swimlane': () => a.addShape('swimlane'),
    'add-text': () => { const id = a.addShape('text'); if (id) a.editLabel(id); },
    'new-document': () => confirmReplace('Start a new diagram?', () => createDocument()),
    'load-demo': () => confirmReplace('Open the approval-flow example?', createDemo),
    'open-project': () => { $('project-file').value = ''; $('project-file').click(); },
    'save-project': () => { a.finishLabelEdit?.(); downloadText(`${basename(a.doc.title)}.nexora.json`, JSON.stringify(a.doc, null, 2)); a.autosave(); a.ui.showToast('Portable project downloaded.'); },
    'export-svg': async () => { a.finishLabelEdit?.(); const pageId = a.pageId; await a.routing.flush(a.doc, a.page); if (a.pageId !== pageId) return; downloadText(`${basename(a.doc.title)}-${basename(a.page.name)}.svg`, exportSVG(a.doc, a.page, a.routing.routes), 'image/svg+xml'); a.ui.showToast('SVG exported with vector geometry and editable text.'); },
    'export-stencils': () => downloadText('nexora-stencils.json', JSON.stringify({ format: 'nexora.stencils', version: 1, masters: Object.values(a.doc.stencils) }, null, 2)),
    'rename-document': () => a.ui.prompt('Rename document', a.doc.title, title => a.store.transact('Rename document', () => a.doc.title = title.slice(0, 500))),
    'rename-page': () => a.ui.prompt('Rename page', a.page.name, name => a.store.transact('Rename page', () => a.page.name = name.slice(0, 100))),
    'add-page': () => { let id; a.transact('Add page', () => { const p = createPage(`Page ${a.doc.pageOrder.length + 1}`); id = p.id; a.doc.pages[id] = p; a.doc.pageOrder.push(id); }); if (id) a.switchPage(id); },
    'duplicate-page': () => {
      let id; a.transact('Duplicate page', () => {
        const source = a.page, page = createPage(`${source.name} copy`); page.width = source.width; page.height = source.height; for (const key of ['canvasMode', 'originX', 'originY', 'units', 'gridSize', 'drawingScale']) if (source[key] !== undefined) page[key] = source[key]; page.layers = structuredClone(source.layers); page.view = { nodes: {}, edges: {} };
        duplicateItems(page, Object.keys(source.graph.nodes), { x: 0, y: 0 }, source);
        // Recreate active constraints using identity mapping inferred from matching insertion order.
        const originalIds = Object.keys(source.graph.nodes), copiedIds = Object.keys(page.graph.nodes), map = new Map(originalIds.map((key, i) => [key, copiedIds[i]]));
        page.constraints = source.constraints.map(c => ({ ...structuredClone(c), id: uid('constraint'), ids: c.ids.map(id => map.get(id)) }));
        a.doc.pages[page.id] = page; a.doc.pageOrder.push(page.id); id = page.id;
      }); if (id) a.switchPage(id);
    },
    'delete-page': () => { if (a.doc.pageOrder.length === 1) throw new Error('A document must contain at least one page.'); a.ui.dialog('Delete this page?', `<p>Delete “${esc(a.page.name)}” and its contents? This operation can be undone.</p>`, () => a.store.transact('Delete page', () => { const id = a.pageId; delete a.doc.pages[id]; a.doc.pageOrder = a.doc.pageOrder.filter(p => p !== id); }), 'Delete page'); },
    'previous-page': () => { const i = a.doc.pageOrder.indexOf(a.pageId); if (i > 0) a.switchPage(a.doc.pageOrder[i - 1]); },
    'next-page': () => { const i = a.doc.pageOrder.indexOf(a.pageId); if (i < a.doc.pageOrder.length - 1) a.switchPage(a.doc.pageOrder[i + 1]); },
    'select-all': () => a.select(editableSelection(a.page, [...Object.keys(a.page.graph.nodes), ...Object.keys(a.page.graph.edges)])),
    copy: () => { if (!selectedNodes().length) { a.ui.showToast('Select shapes to copy; their internal connectors are included.'); return false; } a.clipboard = { page: structuredClone(a.page), ids: [...a.selection] }; a.pasteCount = 0; a.ui.showToast('Selection copied inside Nexora.'); },
    cut: () => { if (actions.copy() !== false) actions.delete(); },
    paste: () => { if (!a.clipboard) return a.ui.showToast('Copy a selection in Nexora first.'); const p = a.clipboard; let ids = []; a.pasteCount = (a.pasteCount || 0) + 1; a.transact('Paste shapes', () => ids = duplicateItems(a.page, p.ids, { x: a.pasteCount * 28, y: a.pasteCount * 28 }, p.page)); a.select(ids); },
    duplicate: () => { if (!selectedNodes().length) throw new Error('Select shapes to duplicate; their internal connectors are included.'); let ids = []; a.transact('Duplicate shapes', () => ids = duplicateItems(a.page, selectedNodes())); a.select(ids); },
    delete: () => {
      const ids = selectedObjects().filter(id => !descendants(a.page, id).some(child => isLocked(a.page, child))); if (!ids.length) return;
      a.transact('Delete selection', () => removeItems(a.page, ids)); a.select([]);
    },
    'zoom-in': () => a.setZoom(a.camera.zoom * 1.2), 'zoom-out': () => a.setZoom(a.camera.zoom / 1.2), 'zoom-100': () => a.setZoom(1), fit: () => a.fitPage(),
    'zoom-selection': () => a.fitBounds(selectionBox(a.page, [...a.selection], a.routing.routes), 100),
    'auto-layout': () => { a.transact('Automatic layout', () => autoLayout(a.doc, a.page)); a.fitPage(); },
    'fit-containers': () => a.transact('Fit containers to members', () => fitContainers(a.doc, a.page)),
    'make-container': () => {
      const ids = selectedNodes(); if (!ids.length) return a.addShape('container'); const box = selectionBounds(a.page, ids); let id;
      a.transact('Create container', () => {
        const parent = a.page.graph.nodes[ids[0]].parentId;
        id = addNode(a.doc, a.page, 'container', box.x - 24, box.y - 55, { label: 'New container', parentId: ids.every(x => a.page.graph.nodes[x].parentId === parent) ? parent : null, geometry: { w: box.w + 48, h: box.h + 79 }, layerId: a.activeLayer });
        for (const child of ids) if (!ancestors(a.page, child).some(parent => ids.includes(parent))) a.page.graph.nodes[child].parentId = id;
      }); if (id) a.select([id]);
    },
    'bring-front': () => { requireSelection(); a.transact('Bring to front', () => { let z = Math.max(0, ...Object.values(a.page.view.nodes).map(g => g.z || 0)); for (const id of selectedNodes()) a.page.view.nodes[id].z = ++z; a.page.view.nextZ = z + 1; }); },
    'clear-constraints': () => { a.transact('Release layout constraints', () => a.page.constraints = a.selection.size ? a.page.constraints.filter(c => !c.ids.some(id => a.selection.has(id))) : []); a.ui.showToast('Layout constraints released.'); },
    'clear-waypoints': () => { const ids = [...a.selection].filter(id => a.page.graph.edges[id] && !isLocked(a.page, id)); if (!ids.length) throw new Error('Select a connector.'); a.transact('Reset connector waypoints', () => ids.forEach(id => a.page.view.edges[id].waypoints = [])); },
    reroute: () => { a.routing.nodes.clear(); a.routing.update(a.doc, a.page, true); a.requestFrame(true); a.ui.showToast('Connector routes regenerated from the semantic graph.'); },
    validate: () => a.runValidation(), 'close-validation': () => $('validation-panel').hidden = true,
    'show-data': () => setInspector('data'), 'show-layers': () => setInspector('layers'),
    'show-outline': () => { a.ui.leftTab = 'outline'; updateLeftTab(); },
    'toggle-properties': () => { if (window.innerWidth <= 950) $('inspector').classList.toggle('mobile-open'); else { $('inspector').classList.toggle('collapsed'); document.querySelector('.workspace').classList.toggle('hide-inspector'); } },
    'add-layer': () => a.ui.prompt('New layer', `Layer ${a.page.layers.length + 1}`, name => { a.store.transact('Add layer', () => { const id = uid('layer'); a.page.layers.push({ id, name: name.slice(0, 100), visible: true, locked: false }); a.activeLayer = id; }); setInspector('layers'); }),
    'rename-layer': () => { const layer = a.page.layers.find(l => l.id === a.activeLayer); a.ui.prompt('Rename layer', layer.name, name => a.store.transact('Rename layer', () => layer.name = name.slice(0, 100))); },
    'delete-layer': () => {
      if (a.page.layers.length === 1) throw new Error('Keep at least one layer.');
      if ([...Object.values(a.page.graph.nodes), ...Object.values(a.page.graph.edges)].some(n => n.layerId === a.activeLayer)) throw new Error('Move or delete the layer’s objects before deleting it.');
      a.transact('Delete empty layer', () => a.page.layers = a.page.layers.filter(l => l.id !== a.activeLayer));
    },
    'add-data-field': () => {
      const obj = single(); a.ui.prompt('Add shape-data field', '', key => {
        if (!/^[a-zA-Z_][\w]{0,63}$/.test(key) || ['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('Use a safe field name with letters, digits, and underscores.');
        if (Object.hasOwn(obj.data, key)) throw new Error('That field already exists.');
        a.store.transact('Add data field', () => obj.data[key] = ''); setInspector('data');
      }, 'Field name');
    },
    'bind-label': () => { const obj = single(); a.ui.prompt('Bind a label to shape data', obj.label + '\n{{owner}}', value => a.store.transact('Bind label', () => obj.label = value), 'Label template · {{field}} references shape data'); },
    'import-csv': () => { $('csv-file').value = ''; $('csv-file').click(); },
    'download-sample-csv': () => downloadText('nexora-example-data.csv', SAMPLE_CSV, 'text/csv'),
    'custom-stencil': () => {
      a.ui.dialog('Create a programmable stencil', `<p>Define a polygon with expressions using <code>w</code> and <code>h</code>. Supported functions: min, max, abs, sin, cos, sqrt, clamp. No scripts are executed.</p><textarea id="master-json" spellcheck="false" aria-label="Stencil JSON">${esc(JSON.stringify(SAMPLE_MASTER, null, 2))}</textarea><p>Port normals must point north, east, south, or west. Import an exported stencil collection with File → Open.</p>`, () => {
        const raw = JSON.parse($('master-json').value), master = validateMaster(raw);
        if (a.doc.stencils[master.id]) throw new Error('A custom stencil with this id already exists. Choose a new id.');
        a.store.transact('Create programmable stencil', () => a.doc.stencils[master.id] = master); a.ui.expanded.add('My stencils'); a.ui.renderStencils(); a.ui.showToast(`“${master.name}” is ready in My stencils.`);
      }, 'Create stencil');
    },
    'save-as-stencil': () => {
      const n = single(); if (!n.master) throw new Error('Choose a shape, not a connector.'); const m = getMaster(a.doc, n.master), g = a.page.view.nodes[n.id];
      if (n.master === 'group' || n.master === 'path' && !g.closed) throw new Error('Reusable polygon stencils require a closed shape. Copy/paste retains open drawing paths.');
      a.ui.prompt('Save reusable shape stencil', `${m.name} variant`, name => {
        // Built-in shape geometry is converted to a normalized programmable polygon.
        import('../core/stencils.js').then(({ shapeGeometry, getPorts }) => {
          const points = shapeGeometry(m, { ...g, x: 0, y: 0, rotation: 0, flipX: false, flipY: false }).points;
          const defaultData = structuredClone(n.data); delete defaultData.key;
          const raw = { id: `custom-${uid().slice(-12)}`, name, defaultLabel: n.label, defaultData, geometry: { kind: 'polygon', points: points.map(p => [`w*${(p.x / g.w).toFixed(6)}`, `h*${(p.y / g.h).toFixed(6)}`]) }, size: [g.w, g.h], ports: getPorts(a.doc, n, { ...g, x: 0, y: 0 }).map(p => ({ id: p.id, x: `w*${(p.x / g.w).toFixed(6)}`, y: `h*${(p.y / g.h).toFixed(6)}`, dx: p.dx, dy: p.dy })), style: { fill: g.fill, stroke: g.stroke, textColor: g.textColor, fontSize: g.fontSize, strokeWidth: g.strokeWidth } };
          try { const master = validateMaster(raw); a.store.transact('Save reusable stencil', () => a.doc.stencils[master.id] = master); a.ui.expanded.add('My stencils'); a.ui.renderStencils(); }
          catch (error) { a.ui.showToast(error.message, true); }
        });
      });
    },
    'engine-info': () => {
      const stats = { backend: a.renderer.mode, fallbackReason: a.renderer.reason || null, cpuSubmitMs: Number((a.renderer.cpuSubmitMs || 0).toFixed(3)), ...a.renderer.backend.lastStats, indexedObjects: a.index.items.size, routeCache: a.routing.routes.size, pendingRoutes: a.routing.dirty.size, workerRouting: Boolean(a.routing.worker), historyCommands: a.store.undoStack.length, historyBytes: a.store.bytes, documentRevision: a.store.revision, constraintResiduals: constraintResiduals(a.page).map(c => ({ id: c.id, residual: c.residual })) };
      a.ui.dialog('Rendering & document diagnostics', `<p>The canvas draws actual document geometry. CPU submission time is not a GPU benchmark. Rendering is invalidation-driven and sleeps when the diagram is idle.</p><pre class="engine-info">${esc(JSON.stringify(stats, null, 2))}</pre><p>WebGPU requires a compatible browser and a secure context (HTTPS or localhost). Unsupported or lost devices use the explicit Canvas 2D fallback.</p>`, null);
    },
    help: () => a.ui.help(), 'close-dialog': () => $('dialog').close()
  };
  a.action = async name => {
    try { if (name !== 'close-dialog') a.finishLabelEdit?.(); const fn = actions[name] || a.extraActions?.[name]; if (!fn) throw new Error(`Unknown command: ${name}`); await fn(); }
    catch (error) { a.ui.showToast(error.message, true); console.error(error); }
  };
  function updateLeftTab() {
    document.querySelectorAll('[data-left-tab]').forEach(b => b.classList.toggle('selected', b.dataset.leftTab === a.ui.leftTab));
    $('stencil-list').hidden = a.ui.leftTab !== 'stencils'; $('outline-list').hidden = a.ui.leftTab !== 'outline'; document.querySelector('.stencil-search').hidden = a.ui.leftTab !== 'stencils'; a.ui.renderOutline();
  }
  document.addEventListener('click', e => {
    const el = e.target.closest('button,[data-fill]'); if (!el || el.disabled) return;
    const d = el.dataset;
    try {
      if (d.action) a.action(d.action);
      else if (d.ribbonTab) { a.ui.tab = d.ribbonTab; a.ui.renderTabs(); a.ui.renderRibbon(); }
      else if (d.master) { if (!a.stencilDragging) a.addShape(d.master); }
      else if (d.category) { a.ui.expanded.has(d.category) ? a.ui.expanded.delete(d.category) : a.ui.expanded.add(d.category); a.ui.renderStencils(); }
      else if (d.leftTab) { a.ui.leftTab = d.leftTab; updateLeftTab(); }
      else if (d.inspectorTab) { a.ui.inspectorTab = d.inspectorTab; a.ui.renderInspector(); }
      else if (d.selectNode) { a.select([d.selectNode], e.shiftKey); }
      else if (d.page) a.switchPage(d.page);
      else if (d.fill) applyFill(d.fill);
      else if (d.activeLayer) { a.activeLayer = d.activeLayer; a.ui.renderLayers(); }
      else if (d.layerVisible) a.transact('Toggle layer visibility', () => { const layer = a.page.layers.find(l => l.id === d.layerVisible); layer.visible = !layer.visible; });
      else if (d.layerLock) a.transact('Toggle layer lock', () => { const layer = a.page.layers.find(l => l.id === d.layerLock); layer.locked = !layer.locked; });
      else if (d.deleteData) { const obj = single(); a.transact('Remove data field', () => delete obj.data[d.deleteData]); }
      else if (d.issue !== undefined) { const issue = a.validationIssues[Number(d.issue)]; if (issue) { a.select(issue.ids); const box = selectionBounds(a.page, issue.ids); if (box) a.fitBounds(box, 160); } }
    } catch (error) { a.ui.showToast(error.message, true); }
  });
  document.addEventListener('dblclick', e => { const el = e.target.closest('[data-page]'); if (el) { a.switchPage(el.dataset.page); a.action('rename-page'); } });
  $('shape-search').addEventListener('input', e => { a.ui.search = e.target.value; a.ui.renderStencils(); });
  $('zoom-slider').addEventListener('input', e => a.setZoom(Number(e.target.value) / 100));
  document.addEventListener('change', e => {
    const el = e.target, d = el.dataset;
    try {
      if (d.setting) { a[d.setting] = el.checked; if (d.setting === 'minimap') $('minimap').hidden = !a.minimap; a.requestFrame(); }
      else if (d.command) { const value = el.value; el.value = ''; if (value) align(value, d.command === 'distribute'); }
      else if (d.prop) {
        const prop = d.prop;
        if (prop === 'pageWidth' || prop === 'pageHeight') { const value = Number(el.value); if (!Number.isFinite(value) || value < 200 || value > 100000) throw new Error('Page dimensions must be between 200 and 100000.'); a.store.transact('Change page size', () => a.page[prop === 'pageWidth' ? 'width' : 'height'] = value); return; }
        requireSelection(); const numeric = ['x', 'y', 'w', 'h', 'fontSize', 'strokeWidth'].includes(prop), value = numeric ? Number(el.value) : el.type === 'checkbox' ? el.checked : el.value;
        if (numeric && !Number.isFinite(value)) throw new Error('Enter a finite number.');
        if (['w', 'h'].includes(prop) && (value < Math.max(...selectedNodes().map(id => ['path', 'group', 'rectangle', 'ellipse'].includes(a.page.graph.nodes[id].master) ? 1 : 24), 1) || value > 100000)) throw new Error('Dimensions must respect the selected shape minimum (1 or 24 units) and be at most 100000.');
        if (['x', 'y'].includes(prop) && Math.abs(value) > 999000) throw new Error('Position is outside the supported document range.');
        if (prop === 'fontSize' && (value < 8 || value > 120)) throw new Error('Font size must be between 8 and 120.');
        if (prop === 'strokeWidth' && (value < 0 || value > 64)) throw new Error('Line width must be between 0 and 64.');
        if (['x', 'y'].includes(prop) && selectedNodes().some(id => movementLockedIds(a.page).has(id))) throw new Error('A container with locked members cannot be moved.');
        if (a.editor.numericProperty(prop, value)) return;
        a.store.transact(`Change ${prop}`, () => {
          for (const id of selectedObjects()) {
            const g = a.page.view.nodes[id] || a.page.view.edges[id]; if (!g) continue;
            if (['x', 'y'].includes(prop) && a.page.graph.nodes[id]) { const delta = value - g[prop]; for (const child of descendants(a.page, id)) a.page.view.nodes[child][prop] += delta; }
            g[prop] = value;
          }
          solveConstraints(a.page, new Set(selectedNodes())); fitContainers(a.doc, a.page);
        });
      } else if (d.label) { const obj = single(); a.store.transact('Edit label', () => obj.label = el.value.slice(0, 10000)); }
      else if (d.semantic) { const obj = single(); a.store.transact('Change membership', () => { obj[d.semantic] = el.value || null; fitContainers(a.doc, a.page); }); }
      else if (d.dataKey !== undefined) {
        const obj = single(), old = obj.data[d.dataKey]; let value = el.value;
        if (typeof old === 'number') { value = Number(value); if (!Number.isFinite(value)) throw new Error('This field expects a finite number.'); }
        if (typeof old === 'boolean') value = /^(true|1|yes)$/i.test(value);
        if (old && typeof old === 'object') value = JSON.parse(value, (key, v) => { if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Unsafe data key.'); return v; });
        a.store.transact('Edit shape data', () => obj.data[d.dataKey] = value);
      }
    } catch (error) { a.ui.showToast(error.message, true); a.ui.renderInspector(); }
  });
  $('project-file').addEventListener('change', async e => {
    const file = e.target.files[0]; if (!file) return;
    try {
      if (file.size > 50 * 1024 * 1024) throw new Error('Project files must be smaller than 50 MB.'); const text = await file.text();
      const header = JSON.parse(text);
      if (header.format === 'nexora.stencils') {
        if (!Array.isArray(header.masters) || header.masters.length > 500) throw new Error('Invalid stencil collection.');
        const masters = header.masters.map(validateMaster); a.store.transact('Import stencil collection', () => { for (const m of masters) { if (a.doc.stencils[m.id]) throw new Error(`Stencil ${m.id} already exists.`); a.doc.stencils[m.id] = m; } }); a.ui.expanded.add('My stencils'); a.ui.renderStencils(); a.ui.showToast(`Imported ${masters.length} stencils.`);
      } else { const doc = parseDocument(text); replace(doc); a.ui.showToast(`Opened “${doc.title}”.`); }
    } catch (error) { a.ui.showToast(`Open failed: ${error.message}`, true); }
  });
  $('csv-file').addEventListener('change', async e => { const file = e.target.files[0]; if (!file) return; try { openCSVDialog(parseCSV(await file.text())); } catch (error) { a.ui.showToast(error.message, true); } });
}
