# Nexora Diagram — core architecture

## 1. Sources of truth

A document contains a versioned, page-scoped semantic graph and a separate visual model:

```js
{
  format: 'nexora.diagram',
  version: 1,
  id: 'doc_…',
  title: 'Approval process',
  pageOrder: ['page_…'],
  stencils: {},
  pages: {
    'page_…': {
      id: 'page_…', name: 'Approval flow', width: 1320, height: 900,
      graph: {
        nodes: {
          'n_…': {
            id: 'n_…', master: 'process',
            label: 'Review by {{owner}}', data: { key: 'OPS01', owner: 'Jordan' },
            parentId: null, layerId: 'diagram'
          }
        },
        edges: {
          // edgeId: { id, from: {nodeId, port}, to: {nodeId, port}, label, data, layerId }
        }
      },
      view: {
        nodes: {
          'n_…': { x: 100, y: 100, w: 170, h: 76, z: 1,
                   fill: '#f0f7ff', stroke: '#7b9cbe', textColor: '#253b53',
                   fontSize: 16, strokeWidth: 1.5 }
        },
        edges: {
          // edgeId: { stroke, strokeWidth, dashed, waypoints: [{x, y}, …] }
        },
        nextZ: 2
      },
      layers: [{ id: 'diagram', name: 'Diagram', visible: true, locked: false }],
      constraints: []
    }
  }
}
```

Moving a rectangle changes `view.nodes[id]`, not graph endpoints. Connecting shapes changes graph references, not a sequence of line segments. Container membership is `parentId`, independent of the rendered border. Master definitions are document-wide; nodes instantiate them by identity.

The route cache, spatial hash, display list, GPU buffers, text atlas, selection, and camera are derived runtime state. None is persisted as a substitute for the graph. Edge waypoints are persisted because they express user routing intent.

Structural validation runs before a document is accepted and before an edit commits. It checks reference integrity, cardinal port definitions, ownership cycles, geometry, style values, supported constraint axes/modes, identities, and resource bounds. Diagram-domain validation is separate: an isolated activity may be a useful intermediate editing state and is a warning rather than a rejected transaction.

## 2. Edit pipeline

A document transaction follows this order:

1. Capture a rollback snapshot with `DocumentStore.begin(label)`.
2. Apply geometry or graph changes. During a gesture, preview events keep visuals, spatial entries, and routes current.
3. Project applicable layout constraints and update affected containers.
4. Validate structural invariants.
5. Compute reversible leaf patches, coalesce the gesture into one history command, increment the committed revision, and notify subscribers.
6. Queue a debounced immutable persistence snapshot. Rendering and connector routing are separately invalidated.

Failure restores the snapshot and does not append history. Escape, pointer cancellation, loss of an active pointer capture, and window blur cancel an in-progress gesture. Undo/redo operate on persistent IDs rather than a current selection.

Arrays are intentionally atomic patches. The implementation favors inspectable correctness over a specialized mutable-CRDT or packed arena allocator. Full-document cloning occurs once per active transaction, and patch discovery is proportional to the visited document structure; it is not an O(changed-shapes)-only transaction system.

Do not retain arbitrary node object references across undo, replace, or rollback. Retain IDs and resolve `app.page.graph.nodes[id]` when applying a change.

## 3. Programmatic editing

In the modular application, `window.nexora` is the live app. This example can be run from its developer console:

```js
const { addNode, addEdge } = await import('./src/core/model.js');
const { solveConstraints, fitContainers } = await import('./src/core/layout.js');
const app = window.nexora;
let a, b, edge;

app.store.transact('Create review pair', () => {
  const page = app.page;
  a = addNode(app.doc, page, 'process', 140, 180, {
    label: 'Prepare {{record}}',
    data: { key: 'PREP01', record: 'purchase order' },
    layerId: app.activeLayer
  });
  b = addNode(app.doc, page, 'decision', 470, 180, {
    label: 'Approved?',
    layerId: app.activeLayer
  });
  edge = addEdge(page, { nodeId: a, port: 'e' }, { nodeId: b, port: 'w' }, 'Review');
  solveConstraints(page);
  fitContainers(app.doc, page);
});
app.select([a, b]);
await app.routing.flush(app.doc, app.page);
```

