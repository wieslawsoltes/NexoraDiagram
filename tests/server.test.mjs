import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createHash } from 'node:crypto';

test('local development server serves modules, restricts methods and hashes the standalone CSP', {timeout:10000}, async () => {
  const child=spawn(process.execPath,['serve.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:'0',HOST:'127.0.0.1'},stdio:['ignore','pipe','pipe']});
  try {
    const base=await new Promise((resolve,reject)=>{let text='';child.stdout.on('data',data=>{text+=data;const match=text.match(/http:\/\/127\.0\.0\.1:\d+/);if(match)resolve(match[0]);});child.once('error',reject);child.once('exit',code=>reject(new Error(`Server exited early: ${code}`)));});
    const home=await fetch(base);assert.equal(home.status,200);assert.match(await home.text(),/Nexora Diagram/);
    const module=await fetch(base+'/src/core/router.js');assert.match(module.headers.get('content-type'),/javascript/);assert.match(await module.text(),/routeConnector/);
    const head=await fetch(base,{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
    assert.equal((await fetch(base,{method:'POST'})).status,405);
    assert.equal((await fetch(base+'/missing-file')).status,404);
    const standalone=await fetch(base+'/dist/Nexora-Diagram.html');assert.equal(standalone.status,200);
    const html=await standalone.text(),code=html.match(/<script>([\s\S]*?)<\/script>/)[1];
    const hash=createHash('sha256').update(code).digest('base64');assert.ok(standalone.headers.get('content-security-policy').includes(`'sha256-${hash}'`));
    assert.ok(standalone.headers.get('content-security-policy').includes("worker-src 'self' blob:"));
  } finally {const exited=once(child,'exit');child.kill('SIGTERM');await exited;}
});
