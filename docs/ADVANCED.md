# Advanced authoring and interchange

Version 1.2 adds the **Advanced** ribbon. Every authoring operation changes the validated document and uses the existing history, browser persistence and export pipelines. The browser application remains dependency-free.

## Rich text

Select a shape and choose **Rich text**. The editor supports individual bold, italic, underline and strike-through runs; superscript/subscript; three portable font families; sizes and colors; paragraph alignment/justification; indentation; numbered and bulleted lists; and HTTP(S)/mailto links. Reopening or double-clicking a rich shape restores its structured content. Plain label editing intentionally replaces rich formatting.

The project stores paragraphs and runs, never executable HTML. Paste inserts plain text. Links are retained in SVG output; the drawing canvas does not navigate them. Layout uses browser font metrics, wrapping and run-specific styles, with Canvas and WebGPU text-atlas output. Bounds are 200 paragraphs, 4,096 runs and 10,000 characters per shape. This is not a word processor: tables, arbitrary installed font embedding, per-character collaborative merging and rich connector labels are not implemented. Rich runs are literal text, not independently evaluated data expressions.

## Embedded images

**Embed image**, paste an image file, or drop a raster onto the canvas. PNG, JPEG and WebP bytes are embedded inside the document; no external asset server is required. Ordinary grips move/resize/rotate/flip the image. **Image crop** provides contain/cover/stretch placement, an accessible description and normalized non-destructive cropping. The original pixels remain available after cropping.

Both renderers preserve image/geometry draw order. SVG includes the embedded raster data, and PNG and print use the same crop and transforms. Imports check file signatures, header dimensions, decoded dimensions and byte limits. Each image is bounded to 8 MB, 8,192 pixels per axis and 32 megapixels. Active SVG, linked images and embedded executable/OLE objects are not accepted as raster assets. Decoded image/texture caches have resource limits; large documents are still bounded by browser memory and the 50 MB project limit.

## Pressure ink

Use Freehand with a pen. Coalesced pointer samples retain position, pressure and tilt metadata. Pressure changes the actual filled vector ribbon, not merely a transient preview. **Pressure ink** controls nominal width, influence and response exponent. Mouse/touch use neutral pressure. The centerline and pressure samples remain editable, copyable and undoable; changing the response re-evaluates the ribbon.

The renderer uses nonzero winding and non-overlapping scanline fill triangles for crossing ribbons. SVG/PNG preserve the resulting outline. Tilt is recorded for interchange but does not currently change the nib. There is no physical pen calibration, textured brush engine or palm-rejection implementation beyond browser pointer handling. A gesture retains at most 2,000 samples.

## Exact arcs and vector boolean operations

**Circular arc** uses three clicks: start, a point on the arc, end. The circumcircle and signed sweep are evaluated analytically. Three defining controls remain editable; collinear input is rejected. Nonuniform resizing produces an elliptical arc. Native SVG output uses `A`, while quadratic/cubic curves use `Q`/`C`. Canvas/WebGPU subdivide curves for display; the source controls are not replaced by those display samples.

Select two or more closed regions or pressure strokes and choose **Union**, **Intersect**, **Subtract** or **Exclude**. Subtract removes later selected operands from the first selected shape. The result is editable compound geometry with holes and disconnected contours. The first shape identity is retained; attached connector references are redirected before other operands are removed. An empty result removes the operands. One undo restores the entire operation.

Operations split a planar segment arrangement at crossings and collinear overlaps, classify material on either side, and stitch oriented boundary contours. Scanline tessellation supports even-odd and nonzero winding. Curved input is flattened at the rendering tolerance before boolean evaluation; results are polygon contours, not symbolic exact curve booleans. Floating-point tolerances and a 4,000-edge operand budget apply. Images/text/structural containers are not boolean operands. Compound vertices can be moved; compound-contour vertex insertion/deletion is not provided by the linear-path commands.

## Live collaboration

Open **Collaborate**, enter a display name and room ID, and start a session. A second tab on the same browser origin may choose **Join and replace workspace**. Joining replaces the joining tab's document only after a valid host snapshot arrives. Editing is paused while waiting. Save a backup first.

Remote peers use reliable, ordered, encrypted WebRTC data channels. The host creates an offer; the joining editor pastes it and creates an answer; the host pastes and accepts that answer. Invitations use the same room ID. No account, hosted signaling service, public discovery or external relay is contacted by default. Optional STUN/TURN configuration is supplied by the user and contacted only when creating a connection. NAT/firewall conditions can require TURN. A deployment on HTTPS or a secure local origin is required for remote browser APIs.

