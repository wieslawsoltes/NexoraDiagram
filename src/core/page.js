/** Page extents stay independent of camera size and raster allocation. One document unit is 1/96 inch. */
import { bounds, union, inflate } from './geometry.js';
import { geometryBounds } from './drawing.js';
export const UNIT_SCALE = { px: 1, mm: 96 / 25.4, cm: 96 / 2.54, in: 96 };
export const PAGE_PRESETS = { A5: [559.37, 793.70], A4: [793.70, 1122.52], A3: [1122.52, 1587.40], A2: [1587.40, 2245.04], A1: [2245.04, 3178.58], A0: [3178.58, 4493.86], Letter: [816, 1056], Legal: [816, 1344], Tabloid: [1056, 1632] };
export function pageBounds(page) { return { x: page.originX || 0, y: page.originY || 0, w: page.width, h: page.height }; }
export function contentBounds(page, ids = null, routes = null) {
  let box;
  for (const [id, g] of Object.entries(page.view.nodes)) if (!ids || ids.has(id)) box = union(box, inflate(geometryBounds(g), Math.max(0, g.strokeWidth || 0) * 2 + (g.startArrow && g.startArrow !== 'none' || g.endArrow && g.endArrow !== 'none' ? 10 : 0)));
  for (const [id, g] of Object.entries(page.view.edges)) if (!ids || ids.has(id)) {
    const points = routes?.get(id)?.points || g.waypoints || [];
    if (points.length) box = union(box, inflate(bounds(points), 12 + (g.strokeWidth || 0)));
  }
  return box;
}
export function fitPageToContent(page, padding = 40, routes = null) {
  const box = inflate(contentBounds(page, null, routes) || { x: 0, y: 0, w: 320, h: 200 }, padding);
  page.originX = Math.floor(box.x); page.originY = Math.floor(box.y);
  page.width = Math.max(200, Math.ceil(box.x + box.w) - page.originX); page.height = Math.max(200, Math.ceil(box.y + box.h) - page.originY); page.canvasMode = 'fixed';
}
export function autoSizePage(page) {
  if (page.canvasMode !== 'auto') return;
  const box = contentBounds(page); if (!box) return;
  const old = pageBounds(page), content = inflate(box, 40);
  // Expand only overflowing axes. A 200-unit tile avoids continuous paper-edge jitter.
  const x = Math.min(old.x, Math.floor(content.x / 200) * 200), y = Math.min(old.y, Math.floor(content.y / 200) * 200);
  const right = Math.max(old.x + old.w, Math.ceil((content.x + content.w) / 200) * 200), bottom = Math.max(old.y + old.h, Math.ceil((content.y + content.h) / 200) * 200);
  page.originX = x; page.originY = y; page.width = right - x; page.height = bottom - y;
}
export function validatePageSettings(page) {
  if (page.canvasMode !== undefined && !['fixed', 'auto', 'infinite'].includes(page.canvasMode)) throw new Error('Unknown canvas mode.');
  for (const key of ['originX', 'originY']) if (page[key] !== undefined && (!Number.isFinite(page[key]) || Math.abs(page[key]) > 1e6)) throw new Error('Invalid page origin.');
  if (page.units !== undefined && !Object.hasOwn(UNIT_SCALE, page.units)) throw new Error('Unknown measurement units.');
  if (page.gridSize !== undefined && (!Number.isFinite(page.gridSize) || page.gridSize < 1 || page.gridSize > 1000)) throw new Error('Grid spacing must be between 1 and 1000 units.');
  if (page.drawingScale !== undefined && (!Number.isFinite(page.drawingScale) || page.drawingScale < .001 || page.drawingScale > 1e6)) throw new Error('Invalid drawing scale.');
}
