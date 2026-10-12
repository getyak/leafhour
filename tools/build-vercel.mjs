import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appDir = path.join(root, 'app');
const outputDir = path.join(root, 'dist');

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

await cp(appDir, outputDir, { recursive: true });

const evalsPath = path.join(outputDir, 'evals.html');
await mkdir(path.join(outputDir, 'evals'), { recursive: true });
await cp(evalsPath, path.join(outputDir, 'evals', 'index.html'));

await writeFile(
  path.join(outputDir, '404.html'),
  '<!doctype html><meta charset="utf-8"><title>旁读</title><p>这个页面不存在。</p>',
);

console.log(`Built reader shell at ${outputDir}; private content stays in Supabase.`);