The collaboration engine uses Lamport-ordered field registers, persistent-in-session deletion tombstones and deterministic structure repair. Independent style and shape-data fields merge. Geometry, rich text, image records and connector records are atomic: concurrent edits to the same record have one deterministic winning value, not a character-level merge. Missing dependencies remain in the register state until available. Invalid operations roll back atomically. Cursor/name presence is transient.

Remote updates wait until the current local gesture finishes. Undo checks the current field's collaboration stamp and value, preserving changes made later by another peer. Commands made before the session do not have ownership stamps and are conservatively skipped. Offline edits merge through snapshots when peers reconnect **while their sessions remain open**. The resulting document is autosaved, but the CRDT register log, network invitations and peer membership are not durably restored after closing/reloading the session. This is peer editing, not a hosted cloud workspace.

Treat the room and invitation as editing capabilities. Anyone holding them can edit. There are no roles, account authentication, moderation or end-to-end identity verification beyond the WebRTC connection. BroadcastChannel is same-origin, not an authorization boundary against other scripts on that origin. The UI states these constraints before sharing.

## Native drawing packages

**Import drawing** accepts `.vsdx` OPC/ZIP packages and `.vdx` XML interchange. **Export package** writes `.vsdx` with standard document/page/media/relationship parts. The independent reader handles stored and DEFLATE ZIP members, CRC verification, bounded expansion and path traversal rejection. XML is parsed inertly; DTDs, external entities, unsafe object keys and malformed structures are rejected. External relationships and active payloads are not executed.

Supported records include multiple pages, inherited master/style cells, groups and transforms, outline geometry, shape data, text/rich character runs, embedded raster media, connector glue and manual route points. Geometry includes move/line/relative line, polylines, ellipses, circular/elliptical arcs, quadratic/cubic curves and the documented polynomial NURBS subset. Cached numeric cells and bounded arithmetic/coordinate references are evaluated without a general script runtime. Native curves are currently imported as subdivided vector paths at 0.192 document-pixel tolerance.

The conversion report appears before replacing the workspace and can be downloaded. Unsupported geometry, media, coordinate expressions and active content are reported. This is **not universal native-format compatibility**: legacy compound-binary `.vsd`, arbitrary rational spline knot configurations, embedded application objects, macros and the full symbolic shape-formula language are not implemented. Unsupported spline configurations retain a reported endpoint chord; review warnings before accepting a conversion. Themes, complex native text blocks, stencil behaviors and specialized notation can differ. Do not use a warning-free synthetic roundtrip as proof that every external file is supported.

Exports also contain a Nexora extension preserving the complete editable JSON. A manifest of standard-part names, lengths and checksums detects changes by other editors; the extension is restored only when those parts remain unchanged. Otherwise the standard parts are parsed normally, so stale extension data does not silently overwrite external edits. This manifest detects changes; it is not a cryptographic authenticity signature. Standard output outlines are tessellated, and external editors may approximate unsupported rich marks or image crops even though Nexora's extension roundtrip is lossless.

### Independent interoperability checks

`tests/fixtures/external-generator.vdx` was produced by Graphviz from a three-node graph and imports without conversion warnings, including coordinate formulas, ellipse geometry, text and polynomial spline rows. It was not produced by Nexora. A package generated by Nexora was also opened through the separately installed LibreOffice drawing importer and converted to SVG. These checks exercise independent producers/readers; they are smoke tests, not certification of all schema features or application versions.

## Tiled printing

**Tiled print** selects current/all document pages, A4/A3/Letter/Legal/Tabloid, orientation, margin, scale, overlap and registration labels. Preview generates the actual sheets. **Save printable HTML** exports a self-contained vector/image print document. Choose **Fit each drawing page to one sheet** for ordinary one-sheet output.

Coordinates remain document pixels at 96 pixels per inch. At a requested scale, overlap is computed in physical millimeters. Negative drawing origins are retained. Plans are bounded to 400 sheets per drawing page. Print calls the browser's native print flow, where PDF saving may be available. Choose the same paper/orientation, 100% browser scaling and no browser headers/footers. Physical printer margins, driver behavior and color accuracy require device-specific verification.

## Verification

`npm test` includes geometry, pressure, structured text, raster validation, ZIP/DEFLATE, inert XML, independent native fixtures, package roundtrips, print planning and collaboration convergence/security tests. `tests/advanced_browser.py` performs authoring through the real UI, pen input, cropped-image pixel readback, SVG/PNG/native downloads, native import confirmation and actual print preview sheets. HTTP mode additionally verifies browser storage, BroadcastChannel, WebRTC, conflict-safe undo and reconnection. GPU mode requires the actual WebGPU backend, pixel readback and completed submitted commands; fallback is never a GPU pass. Fixture mode excludes network/storage/GPU claims.
