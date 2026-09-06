import { FONT } from './scene.js';
export class CanvasRenderer {
  constructor(canvas) { this.canvas = canvas; this.ctx = canvas.getContext('2d', { alpha: false }); this.scene = { primitives: [], texts: [] }; this.lastStats = {}; }
  setScene(scene) { this.scene = scene; }
  draw(camera, page, grid) {
    const { canvas, ctx } = this, dpr = camera.dpr;
    const width = Math.max(1, Math.round(camera.width * dpr)), height = Math.max(1, Math.round(camera.height * dpr));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = '#eff1f5'; ctx.fillRect(0, 0, camera.width, camera.height);
    ctx.translate(camera.x, camera.y); ctx.scale(camera.zoom, camera.zoom);
    ctx.fillStyle = '#dee3eb'; ctx.fillRect(4, 4, page.width + 1, page.height + 1); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, page.width, page.height);
    ctx.strokeStyle = '#d1d9e3'; ctx.lineWidth = 1 / camera.zoom; ctx.strokeRect(0, 0, page.width, page.height);
    if (grid && camera.zoom > .3) {
      const x0 = Math.max(0, Math.floor(-camera.x / camera.zoom / 20) * 20), y0 = Math.max(0, Math.floor(-camera.y / camera.zoom / 20) * 20);
      const x1 = Math.min(page.width, (camera.width - camera.x) / camera.zoom), y1 = Math.min(page.height, (camera.height - camera.y) / camera.zoom);
      ctx.fillStyle = '#e6ebf1'; for (let y = y0; y <= y1; y += 20) for (let x = x0; x <= x1; x += 20) ctx.fillRect(x - .6 / camera.zoom, y - .6 / camera.zoom, 1.2 / camera.zoom, 1.2 / camera.zoom);
    }
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    for (const p of this.scene.primitives) {
      if (!p.points.length) continue; ctx.beginPath(); ctx.moveTo(p.points[0].x, p.points[0].y); for (const point of p.points.slice(1)) ctx.lineTo(point.x, point.y);
      if (p.kind === 'polygon') { ctx.closePath(); if (p.fill && !['transparent', 'none'].includes(p.fill)) { ctx.fillStyle = p.fill; ctx.fill(); } }
      if (p.stroke && !['transparent', 'none'].includes(p.stroke)) { ctx.strokeStyle = p.stroke; ctx.lineWidth = p.width || 1; ctx.setLineDash(p.dashed ? [6, 5] : []); ctx.stroke(); }
    }
    ctx.setLineDash([]); ctx.textBaseline = 'top';
    for (const label of this.scene.texts) {
      ctx.font = `${label.weight} ${label.fontSize}px ${FONT}`; ctx.textAlign = label.align; ctx.fillStyle = label.color;
      const x = label.x + (label.align === 'center' ? label.w / 2 : label.align === 'right' ? label.w : 0);
      label.lines.forEach((line, i) => ctx.fillText(line, x, label.y + i * label.lineHeight));
    }
    this.lastStats = { primitives: this.scene.primitives.length, labels: this.scene.texts.length };
  }
  dispose() { }
}
