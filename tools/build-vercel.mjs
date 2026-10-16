import { cp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {portalDocument} from '../server/portal-document.mjs';
import {releaseCommit} from './release-policy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appDir = path.join(root, 'app');
const outputDir = path.join(root, 'dist');

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

await cp(appDir, outputDir, { recursive: true });
await cp(path.join(appDir, 'index.html'), path.join(outputDir, 'read.html'));
await cp(path.join(appDir, 'home.html'), path.join(outputDir, 'index.html'));
await writeFile(path.join(outputDir, 'library.html'),portalDocument(await readFile(path.join(appDir,'home.html'),'utf8'),'/library'));

const evalsPath = path.join(outputDir, 'evals.html');
await mkdir(path.join(outputDir, 'evals'), { recursive: true });
await cp(evalsPath, path.join(outputDir, 'evals', 'index.html'));

await writeFile(
  path.join(outputDir, '404.html'),
  '<!doctype html><meta charset="utf-8"><title>Leafhour</title><p>这个页面不存在。</p>',
);

const sourceCommit=await releaseCommit(root,{sourceCommit:process.env.VERCEL_GIT_COMMIT_SHA||process.env.GITHUB_SHA});
await writeFile(path.join(outputDir,'release.json'),JSON.stringify({sourceCommit})+'\n');

console.log(`Built hosted library and reader at ${outputDir}; private content stays in Supabase.`);
