import { imagePlacement } from './assets.js';
import { transformPoint } from './drawing.js';
import { buildScene } from '../render/scene.js';
import { pageBounds } from './page.js';
import { bounds, union, inflate } from './geometry.js';
import { descendants } from './model.js';
const xml = s => String(s).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
const num = n => Number(n.toFixed(3));
export function exportScene(doc, page, routes, options = {}) {
  let ids = null;
  if (options.ids) {
    ids = new Set(options.ids); for (const id of options.ids) descendants(page, id).forEach(child => ids.add(child));
    for (const edge of Object.values(page.graph.edges)) if (ids.has(edge.from.nodeId) && ids.has(edge.to.nodeId)) ids.add(edge.id);
  }
  const scene = buildScene(doc, page, routes, ids); let box = null;
  for (const p of scene.primitives) if (p.points.length) box = union(box, inflate(bounds(p.points), (p.width || 0) * 2 + 1));
  for (const label of scene.texts) {const corners=[{x:label.x,y:label.y},{x:label.x+label.w,y:label.y},{x:label.x+label.w,y:label.y+label.h},{x:label.x,y:label.y+label.h}]; const angle=(label.rotation||0)*Math.PI/180,c=label.rotationCenter; const points=c?corners.map(p=>({x:c.x+(p.x-c.x)*Math.cos(angle)-(p.y-c.y)*Math.sin(angle),y:c.y+(p.x-c.x)*Math.sin(angle)+(p.y-c.y)*Math.cos(angle)})):corners;box=union(box,bounds(points));}
  if (!options.content && !ids && page.canvasMode !== 'infinite') box = pageBounds(page);
  else box = box ? inflate(box, options.padding ?? 16) : pageBounds(page);
  return { scene, box: { x: box.x, y: box.y, w: Math.max(1, box.w), h: Math.max(1, box.h) } };
}
export function exportSVG(doc, page, routes, options = {}) {
  const { scene, box: b } = exportScene(doc, page, routes, options);
  const parts = [`<?xml version="1.0" encoding="UTF-8"?>`, `<svg xmlns="http://www.w3.org/2000/svg" width="${num(b.w)}" height="${num(b.h)}" viewBox="${num(b.x)} ${num(b.y)} ${num(b.w)} ${num(b.h)}" role="img" aria-label="${xml(doc.title)}">`, `<title>${xml(doc.title)} — ${xml(page.name)}</title>`, `<desc>Vector diagram exported from Nexora Diagram. Shape and connector identities are preserved as data-nexora-id attributes.</desc>`, `<metadata>${xml(JSON.stringify({ format: doc.format, version: doc.version, pageId: page.id, title: doc.title }))}</metadata>`, `<rect x="${num(b.x)}" y="${num(b.y)}" width="${num(b.w)}" height="${num(b.h)}" fill="#fff"/>`, '<g>'];
  for (const p of scene.primitives) {
    if (!p.points.length) continue;
    if (p.kind==='image') { const g=p.geometry,d=imagePlacement(p.image,g),cx=g.x+g.w/2,cy=g.y+g.h/2;parts.push(`<g data-nexora-id="${xml(p.id)}" opacity="${num(p.opacity??1)}" transform="translate(${num(cx)} ${num(cy)}) rotate(${num(g.rotation||0)}) scale(${g.flipX?-1:1} ${g.flipY?-1:1}) translate(${num(-cx)} ${num(-cy)})"><svg x="${num(d.x)}" y="${num(d.y)}" width="${num(d.w)}" height="${num(d.h)}" viewBox="${num(d.sx)} ${num(d.sy)} ${num(d.sw)} ${num(d.sh)}" preserveAspectRatio="none" overflow="hidden"><image href="${xml(p.image.data)}" width="${p.image.width}" height="${p.image.height}"><title>${xml(p.image.alt||'')}</title></image></svg></g>`);continue; }
    const path = p.svgD || (p.kind==='compound' ? p.contours.map(r=>r.map((v,i)=>`${i?'L':'M'}${num(v.x)} ${num(v.y)}`).join(' ')+' Z').join(' ') : p.points.map((v, i) => `${i ? 'L' : 'M'}${num(v.x)} ${num(v.y)}`).join(' ') + (p.kind === 'polygon' ? ' Z' : '')), dash = p.dashArray || (p.dashed ? [6, 5] : []);
    parts.push(`<path${p.id ? ` data-nexora-id="${xml(p.id)}"` : ''} d="${path}" fill-rule="${p.fillRule||'evenodd'}" fill="${xml(['polygon','compound'].includes(p.kind) ? p.fill || 'none' : 'none')}" stroke="${xml(p.stroke || 'none')}" stroke-width="${num(p.width || 0)}" stroke-linecap="${xml(p.lineCap || 'round')}" stroke-linejoin="${xml(p.lineJoin || 'round')}" opacity="${num(p.opacity ?? 1)}"${dash.length ? ` stroke-dasharray="${dash.map(num).join(' ')}"` : ''}/>`);
  }
  parts.push('</g>', '<g font-family="Segoe UI, Arial, sans-serif">');
  for (const label of scene.texts) {
    const x = label.x + (label.align === 'center' ? label.w / 2 : label.align === 'right' ? label.w : 0), anchor = label.align === 'center' ? 'middle' : label.align === 'right' ? 'end' : 'start', c = label.rotationCenter;
    if(label.link)parts.push(`<a href="${xml(label.link)}" target="_blank" rel="noopener noreferrer">`);
    parts.push(`<text font-family="${xml(label.font||'Segoe UI, Arial, sans-serif')}" font-style="${label.italic?'italic':'normal'}" text-decoration="${[label.underline?'underline':'',label.strike?'line-through':''].filter(Boolean).join(' ')||'none'}" data-nexora-id="${xml(label.id)}" font-size="${num(label.fontSize)}" font-weight="${label.weight}" fill="${xml(label.color)}" opacity="${num(label.opacity ?? 1)}" text-anchor="${anchor}" dominant-baseline="text-before-edge"${label.rotation && c ? ` transform="rotate(${num(label.rotation)} ${num(c.x)} ${num(c.y)})"` : ''}>`);
    label.lines.forEach((line, i) => parts.push(`<tspan x="${num(x)}" y="${num(label.y + i * label.lineHeight)}">${xml(line)}</tspan>`)); parts.push('</text>');if(label.link)parts.push('</a>');
  }
  parts.push('</g>', '</svg>'); return parts.join('\n');
}
