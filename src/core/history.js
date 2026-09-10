import { autoSizePage } from './page.js';
import { assertDocument } from './model.js';
const clone = value => value === undefined ? undefined : structuredClone(value);
function equal(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
/** Leaf-object diff; arrays are atomic. Stored commands contain changed values, not whole documents. */
export function diff(before, after, path = [], out = []) {
  if (Object.is(before, after)) return out;
  if (before && after && typeof before === 'object' && typeof after === 'object' && !Array.isArray(before) && !Array.isArray(after)) {
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) diff(before[key], after[key], [...path, key], out);
  } else if (!equal(before, after)) out.push({ path, before: clone(before), after: clone(after) });
  return out;
}
export function applyPatches(doc, patches, forward = true) {
  for (const p of (forward ? patches : [...patches].reverse())) {
    let object = doc; for (let i = 0; i < p.path.length - 1; i++) object = object[p.path[i]];
    const key = p.path.at(-1), value = forward ? p.after : p.before;
    if (value === undefined) delete object[key]; else object[key] = clone(value);
  }
}
export class DocumentStore extends EventTarget {
  constructor(doc, { maxBytes = 16 * 1024 * 1024, maxCommands = 150 } = {}) {
    super(); this.doc = assertDocument(doc); this.undoStack = []; this.redoStack = []; this.maxBytes = maxBytes; this.maxCommands = maxCommands; this.bytes = 0; this.revision = 0; this.pending = null;
  }
  notify(kind, label = '') { this.dispatchEvent(new CustomEvent('change', { detail: { kind, label, revision: this.revision } })); }
  begin(label) { if (this.pending) throw new Error('Nested transactions are not supported.'); this.pending = { label, before: structuredClone(this.doc) }; }
  preview() { this.notify('preview', this.pending?.label); }
  commit() {
    if (!this.pending) return false; const transaction = this.pending;
    try { for (const p of Object.values(this.doc.pages)) autoSizePage(p); assertDocument(this.doc); } catch (error) { this.doc = transaction.before; this.pending = null; this.notify('rollback'); throw error; }
    this.pending = null; const patches = diff(transaction.before, this.doc);
    if (!patches.length) return false;
    const command = { label: transaction.label, patches, bytes: JSON.stringify(patches).length * 2 };
    this.undoStack.push(command); this.redoStack = []; this.bytes += command.bytes;
    while (this.undoStack.length > 1 && (this.bytes > this.maxBytes || this.undoStack.length > this.maxCommands)) this.bytes -= this.undoStack.shift().bytes;
    this.revision++; this.notify('commit', transaction.label); return true;
  }
  cancel() { if (!this.pending) return; this.doc = this.pending.before; this.pending = null; this.notify('rollback'); }
  transact(label, mutate) { this.begin(label); try { mutate(this.doc); return this.commit(); } catch (e) { this.cancel(); throw e; } }
  undo() { if (this.pending) this.cancel(); const c = this.undoStack.pop(); if (!c) return; applyPatches(this.doc, c.patches, false); this.redoStack.push(c); this.bytes -= c.bytes; this.revision++; this.notify('undo', c.label); }
  redo() { if (this.pending) this.cancel(); const c = this.redoStack.pop(); if (!c) return; applyPatches(this.doc, c.patches); this.undoStack.push(c); this.bytes += c.bytes; this.revision++; this.notify('redo', c.label); }
  replace(doc) { assertDocument(doc); this.doc = doc; this.pending = null; this.undoStack = []; this.redoStack = []; this.bytes = 0; this.revision++; this.notify('load'); }
}