For the single-file build, use the existing `app.addShape`, `app.action`, and `app.store` APIs; the module import path above describes the modular development build. A normal application extension should import these modules rather than reach through UI DOM internals. Structural core functions intentionally do not implement user permissions: the UI applies layer-lock editing policy, while bulk data or controlled integrations may update semantic data separately.

### Custom geometry example

```js
const master = {
  id: 'review-chevron',
  name: 'Review chevron',
  size: [190, 80],
  geometry: {
    kind: 'polygon',
    points: [
      ['0', '0'], ['w*0.78', '0'], ['w', 'h/2'],
      ['w*0.78', 'h'], ['0', 'h'], ['w*0.18', 'h/2']
    ]
  },
  ports: [
    { id: 'in', x: 'w*0.18', y: 'h/2', dx: -1, dy: 0 },
    { id: 'out', x: 'w', y: 'h/2', dx: 1, dy: 0 }
  ],
  defaultLabel: 'Review {{owner}}',
  defaultData: { owner: 'Operations' },
  style: { fill: '#f0ecff', stroke: '#9070ce', textColor: '#604491' }
};
```

Pass the definition through `validateMaster` before insertion. Expressions have a 256-character and 100-token limit, a nesting limit of 24, finite-result checks, and a compiled-expression cache. There is no access to JavaScript properties, assignment, loops, network, or application objects. The language is for parametric geometry, not arbitrary JavaScript execution or full ShapeSheet compatibility.

## 4. Routing

`RoutingService` maintains signatures for node geometry/obstacle eligibility and for edge endpoints/waypoints. A move invalidates incident edges and routes whose cached bounding boxes intersect old or new obstacle extents. Deletion clears dead routes. Metadata-only edits normally leave route geometry intact.

Requests are coalesced with a 45 ms drag-time delay, then processed in a Web Worker. Commit-time requests are scheduled immediately. Every request batch has a page ID and generation. The main thread discards stale answers and retains pending dirty IDs so a newer edit is not overwritten by an old route result. A current-endpoint preview is drawn while computation is pending.

Port escapes extend 22 document units beyond the endpoint bounds, including for concave custom ports. Non-container, non-annotation node bounds are expanded by 12 units as obstacles. The endpoint escape segment is exempt from its own obstacle but not other shapes.

Each waypoint interval first tries clear direct/L-shaped paths. Otherwise the router constructs a rectilinear coordinate grid from endpoints and obstacle boundary offsets. A* uses position plus incoming axis as its state, Manhattan distance as its heuristic, and a 22-unit bend penalty. Spatial hashing accelerates segment-obstacle queries. Routes preserve their exact endpoint doubles; display/export formatting can round separately.

The search uses bounded state allocation and expansion. If no clear result is found within the bounds, fallback candidates are scored for length and obstacle intersections. A colliding result is `blocked`, rendered with a warning color, and reported by validation. Routing never claims clearance for a fallback that intersects an obstacle.

`flush()` completes pending routes synchronously for export/validation, avoiding nondeterministic SVG output while a worker is still busy. Routing remains CPU computation; WebGPU handles display. Dirty-route detection uses conservative bounding boxes and scans edges, not a hierarchical segment dependency index. There is no global edge-crossing optimizer.

## 5. Spatial and geometric kernels

`SpatialIndex` is an updatable uniform spatial hash with a spill set for unusually large bounds. Node hit testing first queries candidate bounds, then tests shape polygons. Edge hit testing measures distance to routed segments. Container headers and borders are selectable without making their full interior intercept member editing.

Simple polygons are ear-clipped into triangles. Consecutive repeated vertices are removed from built-in sampled silhouettes before triangulation or reuse as custom masters. Tests verify area conservation for every built-in master and triangulation of concave custom shapes. Bending arcs are sampled polygons, not an exact analytic path kernel.

World coordinates are CSS-pixel document units at 100% zoom. One inch corresponds to 96 document units. Camera transforms map world to viewport CSS pixels; DPR only affects render-target resolution. Pointer hit tolerances are converted from screen pixels to world units.

## 6. Constraints and automatic layout

Persistent align constraints store node IDs, axis, and anchor mode. Distribution constraints store an ordered set of IDs and an axis. A bounded twelve-pass projection solver uses a locked member as a fixed reference, otherwise an edited/preferred member, otherwise the first member. Containers with locked descendants are also fixed for translation.

