import { WebGPURenderer } from './webgpu.js';
import { CanvasRenderer } from './canvas.js';
export class Renderer extends EventTarget {
  constructor(gpuCanvas, fallbackCanvas) {
    super(); this.gpuCanvas = gpuCanvas; this.fallbackCanvas = fallbackCanvas; this.backend = new CanvasRenderer(fallbackCanvas); this.mode = 'Canvas 2D'; this.disposed = false;
    this.fallbackCanvas.hidden = false; this.gpuCanvas.hidden = true;
  }
  async initialize(forceCanvas = false) {
    if (forceCanvas) { this.reason = 'Canvas backend selected by URL parameter.'; this.dispatchEvent(new Event('backend')); return; }
    try {
      const gpu = await WebGPURenderer.create(this.gpuCanvas);
      if (this.disposed) { gpu.dispose(); return; }
      this.backend.dispose(); this.backend = gpu; this.mode = 'WebGPU'; this.gpuCanvas.hidden = false; this.fallbackCanvas.hidden = true;
      gpu.device.lost.then(info => { if (!this.disposed && this.backend === gpu) this.fallback(`GPU device lost: ${info.message || info.reason}`); });
      gpu.device.addEventListener('uncapturederror', e => { e.preventDefault(); if (this.backend === gpu) this.fallback(e.error.message); });
      this.dispatchEvent(new Event('backend'));
    } catch (error) { this.reason = error.message; this.dispatchEvent(new Event('backend')); }
  }
  fallback(reason) {
    const old = this.backend; this.backend = new CanvasRenderer(this.fallbackCanvas); this.mode = 'Canvas 2D'; this.reason = reason; this.gpuCanvas.hidden = true; this.fallbackCanvas.hidden = false;
    if (this.scene) this.backend.setScene(this.scene, this.camera); old.dispose(); this.dispatchEvent(new Event('backend'));
  }
  setScene(scene, camera) {
    this.scene = scene; this.camera = camera;
    try { this.backend.setScene(scene, camera); } catch (error) { if (this.mode === 'WebGPU') this.fallback(error.message); else throw error; }
  }
  draw(camera, page, grid) {
    this.camera = camera; const begin = performance.now();
    try { this.backend.draw(camera, page, grid); } catch (error) { if (this.mode === 'WebGPU') { this.fallback(error.message); this.backend.draw(camera, page, grid); } else throw error; }
    this.cpuSubmitMs = performance.now() - begin;
  }
  dispose() { this.disposed = true; this.backend.dispose(); }
}
