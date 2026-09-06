import { parseDocument } from './model.js';
export class Persistence {
  constructor() { this.db = null; this.fallback = false; }
  async open() {
    if (this.db || this.fallback) return;
    try { this.db = await new Promise((resolve, reject) => { const r = indexedDB.open('nexora-diagram', 1); r.onupgradeneeded = () => r.result.createObjectStore('projects'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); r.onblocked = () => reject(new Error('Storage upgrade is blocked.')); }); }
    catch { this.fallback = true; }
  }
  async load() {
    await this.open();
    const text = this.fallback ? localStorage.getItem('nexora-project') : await new Promise((resolve, reject) => { const r = this.db.transaction('projects').objectStore('projects').get('current'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    return text ? parseDocument(text) : null;
  }
  async save(doc) {
    await this.open(); const text = JSON.stringify(doc);
    if (this.fallback) { localStorage.setItem('nexora-project', text); return; }
    await new Promise((resolve, reject) => { const tx = this.db.transaction('projects', 'readwrite'); tx.objectStore('projects').put(text, 'current'); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('Save aborted.')); });
  }
}
export function parseCSV(text) {
  if (text.length > 10 * 1024 * 1024) throw new Error('CSV input exceeds 10 MB.');
  const rows = []; let row = [], value = '', quoted = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (c === '"' && text[i + 1] === '"') { value += '"'; i++; } else if (c === '"') quoted = false; else value += c; }
    else if (c === '"' && !value) quoted = true;
    else if (c === ',') { row.push(value); value = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(value); if (row.some(v => v.trim())) rows.push(row); row = []; value = ''; }
    else value += c;
  }
  if (quoted) throw new Error('CSV contains an unterminated quoted field.');
  row.push(value); if (row.some(v => v.trim())) rows.push(row);
  if (rows.length < 2) throw new Error('CSV requires a header and at least one data row.');
  const headers = rows.shift().map(h => h.trim());
  if (headers.some(h => !h || ['__proto__', 'constructor', 'prototype'].includes(h)) || new Set(headers).size !== headers.length) throw new Error('CSV header names must be nonempty and unique.');
  return { headers, rows: rows.map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? '']))) };
}
export function bindCSV(page, csv, keyColumn = 'key', nodeField = 'key') {
  if (!csv.headers.includes(keyColumn)) throw new Error(`CSV has no “${keyColumn}” column.`);
  const byKey = new Map(); for (const row of csv.rows) { const key = row[keyColumn]; if (byKey.has(key)) throw new Error(`CSV key “${key}” is duplicated.`); byKey.set(key, row); }
  let count = 0;
  for (const n of Object.values(page.graph.nodes)) {
    const key = nodeField === 'id' ? n.id : String(n.data[nodeField] ?? ''); const row = byKey.get(key);
    if (row) { Object.assign(n.data, row); count++; }
  }
  return count;
}
export function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 15000);
}
export const downloadText = (filename, text, mime = 'application/json') => downloadBlob(filename, new Blob([text], { type: mime }));
