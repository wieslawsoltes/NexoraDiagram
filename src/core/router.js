import { bounds, inflate, intersects, inside, orthogonalSegmentHits, simplifyPolyline, distance, union } from './geometry.js';
import { MinHeap, SpatialIndex } from './spatial.js';
const unique = a => [...new Set(a)].sort((a, b) => a - b);
/** Orthogonal visibility-grid A*: exact endpoint coordinates, Manhattan heuristic, turn penalty. */
export function routeBetween(start, end, obstacles, { bendPenalty = 22, maxStates = 180000 } = {}) {
  if (start.x === end.x && start.y === end.y) return { points: [start], status: 'ok', explored: 0 };
  const direct = [start, { x: end.x, y: start.y }, end];
  const alternate = [start, { x: start.x, y: end.y }, end];
  const clear = points => points.every((b, i) => !i || !obstacles.some(r => orthogonalSegmentHits(points[i - 1], b, r)));
  if (clear(direct)) return { points: simplifyPolyline(direct), status: 'ok', explored: 0 };
  if (clear(alternate)) return { points: simplifyPolyline(alternate), status: 'ok', explored: 0 };
  let search = inflate(bounds([start, end]), 160);
  // Expand to include intersecting obstacles, allowing a route around long walls.
  for (let k = 0; k < 3; k++) for (const r of obstacles) if (intersects(search, r)) search = union(search, inflate(r, 30));
  const relevant = obstacles.filter(r => intersects(search, r));
  const xs = unique([start.x, end.x, search.x, search.x + search.w, ...relevant.flatMap(r => [r.x - .25, r.x + r.w + .25])]);
  const ys = unique([start.y, end.y, search.y, search.y + search.h, ...relevant.flatMap(r => [r.y - .25, r.y + r.h + .25])]);
  const fallback = explored => {
    const candidates = [direct, alternate, [start, { x: start.x, y: search.y }, { x: end.x, y: search.y }, end], [start, { x: search.x, y: start.y }, { x: search.x, y: end.y }, end]];
    const score = ps => ps.reduce((sum, b, i) => !i ? sum : sum + distance(ps[i - 1], b) + relevant.filter(r => orthogonalSegmentHits(ps[i - 1], b, r)).length * 1e6, 0);
    candidates.sort((a, b) => score(a) - score(b)); const points = simplifyPolyline(candidates[0]);
    return { points, status: clear(points) ? 'ok' : 'blocked', explored, limited: true };
  };
  const width = xs.length, height = ys.length, n = width * height * 3;
  if (n > maxStates * 3 || relevant.some(r => inside(r, start) || inside(r, end))) return fallback(0);
  const index = new SpatialIndex(128); relevant.forEach((r, i) => index.set(i, r, r));
  const sx = xs.indexOf(start.x), sy = ys.indexOf(start.y);
  const tx = xs.indexOf(end.x), ty = ys.indexOf(end.y);
  const key = (x, y, dir) => (y * width + x) * 3 + dir;
  const costs = new Float64Array(n); costs.fill(Infinity);
  const previous = new Int32Array(n); previous.fill(-1);
  const closed = new Uint8Array(n); const heap = new MinHeap();
  const initial = key(sx, sy, 0); costs[initial] = 0; heap.push({ id: initial, priority: 0 }); let explored = 0, found = -1;
  while (heap.length && explored++ < maxStates) {
    const { id } = heap.pop(); if (closed[id]) continue; closed[id] = 1;
    const dir = id % 3, cell = Math.floor(id / 3), x = cell % width, y = Math.floor(cell / width);
    if (x === tx && y === ty) { found = id; break; }
    const a = { x: xs[x], y: ys[y] };
    for (const [nx, ny, nd] of [[x - 1, y, 1], [x + 1, y, 1], [x, y - 1, 2], [x, y + 1, 2]]) {
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const next = key(nx, ny, nd); if (closed[next]) continue;
      const b = { x: xs[nx], y: ys[ny] }, box = bounds([a, b]);
      if (index.query(inflate(box, .01)).some(r => orthogonalSegmentHits(a, b, r))) continue;
      const cost = costs[id] + distance(a, b) + (dir && dir !== nd ? bendPenalty : 0);
      if (cost < costs[next]) { costs[next] = cost; previous[next] = id; heap.push({ id: next, priority: cost + Math.abs(b.x - end.x) + Math.abs(b.y - end.y) }); }
    }
  }
  if (found < 0) return fallback(explored);
  const points = [];
  for (let id = found; id >= 0; id = previous[id]) { const cell = Math.floor(id / 3); points.push({ x: xs[cell % width], y: ys[Math.floor(cell / width)] }); }
  return { points: simplifyPolyline(points.reverse()), status: 'ok', explored };
}
export function routeConnector(request, obstacles) {
  const { start, end, startStub, endStub, waypoints = [] } = request;
  const stops = [startStub, ...waypoints, endStub], points = [start, startStub]; let status = 'ok', explored = 0;
  for (let i = 1; i < stops.length; i++) { const r = routeBetween(stops[i - 1], stops[i], obstacles); points.push(...r.points); explored += r.explored; if (r.status !== 'ok') status = r.status; }
  points.push(end);
  // Port escape segments may traverse their own endpoint obstacle, but no other shape.
  if (obstacles.some(r => r.id !== request.fromId && orthogonalSegmentHits(start, startStub, r)) || obstacles.some(r => r.id !== request.toId && orthogonalSegmentHits(endStub, end, r))) status = 'blocked';
  return { id: request.id, points: simplifyPolyline(points), status, explored };
}
