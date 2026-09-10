/** Planar polygon operations. No raster masks: result boundaries are editable vector rings.
 * Floating-point arrangement with explicit complexity limits; even/odd region membership.
 */
const cross = (a, b) => a.x * b.y - a.y * b.x;
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export function regionContains(point, rings, rule = 'evenodd') {
  let crossings = 0, winding = 0;
  for (const ring of rings) for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) crossings++;
    const side = cross(sub(b, a), sub(point, a));
    if (a.y <= point.y && b.y > point.y && side > 0) winding++;
    if (a.y > point.y && b.y <= point.y && side < 0) winding--;
  }
  return rule === 'nonzero' ? winding !== 0 : crossings % 2 === 1;
}
export function signedArea(ring) { return ring.reduce((sum, p, i) => sum + cross(p, ring[(i + 1) % ring.length]), 0) / 2; }
export function validateRings(rings) {
  if (!Array.isArray(rings) || !rings.length || rings.length > 256) throw new Error('A region requires 1–256 contours.');
  let count = 0;
  for (const ring of rings) { if (!Array.isArray(ring) || ring.length < 3 || ring.some(p => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || Math.max(Math.abs(p.x), Math.abs(p.y)) > 1e6)) throw new Error('Invalid polygon contour.'); count += ring.length; }
  if (count > 8192) throw new Error('Region exceeds 8192 vertices.');
}
/** Split all crossings/overlaps, classify both sides of each edge, then stitch oriented boundaries. */
export function booleanRegions(a, b, operation = 'union', { ruleA = 'evenodd', ruleB = 'evenodd' } = {}) {
  if (!['union', 'intersection', 'difference', 'xor'].includes(operation)) throw new Error('Unknown region operation.');
  if (a.length) validateRings(a); if (b.length) validateRings(b);
  const all = [...a, ...b].flat(); if (!all.length) return [];
  const loX = Math.min(...all.map(p => p.x)), hiX = Math.max(...all.map(p => p.x)), loY = Math.min(...all.map(p => p.y)), hiY = Math.max(...all.map(p => p.y));
  const extent = Math.max(1, hiX - loX, hiY - loY), eps = extent * 1e-9, key = p => `${Math.round((p.x - loX) / eps)},${Math.round((p.y - loY) / eps)}`;
  const edges = [];
  for (const ring of [...a, ...b]) for (let i = 0; i < ring.length; i++) { const p = ring[i], q = ring[(i + 1) % ring.length]; if (Math.hypot(q.x - p.x, q.y - p.y) > eps) edges.push({ p, q, cuts: [0, 1] }); }
  if (edges.length * edges.length > 16000000) throw new Error('Boolean operation exceeds the 4000-edge interactive budget. Simplify the inputs first.');
  const add = (e, t) => { if (t >= -1e-9 && t <= 1 + 1e-9) e.cuts.push(Math.max(0, Math.min(1, t))); };
  for (let i = 0; i < edges.length; i++) for (let j = i + 1; j < edges.length; j++) {
    const e = edges[i], f = edges[j];
    if (Math.max(e.p.x, e.q.x) + eps < Math.min(f.p.x, f.q.x) || Math.max(f.p.x, f.q.x) + eps < Math.min(e.p.x, e.q.x) || Math.max(e.p.y, e.q.y) + eps < Math.min(f.p.y, f.q.y) || Math.max(f.p.y, f.q.y) + eps < Math.min(e.p.y, e.q.y)) continue;
    const r = sub(e.q, e.p), s = sub(f.q, f.p), q = sub(f.p, e.p), denominator = cross(r, s), scale = Math.hypot(r.x, r.y) * Math.hypot(s.x, s.y);
    if (Math.abs(denominator) > scale * 1e-12) {
      const t = cross(q, s) / denominator, u = cross(q, r) / denominator;
      if (t >= -1e-9 && t <= 1 + 1e-9 && u >= -1e-9 && u <= 1 + 1e-9) { add(e, t); add(f, u); }
    } else if (Math.abs(cross(q, r)) < eps * Math.hypot(r.x, r.y)) {
      const project = (p, start, v) => ((p.x - start.x) * v.x + (p.y - start.y) * v.y) / (v.x * v.x + v.y * v.y);
      add(e, project(f.p, e.p, r)); add(e, project(f.q, e.p, r)); add(f, project(e.p, f.p, s)); add(f, project(e.q, f.p, s));
    }
  }
  const inside = p => { const x = regionContains(p, a, ruleA), y = regionContains(p, b, ruleB); return operation === 'union' ? x || y : operation === 'intersection' ? x && y : operation === 'difference' ? x && !y : x !== y; };
  const segments = new Map(), vertices = new Map();
  for (const e of edges) {
    e.cuts.sort((x, y) => x - y); const ts = e.cuts.filter((v, i, list) => !i || v - list[i - 1] > 1e-10);
    for (let i = 1; i < ts.length; i++) {
      let p = lerp(e.p, e.q, ts[i - 1]), q = lerp(e.p, e.q, ts[i]); const len = Math.hypot(q.x - p.x, q.y - p.y); if (len < eps) continue;
      const mid = lerp(p, q, .5), delta = Math.min(eps * 4, len * 1e-4), nx = -(q.y - p.y) / len * delta, ny = (q.x - p.x) / len * delta;
      const left = inside({ x: mid.x + nx, y: mid.y + ny }), right = inside({ x: mid.x - nx, y: mid.y - ny });
      if (left === right) continue; if (!left) [p, q] = [q, p];
      const pk = key(p), qk = key(q); if (pk === qk) continue;
      if (!vertices.has(pk)) vertices.set(pk, p); if (!vertices.has(qk)) vertices.set(qk, q);
      segments.set(`${pk}>${qk}`, { a: pk, b: qk, p: vertices.get(pk), q: vertices.get(qk) });
    }
  }
  const outgoing = new Map(); for (const [id, e] of segments) { if (!outgoing.has(e.a)) outgoing.set(e.a, []); outgoing.get(e.a).push(id); }
  const unused = new Set(segments.keys()), result = [];
  while (unused.size) {
    const first = segments.get(unused.values().next().value); let e = first, ring = [], guard = 0;
    do {
      if (++guard > segments.size + 1) throw new Error('Boolean boundary could not be closed.');
      ring.push(e.p); unused.delete(`${e.a}>${e.b}`); if (e.b === first.a) break;
      const options = (outgoing.get(e.b) || []).filter(id => unused.has(id)); if (!options.length) throw new Error('Numerically ambiguous boolean boundary. Rescale or simplify the inputs.');
      const incoming = Math.atan2(e.q.y - e.p.y, e.q.x - e.p.x);
      // Follow the face with filled material to the left (clockwise from the reverse direction).
      options.sort((x, y) => { const angle = id => { const c = segments.get(id); return (incoming + Math.PI - Math.atan2(c.q.y - c.p.y, c.q.x - c.p.x) + Math.PI * 4) % (Math.PI * 2); }; return angle(x) - angle(y); });
      e = segments.get(options[0]);
    } while (true);
    ring = ring.filter((p, i) => { const prev = ring[(i + ring.length - 1) % ring.length], next = ring[(i + 1) % ring.length]; return Math.abs(cross(sub(p, prev), sub(next, p))) > eps * Math.max(1, Math.hypot(next.x - prev.x, next.y - prev.y)); });
    if (ring.length >= 3 && Math.abs(signedArea(ring)) > eps * eps) result.push(ring);
  }
  return result;
}
/** Scanline trapezoid triangulation supports holes and disconnected contours without bridges. */
export function triangulateRegion(rings, rule = 'evenodd') {
  if (!rings.length) return [];
  const values = rings.flat().map(p => p.y), edges = [];
  for (const ring of rings) for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length]; if (Math.abs(a.y - b.y) > 1e-12) edges.push({ a, b }); }
  if (edges.length > 8192) throw new Error('Region triangulation budget exceeded.');
  // Crossing y levels must split a slab too: variable-pressure ribbons can cross themselves.
  for (let i = 0; i < edges.length; i++) for (let j = i + 1; j < edges.length; j++) {
    const e=edges[i],f=edges[j]; if(Math.max(e.a.y,e.b.y)<=Math.min(f.a.y,f.b.y)||Math.max(f.a.y,f.b.y)<=Math.min(e.a.y,e.b.y)||Math.max(e.a.x,e.b.x)<Math.min(f.a.x,f.b.x)||Math.max(f.a.x,f.b.x)<Math.min(e.a.x,e.b.x))continue;
    const r=sub(e.b,e.a),t=sub(f.b,f.a),q=sub(f.a,e.a),d=cross(r,t); if(Math.abs(d)<1e-12)continue;const u=cross(q,t)/d,v=cross(q,r)/d;
    if(u>1e-10&&u<1-1e-10&&v>1e-10&&v<1-1e-10)values.push(e.a.y+u*r.y);
  }
  values.sort((a,b)=>a-b);const ys=values.filter((y,i)=>!i||Math.abs(y-values[i-1])>1e-9);
  if (ys.length * edges.length > 32000000) throw new Error('Region triangulation budget exceeded.');
  const out = [], xAt = (e, y) => e.a.x + (e.b.x - e.a.x) * (y - e.a.y) / (e.b.y - e.a.y);
  for (let i = 1; i < ys.length; i++) {
    const top = ys[i - 1], bottom = ys[i], mid = (top + bottom) / 2;
    const active = edges.filter(e => mid > Math.min(e.a.y, e.b.y) && mid < Math.max(e.a.y, e.b.y)).sort((a, b) => xAt(a, mid) - xAt(b, mid));
    let winding=0,left=null;
    for (const edge of active) {
      const was=rule==='nonzero'?winding!==0:Math.abs(winding)%2===1;winding+=edge.b.y>edge.a.y?1:-1;const inside=rule==='nonzero'?winding!==0:Math.abs(winding)%2===1;
      if(!was&&inside)left=edge;
      else if(was&&!inside&&left){const a={x:xAt(left,top),y:top},b={x:xAt(edge,top),y:top},c={x:xAt(edge,bottom),y:bottom},d={x:xAt(left,bottom),y:bottom};out.push(a,b,c,a,c,d);left=null;}
    }
    if(winding)throw new Error('Region contains an open contour.');
  }
  return out;
}
