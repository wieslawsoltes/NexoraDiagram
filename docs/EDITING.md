# Drawing and editing workflows

## Drawing tools

Open **Draw**, choose a tool, and drag on the canvas. The tools stay selected for repeated use; press V to return to Pointer. The floating toolbar also exposes Line and Freehand.

| Tool | Input and stored geometry |
| --- | --- |
| Line / Arrow | Drag two endpoints. Arrow defaults to a triangle end marker. Shift constrains the direction to 45-degree increments. |
| Rectangle / Ellipse | Drag the bounds. Shift makes a square/circle. |
| Polyline | Click successive vertices. Enter or double-click finishes. Backspace removes the last draft vertex. Clicking the first point closes a polygon. |
| Polygon | Click at least three vertices, then Enter, double-click, or click the first vertex. Concave simple polygons are supported; self-intersecting filled boundaries are rejected. |
| Freehand | Drag with mouse, pen, or touch. Sampled vertices are simplified into an editable polyline. Width is constant; pressure/tilt is not currently interpreted. |
| Arc | Drag endpoints to create a quadratic arc. Edit points exposes its single control point. This is a quadratic curve, not an exact circular-arc primitive. |
| Bézier | Drag endpoints to create a cubic curve. Edit points exposes both controls and endpoints. |

All path geometry is stored as normalized points in a document-space bounding box. A horizontal/vertical line uses a one-unit minimum envelope without changing its endpoint coordinates. Moving, resizing, grouping, saving, copying, undoing, and exporting operate on that geometry. The renderer adaptively subdivides quadratic/cubic paths; the project retains their original controls. SVG currently emits vector polylines at the renderer's subdivision tolerance rather than native Q/C commands.

Escape cancels a draft or active gesture. Pointer cancellation, lost capture, window blur during a drag, and the start of a two-finger pinch roll back an active edit instead of leaving a partially committed object. A completed pointer gesture is one history command.

## Formatting

Properties → Stroke & transform provides color, line weight (0–64 document units), solid/dash/dot/dash-dot patterns, butt/round/square caps, miter/round/bevel joins, opacity (0–1), and independent start/end markers. Markers are none, triangle, open arrow, diamond, or circle. No fill and No stroke are explicit actions. A zero-width stroke is not drawn.

With no selection, these controls set drawing defaults for the session. With an editable selection, the same controls update selected objects and the defaults for new drawings. Copy format / Paste format copies these style properties without copying geometry or labels. Groups are structural: select their members with Ctrl/Cmd-click or the Outline to format individual child shapes.

## Selection and transforms

Ctrl/Cmd+A and Home → Select all select visible, editable objects, excluding locks. Shift-click toggles membership. Plain clicks preserve an existing multi-selection when clicking a member. Ctrl/Cmd-click reaches a member inside a group. A drag from empty space inside a multi-selection's bounding rectangle moves the selection; Shift-drag there starts an additive marquee instead.

Drag empty canvas rightward for full containment, leftward for crossing selection. Lasso selects fully enclosed object bounds and connector route points. Hidden and locked objects are excluded. Arrow keys nudge by one document unit; Shift+Arrow uses the configured grid spacing. Holding Shift during movement constrains one axis. Alt temporarily disables snapping/guides for movement. Smart guides snap aligned edges/centers. Dragging near a viewport edge auto-pans while capture remains active.

Shapes and multi-selections have four corner and four side grips. Side grips change one dimension; corners change both. Shift preserves proportions. Alt keeps the center fixed. Rotated single-shape resizing works in the shape's local axes. A multi-selection containing rotated shapes is proportionally resized, avoiding an unrepresentable affine shear. Numeric multi-selection resizing rejects rotated collections; use proportional grips instead. All dimensions must satisfy each member's minimum size. Layout containers continue to fit their contents.

The round grip above the selection rotates it. Shift snaps rotation to 15-degree steps. Properties has exact rotation for individual shapes plus 90-degree and horizontal/vertical flip actions. Layout containers cannot be rotated/flipped as if they were ordinary shapes; groups of ordinary shapes can. Text rotates with its shape but is not mirrored by Flip.

Group / Ungroup (Ctrl/Cmd+G / Ctrl/Cmd+Shift+G) creates/removes persistent parent identities. Groups contain shapes, not detached connector endpoints. Internal connectors stay attached and manual waypoints transform exactly once. Dragging only a connector bends its route through movable waypoints; its endpoint attachments remain intact. Use the endpoint grips to reconnect it. Standalone lines/arrows have free endpoints and do not require graph attachments.

Object locks supplement layer locks. A group containing locked descendants cannot move or resize those descendants. Unlock selection removes object locks, not layer/ancestor locks. Undo can reverse locking.

## Page setup

Page setup is accessible even while shapes are selected. Paper presets include A0–A5, Letter, Legal, and Tabloid. Custom fixed paper dimensions are 200–100,000 document pixels. The renderer uses a viewport-sized backing surface regardless of paper dimensions. Zoom extends down to 0.1% to fit large pages; ruler spacing adapts to zoom rather than generating a tick for every document unit.

Fixed mode keeps paper bounds unchanged. Auto-size expands the paper in 200-unit tiles, including negative directions. Expansion participates in the same transaction as the edit and is undoable. Infinite mode hides paper boundaries and does not expand the stored page size. Its viewport can pan freely, but it is not mathematically infinite: document coordinates and shape dimensions remain subject to finite validation bounds (magnitude at most 1,000,000), object-count limits, and browser resources.

Units are px/mm/cm/in at 96 document pixels per inch. They affect page-dimension entry and ruler display; geometry is stored in document pixels. Drawing scale is a display conversion (1:n), not a general engineering constraint solver. Grid spacing remains in document pixels. Settings are per-page and survive JSON round-trip, duplicate-page, history, and browser storage.

Fit drawing fits content in the viewport. Fit page fits the paper, or content in infinite mode. Fit page to drawing changes the page to fixed mode with padding and an origin that includes negative coordinates. Page reorder, duplicate, and delete remain undoable.

## Export and print

SVG and PNG export visible content and current graph routes, independent of viewport culling. Fixed/auto mode uses the configured paper rectangle. Infinite mode uses finite drawing bounds. Selection SVG includes selected group descendants and their internal connectors. Styles, rotated labels, and object identities survive SVG export. PNG uses the SVG vector output and caps resolution at 8,192 pixels per axis and approximately 32 megapixels.

Print sends the current page to a browser print frame and fits it to one sheet. Paper choice, margins, printer output, and PDF saving are supplied by the browser. Tiled poster printing, bleed, crop marks, and imposed multi-page print layouts are not implemented.

## Keyboard

| Action | Shortcut |
| --- | --- |
| Pointer / connector / pan | V / C / H |
| Line / freehand / cubic curve | L / P / B |
| Rectangle / ellipse / text | R / E / T |
| Temporary pan | Space-drag; middle/right drag |
| Finish multi-point path | Enter or double-click |
| Remove draft vertex / cancel | Backspace / Escape |
| Group / ungroup | Ctrl/Cmd+G / Ctrl/Cmd+Shift+G |
| Find labels or shape data | Ctrl/Cmd+F |
| Print current page | Ctrl/Cmd+P |
| Select all / copy / paste / duplicate | Ctrl/Cmd+A / C / V / D |
| Undo / redo | Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z |
| Save portable project | Ctrl/Cmd+S |
| Zoom | Ctrl/Cmd+wheel; two-finger pinch |

Shortcuts do not intercept text inputs, property fields, or modal dialogs.
