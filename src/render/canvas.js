import { pageBounds } from '../core/page.js';
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
    const pb = pageBounds(page), infinite = page.canvasMode === 'infinite';
    if (infinite) { ctx.fillStyle = '#ffffff'; ctx.fillRect(-camera.x / camera.zoom, -camera.y / camera.zoom, camera.width / camera.zoom, camera.height / camera.zoom); }
    else { ctx.save(); ctx.translate(pb.x, pb.y);
    ctx.fillStyle = '#dee3eb'; ctx.fillRect(4, 4, page.width + 1, page.height + 1); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, page.width, page.height);
    ctx.strokeStyle = '#d1d9e3'; ctx.lineWidth = 1 / camera.zoom; ctx.strokeRect(0, 0, page.width, page.height); ctx.restore(); }
    if (grid && camera.zoom > .3) {
      const step = (page.gridSize || 10) * Math.max(1, Math.ceil(12 / (page.gridSize || 10) / camera.zoom));
      const x0 = Math.ceil(Math.max(infinite ? -Infinity : pb.x, -camera.x / camera.zoom) / step) * step, y0 = Math.ceil(Math.max(infinite ? -Infinity : pb.y, -camera.y / camera.zoom) / step) * step;
      const x1 = Math.min(infinite ? Infinity : pb.x + page.width, (camera.width - camera.x) / camera.zoom), y1 = Math.min(infinite ? Infinity : pb.y + page.height, (camera.height - camera.y) / camera.zoom);
      ctx.fillStyle = '#e6ebf1'; for (let y = y0; y <= y1; y += step) for (let x = x0; x <= x1; x += step) ctx.fillRect(x - .6 / camera.zoom, y - .6 / camera.zoom, 1.2 / camera.zoom, 1.2 / camera.zoom);
    }
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    for (const p of this.scene.primitives) {
      if (!p.points.length) continue; ctx.globalAlpha = p.opacity ?? 1; ctx.lineCap = p.lineCap || 'round'; ctx.lineJoin = p.lineJoin || 'round'; ctx.beginPath(); ctx.moveTo(p.points[0].x, p.points[0].y); for (const point of p.points.slice(1)) ctx.lineTo(point.x, point.y);
      if (p.kind === 'polygon') { ctx.closePath(); if (p.fill && !['transparent', 'none'].includes(p.fill)) { ctx.fillStyle = p.fill; ctx.fill(); } }
      if (p.width !== 0 && p.stroke && !['transparent', 'none'].includes(p.stroke)) { ctx.strokeStyle = p.stroke; ctx.lineWidth = p.width ?? 1; ctx.setLineDash(p.dashArray || (p.dashed ? [6, 5] : [])); ctx.stroke(); }
    }
    ctx.globalAlpha = 1; ctx.setLineDash([]); ctx.textBaseline = 'top';
    for (const label of this.scene.texts) {
      ctx.save(); ctx.globalAlpha = label.opacity ?? 1;
      if (label.rotation) { const c = label.rotationCenter; ctx.translate(c.x, c.y); ctx.rotate(label.rotation * Math.PI / 180); ctx.translate(-c.x, -c.y); }
      ctx.font = `${label.weight} ${label.fontSize}px ${FONT}`; ctx.textAlign = label.align; ctx.fillStyle = label.color;
      const x = label.x + (label.align === 'center' ? label.w / 2 : label.align === 'right' ? label.w : 0);
      label.lines.forEach((line, i) => ctx.fillText(line, x, label.y + i * label.lineHeight)); ctx.restore();
    }
    this.lastStats = { primitives: this.scene.primitives.length, labels: this.scene.texts.length };
  }
  dispose() { }
}
