import { cp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {buildPortalWeb} from './build-portal-web.mjs';
import {buildReaderWeb} from './build-reader-web.mjs';
import {buildOfflineReading} from './build-offline-reading.mjs';
import {portalDocument} from '../server/portal-document.mjs';
import {homeDocument,homeLocales} from '../app/home-locale.mjs';
import {releaseCommit} from './release-policy.mjs';
import {commercePage} from '../app/commerce-pages.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function buildSupportPages({appDir,outputDir}){
  for(const directory of ['en','zh-hans','zh-hant','ja'])for(const kind of ['privacy','mcp']){
    const source=await readFile(path.join(appDir,directory,kind+'.html'),'utf8');
    const html=portalDocument(source,'/'+directory+'/'+kind);
    await mkdir(path.join(outputDir,directory),{recursive:true});
    await writeFile(path.join(outputDir,directory,kind+'.html'),html);
    if(directory==='en')await writeFile(path.join(outputDir,kind+'.html'),html);
  }
}
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

export async function buildVercel({outputDir=path.join(root,'dist'),uiTemplateDir=outputDir===path.join(root,'dist')?path.join(root,'.ui-entry'):outputDir+'.ui-entry'}={}){
const appDir = path.join(root, 'app');

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

await cp(appDir, outputDir, { recursive: true });
const readerWeb=await buildReaderWeb({root,outputDir,html:await readFile(path.join(appDir,'index.html'),'utf8')});
await mkdir(uiTemplateDir,{recursive:true});
await writeFile(path.join(uiTemplateDir,'read.html'),readerWeb.html);
await rm(path.join(outputDir,'index.html'),{force:true});
const home = await readFile(path.join(appDir, 'home.html'), 'utf8');
const portalWeb=await buildPortalWeb({root,outputDir,html:home,additionalEntries:['library-shell.mjs','book-cover-ui.mjs']});
console.log('Built portal entry: '+portalWeb.inputs.length+' bundled modules, '+portalWeb.bytes+' bytes; shared and lazy modules retain public URLs.');
// The root is a safe automatic entry; authored language pages have stable URLs.
// Canonical /, /library and /read are served by the localized HTML function.
// Public flat files here would win filesystem routing and shadow its rewrites.
await rm(path.join(outputDir,'library.html'),{force:true});
await rm(path.join(outputDir,'read.html'),{force:true});
for (const locale of homeLocales) {
  const directory = locale.route === '/' ? 'en' : locale.route.slice(1);
  const rendered = homeDocument(home, locale.code);
  await mkdir(path.join(outputDir, directory), { recursive: true });
  await writeFile(path.join(outputDir, directory, 'index.html'), rendered);
  // Static hosts may resolve either the flat file or the directory index.
  await writeFile(path.join(outputDir, directory + '.html'), rendered);
}
await buildSupportPages({appDir,outputDir});
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
const offline=await buildOfflineReading({root,outputDir,readerHtml:readerWeb.html,readerFiles:readerWeb.files});

console.log(`Built hosted library and reader at ${outputDir}; private content stays in Supabase.`);
return {outputDir,uiTemplateDir,offline};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await buildVercel();
