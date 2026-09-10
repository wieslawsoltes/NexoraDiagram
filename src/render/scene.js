import { layoutRichText, textFont } from '../core/rich-text.js';
import { inkOutline } from '../core/curves.js';
import { strokeDash, pathContours, svgPathData } from '../core/drawing.js';
import { markerPrimitives } from './stroke.js';
import { allMasters, getMaster, shapeGeometry, isContainer } from '../core/stencils.js';
import { isVisible } from '../core/model.js';
import { resolveLabel } from '../core/expression.js';
import { bounds, inflate, pointAlong, roundedRect, boxPoints } from '../core/geometry.js';
export const FONT = '"Segoe UI", -apple-system, BlinkMacSystemFont, Arial, sans-serif';
let measureContext;
function measurer() { if (!measureContext) measureContext = document.createElement('canvas').getContext('2d'); return measureContext; }
export function layoutText(text, width, fontSize, weight = 400, maxLines = 40) {
  const ctx = measurer(); ctx.font = `${weight} ${fontSize}px ${FONT}`; const lines = [];
  for (const paragraph of String(text).split('\n')) {
    let line = '';
    const words = paragraph.match(/\S+\s*|\s+/g) || [''];
    for (const word of words) {
      if (ctx.measureText(line + word).width <= width) { line += word; continue; }
      if (line.trim()) lines.push(line.trimEnd()); line = '';
      if (ctx.measureText(word).width > width) {
        for (const char of [...word]) { if (ctx.measureText(line + char).width > width && line) { lines.push(line); line = ''; } line += char; }
      } else line = word.trimStart();
    }
    lines.push(line.trimEnd());
  }
  if (lines.length > maxLines) { lines.length = maxLines; let s = lines.at(-1); while (s.length && ctx.measureText(s + '…').width > width) s = s.slice(0, -1); lines[lines.length - 1] = s + '…'; }
  return { lines, lineHeight: fontSize * 1.3, width: Math.max(1, ...lines.map(s => ctx.measureText(s).width)) };
}
export function labelForNode(doc, n, g) {
  const m = getMaster(doc, n.master), text = resolveLabel(n), size = Math.min(120, Math.max(8, g.fontSize || 16));
  let area = { x: g.x + 14, y: g.y + 7, w: Math.max(10, g.w - 28), h: Math.max(10, g.h - 14) }, align = g.align || 'center';
  if (m.container) { area = { x: g.x + 18, y: g.y + 5, w: g.w - 36, h: 29 }; align = 'left'; }
  else if (m.geometry.kind === 'diamond') { area = { x: g.x + g.w * .2, y: g.y + g.h * .19, w: g.w * .6, h: g.h * .62 }; }
  else if (m.geometry.kind === 'pill') { area = { x: g.x + 12, y: g.y + 4, w: g.w - 24, h: g.h - 8 }; }
  else if (m.geometry.kind === 'triangle') { area = { x: g.x + g.w * .25, y: g.y + g.h * .42, w: g.w * .5, h: g.h * .5 }; }
  else if (m.geometry.kind === 'text') { area = { ...g }; align = g.align || 'left'; }
  else if (m.geometry.kind === 'cylinder') { area.y += g.h * .1; area.h -= g.h * .1; }
  const weight = g.weight || (m.container ? 600 : 400), layout = layoutText(text, area.w, size, weight, Math.max(1, Math.floor(area.h / (size * 1.3))));
  const totalHeight = layout.lines.length * layout.lineHeight;
  return { id: n.id, text, lines: layout.lines, x: area.x, y: area.y + (area.h - totalHeight) / 2, w: area.w, h: totalHeight, rotation: g.rotation || 0, rotationCenter: { x: g.x + g.w / 2, y: g.y + g.h / 2 }, opacity: g.opacity ?? 1, fontSize: size, lineHeight: layout.lineHeight, color: g.textColor || '#334155', align, weight };
}
/** One backend-neutral display list powers GPU rendering, Canvas fallback, and SVG export. */
export function buildScene(doc, page, routes, visibleIds = null) {
  const primitives = [], texts = [];
  const appendLabel = (n, g) => {
    if (!n.richText) { texts.push(labelForNode(doc,n,g)); return; }
    const box = { x:g.x+8, y:g.y+6, w:Math.max(1,g.w-16), h:Math.max(1,g.h-12) }, ctx=measurer();
    const layout=layoutRichText(n.richText,box,g.fontSize||16,(text,run)=> { ctx.font=textFont(run,g.fontSize||16); return ctx.measureText(text).width; });
    const dy=g.textVertical==='bottom'?box.h-layout.height:g.textVertical==='middle'?(box.h-layout.height)/2:0;
    for (const run of layout.runs) texts.push({ id:n.id, lines:[run.text], x:run.x, y:run.y+dy, w:run.width, h:run.size*1.3, fontSize:run.size, lineHeight:run.size*1.3, weight:run.bold?700:400, italic:!!run.italic, underline:!!run.underline, strike:!!run.strike, font:run.font||'sans-serif', link:run.link, color:run.color||g.textColor||'#334155', align:'left', opacity:g.opacity??1, rotation:g.rotation||0, rotationCenter:{x:g.x+g.w/2,y:g.y+g.h/2} });
  };
  const visible = id => isVisible(page, id) && (!visibleIds || visibleIds.has(id));
  const polygon = (points, fill, stroke, width = 1, extra = {}) => primitives.push({ kind: 'polygon', points, fill, stroke, width, ...extra });
  const line = (points, stroke, width = 1, dashed = false, extra = {}) => primitives.push({ kind: 'line', points, stroke, width, dashed, ...extra });
  const nodes = Object.values(page.graph.nodes).filter(n => visible(n.id)).sort((a, b) => (page.view.nodes[a.id].z || 0) - (page.view.nodes[b.id].z || 0));
  // Containers are behind routes; regular shapes occlude incoming connector stubs.
  for (const n of nodes.filter(n => isContainer(doc, n))) {
    const g = page.view.nodes[n.id], m = getMaster(doc, n.master);
    if (n.master === 'group') continue;
    polygon(boxPoints(g), g.fill, g.stroke, g.strokeWidth ?? 1, { id: n.id, dashArray: strokeDash(g), lineCap: g.lineCap, lineJoin: g.lineJoin, opacity: g.opacity ?? 1 });
    polygon(boxPoints({ x: g.x, y: g.y, w: g.w, h: 38 }), g.headerFill || '#f1f4f9', null, 0, { id: n.id, opacity: g.opacity ?? 1 });
    line([{ x: g.x, y: g.y + 38 }, { x: g.x + g.w, y: g.y + 38 }], g.stroke, .8, false, { id: n.id, opacity: g.opacity ?? 1 });
    appendLabel(n,g);
  }
  const edgeLabels = [];
  for (const e of Object.values(page.graph.edges)) if (visible(e.id)) {
    const route = routes.get(e.id); if (!route?.points?.length) continue; const g = page.view.edges[e.id];
    const stroke = route.status === 'blocked' ? '#d46a54' : g.stroke || '#788da4';
    line(route.points, stroke, g.strokeWidth ?? 1.6, false, { id: e.id, dashArray: strokeDash(g), lineCap: g.lineCap, lineJoin: g.lineJoin, opacity: g.opacity ?? 1 }); primitives.push(...markerPrimitives(route.points, { ...g, stroke, id: e.id }, 'triangle'));
    if (e.label) {
      const p = pointAlong(route.points, g.labelPosition ?? .5), fs = 12, layout = layoutText(resolveLabel(e), 150, fs, 400, 2), w = layout.width + 14, h = layout.lines.length * layout.lineHeight + 4;
      edgeLabels.push({ id: e.id, p, w, h, layout, fs, color: stroke });
    }
  }
  for (const n of nodes.filter(n => !isContainer(doc, n))) {
    const g = page.view.nodes[n.id], m = getMaster(doc, n.master), geometry = shapeGeometry(m, g);
    if (n.image) { primitives.push({kind:'image',id:n.id,points:geometry.points,image:n.image,geometry:g,opacity:g.opacity??1}); if(n.label || n.richText) appendLabel(n,g); continue; }
    if (m.geometry.kind === 'path') {
      if (g.pressures && !g.closed) { const outline=inkOutline(geometry.points,g.pressures,g.strokeWidth??2,g.ink||{}); primitives.push({kind:'compound',id:n.id,points:outline,contours:[outline],fill:g.stroke,stroke:null,width:0,opacity:g.opacity??1,fillRule:'nonzero'}); if(n.label || n.richText) appendLabel(n,g); continue; }
      primitives.push({ kind: g.pathMode === 'compound' ? 'compound' : g.closed ? 'polygon' : 'line', contours: geometry.contours, svgD: svgPathData(g), points: geometry.points, fill: g.closed ? g.fill : 'none', stroke: g.stroke, width: g.strokeWidth ?? 2, id: n.id, dashArray: strokeDash(g), lineCap: g.lineCap, lineJoin: g.lineJoin, opacity: g.opacity ?? 1 });
      if (!g.closed) primitives.push(...markerPrimitives(geometry.points, { ...g, id: n.id }));
      if (n.label) appendLabel(n,g);
      continue;
    }
    if (m.geometry.kind !== 'text') {
      // Subtle document-space shadow, not a bitmap: scales with the shape.
      if (!m.annotation && g.fill && !['none', 'transparent'].includes(g.fill)) polygon(geometry.points.map(p => ({ x: p.x, y: p.y + 2 })), '#e9edf3', null, 0, { id: n.id, opacity: g.opacity ?? 1 });
      polygon(geometry.points, g.fill, g.stroke, g.strokeWidth ?? 1.5, { id: n.id, dashArray: strokeDash(g), lineCap: g.lineCap, lineJoin: g.lineJoin, opacity: g.opacity ?? 1 });
      for (const detail of geometry.details) line(detail, g.stroke, g.strokeWidth ?? 1.5, false, { id: n.id, opacity: g.opacity ?? 1 });
    }
    appendLabel(n,g);
  }
  for (const item of edgeLabels) {
    const { p, w, h, fs, layout, color } = item;
    polygon(roundedRect(p.x - w / 2, p.y - h / 2, w, h, 3, 4), '#ffffff', null);
    texts.push({ id: item.id, lines: layout.lines, x: p.x - w / 2, y: p.y - layout.lines.length * layout.lineHeight / 2, w, h, fontSize: fs, lineHeight: layout.lineHeight, color, align: 'center', weight: 400 });
  }
  return { primitives, texts };
}
