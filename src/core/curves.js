/** Analytic circular arcs through three points; display tessellation never replaces the stored arc. */
const tau = Math.PI * 2;
const mod = a => (a % tau + tau) % tau;
export function circleThrough(a, b, c) {
  const bx = b.x - a.x, by = b.y - a.y, cx = c.x - a.x, cy = c.y - a.y, d = 2 * (bx * cy - by * cx);
  if (Math.abs(d) < 1e-12 * Math.max(1, bx * bx + by * by + cx * cx + cy * cy)) throw new Error('A circular arc requires three distinct, non-collinear points.');
  const bb = bx * bx + by * by, cc = cx * cx + cy * cy, x = a.x + (cy * bb - by * cc) / d, y = a.y + (bx * cc - cx * bb) / d;
  const r = Math.hypot(a.x - x, a.y - y), start = Math.atan2(a.y - y, a.x - x), middle = Math.atan2(b.y - y, b.x - x), end = Math.atan2(c.y - y, c.x - x);
  const positive = mod(end - start), sweep = mod(middle - start) <= positive ? positive : positive - tau;
  if (![x, y, r, sweep].every(Number.isFinite) || r > 1e6 || r < 1e-9) throw new Error('Circular arc radius is outside the document limits.');
  return { x, y, r, start, sweep };
}
export function arcSamples(arc, tolerance = .3, scale = 1) {
  const step = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - Math.max(1e-8, tolerance) / (arc.r * scale))));
  const count = Math.max(2, Math.min(4096, Math.ceil(Math.abs(arc.sweep) / Math.max(.001, step))));
  return Array.from({ length: count + 1 }, (_, i) => { const angle = arc.start + arc.sweep * i / count; return { x: arc.x + arc.r * Math.cos(angle), y: arc.y + arc.r * Math.sin(angle) }; });
}
/** Variable-width ribbon with round caps. Pressure remains attached to editable centerline samples. */
export function inkOutline(points, pressures, width, { thinning = .85, gamma = 1, tilt = null } = {}) {
  if (points.length < 2 || !Number.isFinite(width) || width <= 0) return [];
  const ps = [], values = [];
  points.forEach((p, i) => { if (!ps.length || Math.hypot(p.x - ps.at(-1).x, p.y - ps.at(-1).y) > 1e-6) { ps.push(p); values.push(pressures?.[i] ?? .5); } });
  if (ps.length < 2) return [];
  const radius = i => Math.max(.02, width / 2 * (1 - thinning + thinning * Math.pow(Math.max(0, Math.min(1, values[i])), gamma) * 2));
  const left = [], right = [];
  for (let i = 0; i < ps.length; i++) {
    const a = ps[Math.max(0, i - 1)], b = ps[Math.min(ps.length - 1, i + 1)], length = Math.hypot(b.x - a.x, b.y - a.y) || 1, nx = -(b.y - a.y) / length, ny = (b.x - a.x) / length, r = radius(i);
    left.push({ x: ps[i].x + nx * r, y: ps[i].y + ny * r }); right.push({ x: ps[i].x - nx * r, y: ps[i].y - ny * r });
  }
  const cap = (p, from, to) => { const angle = Math.atan2(from.y - p.y, from.x - p.x), r = Math.hypot(from.x - p.x, from.y - p.y); return Array.from({ length: 9 }, (_, i) => ({ x: p.x + r * Math.cos(angle - Math.PI * (i + 1) / 10), y: p.y + r * Math.sin(angle - Math.PI * (i + 1) / 10) })); };
  return [...left, ...cap(ps.at(-1), left.at(-1), right.at(-1)), ...right.reverse(), ...cap(ps[0], right.at(-1), left[0])];
}
