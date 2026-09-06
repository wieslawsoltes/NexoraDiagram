import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { buildPages } from '../build-pages.mjs';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
test('Pages build preserves module, worker, example and standalone asset paths', async () => {
  const build = spawnSync(process.execPath, [join(root, 'build.mjs')], { encoding: 'utf8' });
  assert.equal(build.status, 0, build.stderr);
  const output = await mkdtemp(join(tmpdir(), 'nexora-pages-'));
  try {
    await buildPages(output, 'test-revision');
    const info = JSON.parse(await readFile(join(output, 'build-info.json'), 'utf8'));
    assert.equal(info.sourceRevision, 'test-revision');
    const html = await readFile(join(output, 'index.html'), 'utf8');
    for (const match of html.matchAll(/(?:src|href)="(\.\/[^"#?]+)"/g)) assert.ok((await stat(resolve(output, match[1]))).isFile(), match[1]);
    async function inspect(directory) {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) { await inspect(path); continue; }
        if (!entry.name.endsWith('.js')) continue;
        const code = await readFile(path, 'utf8');
        for (const match of code.matchAll(/(?:from\s*|import\s*\(|new URL\s*\()\s*['"](\.[^'"]+)['"]/g)) assert.ok((await stat(resolve(dirname(path), match[1]))).isFile(), `${path}: ${match[1]}`);
      }
    }
    await inspect(join(output, 'src'));
    assert.equal(await readFile(join(output, '.nojekyll'), 'utf8'), '');
    assert.deepEqual(await readFile(join(output, 'Nexora-Diagram.html')), await readFile(join(output, 'dist', 'Nexora-Diagram.html')));
    assert.ok((await stat(join(output, 'tests', 'webgpu-smoke.js'))).isFile());
    assert.ok((await stat(join(output, 'examples', 'chevron.stencils.json'))).isFile());
  } finally { await rm(output, { recursive: true, force: true }); }
});
test('Pages build refuses to replace the source root', async () => {
  await assert.rejects(buildPages(root), /must not replace/);
});
