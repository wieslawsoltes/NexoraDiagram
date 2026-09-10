/** Editable vector paths and transforms. Pure geometry, independent of the UI and renderer. */
import { bounds, boxPoints, distance, pointSegmentDistance, clamp, isSimplePolygon } from './geometry.js';
export const DRAW_TOOLS = ['line', 'arrow', 'rectangle', 'ellipse', 'polyline', 'polygon', 'pencil', 'arc', 'bezier'];
export const DRAW_STYLE = { fill: '#dcecff', stroke: '#456a91', strokeWidth: 2, dash: 'solid', lineCap: 'round', lineJoin: 'round', opacity: 1, startArrow: 'none', endArrow: 'none' };
export const HANDLES = [['nw', 0, 0], ['n', .5, 0], ['ne', 1, 0], ['e', 1, .5], ['se', 1, 1], ['s', .5, 1], ['sw', 0, 1], ['w', 0, .5]];
export const normalizeAngle = angle => ((angle % 360) + 360) % 360;
export function rotatePoint(p, center, angle) {
  const r = angle * Math.PI / 180, c = Math.cos(r), s = Math.sin(r), x = p.x - center.x, y = p.y - center.y;
  return { x: center.x + x * c - y * s, y: center.y + x * s + y * c };
}
export function transformPoint(p, g, inverse = false) {
  const center = { x: g.x + g.w / 2, y: g.y + g.h / 2 };
  let q = inverse ? rotatePoint(p, center, -(g.rotation || 0)) : { ...p };
  if (g.flipX) q.x = center.x * 2 - q.x;
  if (g.flipY) q.y = center.y * 2 - q.y;
  return inverse ? q : rotatePoint(q, center, g.rotation || 0);
}
export function geometryBounds(g) {
  return g.rotation ? bounds(boxPoints(g).map(p => rotatePoint(p, { x: g.x + g.w / 2, y: g.y + g.h / 2 }, g.rotation))) : { x: g.x, y: g.y, w: g.w, h: g.h };
}
export function handlePoints(g) {
  const center = { x: g.x + g.w / 2, y: g.y + g.h / 2 };
  return HANDLES.map(([name, x, y]) => ({ name, ...rotatePoint({ x: g.x + g.w * x, y: g.y + g.h * y }, center, g.rotation || 0) }));
}
export function pathControls(g) {
  return (g.path || []).map(p => transformPoint({ x: g.x + p.x * g.w, y: g.y + p.y * g.h }, g));
}
export function pathGeometry(points, mode = 'linear', closed = false) {
  if (points.length < 2 || points.length > 4096 || points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) throw new Error('A path requires 2–4096 finite points.');
  const b = bounds(points); b.w = Math.max(1, b.w); b.h = Math.max(1, b.h);
  return { ...b, path: points.map(p => ({ x: (p.x - b.x) / b.w, y: (p.y - b.y) / b.h })), pathMode: mode, closed, rotation: 0, flipX: false, flipY: false };
}
/** Adaptive de Casteljau subdivision; preserves exact control points in the project. */
export function flattenPath(g, tolerance = .4) {
  const controls = pathControls(g);
  if (!['quadratic', 'cubic'].includes(g.pathMode)) return controls;
  const output = [controls[0]];
  function split(ps, depth) {
    if (depth >= 10 || ps.slice(1, -1).every(p => pointSegmentDistance(p, ps[0], ps.at(-1)) <= tolerance)) { output.push(ps.at(-1)); return; }
    const left = [ps[0]], right = [ps.at(-1)]; let row = ps;
    while (row.length > 1) { row = row.slice(1).map((p, i) => ({ x: (p.x + row[i].x) / 2, y: (p.y + row[i].y) / 2 })); left.push(row[0]); right.unshift(row.at(-1)); }
    split(left, depth + 1); split(right, depth + 1);
  }
  split(controls, 0); return output;
}
/** Iterative Ramer–Douglas–Peucker, avoiding recursion on long pen strokes. */
export function simplifyPath(points, tolerance = .7) {
  if (points.length <= 2) return points.map(p => ({ ...p }));
  const keep = new Set([0, points.length - 1]), stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop(); let far = tolerance, index = -1;
    for (let i = first + 1; i < last; i++) { const d = pointSegmentDistance(points[i], points[first], points[last]); if (d > far) { far = d; index = i; } }
    if (index >= 0) { keep.add(index); stack.push([first, index], [index, last]); }
  }
  return [...keep].sort((a, b) => a - b).map(i => ({ x: points[i].x, y: points[i].y }));
}
export function validatePath(g) {
  if (!Array.isArray(g.path) || g.path.length < 2 || g.path.length > 4096 || g.path.some(p => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < -1e-7 || p.x > 1.0000001 || p.y < -1e-7 || p.y > 1.0000001)) throw new Error('Invalid normalized drawing path.');
  if (!['linear', 'quadratic', 'cubic'].includes(g.pathMode || 'linear')) throw new Error('Unknown path mode.');
  if (g.pathMode === 'quadratic' && g.path.length !== 3 || g.pathMode === 'cubic' && g.path.length !== 4) throw new Error('A curve has an invalid number of control points.');
  if (typeof g.closed !== 'boolean') throw new Error('A drawing path must specify whether it is closed.');
  if (g.closed && (g.path.length < 3 || !isSimplePolygon(flattenPath(g)))) throw new Error('A filled path must be a non-self-intersecting polygon.');
}
export function constrainPoint(start, p, enabled) {
  if (!enabled) return { ...p };
  const length = distance(start, p), angle = Math.round(Math.atan2(p.y - start.y, p.x - start.x) / (Math.PI / 4)) * Math.PI / 4;
  return { x: start.x + Math.cos(angle) * length, y: start.y + Math.sin(angle) * length };
}
/** Side handles affect one dimension; Shift preserves ratio and Alt keeps the center fixed. */
export function resizeGeometry(original, handle, world, { proportional = false, centered = false, minimum = 1 } = {}) {
  const o = original, center = { x: o.x + o.w / 2, y: o.y + o.h / 2 }, p = rotatePoint(world, center, -(o.rotation || 0));
  const east = handle.includes('e'), west = handle.includes('w'), north = handle.includes('n'), south = handle.includes('s');
  let w = o.w, h = o.h;
  if (east) w = p.x - (centered ? center.x : o.x);
  if (west) w = (centered ? center.x : o.x + o.w) - p.x;
  if (south) h = p.y - (centered ? center.y : o.y);
  if (north) h = (centered ? center.y : o.y + o.h) - p.y;
  if (centered) { if (east || west) w *= 2; if (north || south) h *= 2; }
  w = clamp(w, minimum, 1e6); h = clamp(h, minimum, 1e6);
  if (proportional) {
    const ratio = o.w / o.h;
    if (!(north || south)) h = w / ratio;
    else if (!(east || west)) w = h * ratio;
    else if (Math.abs(w / o.w - 1) > Math.abs(h / o.h - 1)) h = w / ratio;
    else w = h * ratio;
    const factor = Math.max(minimum / w, minimum / h, 1); w *= factor; h *= factor;
    const limit = Math.min(1, 1e6 / w, 1e6 / h); w *= limit; h *= limit;
  }
  const x = centered || !(east || west) ? center.x - w / 2 : west ? o.x + o.w - w : o.x;
  const y = centered || !(north || south) ? center.y - h / 2 : north ? o.y + o.h - h : o.y;
  const movedCenter = rotatePoint({ x: x + w / 2, y: y + h / 2 }, center, o.rotation || 0);
  return { ...o, x: movedCenter.x - w / 2, y: movedCenter.y - h / 2, w, h };
}
export function strokeDash(g) {
  const unit = Math.max(1, g.strokeWidth ?? g.width ?? 1);
  switch (g.dash || (g.dashed ? 'dash' : 'solid')) {
    case 'dash': return [unit * 4, unit * 3];
    case 'dot': return [unit, unit * 2];
    case 'dashdot': return [unit * 4, unit * 2, unit, unit * 2];
    default: return [];
  }
}
