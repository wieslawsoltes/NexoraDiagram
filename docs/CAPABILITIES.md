# Capability matrix — 1.2

This describes implemented behavior, not universal application or file-format parity. See [Advanced workflows](ADVANCED.md) for controls, security limits, interchange scope and test methods.

| Area | Implemented | Boundaries |
| --- | --- | --- |
| Drawing | Lines/arrows, rectangles/ellipses, polylines, polygons, freehand, editable quadratic/cubic and exact three-point circular arcs | Circular input must be non-collinear; display curves are adaptively tessellated |
| Pressure ink | Pen pressure/coalesced samples, adjustable response, editable centerline and variable-width vector ribbon | Tilt metadata does not drive a nib; 2,000 samples per gesture; no textured brush/palm-rejection engine |
| Regions | Union/intersection/difference/xor, compound holes/disconnected boundaries, editable vertices, nonzero/even-odd tessellation | Curved boolean operands become polygon contours; floating-point tolerance and edge budgets; no symbolic curve booleans |
| Stroke/fill | Solid/dash/dot/dash-dot, no fill/stroke, width, cap/join, opacity, endpoint markers, format copy/paste | No gradients/pattern fills; ordinary translucent stroke joins can differ between backends |
| Rich text | Validated paragraphs/runs, wrapping, fonts/sizes/colors/marks, script baselines, lists/indentation/alignment, SVG links | No rich connector labels, tables, installed-font embedding or per-character collaborative merge |
| Images | Embedded PNG/JPEG/WebP, drop/paste/file import, description, non-destructive crop, contain/cover/stretch, transforms, renderer/export integration | Raster allowlist and byte/pixel/cache limits; active SVG/OLE and remote image URLs rejected |
| Transforms/selection | Eight grips, rotated local resizing, centered/proportional resize, rotation/flips, groups, object/layer locks, crossing/containment/lasso, nudge, guides, auto-pan | No shear; rotated collections resize proportionally; lasso uses full bounds; group styling does not cascade |
| Connections/structure | Port glue, orthogonal obstacle routing, reconnect, waypoints, group route transforms, containers/swimlanes/layers, outline, align/distribute/layout constraints | No connector jumps, global crossing optimization, cross-page identities or general symbolic solver |
| Canvas/pages | Fixed/auto/infinite, negative origins, presets/custom dimensions, units/scaled rulers, grid spacing, page management | Finite model/resource limits; no background-page inheritance |
| Collaboration | Field-register convergence, tombstones, dependency repair, same-origin BroadcastChannel, manual WebRTC offer/answer, presence, in-session offline merge, ownership-aware undo | No hosted signaling/relay/cloud accounts, roles or durable CRDT-log restoration after session close; atomic rich/geometry conflicts |
| Native interchange | VSDX package import/export, VDX XML import, standard pages/media/master/style/group/connector records, conversion report, independent ZIP/DEFLATE/XML readers | Not all schema records; no legacy VSD binary, arbitrary rational spline configurations, macro/runtime parity or embedded application objects |
| Data/documents | Versioned JSON, shape data/expressions, CSV binding, stencil JSON, validation, autosave/recovery/history, multipage projects | Browser-local persistence; no enterprise data connector or business-rule runtime |
| Export/print | Native Q/C/A SVG, selection SVG, embedded-image PNG, native packages, tiled/all-page/fit-sheet print HTML and browser printing | Native standard curves tessellate; no editable PDF import or physical-printer certification |
| Rendering | Shared scene, retained WebGPU geometry/text/images, Canvas fallback, culling, worker routing, bounded caches/raster export | CI software adapter is not physical GPU coverage or universal pixel-golden/performance certification |

## Verification

`npm test` covers core model/geometry/transactions/interchange/print/convergence behavior. Existing browser regressions remain, and `tests/advanced_browser.py` adds real UI/pen/image/export/print, storage and peer-transport checks. CI retains JSON reports, TAP logs and screenshots. Fixture tests use injected persistence and are not represented as HTTP storage or WebGPU verification. Performance and printer fidelity still require target-device measurements.
