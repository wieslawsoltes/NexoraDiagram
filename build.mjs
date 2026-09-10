#!/usr/bin/env node
/** Dependency-free bundler for this project's deliberately small, named-export-only ES-module subset.
 * This is not a general-purpose JavaScript bundler. The modular source is the development build.
 */
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
const root = dirname(fileURLToPath(import.meta.url));
async function collect(dir) { const result = []; for (const entry of await readdir(dir, { withFileTypes: true })) { const path = join(dir, entry.name); if (entry.isDirectory()) result.push(...await collect(path)); else if (entry.name.endsWith('.js')) result.push(path); } return result; }
const files = await collect(join(root, 'src'));
const modules = new Map();
for (const file of files) {
  const id = '/' + relative(root, file).replaceAll('\\', '/'); let source = await readFile(file, 'utf8');
  const exports = [...source.matchAll(/\bexport\s+(?:async\s+)?(?:function|class|const|let)\s+(\w+)/g)].map(m => m[1]);
  source = source.replace(/import\s*\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"];?/g, (_, names, specifier) => `const {${names}} = require(${JSON.stringify(specifier)});`)
    .replace(/\bexport\s+(?=(?:async\s+)?(?:function|class|const|let)\s)/g, '')
    .replace(/\bimport\(('[^']+'|"[^"]+")\)/g, 'Promise.resolve(require($1))')
    .replace("new Worker(new URL('./router.worker.js', import.meta.url), { type: 'module' })", 'new Worker(globalThis.__NEXORA_ROUTER_WORKER_URL__)');
  if (/\bimport\.meta\b|^\s*import\s|^\s*export\s/m.test(source)) throw new Error(`Unsupported module syntax in ${id}`);
  modules.set(id, `${id.endsWith('/main.js') ? 'async ' : ''}function(module, exports, require){\n'use strict';\n${source}\nObject.assign(exports, {${exports.join(',')}});\n}`);
}
function registry(ids) {
  return `const factories={${ids.map(id => `${JSON.stringify(id)}:${modules.get(id)}`).join(',\n')}}; const cache=Object.create(null);
function normalize(spec, base){const parts=(spec.startsWith('/')?spec:base.slice(0,base.lastIndexOf('/')+1)+spec).split('/'),out=[];for(const p of parts){if(p==='..')out.pop();else if(p&&p!=='.')out.push(p);}return '/'+out.join('/');}
function requireModule(spec,base='/'){const id=normalize(spec,base);if(cache[id])return cache[id].exports;const factory=factories[id];if(!factory)throw Error('Unknown bundled module '+id);const module={exports:{}};cache[id]=module;const result=factory(module,module.exports,next=>requireModule(next,id));if(result?.catch)result.catch(error=>{console.error(error);globalThis.__NEXORA_BOOT_ERROR__=error.message;});return module.exports;}`;
}
const worker = `(()=>{${registry(['/src/core/geometry.js', '/src/core/spatial.js', '/src/core/router.js', '/src/core/router.worker.js'])}\nrequireModule('/src/core/router.worker.js');})();`;
let bundle = `(()=>{globalThis.__NEXORA_ROUTER_WORKER_URL__=URL.createObjectURL(new Blob([${JSON.stringify(worker)}],{type:'text/javascript'}));\n${registry([...modules.keys()])}\nrequireModule('/src/main.js');})();`;
bundle = bundle.replace(/<\/script/gi, '<\\/script');
const css = await readFile(join(root, 'style.css'), 'utf8'), favicon = await readFile(join(root, 'favicon.svg'), 'utf8');
let html = await readFile(join(root, 'index.html'), 'utf8');
html = html.replace('<link rel="stylesheet" href="./style.css">', () => `<style>${css}</style>`).replace('href="./favicon.svg"', `href="data:image/svg+xml,${encodeURIComponent(favicon)}"`).replace('<script type="module" src="./src/main.js"></script>', () => `<script>${bundle}</script>`);
await mkdir(join(root, 'dist'), { recursive: true });
await writeFile(join(root, 'dist', 'Nexora-Diagram.html'), html);
console.log(`Built dist/Nexora-Diagram.html (${(Buffer.byteLength(html) / 1024).toFixed(1)} KiB).`);
