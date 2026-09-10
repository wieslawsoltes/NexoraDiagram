import { pathContours, flattenPath, transformPoint, rotatePoint } from './drawing.js';
import { evaluate } from './expression.js';
import { roundedRect, boxPoints, isSimplePolygon, distance } from './geometry.js';
const ports = [
  { id: 'n', x: 'w/2', y: '0', dx: 0, dy: -1 }, { id: 'e', x: 'w', y: 'h/2', dx: 1, dy: 0 },
  { id: 's', x: 'w/2', y: 'h', dx: 0, dy: 1 }, { id: 'w', x: '0', y: 'h/2', dx: -1, dy: 0 }
];
const def = (id, name, category, kind, size, style = {}, extra = {}) => ({ id, name, category, geometry: { kind }, size, ports, style: { fill: '#f0f7ff', stroke: '#7b9cbe', textColor: '#253b53', fontSize: 16, strokeWidth: 1.5, ...style }, ...extra });
export const BUILTINS = Object.fromEntries([
  def('image', 'Embedded image', 'Media', 'rect', [240,160], { fill:'none', stroke:'none' }, { hidden:true }),
  def('path', 'Drawing path', 'Drawing', 'path', [160, 90], { fill: 'none' }, { annotation: true, hidden: true, ports: [] }),
  def('group', 'Group', 'Structure', 'group', [160, 90], { fill: 'none', stroke: 'none' }, { container: true, hidden: true, ports: [] }),
  def('process', 'Process', 'Basic flowchart', 'roundrect', [170, 76]),
  def('decision', 'Decision', 'Basic flowchart', 'diamond', [138, 98], { fill: '#fff7e6', stroke: '#d5a65a', textColor: '#7a541f' }),
  def('terminator', 'Start / End', 'Basic flowchart', 'pill', [130, 54], { fill: '#e5f5ef', stroke: '#6da993', textColor: '#276753' }),
  def('document', 'Document', 'Basic flowchart', 'document', [150, 88]),
  def('data', 'Data', 'Basic flowchart', 'parallelogram', [165, 76], { fill: '#f3edff', stroke: '#a38bbf', textColor: '#614581' }),
  def('database', 'Database', 'Basic flowchart', 'cylinder', [125, 90], { fill: '#f3edff', stroke: '#a38bbf', textColor: '#614581' }),
  def('subprocess', 'Subprocess', 'Basic flowchart', 'subprocess', [175, 76]),
  def('manual', 'Manual input', 'Basic flowchart', 'manual', [165, 80]),
  def('rectangle', 'Rectangle', 'Basic shapes', 'rectangle', [145, 85], { fill: '#ffffff', stroke: '#8895a7' }),
  def('ellipse', 'Ellipse', 'Basic shapes', 'ellipse', [125, 85], { fill: '#eef5fd', stroke: '#859fc0' }),
  def('hexagon', 'Preparation', 'Basic shapes', 'hexagon', [160, 80]),
  def('triangle', 'Triangle', 'Basic shapes', 'triangle', [105, 90], { fill: '#fff7e6', stroke: '#d5a65a' }),
  def('note', 'Note', 'Annotations', 'note', [180, 95], { fill: '#fffbea', stroke: '#dec989', textColor: '#87733f', fontSize: 14 }, { annotation: true }),
  def('text', 'Text block', 'Annotations', 'text', [230, 46], { fill: 'transparent', stroke: 'transparent', textColor: '#253b53', fontSize: 19, align: 'left' }, { annotation: true, ports: [] }),
  def('container', 'Container', 'Containers', 'container', [480, 260], { fill: '#fbfcff', stroke: '#bdc9d9', textColor: '#4d6077', fontSize: 16 }, { container: true, ports: [] }),
  def('swimlane', 'Swimlane', 'Containers', 'swimlane', [1050, 190], { fill: '#ffffff', stroke: '#dce4ee', textColor: '#596d84', fontSize: 14 }, { container: true, ports: [] })
].map(m => [m.id, m]));
export const allMasters = doc => ({ ...BUILTINS, ...doc.stencils });
export const getMaster = (doc, id) => doc.stencils?.[id] || BUILTINS[id] || BUILTINS.process;
export const isContainer = (doc, node) => Boolean(getMaster(doc, node.master).container);
export function shapeGeometry(master, g) {
  if (master.geometry.kind === 'path') return { points: g.pathMode === 'compound' ? pathContours(g).flat() : flattenPath(g), contours: pathContours(g), details: [], closed: Boolean(g.closed) };
  const { x, y, w, h } = g, kind = master.geometry.kind; let points; const details = [];
  const local = p => p.map(([a, b]) => ({ x: x + a, y: y + b }));
  switch (kind) {
    case 'roundrect': points = roundedRect(x, y, w, h, 7); break;
    case 'pill': points = roundedRect(x, y, w, h, h / 2, 12); break;
    case 'diamond': points = local([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]); break;
    case 'triangle': points = local([[w / 2, 0], [w, h], [0, h]]); break;
    case 'hexagon': points = local([[w * .15, 0], [w * .85, 0], [w, h / 2], [w * .85, h], [w * .15, h], [0, h / 2]]); break;
    case 'parallelogram': points = local([[w * .16, 0], [w, 0], [w * .84, h], [0, h]]); break;
    case 'manual': points = local([[0, h * .2], [w, 0], [w, h], [0, h]]); break;
    case 'document': {
      points = local([[0, 0], [w, 0], [w, h * .85]]);
      for (let i = 1; i <= 24; i++) { const t = 1 - i / 24; points.push({ x: x + w * t, y: y + h * (.85 + .1 * Math.sin(t * Math.PI * 2)) }); }
      break;
    }
    case 'cylinder': {
      points = []; const r = h * .14;
      for (let i = 0; i <= 24; i++) { const a = Math.PI + i * Math.PI / 24; points.push({ x: x + w / 2 + w / 2 * Math.cos(a), y: y + r + r * Math.sin(a) }); }
      for (let i = 0; i <= 24; i++) { const a = i * Math.PI / 24; points.push({ x: x + w / 2 + w / 2 * Math.cos(a), y: y + h - r + r * Math.sin(a) }); }
      const arc = []; for (let i = 0; i <= 24; i++) { const a = i * Math.PI / 24; arc.push({ x: x + w / 2 + w / 2 * Math.cos(a), y: y + r + r * Math.sin(a) }); } details.push(arc); break;
    }
    case 'ellipse': points = Array.from({ length: 64 }, (_, i) => ({ x: x + w / 2 + w / 2 * Math.cos(i * Math.PI / 32), y: y + h / 2 + h / 2 * Math.sin(i * Math.PI / 32) })); break;
    case 'note': points = local([[0, 0], [w - 20, 0], [w, 20], [w, h], [0, h]]); details.push(local([[w - 20, 0], [w - 20, 20], [w, 20]])); break;
    case 'subprocess': points = roundedRect(x, y, w, h, 5); details.push(local([[12, 0], [12, h]]), local([[w - 12, 0], [w - 12, h]])); break;
    case 'polygon': points = master.geometry.points.map(p => ({ x: x + evaluate(p[0], { w, h }), y: y + evaluate(p[1], { w, h }) })); break;
    default: points = boxPoints(g);
  }
  points = points.filter((p, i) => !i || distance(p, points[i - 1]) > 1e-6);
  if (points.length > 2 && distance(points[0], points.at(-1)) < 1e-6) points.pop();
  return { points: points.map(p => transformPoint(p, g)), details: details.map(ps => ps.map(p => transformPoint(p, g))), closed: true };
}
export function getPorts(doc, node, g) {
  const m = getMaster(doc, node.master);
  return (node.ports || m.ports || []).map(p => {
    const at = transformPoint({ x: g.x + evaluate(p.x, g), y: g.y + evaluate(p.y, g) }, g);
    const normal = rotatePoint({ x: p.dx * (g.flipX ? -1 : 1), y: p.dy * (g.flipY ? -1 : 1) }, { x: 0, y: 0 }, g.rotation || 0);
    const horizontal = Math.abs(normal.x) >= Math.abs(normal.y);
    return { id: p.id, ...at, dx: horizontal ? Math.sign(normal.x) : 0, dy: horizontal ? 0 : Math.sign(normal.y) };
  });
}
export function getPort(doc, page, endpoint, toward) {
  const n = page.graph.nodes[endpoint.nodeId], g = page.view.nodes[endpoint.nodeId]; if (!n || !g) return null;
  const ps = getPorts(doc, n, g); if (!ps.length) return null;
  if (endpoint.port !== 'auto') { const port = ps.find(p => p.id === endpoint.port); if (port) return port; }
  const target = toward || { x: g.x + g.w + 100, y: g.y + g.h / 2 };
  return ps.reduce((a, b) => Math.hypot(a.x - target.x, a.y - target.y) < Math.hypot(b.x - target.x, b.y - target.y) ? a : b);
}
export function validateStyle(style = {}) {
  for (const key of ['fill', 'stroke', 'textColor', 'headerFill']) if (style[key] !== undefined && (typeof style[key] !== 'string' || !/^(#[0-9a-f]{6}|transparent|none)$/i.test(style[key]))) throw new Error(`Invalid ${key}: use #RRGGBB, transparent, or none.`);
  for (const [key, min, max] of [['fontSize', 8, 120], ['strokeWidth', 0, 64], ['rotation', 0, 360], ['opacity', 0, 1], ['z', -1000000, 1000000], ['weight', 100, 900], ['labelPosition', 0, 1]]) if (style[key] !== undefined && (!Number.isFinite(style[key]) || style[key] < min || style[key] > max)) throw new Error(`Invalid ${key}.`);
  if (style.align !== undefined && !['left', 'center', 'right'].includes(style.align)) throw new Error('Invalid text alignment.');
  for (const [key, values] of Object.entries({ dash: ['solid', 'dash', 'dot', 'dashdot'], lineCap: ['butt', 'round', 'square'], lineJoin: ['miter', 'round', 'bevel'], startArrow: ['none', 'triangle', 'open', 'diamond', 'circle'], endArrow: ['none', 'triangle', 'open', 'diamond', 'circle'] })) if (style[key] !== undefined && !values.includes(style[key])) throw new Error(`Invalid ${key}.`);
  for (const key of ['flipX', 'flipY', 'dashed']) if (style[key] !== undefined && typeof style[key] !== 'boolean') throw new Error(`Invalid ${key}.`);
  return style;
}
export function validatePorts(list, g) {
  if (!Array.isArray(list) || list.length > 64) throw new Error('A shape supports at most 64 connection points.');
  const seen = new Set();
  for (const p of list) {
    if (!p || typeof p.id !== 'string' || !/^[a-zA-Z][\w-]{0,63}$/.test(p.id) || seen.has(p.id)) throw new Error('Port identifiers must be safe and unique.');
    seen.add(p.id);
    if (![p.dx, p.dy].every(Number.isFinite) || Math.abs(p.dx) + Math.abs(p.dy) !== 1 || p.dx * p.dy !== 0) throw new Error('Port normals must be cardinal unit vectors.');
    const x = evaluate(p.x, g), y = evaluate(p.y, g);
    if (x < -.01 || y < -.01 || x > g.w + .01 || y > g.h + .01) throw new Error('Connection points must lie inside or on the shape bounds.');
  }
  return list;
}
export function validateMaster(m) {
  if (!m || typeof m.id !== 'string' || !/^[a-zA-Z][\w-]{0,63}$/.test(m.id) || Object.hasOwn(BUILTINS, m.id)) throw new Error('Use a unique custom stencil id (letters, digits, hyphens).');
  if (['__proto__', 'prototype', 'constructor'].includes(m.id)) throw new Error('Reserved stencil id.');
  if (typeof m.name !== 'string' || !m.name.trim() || m.name.length > 100) throw new Error('Stencil name must contain 1–100 characters.');
  if (m.geometry?.kind !== 'polygon' || !Array.isArray(m.geometry.points) || m.geometry.points.length < 3 || m.geometry.points.length > 128) throw new Error('Custom stencils require a simple polygon with 3–128 points.');
  const size = m.size || [160, 90];
  if (size.length !== 2 || size.some(n => !Number.isFinite(n) || n < 24 || n > 4000)) throw new Error('Invalid stencil default size.');
  for (const [w, h] of [size, [64, 64], [400, 100], [100, 400]]) {
    const points = shapeGeometry(m, { x: 0, y: 0, w, h }).points;
    if (points.some(p => p.x < -0.01 || p.y < -0.01 || p.x > w + .01 || p.y > h + .01) || !isSimplePolygon(points)) throw new Error('Stencil polygon must remain simple and inside its bounds when resized.');
  }
  validateStyle(m.style);
  validatePorts(m.ports || ports, { w: size[0], h: size[1] });
  if (m.defaultLabel !== undefined && (typeof m.defaultLabel !== 'string' || m.defaultLabel.length > 10000)) throw new Error('Invalid default label.');
  if (m.defaultData !== undefined && (!m.defaultData || typeof m.defaultData !== 'object' || Array.isArray(m.defaultData))) throw new Error('Invalid default shape data.');
  return { ...m, category: 'My stencils', size, ports: m.ports || structuredClone(ports), style: { ...BUILTINS.process.style, ...m.style } };
}
export const SAMPLE_MASTER = {
  id: 'chevron', name: 'Chevron step', size: [190, 80],
  geometry: { kind: 'polygon', points: [['0', '0'], ['w*0.78', '0'], ['w', 'h/2'], ['w*0.78', 'h'], ['0', 'h'], ['w*0.18', 'h/2']] },
  ports: [{ id: 'in', x: 'w*0.18', y: 'h/2', dx: -1, dy: 0 }, { id: 'out', x: 'w', y: 'h/2', dx: 1, dy: 0 }],
  style: { fill: '#f0ecff', stroke: '#9070ce', textColor: '#604491' }
};
