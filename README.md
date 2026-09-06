# Nexora Diagram

An original, dependency-free structured-diagram editor with a Visio-inspired ribbon workspace, a semantic diagram model, real editing tools, obstacle-aware orthogonal routing, and a retained WebGPU rendering backend.

**The diagram is not an SVG mockup or screenshot.** Shapes, ports, connectors, labels, layers, containers, page graphs, and property panels are editable document objects. The startup purchase-approval example is built through the same model API used by the editor.

## Live application

[Open Nexora Diagram](https://wieslawsoltes.github.io/NexoraDiagram/) · [Standalone HTML](https://wieslawsoltes.github.io/NexoraDiagram/Nexora-Diagram.html) · [WebGPU smoke test](https://wieslawsoltes.github.io/NexoraDiagram/tests/webgpu-smoke.html)

The `main` branch contains the source. GitHub Actions runs the automated tests, creates a static site with `npm run build:pages`, and publishes the tested artifact directly to GitHub Pages. Pull requests run the same tests and build without publishing. No runtime dependencies, tokens, or third-party services are needed by the application.

## Run

Use Node.js 20 or later. No packages need to be installed.

```sh
git clone https://github.com/wieslawsoltes/NexoraDiagram.git
cd NexoraDiagram
npm start
```

Open `http://127.0.0.1:8080` in your browser. To use another port on macOS/Linux:

```sh
PORT=8765 npm start
```

On PowerShell:

```powershell
$env:PORT=8765
npm start
```

Python is an alternative for serving the modular source:

```sh
python3 serve.py 8080
```

The server binds only to the local machine by default. The app itself has no service backend, account, telemetry, third-party scripts, CDN assets, or network-dependent fonts.

### Single-file edition

Run `npm run build` to generate the single-file edition. `dist/Nexora-Diagram.html` contains the complete application, styles, icons, and a real Blob-based routing worker. Open it directly as a convenient offline edition, or serve it with the included server at `/dist/Nexora-Diagram.html`. Browser storage and GPU access under `file:` depend on the browser; localhost is the preferred mode.

Rebuild the standalone file after changing source:

```sh
npm run build
```

`build.mjs` is a small, purpose-specific bundler for this repository's named-export ES-module subset. It is not a general JavaScript bundler. The modular source is the development build.

## Renderer selection

The app attempts WebGPU, then explicitly falls back to Canvas 2D if the API, adapter, shader compilation, or device is unavailable. The status-bar badge displays the **actual active renderer**. View → Diagnostics shows the reason for a fallback and live engine counters.

WebGPU access requires a supporting browser and a secure context. Localhost is the intended local-development origin; use HTTPS for a remote deployment. The fallback can also be selected explicitly with `?renderer=canvas`.

The GPU backend uses three WGSL pipelines: procedural page/grid, filled and stroked geometry, and atlas-backed text. It uses four-sample antialiasing, retained growable vertex buffers, resolution-bucketed text atlases, viewport culling, and invalidation-driven frame submission. It does not continuously redraw a static page.

**Verification boundary:** this delivery was browser-tested using Canvas 2D and a real routing Worker in an in-memory fixture. Actual WebGPU execution and IndexedDB reload persistence were not available in that restricted browser fixture. A dedicated hardware test is included at `/tests/webgpu-smoke.html`; open it on your target machine. It compiles the actual shaders, submits the real demo, waits for GPU completion, and reports validation errors without silently falling back. No hardware throughput or FPS claim is made.

## Editing guide

Drag a stencil onto the paper, or click a stencil to add it near the current viewport center. The sixteen built-in masters cover flowchart shapes, basic shapes, annotations, containers, and swimlanes.

Use the pointer tool to drag shapes and the four square handles to resize. Shift-resize preserves the aspect ratio of non-container shapes. Grid snapping and smart edge/center guides can be toggled in View; hold Alt during a gesture to bypass grid snapping. Shift-click extends or toggles selection. Drag empty paper to marquee-select.

Connect with **C**, then drag from one shape to another, or click a source and target. Visible port circles can start a connector directly. Endpoints remain attached to shape and port identities. Select a connector to drag its endpoint handles to other ports. Double-click a connector to insert a routing waypoint, then drag its square handle. Process → Reset connector clears manual waypoints.

Double-click a shape to edit its text on the canvas. Ctrl+Enter commits; Escape cancels. The properties panel also edits labels, position, size, fill, stroke, line width, text size, and alignment. Bind labels with `{{owner}}`, `{{status}}`, or `{{data.customer.name}}`. Missing fields are visible and generate validation warnings.

Home provides alignment, distribution, duplication, and automatic layout. Design → Keep constraints makes alignment/distribution persistent; release constraints to return to unconstrained movement. Contradictory constraints retain measurable residuals rather than being silently declared satisfied.

Select shapes and use Insert → Container to establish parent-child membership. Moving a container moves its descendants; moving a child inside another eligible container changes membership. Containers expand to include their members. A locked member prevents translation of its enclosing container. Swimlanes are editable horizontal container masters with header regions, not decorative backgrounds.

Layers have visibility and lock controls. Choose the active layer in the Layers panel; change a selected object's layer or parent in Properties. Hidden ancestors hide their descendants. Locked ancestors lock their descendants. CSV updates are bulk data operations rather than geometric manipulation; they can refresh data on locked diagram shapes.

Use the bottom page tabs and **+** button for independent pages. Double-click a tab to rename it. Insert duplicates a page, and the document inspector exposes page size, duplication, and deletion. Click blank paper to show that inspector; switch the right panel back to Format when necessary.

### Useful shortcuts

| Command | Shortcut |
| --- | --- |
| Pointer / connector / hand / text | V / C / H / T |
| Pan | Space-drag, middle-drag, right-drag, or wheel |
| Zoom at pointer | Ctrl/Command + wheel |
| Fit page | F or Ctrl/Command+0 |
| Select all | Ctrl/Command+A |
| Copy / cut / paste | Ctrl/Command+C / X / V |
| Duplicate | Ctrl/Command+D |
| Undo / redo | Ctrl/Command+Z / Shift+Z; Ctrl+Y also works |
| Nudge | Arrow keys; Shift for 10-unit steps |
| Delete | Delete or Backspace |
| Download project / open project | Ctrl/Command+S / O |
| Commit / cancel in-place text | Ctrl/Command+Enter / Escape |

Two-finger touch navigation supports pan/zoom. The mobile layout retains the canvas, stencils, page tabs, and a toggleable properties panel; desktop remains the most comfortable arrangement for large editing sessions.

## Stencils and programmable geometry

Use **+** in Shapes or Insert → New stencil to create a programmable polygon master. Geometry coordinates are arithmetic expressions over `w`, `h`, and `pi`, with `+`, `-`, `*`, `/`, parentheses, and `min`, `max`, `abs`, `sin`, `cos`, `sqrt`, `clamp`. Expressions are parsed by a bounded interpreter, never evaluated as JavaScript.

Custom masters support up to 128 polygon vertices and 64 named connection points. Ports have cardinal outward normals. Masters are checked for simple polygons at their default size and representative aspect ratios. Shape instances are checked again at commit. The programmatic model also supports instance-specific port definitions.

See `examples/chevron.stencils.json` for a complete collection. Open it with File → Open. A stencil ID must be unique and cannot replace a built-in master.

Select an existing shape and choose Insert → Save as stencil to preserve its silhouette, appearance, default label, data defaults, and ports as a new reusable master. Multi-part decorative details of built-ins are flattened to their outer polygon; this is not a compound-symbol authoring language. Export custom collections from File → Stencils.

## Data, validation, and export

Data → Link CSV data opens a keyed mapping dialog. Choose the CSV key column and a shape-data field, or stable shape `id`. The import updates matched shape data in one undoable command. Duplicate CSV keys are rejected; unmatched shapes are left unchanged. CSV handling supports quoted values, escaped quotes, CRLF, and multiline fields. Linking is a local snapshot import, not a live database subscription.

`examples/approval-data.csv` updates REQ01, OPS01, and FIN01 in the example. `examples/data-bound-approval.nexora.json` already contains labels that expose these fields.

Process → Check diagram runs actual validation over the current graph and completed routes: missing references and ports, route obstruction, missing bindings, empty labels, isolated activities, incomplete decision branching, duplicate external keys, peer overlaps, containment, page extents, and persistent-constraint residuals. Clicking an issue selects the relevant objects.

Export SVG produces vector paths and text, not a canvas bitmap. Visible layers are exported; stable IDs are preserved as `data-nexora-id`. Font families are referenced, not embedded. SVG is a visual interchange format here: reopening a fully editable semantic document requires the `.nexora.json` project, not the SVG.

## Persistence and history

The current workspace autosaves to IndexedDB with a localStorage fallback and unload-recovery snapshot. Save operations serialize immutable snapshots and report storage failures. The save indicator is not a cloud-sync indicator. Download a project for a portable backup, particularly before clearing site data or using private browsing. Concurrent tabs are not merged; use one editing tab per workspace.

Undo/redo records leaf-value patches with stable identities. A complete pointer gesture is one command, including its container and constraint effects. Arrays are atomic patch values. An active transaction keeps one full rollback snapshot; undo history does not keep a complete document per command. Limits are 150 commands and approximately 16 MiB of stored undo patches, while retaining the latest command even when it alone exceeds the byte target. The redo stack is discarded after a new edit.

Projects are versioned JSON with separate `graph` and `view` records per page. Routes, selections, caches, and camera state are not document truth. Imports validate structure and references before replacing the workspace. Limits include 100 pages, 100 layers per page, 500 custom stencils, 50,000 total shapes/connectors, and 50 MiB of input JSON. These are safety limits, **not measured interactive-capacity guarantees**.

## Source and extension points

| Area | Files |
| --- | --- |
| Semantic document, stable identities, imports | `src/core/model.js` |
| Built-in/custom masters and safe expressions | `src/core/stencils.js`, `expression.js` |
| Patches, transactions, undo/redo | `src/core/history.js` |
| Orthogonal A*, worker bridge, derived routes | `src/core/router.js`, `router.worker.js`, `routing-service.js` |
| Spatial hash and geometry kernel | `src/core/spatial.js`, `geometry.js` |
| Persistent constraints and graph layout | `src/core/layout.js` |
| Validation, CSV, persistence, SVG | `src/core/validation.js`, `persistence.js`, `export-svg.js` |
| Backend-neutral scene and text layout | `src/render/scene.js` |
| WebGPU pipelines, buffers, and text atlas | `src/render/webgpu.js` |
| Canvas fallback and backend lifecycle | `src/render/canvas.js`, `renderer.js` |
| Workspace, hit testing, camera, overlays | `src/app.js` |
| Pointer/keyboard tools, ribbon, panels | `src/ui/interactions.js`, `actions.js`, `panels.js` |

`docs/ARCHITECTURE.md` explains invariants, routing invalidation, rendering lifetimes, and extension examples.

## Tests

```sh
npm run build
npm test
npm run build:pages
```

The package includes 35 tests: 32 core tests, one local-server test, and two Pages packaging tests. The test runner is Node's built-in test runner; no test dependencies are needed for this suite. The server test also verifies the generated standalone file's CSP hash.

For full browser interaction testing on an unrestricted local browser, install Python Playwright, start `npm start` in another terminal, and run:

```sh
python3 -m pip install playwright
python3 -m playwright install chromium
python3 tests/browser_test.py
```

`NEXORA_URL` overrides the target URL. Normal HTTP mode exercises the modular source and checks real storage across reload. It does not require WebGPU to pass; the report records the backend actually used.

The restricted-runner mode used for this delivery was:

```sh
npm run build
NEXORA_FIXTURE=1 CHROMIUM_PATH=/usr/bin/chromium python3 tests/browser_test.py
```

It exercises the self-contained build with `page.set_content`, a real Blob Worker, actual pointer/keyboard operations, actual file downloads/uploads, and **injected in-memory persistence**. It does not modify browser navigation policy. The report contains 36 passing checks, no uncaught errors, and no browser console errors. See `docs/browser-test-results.json` and `docs/core-test-results.tap` for the historical delivery reports. The browser harness generates desktop/mobile screenshots locally; generated screenshots and bundles are not checked into source.

## Explicit scope

This is a working original diagram editor and extensible core, not Microsoft's software or a promise of complete Visio compatibility. There is no VSD/VSDX/VDX import, VBA, full ShapeSheet, BPMN execution, arbitrary Bezier path editing, rotation, rich-text editor, embedded image shape, cross-page connector, multi-user collaboration, or server-side document service. SVG and Nexora JSON are the provided export formats.

Routing is clearance-aware against axis-aligned shape bounds, not exact curved silhouettes. It does not globally optimize connector crossings, bundle edges, or add line jumps. A bounded search can return a visibly flagged blocked route; user waypoints guide routing, not guaranteed feasibility. Containers are not obstacles. The layout solver is a bounded projection solver for alignment and distribution, not a general symbolic equation solver or mixed-integer optimizer. Heavy graph edits still require CPU work, a transaction snapshot, validation, and scene reconstruction for visible content.

The GPU backend is implemented, but hardware visual conformance, device-loss stress, long-session memory behavior, and large-document throughput need measurement on target devices. Canvas fallback and the ordinary editing workflows were exercised in the included automated browser report. This distinction is intentional: no simulated GPU badge, artificial FPS figure, or prerecorded diagram movement is used.

## References

The implementation targets the WebGPU and WGSL specifications and uses native browser APIs. Useful primary documentation:

- WebGPU specification: https://www.w3.org/TR/webgpu/
- WGSL specification: https://www.w3.org/TR/WGSL/
- GPU API and secure-context availability: https://developer.mozilla.org/en-US/docs/Web/API/GPU
- Secure contexts: https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Secure_Contexts

Original source is provided under the MIT license. Nexora Diagram is not affiliated with or endorsed by Microsoft.
