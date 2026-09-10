# Capability matrix

This matrix describes the implemented Nexora engine. It is not a claim of universal application or file-format parity. The implementation is independently written, with no imported proprietary application code, stencils, icons, or binary formats.

| Area | Implemented | Boundaries |
| --- | --- | --- |
| Drawing | Free lines/arrows, rectangles, ellipses, polylines, filled simple polygons, freehand polylines, editable quadratic/cubic curves | Constant-width pen; no pressure/tilt, compound holes, self-intersecting fills, path boolean operations, or exact circular arcs |
| Stroke/fill | Solid/dash/dot/dash-dot, no-fill/no-stroke, width, cap/join, opacity, five marker choices at both ends, format copy/paste | GPU triangle overdraw can differ from Canvas/SVG for translucent overlapping joins; no gradient/pattern fills or pixel-identical backend certification |
| Transforms | Eight grips, rotated single-shape resizing, proportional/centered resizing, rotation, flips, group transforms, numeric geometry | No shear; rotated multi-selections use proportional grips; layout containers are not rotatable; text is not mirrored |
| Selection | Select all, additive, containment/crossing marquee, lasso, group-member drill-down, empty-bounds dragging, nudge, object/layer locks, edge auto-pan, smart guides | Lasso is full-bounds containment rather than partial silhouette intersection; structural group styling does not cascade to all children |
| Connections | Port attachment, orthogonal obstacle routing, endpoint reconnect, manual waypoints, attached route dragging, waypoint-preserving group moves | Graph connectors remain attached; no connector jumps, edge bundling, global crossing optimization, cross-page identities, or free graph endpoints (use standalone lines) |
| Canvas/pages | Fixed/auto/infinite modes, negative origins, paper presets, custom size, orientation, units, drawing-scale ruler display, grid spacing, fit content, page reorder/duplicate/delete | Finite coordinate/object validation limits still apply; no background-page inheritance or tiled poster printing |
| Structure | Persistent groups, containers, swimlanes, layers, outline, z-order actions, align/distribute, persistent alignment constraints, automatic layout | Bounded projection/layout solvers, not general symbolic constraints or every specialized diagram notation |
| Data | Shape data, label expressions, CSV binding/update, find by label/data, programmable polygon stencils, stencil JSON import/export, validation | No database connection manager, live enterprise-data refresh service, general business-rule execution, or macro runtime |
| Documents | Native versioned JSON, validation on import, undo/redo, autosave/recovery, multi-page projects | Browser-local workspace; no collaborative editing, cloud sync, conflict resolution, native third-party document translators, or proprietary macro execution |
| Delivery | Modular app, standalone HTML, SVG, selection SVG, PNG, single-sheet browser print | SVG curve output is adaptive vector polylines; no rich-text layout engine, embedded images, editable PDF import, manufacturing interchange, or proprietary native export |
| Rendering | Retained WebGPU geometry/text, shared scene, Canvas fallback, viewport culling, worker routing, bounded raster export | CI software-adapter verification is not physical GPU coverage, pixel-golden conformance, or a throughput guarantee for 50,000 objects |

## Verification

`npm test` covers the model, routing, history, geometry, transforms, style validation, dash/marker tessellation, page modes, export, server, and build behavior. `tests/browser_test.py` covers the existing editor workflows. `tests/editor_browser.py` performs real pointer/keyboard gestures on the new drawing, grips, style, group, lock, page, and export workflows. The HTTP variants verify real browser persistence; the explicitly named fixture variant uses injected persistence and must not be described as storage/GPU verification.

The Editor regression tests workflow retains source, JSON results, and screenshots. GPU mode requires the WebGPU backend and command completion; it does not treat Canvas fallback as a GPU pass. Performance and visual conformance need measurement on target physical devices.
