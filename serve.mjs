#!/usr/bin/env node
import http from 'node:http';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 8080), host = process.env.HOST || '127.0.0.1';
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8', '.csv': 'text/csv; charset=utf-8', '.png': 'image/png', '.md': 'text/markdown; charset=utf-8' };
const server = http.createServer(async (req, res) => {
  try {
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }); return res.end(); }
    const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    let file = resolve(root, '.' + path); if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403); return res.end('Forbidden'); }
    const info = await stat(file); if (info.isDirectory()) file = join(file, 'index.html');
    const data = await readFile(file);
    // Hash this local build's inline bundle; no unsafe-eval or unrestricted inline scripts.
    const hashes = extname(file) === '.html' ? [...data.toString().matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => ` 'sha256-${createHash('sha256').update(m[1]).digest('base64')}'`).join('') : '';
    res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Resource-Policy': 'same-origin', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': `default-src 'self'; script-src 'self'${hashes}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'` });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch (error) { res.writeHead(error.code === 'ENOENT' ? 404 : 400, { 'Content-Type': 'text/plain' }); res.end(error.code === 'ENOENT' ? 'Not found' : 'Bad request'); }
});
server.listen(port, host, () => console.log(`Nexora Diagram: http://${host}:${server.address().port}\nPress Ctrl+C to stop. No build or dependencies are required.`));
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
