import { tessellateScene } from './stroke.js';
import { cachedImage, imagePlacement } from '../core/assets.js';
import { transformPoint, rotatePoint } from '../core/drawing.js';
import { parseColor, triangulate, distance } from '../core/geometry.js';
import { FONT } from './scene.js';
const SHARED = `
struct Camera { viewport: vec2f, pan: vec2f, zoom: f32, dpr: f32, page: vec2f, grid: f32, pad: f32, extra: vec2f };
@group(0) @binding(0) var<uniform> camera: Camera;
fn project(p: vec2f) -> vec4f { let q = (p * camera.zoom + camera.pan) / camera.viewport; return vec4f(q.x * 2.0 - 1.0, 1.0 - q.y * 2.0, 0.0, 1.0); }
`;
const GEOMETRY_SHADER = SHARED + `
struct In { @location(0) position: vec2f, @location(1) color: vec4f };
struct Out { @builtin(position) position: vec4f, @location(0) color: vec4f };
@vertex fn vs(input: In) -> Out { var o: Out; o.position = project(input.position); o.color = input.color; return o; }
@fragment fn fs(input: Out) -> @location(0) vec4f { return input.color; }
`;
const BACKGROUND_SHADER = SHARED + `
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f { let p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0)); return vec4f(p[i], 0.0, 1.0); }
@fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let screen = position.xy / camera.dpr;
  let p = (screen - camera.pan) / camera.zoom;
  var color = vec3f(0.938, 0.946, 0.961);
  let local = p - camera.extra;
  if (camera.pad < 0.5 && all(local >= vec2f(4.0)) && all(local <= camera.page + vec2f(5.0))) { color = vec3f(0.87, 0.889, 0.917); }
  if (camera.pad > 0.5 || (all(local >= vec2f(0.0)) && all(local <= camera.page))) {
    color = vec3f(1.0);
    let edge = min(min(local.x, local.y), min(camera.page.x - local.x, camera.page.y - local.y));
    if (camera.pad < 0.5 && edge < 0.75 / camera.zoom) { color = vec3f(0.82, 0.85, 0.89); }
    if (camera.grid > 0.0 && camera.zoom > 0.3) {
      let g = (fract(p / camera.grid + 0.5) - 0.5) * camera.grid * camera.zoom;
      let dotAlpha = 1.0 - smoothstep(0.45, 1.05, length(g));
      color = mix(color, vec3f(0.87, 0.90, 0.93), dotAlpha * 0.72);
    }
  }
  return vec4f(color, 1.0);
}
`;
const TEXT_SHADER = SHARED + `
@group(1) @binding(0) var glyphs: texture_2d<f32>;
@group(1) @binding(1) var glyphSampler: sampler;
struct In { @location(0) position: vec2f, @location(1) uv: vec2f, @location(2) color: vec4f };
struct Out { @builtin(position) position: vec4f, @location(0) uv: vec2f, @location(1) color: vec4f };
@vertex fn vs(input: In) -> Out { var o: Out; o.position = project(input.position); o.uv = input.uv; o.color = input.color; return o; }
@fragment fn fs(input: Out) -> @location(0) vec4f { let a = textureSample(glyphs, glyphSampler, input.uv).a; return vec4f(input.color.rgb, input.color.a * a); }
`;
const blend = { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } };
class GrowBuffer {
  constructor(device, usage) { this.device = device; this.usage = usage; this.capacity = 0; this.buffer = null; this.count = 0; }
  upload(data, stride) {
    this.count = data.length / stride;
    if (data.byteLength > this.capacity) { this.buffer?.destroy(); this.capacity = 2 ** Math.ceil(Math.log2(Math.max(1024, data.byteLength))); this.buffer = this.device.createBuffer({ size: this.capacity, usage: this.usage | GPUBufferUsage.COPY_DST }); }
    if (data.byteLength) this.device.queue.writeBuffer(this.buffer, 0, data);
  }
  dispose() { this.buffer?.destroy(); }
}
/** Native text shaping -> cached text-run atlas; resolution buckets prevent continuous re-rasterization. */
class TextAtlas {
  constructor(device, layout, sampler) { this.device = device; this.layout = layout; this.sampler = sampler; this.size = Math.min(2048, device.limits.maxTextureDimension2D); this.pages = []; this.entries = new Map(); this.bucket = 0; this.measure = document.createElement('canvas').getContext('2d'); }
  reset(bucket) { for (const p of this.pages) p.texture.destroy(); this.pages = []; this.entries.clear(); this.bucket = bucket; }
  newPage() {
    if (this.pages.length >= 8) throw new Error('Visible label atlas exceeds its 128 MB limit. Falling back to Canvas.');
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = this.size;
    const texture = this.device.createTexture({ size: [this.size, this.size], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
    const page = { canvas, ctx: canvas.getContext('2d'), texture, x: 2, y: 2, rowHeight: 0, dirty: false };
    page.bindGroup = this.device.createBindGroup({ layout: this.layout, entries: [{ binding: 0, resource: texture.createView() }, { binding: 1, resource: this.sampler }] });
    this.pages.push(page); return page;
  }
  get(label) {
    const font = `${label.italic?'italic ':''}${label.weight} ${label.fontSize}px ${label.font||FONT}`; this.measure.font = font;
    const width = Math.max(1, ...label.lines.map(s => this.measure.measureText(s).width));
    const height = label.lines.length * label.lineHeight;
    const key = JSON.stringify([label.lines, label.fontSize, label.weight, label.align, label.lineHeight,label.italic,label.font,label.underline,label.strike]);
    if (this.entries.has(key)) return this.entries.get(key);
    const scale = Math.min(this.bucket, (this.size - 12) / width, (this.size - 12) / height), pad = 3;
    const w = Math.ceil(width * scale) + pad * 2, h = Math.ceil(height * scale) + pad * 2;
    let page = this.pages.at(-1) || this.newPage();
    if (page.x + w + 2 > this.size) { page.x = 2; page.y += page.rowHeight + 2; page.rowHeight = 0; }
    if (page.y + h + 2 > this.size) page = this.newPage();
    const { ctx } = page; ctx.save(); ctx.translate(page.x + pad, page.y + pad); ctx.scale(scale, scale); ctx.font = font; ctx.fillStyle = '#ffffff'; ctx.textBaseline = 'top'; ctx.textAlign = label.align;
    const dx = label.align === 'center' ? width / 2 : label.align === 'right' ? width : 0;
    label.lines.forEach((line,i)=>{const y=i*label.lineHeight;ctx.fillText(line,dx,y);const lw=ctx.measureText(line).width,start=dx-(label.align==='center'?lw/2:label.align==='right'?lw:0);for(const position of [label.underline ? .98 : 0,label.strike ? .5 : 0].filter(Boolean))ctx.fillRect(start,y+label.fontSize*position,lw,Math.max(1,label.fontSize/14));}); ctx.restore();
    const entry = { page: this.pages.length - 1, x: page.x, y: page.y, w, h, width, height, scale, pad };
    page.x += w + 2; page.rowHeight = Math.max(page.rowHeight, h); page.dirty = true; this.entries.set(key, entry); return entry;
  }
  upload() { for (const p of this.pages) if (p.dirty) { this.device.queue.copyExternalImageToTexture({ source: p.canvas }, { texture: p.texture, premultipliedAlpha: false }, [this.size, this.size]); p.dirty = false; } }
  dispose() { this.reset(0); }
}
export class WebGPURenderer {
  static async create(canvas) {
    if (!navigator.gpu) throw new Error('WebGPU is not exposed in this browser context.');
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }); if (!adapter) throw new Error('No WebGPU adapter available.');
    const device = await adapter.requestDevice();
    try { const renderer = new WebGPURenderer(canvas, device); await renderer.initialize(); return renderer; }
    catch (error) { device.destroy(); throw error; }
  }
  constructor(canvas, device) { this.canvas = canvas; this.device = device; this.context = canvas.getContext('webgpu'); this.format = navigator.gpu.getPreferredCanvasFormat(); this.textBuffers = []; this.imageTextures = new Map(); this.imageBuffers=[]; this.commands=[]; this.sizeKey = ''; this.bucket = 0; this.scene = null; this.lastStats = {}; }
  async initialize() {
    const d = this.device; this.context.configure({ device: d, format: this.format, alphaMode: 'opaque' });
    this.uniform = d.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.cameraLayout = d.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
    this.cameraGroup = d.createBindGroup({ layout: this.cameraLayout, entries: [{ binding: 0, resource: { buffer: this.uniform } }] });
    const textureLayout = d.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } }, { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } }] });
    const make = async (code, buffers, layouts, blended) => {
      const module = d.createShaderModule({ code }); const info = await module.getCompilationInfo(); const errors = info.messages.filter(m => m.type === 'error'); if (errors.length) throw new Error(errors.map(m => m.message).join('\n'));
      return d.createRenderPipelineAsync({ layout: d.createPipelineLayout({ bindGroupLayouts: layouts }), vertex: { module, entryPoint: 'vs', buffers }, fragment: { module, entryPoint: 'fs', targets: [{ format: this.format, ...(blended ? { blend } : {}) }] }, primitive: { topology: 'triangle-list' }, multisample: { count: 4 } });
    };
    this.backgroundPipeline = await make(BACKGROUND_SHADER, [], [this.cameraLayout], false);
    this.geometryPipeline = await make(GEOMETRY_SHADER, [{ arrayStride: 24, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }, { shaderLocation: 1, offset: 8, format: 'float32x4' }] }], [this.cameraLayout], true);
    this.textPipeline = await make(TEXT_SHADER, [{ arrayStride: 32, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }, { shaderLocation: 1, offset: 8, format: 'float32x2' }, { shaderLocation: 2, offset: 16, format: 'float32x4' }] }], [this.cameraLayout, textureLayout], true);
    this.textureLayout=textureLayout; this.imageSampler=d.createSampler({magFilter:'linear',minFilter:'linear'});
    this.imagePipeline=await make(TEXT_SHADER.replace('let a = textureSample(glyphs, glyphSampler, input.uv).a; return vec4f(input.color.rgb, input.color.a * a);','let c = textureSample(glyphs, glyphSampler, input.uv); return vec4f(c.rgb * input.color.rgb, c.a * input.color.a);'),[{arrayStride:32,attributes:[{shaderLocation:0,offset:0,format:'float32x2'},{shaderLocation:1,offset:8,format:'float32x2'},{shaderLocation:2,offset:16,format:'float32x4'}]}],[this.cameraLayout,textureLayout],true);
    this.geometry = new GrowBuffer(d, GPUBufferUsage.VERTEX);
    this.atlas = new TextAtlas(d, textureLayout, d.createSampler({ magFilter: 'linear', minFilter: 'linear' }));
  }
  setScene(scene,camera) {
    this.scene=scene;this.commands=[]; const chunks=[];let offset=0,index=0;
    const live=new Set(scene.primitives.filter(p=>p.kind==='image').map(p=>p.image.data));
    for(const [key,t] of this.imageTextures) if(!live.has(key)){t.texture.destroy();this.imageTextures.delete(key);}
    for(const p of scene.primitives) {
      if(p.kind!=='image') {const vertices=tessellateScene({primitives:[p]}),count=vertices.length/6;chunks.push(vertices); if(count){const last=this.commands.at(-1);if(last?.kind==='geometry')last.count+=count;else this.commands.push({kind:'geometry',offset,count});offset+=count;}continue;}
      const item=cachedImage(p.image,()=>this.onInvalidate?.()); if(!item.ready) continue;
      let t=this.imageTextures.get(p.image.data);
      if(!t) {
        const bytes=p.image.width*p.image.height*4;
        if([...this.imageTextures.values()].reduce((sum,t)=>sum+t.bytes,bytes)>128*1024*1024)throw new Error('Visible image textures exceed 128 MB.');
        const texture=this.device.createTexture({size:[p.image.width,p.image.height],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT});
        this.device.queue.copyExternalImageToTexture({source:item.element},{texture,premultipliedAlpha:false},[p.image.width,p.image.height]);
        t={texture,bytes,group:this.device.createBindGroup({layout:this.textureLayout,entries:[{binding:0,resource:texture.createView()},{binding:1,resource:this.imageSampler}]})}; this.imageTextures.set(p.image.data,t);
      }
      const placement=imagePlacement(p.image,p.geometry),vertices=[];
      for(const [dx,dy] of [[0,0],[1,0],[1,1],[0,0],[1,1],[0,1]]){const point=transformPoint({x:placement.x+dx*placement.w,y:placement.y+dy*placement.h},p.geometry);vertices.push(point.x,point.y,(placement.sx+dx*placement.sw)/p.image.width,(placement.sy+dy*placement.sh)/p.image.height,1,1,1,p.opacity??1);}
      const buffer=this.imageBuffers[index] ||= new GrowBuffer(this.device,GPUBufferUsage.VERTEX);buffer.upload(new Float32Array(vertices),8);index++;this.commands.push({kind:'image',buffer,group:t.group});
    }
    const data=new Float32Array(offset*6);let at=0;for(const chunk of chunks){data.set(chunk,at);at+=chunk.length;}this.geometry.upload(data,6);this.rebuildText(camera);
  }
  rebuildText(camera) {
    if (!this.scene) return;
    const bucket = Math.min(4, Math.max(1, 2 ** (Math.ceil(Math.log2(camera.zoom * camera.dpr) * 2) / 2)));
    if (bucket !== this.bucket || this.atlas.entries.size > 5000) { this.atlas.reset(bucket); this.bucket = bucket; }
    const vertices = [];
    for (const label of this.scene.texts) {
      if (!label.lines.some(Boolean)) continue;
      const e = this.atlas.get(label); const data = vertices[e.page] ||= []; const c = parseColor(label.color); c[3] *= label.opacity ?? 1;
      const x = label.x + (label.align === 'center' ? (label.w - e.width) / 2 : label.align === 'right' ? label.w - e.width : 0) - e.pad / e.scale;
      const y = label.y - e.pad / e.scale, w = e.w / e.scale, h = e.h / e.scale, s = this.atlas.size;
      for (const [dx, dy] of [[0, 0], [1, 0], [1, 1], [0, 0], [1, 1], [0, 1]]) {
        const p = label.rotation ? rotatePoint({ x: x + dx * w, y: y + dy * h }, label.rotationCenter, label.rotation) : { x: x + dx * w, y: y + dy * h };
        data.push(p.x, p.y, (e.x + dx * e.w) / s, (e.y + dy * e.h) / s, ...c);
      }
    }
    for (let i = 0; i < Math.max(vertices.length, this.textBuffers.length); i++) {
      this.textBuffers[i] ||= new GrowBuffer(this.device, GPUBufferUsage.VERTEX); this.textBuffers[i].upload(new Float32Array(vertices[i] || []), 8);
    }
    this.atlas.upload();
  }
  draw(camera, page, grid) {
    const { canvas, device: d } = this; const w = Math.max(1, Math.round(camera.width * camera.dpr)), h = Math.max(1, Math.round(camera.height * camera.dpr));
    if (`${w}:${h}` !== this.sizeKey) { canvas.width = w; canvas.height = h; this.msaa?.destroy(); this.msaa = d.createTexture({ size: [w, h], sampleCount: 4, format: this.format, usage: GPUTextureUsage.RENDER_ATTACHMENT }); this.sizeKey = `${w}:${h}`; }
    const requiredBucket = Math.min(4, Math.max(1, 2 ** (Math.ceil(Math.log2(camera.zoom * camera.dpr) * 2) / 2)));
    if (requiredBucket !== this.bucket) this.rebuildText(camera);
    d.queue.writeBuffer(this.uniform, 0, new Float32Array([camera.width, camera.height, camera.x, camera.y, camera.zoom, camera.dpr, page.width, page.height, grid ? (page.gridSize || 10) * Math.max(1, Math.ceil(12 / (page.gridSize || 10) / camera.zoom)) : 0, page.canvasMode === 'infinite' ? 1 : 0, page.originX || 0, page.originY || 0]));
    const encoder = d.createCommandEncoder(); const pass = encoder.beginRenderPass({ colorAttachments: [{ view: this.msaa.createView(), resolveTarget: this.context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'discard', clearValue: { r: .94, g: .95, b: .96, a: 1 } }] });
    pass.setBindGroup(0, this.cameraGroup); pass.setPipeline(this.backgroundPipeline); pass.draw(3);
    let draws=1;for(const command of this.commands){if(command.kind==='geometry'){pass.setPipeline(this.geometryPipeline);pass.setVertexBuffer(0,this.geometry.buffer);pass.draw(command.count,1,command.offset);}else{pass.setPipeline(this.imagePipeline);pass.setBindGroup(1,command.group);pass.setVertexBuffer(0,command.buffer.buffer);pass.draw(command.buffer.count);}draws++;}
    pass.setPipeline(this.textPipeline);
    this.textBuffers.forEach((buffer, i) => { if (!buffer.count) return; pass.setBindGroup(1, this.atlas.pages[i].bindGroup); pass.setVertexBuffer(0, buffer.buffer); pass.draw(buffer.count); draws++; });
    pass.end(); d.queue.submit([encoder.finish()]);
    this.lastStats = { vertices: this.geometry.count, atlasPages: this.atlas.pages.length, drawCalls: draws, atlasEntries: this.atlas.entries.size };
  }
  dispose() { this.msaa?.destroy(); this.uniform?.destroy(); this.geometry?.dispose(); this.atlas?.dispose(); this.textBuffers.forEach(b => b.dispose());this.imageBuffers.forEach(b=>b.dispose());for(const t of this.imageTextures.values())t.texture.destroy(); this.device.destroy(); }
}
