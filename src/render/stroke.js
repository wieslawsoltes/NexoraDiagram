/** Shared dash splitting and marker construction; GPU strokes are actual triangle geometry. */
import { triangulateRegion } from '../core/regions.js';
import { distance, parseColor, triangulate } from '../core/geometry.js';
export function dashRuns(points, pattern = []) {
  if (!pattern.length) return [points];
  if (pattern.some(n => !Number.isFinite(n) || n <= 0)) throw new Error('Dash lengths must be positive finite numbers.');
  if (pattern.length % 2) pattern = [...pattern, ...pattern];
  const runs = []; let index = 0, remaining = pattern[0], run = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], length = distance(a, b); if (length < 1e-8) continue;
    let at = 0;
    while (at < length - 1e-8) {
      const step = Math.min(remaining, length - at), p = { x: a.x + (b.x - a.x) * at / length, y: a.y + (b.y - a.y) * at / length };
      at += step; const q = { x: a.x + (b.x - a.x) * at / length, y: a.y + (b.y - a.y) * at / length };
      if (index % 2 === 0) { if (!run.length) run.push(p); run.push(q); }
      remaining -= step;
      if (remaining <= 1e-8) { if (run.length) { runs.push(run); run = []; } index = (index + 1) % pattern.length; remaining = pattern[index]; }
    }
  }
  if (run.length) runs.push(run); return runs;
}
export function markerPrimitives(points, style, defaultEnd = 'none') {
  const out = [], size = Math.max(8, (style.strokeWidth ?? 1.5) * 4), stroke = style.stroke;
  if (!stroke || ['none', 'transparent'].includes(stroke) || style.strokeWidth === 0 || points.length < 2) return out;
  for (const [type, ps] of [[style.startArrow || 'none', [...points].reverse()], [style.endArrow || defaultEnd, points]]) {
    if (type === 'none') continue;
    const b = ps.at(-1), a = [...ps].reverse().find(p => distance(p, b) > 1e-6); if (!a) continue;
    const len = distance(a, b), dx = (b.x - a.x) / len, dy = (b.y - a.y) / len;
    const at = (x, y) => ({ x: b.x - dx * x - dy * y, y: b.y - dy * x + dx * y });
    const base = { id: style.id, opacity: style.opacity ?? 1, width: style.strokeWidth ?? 1.5, lineCap: 'round', lineJoin: 'round' };
    if (type === 'open') out.push({ ...base, kind: 'line', points: [at(size, size * .48), b, at(size, -size * .48)], stroke, fill: 'none' });
    else {
      const polygon = type === 'circle' ? Array.from({ length: 24 }, (_, i) => at(size * .5 + Math.cos(i * Math.PI / 12) * size * .5, Math.sin(i * Math.PI / 12) * size * .5)) : type === 'diamond' ? [b, at(size * .6, size * .4), at(size * 1.2, 0), at(size * .6, -size * .4)] : [b, at(size, size * .48), at(size, -size * .48)];
      out.push({ ...base, kind: 'polygon', points: polygon, fill: stroke, stroke: null });
    }
  }
  return out;
}
export function tessellateScene(scene) {
  const data = [], vertex = (p, c) => data.push(p.x, p.y, ...c);
  const color = (value, opacity = 1) => { const c = parseColor(value); c[3] *= opacity; return c; };
  const triangle = (a, b, c, fill) => { vertex(a, fill); vertex(b, fill); vertex(c, fill); };
  function disc(p, radius, c) {
    const steps = Math.max(8, Math.min(32, Math.ceil(radius * 2)));
    for (let i = 0; i < steps; i++) triangle(p, { x: p.x + Math.cos(i * 2 * Math.PI / steps) * radius, y: p.y + Math.sin(i * 2 * Math.PI / steps) * radius }, { x: p.x + Math.cos((i + 1) * 2 * Math.PI / steps) * radius, y: p.y + Math.sin((i + 1) * 2 * Math.PI / steps) * radius }, c);
  }
  function strokeRun(raw, width, c, cap, join, closed) {
    const ps = raw.filter((p, i) => !i || distance(p, raw[i - 1]) > 1e-8); if (ps.length < 2) return;
    const half = width / 2, directions = [];
    for (let i = 1; i < ps.length; i++) { const len = distance(ps[i], ps[i - 1]); directions.push({ x: (ps[i].x - ps[i - 1].x) / len, y: (ps[i].y - ps[i - 1].y) / len }); }
    for (let i = 0; i < directions.length; i++) {
      const d = directions[i], n = { x: -d.y * half, y: d.x * half }; let a = ps[i], b = ps[i + 1];
      if (cap === 'square' && !closed) { if (!i) a = { x: a.x - d.x * half, y: a.y - d.y * half }; if (i === directions.length - 1) b = { x: b.x + d.x * half, y: b.y + d.y * half }; }
      const q = [{ x: a.x + n.x, y: a.y + n.y }, { x: b.x + n.x, y: b.y + n.y }, { x: b.x - n.x, y: b.y - n.y }, { x: a.x - n.x, y: a.y - n.y }];
      triangle(q[0], q[1], q[2], c); triangle(q[0], q[2], q[3], c);
    }
    for (let i = closed ? 0 : 1; i < ps.length - 1; i++) {
      const prev = directions[(i - 1 + directions.length) % directions.length], next = directions[i], point = ps[i];
      if (join === 'round') { disc(point, half, c); continue; }
      const turn = prev.x * next.y - prev.y * next.x; if (Math.abs(turn) < 1e-8) continue;
      const sign = turn > 0 ? -1 : 1, a = { x: point.x - prev.y * half * sign, y: point.y + prev.x * half * sign }, b = { x: point.x - next.y * half * sign, y: point.y + next.x * half * sign };
      if (join === 'miter') {
        const denominator = 1 + prev.x * next.x + prev.y * next.y;
        if (denominator > .125) { const tip = { x: point.x - (prev.y + next.y) * half * sign / denominator, y: point.y + (prev.x + next.x) * half * sign / denominator }; triangle(a, tip, b, c); }
      }
      triangle(a, point, b, c);
    }
    if (cap === 'round' && !closed) { disc(ps[0], half, c); disc(ps.at(-1), half, c); }
  }
  for (const p of scene.primitives) {
    if(p.kind==='image') continue;
    if(p.kind==='compound') {
      if(p.fill && !['none','transparent'].includes(p.fill)) { const c=color(p.fill,p.opacity); for(const point of triangulateRegion(p.contours,p.fillRule||'evenodd'))vertex(point,c); }
      if(p.stroke && !['none','transparent'].includes(p.stroke) && p.width!==0) {const c=color(p.stroke,p.opacity);for(const ring of p.contours) for(const run of dashRuns([...ring,ring[0]],p.dashArray||[]))strokeRun(run,p.width??1,c,p.lineCap||'round',p.lineJoin||'round',!p.dashArray?.length); }
      continue;
    }
    if (p.kind === 'polygon' && p.fill && !['transparent', 'none'].includes(p.fill) && p.points.length >= 3) {
      const c = color(p.fill, p.opacity); for (const i of triangulate(p.points)) vertex(p.points[i], c);
    }
    if (p.stroke && !['none', 'transparent'].includes(p.stroke) && p.width !== 0) {
      const closed = p.kind === 'polygon', points = closed ? [...p.points, p.points[0]] : p.points, c = color(p.stroke, p.opacity);
      for (const run of dashRuns(points, p.dashArray || (p.dashed ? [6, 5] : []))) strokeRun(run, p.width ?? 1, c, p.lineCap || 'round', p.lineJoin || 'round', closed && !p.dashArray?.length && !p.dashed);
    }
  }
  return new Float32Array(data);
}
