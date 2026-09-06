import { intersects } from './geometry.js';
/** Dynamic spatial hash. Oversized rectangles live in a spill set to bound insertion cost. */
export class SpatialIndex {
  constructor(cellSize = 192) { this.cellSize = cellSize; this.cells = new Map(); this.items = new Map(); this.large = new Set(); }
  keys(r) {
    const c = this.cellSize, x0 = Math.floor(r.x / c), y0 = Math.floor(r.y / c), x1 = Math.floor((r.x + r.w) / c), y1 = Math.floor((r.y + r.h) / c);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 256) return null;
    const keys = []; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) keys.push(`${x},${y}`); return keys;
  }
  set(id, r, value = id) {
    this.delete(id); const keys = this.keys(r); this.items.set(id, { bounds: { ...r }, value, keys });
    if (!keys) this.large.add(id);
    else for (const key of keys) { if (!this.cells.has(key)) this.cells.set(key, new Set()); this.cells.get(key).add(id); }
  }
  delete(id) {
    const item = this.items.get(id); if (!item) return;
    if (item.keys) for (const k of item.keys) { const c = this.cells.get(k); c.delete(id); if (!c.size) this.cells.delete(k); }
    else this.large.delete(id);
    this.items.delete(id);
  }
  query(r) {
    const keys = this.keys(r); const ids = new Set(this.large);
    if (!keys) for (const id of this.items.keys()) ids.add(id);
    else for (const key of keys) for (const id of this.cells.get(key) || []) ids.add(id);
    const result = []; for (const id of ids) { const a = this.items.get(id); if (intersects(a.bounds, r)) result.push(a.value); } return result;
  }
  clear() { this.cells.clear(); this.items.clear(); this.large.clear(); }
}
export class MinHeap {
  constructor() { this.items = []; }
  get length() { return this.items.length; }
  push(item) { const a = this.items; a.push(item); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p].priority <= item.priority) break; a[i] = a[p]; i = p; } a[i] = item; }
  pop() {
    const a = this.items; if (!a.length) return undefined; const first = a[0], last = a.pop();
    if (a.length) { let i = 0; while (true) { let j = i * 2 + 1; if (j >= a.length) break; if (j + 1 < a.length && a[j + 1].priority < a[j].priority) j++; if (a[j].priority >= last.priority) break; a[i] = a[j]; i = j; } a[i] = last; }
    return first;
  }
}
