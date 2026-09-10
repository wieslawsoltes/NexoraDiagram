/** Embedded raster assets: strict data-only allowlist, no external fetches or active SVG. */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export function validateImage(image) {
  if (!image || !['image/png', 'image/jpeg', 'image/webp'].includes(image.mime) || typeof image.data !== 'string' || image.data.length > MAX_IMAGE_BYTES * 1.38 || !new RegExp(`^data:${image.mime};base64,[A-Za-z0-9+/]+={0,2}$`).test(image.data)) throw new Error('Use an embedded PNG, JPEG, or WebP image below 8 MB.');
  if (![image.width, image.height].every(n => Number.isInteger(n) && n > 0 && n <= 8192) || image.width * image.height > 32000000) throw new Error('Image dimensions exceed the 32 megapixel/8192-pixel limit.');
  if (image.alt !== undefined && (typeof image.alt !== 'string' || image.alt.length > 1000)) throw new Error('Invalid image description.');
  if (image.fit !== undefined && !['contain', 'cover', 'stretch'].includes(image.fit)) throw new Error('Invalid image fit mode.');
  if (image.crop !== undefined && (!image.crop || !['x','y','w','h'].every(k => Number.isFinite(image.crop[k])) || image.crop.x < 0 || image.crop.y < 0 || image.crop.w <= 0 || image.crop.h <= 0 || image.crop.x + image.crop.w > 1.000001 || image.crop.y + image.crop.h > 1.000001)) throw new Error('Invalid normalized image crop.');
  const prefix = atob(image.data.split(',')[1].slice(0, 48));
  if (image.mime === 'image/png' && prefix.slice(0,8) !== '\x89PNG\r\n\x1a\n' || image.mime === 'image/jpeg' && prefix.slice(0,3) !== '\xff\xd8\xff' || image.mime === 'image/webp' && (prefix.slice(0,4) !== 'RIFF' || prefix.slice(8,12) !== 'WEBP')) throw new Error('Image signature does not match its declared type.');
  return image;
}
export function imagePlacement(image, g) {
  const crop = image.crop || { x: 0, y: 0, w: 1, h: 1 }; let sx = crop.x * image.width, sy = crop.y * image.height, sw = crop.w * image.width, sh = crop.h * image.height;
  let x = g.x, y = g.y, w = g.w, h = g.h; const fit = image.fit || 'contain';
  if (fit === 'contain') { const scale = Math.min(w/sw,h/sh); w = sw*scale; h = sh*scale; x += (g.w-w)/2; y += (g.h-h)/2; }
  if (fit === 'cover') { const scale = Math.max(w/sw,h/sh), nw = w/scale, nh = h/scale; sx += (sw-nw)/2; sy += (sh-nh)/2; sw=nw; sh=nh; }
  return { x,y,w,h,sx,sy,sw,sh };
}
export async function imageFromFile(file) {
  if (file.size > MAX_IMAGE_BYTES) throw new Error('Image is larger than 8 MB.');
  if (!['image/png','image/jpeg','image/webp'].includes(file.type)) throw new Error('Choose a PNG, JPEG or WebP image.');
  const checked=rasterFromBytes(new Uint8Array(await file.arrayBuffer()),file.name);
  const data = await new Promise((resolve,reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); });
  const element = new Image(); element.src = data; await element.decode();
  if(element.naturalWidth!==checked.width||element.naturalHeight!==checked.height)throw new Error('Decoded raster dimensions differ from its header.');return checked;
}
const images = new Map(); let cacheBytes=0;
export function cachedImage(image, invalidate) {
  const key = image.data; let entry = images.get(key);
  if (!entry) {
    validateImage(image); const element = new Image(); entry = { element, ready:false, failed:false, listeners:new Set(), bytes:image.width*image.height*4 }; images.set(key,entry);cacheBytes+=entry.bytes;
    element.onload = () => { if (element.naturalWidth !== image.width || element.naturalHeight !== image.height) { entry.failed = true; } else entry.ready = true; for(const callback of entry.listeners) callback();entry.listeners.clear(); };
    element.onerror = () => { entry.failed = true; for(const callback of entry.listeners) callback();entry.listeners.clear(); }; element.src = key;
    // Bounded decoded-image cache; live scene images are re-requested when needed.
    while(images.size > 1 && (images.size > 32 || cacheBytes > 128*1024*1024)){const oldest=images.keys().next().value;cacheBytes-=images.get(oldest).bytes;images.delete(oldest);}
  }
  if(invalidate && !entry.ready && !entry.failed) entry.listeners.add(invalidate);
  return entry;
}
export async function loadSceneImages(scene) { await Promise.all(scene.primitives.filter(p=>p.kind==='image').map(async p=> { const e=cachedImage(p.image); await e.element.decode(); if(e.element.naturalWidth!==p.image.width || e.element.naturalHeight!==p.image.height) throw new Error('Image dimensions do not match the embedded data.'); e.ready=true; })); }

export function rasterFromBytes(bytes,name='image.png'){
  if(!(bytes instanceof Uint8Array)||bytes.length<30||bytes.length>MAX_IMAGE_BYTES)throw new Error('Raster byte size is outside supported limits.');let mime,width,height;const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),s=String.fromCharCode(...bytes.slice(0,12));
  if(s.startsWith('\x89PNG\r\n\x1a\n')){mime='image/png';width=view.getUint32(16);height=view.getUint32(20);}
  else if(bytes[0]===255&&bytes[1]===216){mime='image/jpeg';let at=2;while(at+9<bytes.length){if(bytes[at++]!==255)continue;const marker=bytes[at++],len=view.getUint16(at);if([0xc0,0xc1,0xc2].includes(marker)){height=view.getUint16(at+3);width=view.getUint16(at+5);break;}if(len<2)break;at+=len;}}
  else if(s.startsWith('RIFF')&&s.slice(8)==='WEBP'){mime='image/webp';const kind=String.fromCharCode(...bytes.slice(12,16));if(kind==='VP8X'){width=1+(bytes[24]|bytes[25]<<8|bytes[26]<<16);height=1+(bytes[27]|bytes[28]<<8|bytes[29]<<16);}else if(kind==='VP8 '){width=view.getUint16(26,true)&0x3fff;height=view.getUint16(28,true)&0x3fff;}else if(kind==='VP8L'){const bits=view.getUint32(21,true);width=1+(bits&0x3fff);height=1+(bits>>14&0x3fff);}}
  if(!mime||!width||!height)throw new Error('This raster encoding is not supported.');let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return validateImage({mime,width,height,data:`data:${mime};base64,${btoa(binary)}`,alt:name.slice(0,1000),fit:'contain'});
}