Residuals remain queryable with `constraintResiduals()`. Conflicts appear in diagram validation. This is not an exact general linear constraint solver, nonlinear solver, or optimization proof.

Automatic graph layout uses iterative strongly connected components, a condensation DAG, and rank-based positioning. It handles cycles without recursively traversing the process graph. It preserves container membership, respects locked nodes, grows containers, and separates movable top-level containers after expansion. The SCC routine is tested on a 20,000-node chain; that test is not a 20,000-shape interactive rendering benchmark.

## 7. Rendering pipeline

`buildScene()` produces plain geometry primitives and laid-out text runs. Both runtime backends consume that display list. SVG export consumes the same construction without viewport culling, preserving visual consistency and avoiding a parallel export implementation of the semantic model.

### WebGPU

The background pipeline draws a fullscreen triangle with a procedural page, border, shadow, and grid. Shape fills are CPU-triangulated. Strokes are expanded into triangles, including dash segments, then uploaded into a retained growable vertex buffer. The geometry pipeline uses a 24-byte vertex layout: `float32x2` position and `float32x4` color. Text uses a 32-byte layout with position, UV, and tint.

The shared camera uniform is 48 bytes with viewport, pan, zoom, DPR, page size, grid state, and alignment padding. Camera-only movement reuses retained geometry while the view stays inside its culling overscan bounds.

A four-sample render attachment resolves into the current canvas texture. GPU initialization awaits shader diagnostics and pipeline creation. The wrapper falls back explicitly after unsupported initialization, runtime validation errors, or device loss. Failed device initialization destroys the requested device. View → Diagnostics displays actual counters and the fallback reason.

### Text

Native browser text shaping and measurement determine label wrapping. Whole text runs are rasterized into white-alpha atlas regions and tinted in WGSL. This preserves native shaping within each rendered run rather than pretending that code points correspond one-to-one with glyphs.

Atlas resolution uses square-root-of-two scale steps up to 4×. Atlas pages use RGBA8, at most 2048² per page, up to eight pages: 128 MiB of GPU texture storage at the maximum size, **plus** CPU canvases and geometry buffers. The atlas is reset on scale-bucket changes or after the entry threshold. Atlas-capacity overflow activates Canvas fallback rather than allocating indefinitely. This is a bounded text-run atlas, not an MSDF/analytic-glyph renderer or a full rich-text layout engine.

Labels are viewport culled together with diagram geometry. Visible-label edits can rebuild text vertices without changing semantics. Rulers, selection handles, guides, and floating editing controls use lightweight Canvas/SVG/HTML overlays for precise interaction; the base diagram geometry uses the selected rendering backend.

### Invalidation and measurement

`requestFrame()` coalesces work into a single animation frame. The editor sleeps when nothing changes. Scene rebuilding, route scheduling, and frame submission are separate. The displayed timing is CPU submission time for the renderer draw call, not end-to-end interaction latency, GPU execution time, or FPS. Scene construction and routing are not included in that number.

## 8. Persistence and security boundary

Versioned JSON is imported atomically after structural validation. Text is rendered with DOM text escaping or native text drawing, and SVG text/attributes are XML-escaped. Styles and identifiers are validated so imported values cannot become arbitrary SVG attribute fragments. Unsafe prototype keys are rejected by the JSON parser and label-binding resolver. SVG exports do not embed fonts or execute scripts.

The Node development server accepts GET/HEAD only, constrains paths to the project directory, uses explicit MIME types, and sends a CSP. For the standalone build, it hashes the local inline script and permits Blob workers, rather than using `unsafe-eval` or unrestricted inline script execution. The Python helper is a simple local file server and does not replicate those security headers.

Browser persistence is a single local workspace with serialized saves, not a collaborative database. Site storage can be unavailable or cleared; a JSON download is the portable backup. Multi-tab conflict resolution, cloud synchronization, and untrusted multi-tenant hosting are outside this build's scope. Input checks do not constitute a third-party security audit.

## 9. Test evidence

`npm test`: 35 passing tests, consisting of 32 core tests, one HTTP-server test, and two Pages packaging tests. Core checks cover geometry, routing, fractional endpoint preservation, impossible routes, graph identities, ownership, inherited locking, layout residuals, undo/redo, malformed project rejection, data binding, CSV quoting, and reusable stencils.

