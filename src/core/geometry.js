/** Geometry is expressed in document units (CSS pixels at 100%). */
export const EPS = 1e-7;
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const round = (v, n = 3) => Math.round(v * 10 ** n) / 10 ** n;
export const rect = (x, y, w, h) => ({ x, y, w, h });
export const inflate = (r, n) => rect(r.x - n, r.y - n, r.w + n * 2, r.h + n * 2);
export const intersects = (a, b) => a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;
export const contains = (r, p) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
export const inside = (r, p) => p.x > r.x + EPS && p.x < r.x + r.w - EPS && p.y > r.y + EPS && p.y < r.y + r.h - EPS;
export const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const union = (a, b) => !a ? { ...b } : rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x + a.w, b.x + b.w) - Math.min(a.x, b.x), Math.max(a.y + a.h, b.y + b.h) - Math.min(a.y, b.y));
export function bounds(points) {
  if (!points.length) return rect(0, 0, 0, 0);
  let x = Infinity, y = Infinity, X = -Infinity, Y = -Infinity;
  for (const p of points) { x = Math.min(x, p.x); y = Math.min(y, p.y); X = Math.max(X, p.x); Y = Math.max(Y, p.y); }
  return rect(x, y, X - x, Y - y);
}
export function pointSegmentDistance(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1), 0, 1);
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
export function polylineDistance(p, points) {
  let d = Infinity;
  for (let i = 1; i < points.length; i++) d = Math.min(d, pointSegmentDistance(p, points[i - 1], points[i]));
  return d;
}
export function pointInPolygon(p, points) {
  let hit = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i], b = points[j];
    if (pointSegmentDistance(p, a, b) < EPS) return true;
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}
export function orthogonalSegmentHits(a, b, r) {
  if (Math.abs(a.x - b.x) < EPS) return a.x > r.x + EPS && a.x < r.x + r.w - EPS && Math.max(a.y, b.y) > r.y + EPS && Math.min(a.y, b.y) < r.y + r.h - EPS;
  if (Math.abs(a.y - b.y) < EPS) return a.y > r.y + EPS && a.y < r.y + r.h - EPS && Math.max(a.x, b.x) > r.x + EPS && Math.min(a.x, b.x) < r.x + r.w - EPS;
  return true;
}
export function simplifyPolyline(points) {
  const out = [];
  for (const p of points) {
    if (out.length && distance(out.at(-1), p) < EPS) continue;
    while (out.length > 1) {
      const a = out.at(-2), b = out.at(-1);
      const sameX = Math.abs(a.x - b.x) < EPS && Math.abs(b.x - p.x) < EPS;
      const sameY = Math.abs(a.y - b.y) < EPS && Math.abs(b.y - p.y) < EPS;
      // Only remove forward-going collinear vertices, never a reversal.
      if ((sameX || sameY) && (b.x - a.x) * (p.x - b.x) + (b.y - a.y) * (p.y - b.y) >= 0) out.pop(); else break;
    }
    out.push({ x: p.x, y: p.y });
  }
  return out;
}
export function pointAlong(points, fraction = 0.5) {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += distance(points[i - 1], points[i]);
  let remaining = total * fraction;
  for (let i = 1; i < points.length; i++) {
    const n = distance(points[i - 1], points[i]);
    if (remaining <= n) { const t = remaining / (n || 1); return { x: points[i - 1].x + (points[i].x - points[i - 1].x) * t, y: points[i - 1].y + (points[i].y - points[i - 1].y) * t }; }
    remaining -= n;
  }
  return points.at(-1) || { x: 0, y: 0 };
}
const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
export function polygonArea(p) { let area = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; area += a.x * b.y - b.x * a.y; } return area / 2; }
export function isSimplePolygon(p) {
  const segmentHit = (a, b, c, d) => {
    const c1 = cross(a, b, c), c2 = cross(a, b, d), c3 = cross(c, d, a), c4 = cross(c, d, b);
    if (c1 * c2 < -EPS && c3 * c4 < -EPS) return true;
    return Math.abs(c1) < EPS && pointSegmentDistance(c, a, b) < EPS || Math.abs(c2) < EPS && pointSegmentDistance(d, a, b) < EPS || Math.abs(c3) < EPS && pointSegmentDistance(a, c, d) < EPS || Math.abs(c4) < EPS && pointSegmentDistance(b, c, d) < EPS;
  };
  if (p.length < 3 || Math.abs(polygonArea(p)) < EPS) return false;
  for (let i = 0; i < p.length; i++) {
    if (distance(p[i], p[(i + 1) % p.length]) < EPS) return false;
    for (let j = i + 1; j < p.length; j++) {
      if (j === i + 1 || (i === 0 && j === p.length - 1)) continue;
      if (segmentHit(p[i], p[(i + 1) % p.length], p[j], p[(j + 1) % p.length])) return false;
    }
  }
  return true;
}
/** Ear clipping supports simple concave programmable polygons. Returns indexed triangles. */
export function triangulate(points) {
  if (points.length < 3) return [];
  const indices = Array.from({ length: points.length }, (_, i) => i);
  if (polygonArea(points) < 0) indices.reverse();
  const out = [];
  let guard = points.length ** 2;
  while (indices.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let i = 0; i < indices.length; i++) {
      const a = indices[(i + indices.length - 1) % indices.length], b = indices[i], c = indices[(i + 1) % indices.length];
      if (cross(points[a], points[b], points[c]) <= EPS) continue;
      const enclosed = indices.some(v => v !== a && v !== b && v !== c && cross(points[a], points[b], points[v]) >= -EPS && cross(points[b], points[c], points[v]) >= -EPS && cross(points[c], points[a], points[v]) >= -EPS);
      if (!enclosed) { out.push(a, b, c); indices.splice(i, 1); clipped = true; break; }
    }
    if (!clipped) {
      const i = indices.findIndex((b, k) => Math.abs(cross(points[indices[(k + indices.length - 1) % indices.length]], points[b], points[indices[(k + 1) % indices.length]])) < EPS);
      if (i < 0) throw new Error('Polygon is self-intersecting or numerically degenerate.');
      indices.splice(i, 1);
    }
  }
  if (indices.length === 3) out.push(...indices);
  return out;
}
export function roundedRect(x, y, w, h, r = 8, samples = 7) {
  r = Math.min(r, w / 2, h / 2); const p = [];
  for (const [cx, cy, start] of [[x + w - r, y + r, -Math.PI / 2], [x + w - r, y + h - r, 0], [x + r, y + h - r, Math.PI / 2], [x + r, y + r, Math.PI]]) {
    for (let i = 0; i <= samples; i++) { const a = start + i * Math.PI / 2 / samples; p.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r }); }
  }
  return p;
}
export const boxPoints = r => [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }];
export function parseColor(hex, alpha = 1) {
  if (hex === 'transparent' || hex === 'none') return [0, 0, 0, 0];
  const h = /^#[0-9a-f]{6}$/i.test(hex || '') ? hex : '#334155';
  return [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255, alpha];
}
