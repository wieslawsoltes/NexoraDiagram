/** Small, total arithmetic interpreter: no eval, property access, assignment, or loops. */
const functions = Object.freeze({ min: Math.min, max: Math.max, abs: Math.abs, sin: Math.sin, cos: Math.cos, sqrt: Math.sqrt, clamp: (x, a, b) => Math.max(a, Math.min(b, x)) });
const cache = new Map();
export function compileExpression(source) {
  if (typeof source === 'number') { if (!Number.isFinite(source)) throw new Error('Non-finite expression.'); return () => source; }
  if (typeof source !== 'string' || source.length > 256) throw new Error('Expression must contain at most 256 characters.');
  if (cache.has(source)) return cache.get(source);
  const tokens = []; const re = /\s*(?:(\d*\.?\d+(?:e[+-]?\d+)?)|([a-zA-Z_][a-zA-Z0-9_]*)|([+\-*/(),]))/gy;
  let offset = 0;
  while (offset < source.length) { if (!source.slice(offset).trim()) break; re.lastIndex = offset; const m = re.exec(source); if (!m) throw new Error(`Invalid expression near “${source.slice(offset, offset + 12)}”.`); tokens.push(m[1] !== undefined ? { number: Number(m[1]) } : m[2] || m[3]); offset = re.lastIndex; }
  if (tokens.length > 100) throw new Error('Expression is too long.');
  let i = 0, depth = 0;
  const consume = t => { if (tokens[i] !== t) throw new Error(`Expected ${t}.`); i++; };
  function primary() {
    if (++depth > 24) throw new Error('Expression nesting exceeds 24 levels.');
    const t = tokens[i++]; let result;
    if (t && typeof t === 'object') result = { type: 'number', value: t.number };
    else if (t === '+' || t === '-') result = { type: 'unary', op: t, arg: primary() };
    else if (t === '(') { result = sum(); consume(')'); }
    else if (['w', 'h', 'pi'].includes(t)) result = { type: 'variable', name: t };
    else if (Object.hasOwn(functions, t)) { consume('('); const args = [sum()]; while (tokens[i] === ',') { i++; args.push(sum()); } consume(')'); if (args.length > 8) throw new Error('Too many function arguments.'); result = { type: 'call', name: t, args }; }
    else throw new Error(`Unknown token ${String(t)}.`);
    depth--; return result;
  }
  function product() { let l = primary(); while (tokens[i] === '*' || tokens[i] === '/') { const op = tokens[i++]; l = { type: 'binary', op, l, r: primary() }; } return l; }
  function sum() { let l = product(); while (tokens[i] === '+' || tokens[i] === '-') { const op = tokens[i++]; l = { type: 'binary', op, l, r: product() }; } return l; }
  const ast = sum(); if (i !== tokens.length) throw new Error('Unexpected trailing expression tokens.');
  function run(n, vars) {
    if (n.type === 'number') return n.value;
    if (n.type === 'variable') return n.name === 'pi' ? Math.PI : vars[n.name];
    if (n.type === 'unary') return n.op === '-' ? -run(n.arg, vars) : run(n.arg, vars);
    if (n.type === 'call') return functions[n.name](...n.args.map(a => run(a, vars)));
    const l = run(n.l, vars), r = run(n.r, vars); return n.op === '+' ? l + r : n.op === '-' ? l - r : n.op === '*' ? l * r : l / r;
  }
  const fn = vars => { const n = run(ast, vars); if (!Number.isFinite(n) || Math.abs(n) > 1e7) throw new Error('Expression returned an invalid coordinate.'); return n; };
  if (cache.size > 2048) cache.clear(); cache.set(source, fn); return fn;
}
export const evaluate = (source, vars) => compileExpression(source)(vars);
export function readBinding(data, path) {
  const keys = path.replace(/^data\./, '').split('.'); let value = data;
  for (const key of keys) {
    if (['__proto__', 'prototype', 'constructor'].includes(key) || value === null || typeof value !== 'object' || !Object.hasOwn(value, key)) return undefined;
    value = value[key];
  }
  return value;
}
export function resolveLabel(node) {
  return String(node.label || '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => { const value = readBinding(node.data || {}, key); return value === undefined ? `⟨${key}⟩` : typeof value === 'object' ? JSON.stringify(value) : String(value); });
}
export function unresolvedBindings(node) { return [...String(node.label || '').matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map(m => m[1]).filter(k => readBinding(node.data || {}, k) === undefined); }