`tests/browser_test.py`: 36 passing interaction checks in the documented Canvas + real Worker fixture, including drag, resize, edit/bind labels, duplicate/delete/undo, custom masters, layers, CSV upload, SVG/project download, new pages, port dragging, waypoint editing, container movement, validation, project restore, autosave integration, and responsive layout. No uncaught application errors or console errors were observed.

The browser fixture injected persistence and did not have access to WebGPU. These results are not evidence of hardware GPU correctness or IndexedDB reload behavior. `tests/webgpu-smoke.html` and the normal HTTP browser-test mode provide reproducible follow-on checks on a target browser. The source includes both backends; their test evidence is deliberately not conflated.

## Drawing and canvas extension

`core/drawing.js` owns normalized path geometry, quadratic/cubic subdivision, simplification, world/local transforms, eight-grip coordinates, anchored resizing, and stroke-pattern interpretation. A built-in `path` is an annotation node with `view.path`, `pathMode`, `closed`, and normal shape style fields. A built-in `group` is a hidden, unpainted container record with exact child bounds. Neither appears as a malformed generic polygon in the stencil gallery. Existing version-1 files without the optional fields remain valid; validation rejects invalid new path/style/page fields atomically.

`core/editing.js` captures one immutable geometry snapshot per interaction. A top-level selection expands to descendants without double-moving a selected child. Attached internal connector waypoints are included once. A connector-only drag moves routing waypoints rather than detaching graph endpoints. Translation, scaling, rotation, and reflection operate on the captured originals, never repeatedly accumulate deltas on previews. Group bounds are recomputed after transformations. Locked descendants prevent parent transforms.

`core/page.js` separates paper bounds from viewport/backing resolution. Page mode, origin, units, grid spacing, and drawing scale are optional version-1 extensions. Auto-size runs inside `DocumentStore.commit`, before invariant validation and history diff creation. Infinite mode changes the procedural background and content-based fit/export behavior, not the canvas texture allocation. Rulers choose a bounded adaptive tick spacing at low zoom.

`ui/drawing.js` installs drawing/transform gestures and command handlers. Existing `interactions.js` retains pointer capture, two-finger pinch, panning, text editing, and attached connector reconnection, delegating drawing and selection transforms to the new controller. Draft paths are transient until commit. Tool changes, cancellation, and page changes clear drafts. The same model changes drive history, routing invalidation, the spatial index, and rendering.

`render/stroke.js` shares dash splitting and endpoint-marker construction and expands GPU strokes into triangles with cap/join geometry. `render/scene.js` produces backend-neutral paths and rotated text for both renderers and vector export. Curves retain controls in the model and are flattened for drawing/export. Rotated node bounds participate in culling and obstacle invalidation; port positions and cardinal escape directions rotate with shapes. Grouping is semantic, not a texture bake.

SVG export now accepts content/selection options and computes finite bounds for infinite drawings, including negative origins and markers. PNG rasterization uses the exported SVG and explicit dimension/area caps. Printing uses a dedicated ephemeral same-origin frame and the browser print dialog. There is no claim of backend pixel identity, rich-text round-trip, or native third-party format compatibility; see the capability matrix.


## Advanced authoring modules (1.2)

`curves.js` retains analytic arc controls and constructs pressure outlines. `regions.js` implements planar region operations and winding-aware nonoverlapping triangulation. `rich-text.js` validates and lays out structured text; `assets.js` manages bounded embedded rasters. The shared scene carries rich glyph runs, compound regions and image primitives into both renderers and SVG/PNG/print. WebGPU image commands retain geometry-relative draw order.

`archive.js` and `xml.js` are independent bounded parsers; `native-diagram.js` maps supported OPC/legacy XML records with explicit reports. `print.js` separates physical tile planning from output rendering. `collaboration.js` (core) is a Lamport field-register CRDT with tombstones, atomic correlated geometry records and deterministic dependency repair; its UI transport supports BroadcastChannel and framed/backpressured WebRTC messages. `history.js` offers a collaboration-aware patch ownership hook without turning remote operations into local undo commands.

See ADVANCED.md for non-goals, security boundaries and test distinctions.
