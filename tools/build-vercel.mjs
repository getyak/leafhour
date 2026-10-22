import { cp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {buildReaderWeb} from './build-reader-web.mjs';
import {portalDocument} from '../server/portal-document.mjs';
import {homeDocument,homeLocales} from '../app/home-locale.mjs';
import {releaseCommit} from './release-policy.mjs';
import {commercePage} from '../app/commerce-pages.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function buildCommercePages({appDir,outputDir}){
  for(const [locale,directory]of [['en','en'],['zh-Hans','zh-hans'],['zh-Hant','zh-hant'],['ja','ja']]){
    for(const kind of ['pricing','terms','refunds']){
      // Static output never claims a configured payment service is ready. The
      // browser obtains current availability from the protected runtime catalog.
      const html=commercePage({kind,locale,billingEnabled:false});
      await mkdir(path.join(outputDir,directory,kind),{recursive:true});
      await writeFile(path.join(outputDir,directory,kind+'.html'),html);
      await writeFile(path.join(outputDir,directory,kind,'index.html'),html);
      if(locale==='en'){
        await mkdir(path.join(outputDir,kind),{recursive:true});
        await writeFile(path.join(outputDir,kind+'.html'),html);
        await writeFile(path.join(outputDir,kind,'index.html'),html);
      }
    }
  }
  await mkdir(path.join(outputDir,'admin'),{recursive:true});
  await cp(path.join(appDir,'billing.html'),path.join(outputDir,'billing.html'));
  await cp(path.join(appDir,'billing.html'),path.join(outputDir,'admin','billing.html'));
}

export async function buildVercel({outputDir=path.join(root,'dist')}={}){
const appDir = path.join(root, 'app');

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

await cp(appDir, outputDir, { recursive: true });
const readerWeb=await buildReaderWeb({root,outputDir,html:await readFile(path.join(appDir,'index.html'),'utf8')});
await writeFile(path.join(outputDir,'read.html'),readerWeb.html);
const home = await readFile(path.join(appDir, 'home.html'), 'utf8');
// The root is a safe automatic entry; authored language pages have stable URLs.
await writeFile(path.join(outputDir, 'index.html'), portalDocument(home, '/'));
await writeFile(path.join(outputDir, 'library.html'), portalDocument(home, '/library'));
for (const locale of homeLocales) {
  const directory = locale.route === '/' ? 'en' : locale.route.slice(1);
  const rendered = homeDocument(home, locale.code);
  await mkdir(path.join(outputDir, directory), { recursive: true });
  await writeFile(path.join(outputDir, directory, 'index.html'), rendered);
  // Static hosts may resolve either the flat file or the directory index.
  await writeFile(path.join(outputDir, directory + '.html'), rendered);
}
// The default-language guides also serve the unprefixed URLs.
await cp(path.join(appDir, 'en', 'mcp.html'), path.join(outputDir, 'mcp.html'));
await cp(path.join(appDir, 'en', 'privacy.html'), path.join(outputDir, 'privacy.html'));
await buildCommercePages({appDir,outputDir});

const evalsPath = path.join(outputDir, 'evals.html');
await mkdir(path.join(outputDir, 'evals'), { recursive: true });
await cp(evalsPath, path.join(outputDir, 'evals', 'index.html'));

await writeFile(
  path.join(outputDir, '404.html'),
  '<!doctype html><meta charset="utf-8"><title>Leafhour</title><p>This page does not exist.</p>',
);

const sourceCommit=await releaseCommit(root,{sourceCommit:process.env.VERCEL_GIT_COMMIT_SHA||process.env.GITHUB_SHA});
await writeFile(path.join(outputDir,'release.json'),JSON.stringify({sourceCommit})+'\n');

console.log(`Built hosted library and reader at ${outputDir}; private content stays in Supabase.`);
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await buildVercel();
