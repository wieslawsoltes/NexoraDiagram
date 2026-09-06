#!/usr/bin/env node
/** Assemble a subdirectory-safe, dependency-free GitHub Pages deployment. */
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = dirname(fileURLToPath(import.meta.url));
export async function buildPages(outputDirectory, revision = 'local') {
  const output = resolve(outputDirectory);
  if (output === root || root.startsWith(output + '/')) throw new Error('The site output must not replace the project root or its ancestors.');
  await mkdir(output, { recursive: true });
  for (const name of ['index.html', 'style.css', 'favicon.svg', 'src', 'examples', 'LICENSE']) {
    await cp(join(root, name), join(output, name), { recursive: true });
  }
  await mkdir(join(output, 'tests'), { recursive: true });
  for (const name of ['webgpu-smoke.html', 'webgpu-smoke.js']) await cp(join(root, 'tests', name), join(output, 'tests', name));
  await mkdir(join(output, 'dist'), { recursive: true });
  const standalone = await readFile(join(root, 'dist', 'Nexora-Diagram.html'));
  await writeFile(join(output, 'dist', 'Nexora-Diagram.html'), standalone);
  await writeFile(join(output, 'Nexora-Diagram.html'), standalone);
  await writeFile(join(output, '.nojekyll'), '');
  await writeFile(join(output, 'build-info.json'), JSON.stringify({ name: 'Nexora Diagram', version: '1.0.0', sourceRevision: revision }, null, 2) + '\n');
  return output;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = spawnSync(process.execPath, [join(root, 'build.mjs')], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  const output = join(root, '_site');
  await rm(output, { recursive: true, force: true });
  await buildPages(output, process.env.GITHUB_SHA || 'local');
  console.log('Built _site/ for GitHub Pages; all runtime asset paths are relative.');
}
