import { buildScene } from '../render/scene.js';
const xml = s => String(s).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
const num = n => Number(n.toFixed(3));
export function exportSVG(doc, page, routes) {
  const scene = buildScene(doc, page, routes), parts = [`<?xml version="1.0" encoding="UTF-8"?>`, `<svg xmlns="http://www.w3.org/2000/svg" xmlns:nexora="https://nexora.local/schema" width="${page.width}" height="${page.height}" viewBox="0 0 ${page.width} ${page.height}" role="img" aria-label="${xml(doc.title)}">`, `<title>${xml(doc.title)} — ${xml(page.name)}</title>`, `<desc>Editable vector diagram exported from Nexora Diagram. Shape and connector identities are preserved as data-nexora-id attributes.</desc>`, `<metadata>${xml(JSON.stringify({ format: doc.format, version: doc.version, pageId: page.id, title: doc.title }))}</metadata>`, `<rect width="100%" height="100%" fill="#fff"/>`, '<g stroke-linejoin="round" stroke-linecap="round">'];
  for (const p of scene.primitives) {
    if (!p.points.length) continue; const path = p.points.map((v, i) => `${i ? 'L' : 'M'}${num(v.x)} ${num(v.y)}`).join(' ') + (p.kind === 'polygon' ? ' Z' : '');
    parts.push(`<path${p.id ? ` data-nexora-id="${xml(p.id)}"` : ''} d="${path}" fill="${xml(p.kind === 'polygon' ? p.fill || 'none' : 'none')}" stroke="${xml(p.stroke || 'none')}" stroke-width="${num(p.width || 0)}"${p.dashed ? ' stroke-dasharray="6 5"' : ''}/>`);
  }
  parts.push('</g>', '<g font-family="Segoe UI, Arial, sans-serif">');
  for (const label of scene.texts) {
    const x = label.x + (label.align === 'center' ? label.w / 2 : label.align === 'right' ? label.w : 0), anchor = label.align === 'center' ? 'middle' : label.align === 'right' ? 'end' : 'start';
    parts.push(`<text data-nexora-id="${xml(label.id)}" font-size="${num(label.fontSize)}" font-weight="${label.weight}" fill="${xml(label.color)}" text-anchor="${anchor}" dominant-baseline="text-before-edge">`);
    label.lines.forEach((line, i) => parts.push(`<tspan x="${num(x)}" y="${num(label.y + i * label.lineHeight)}">${xml(line)}</tspan>`)); parts.push('</text>');
  }
  parts.push('</g>', '</svg>'); return parts.join('\n');
}
