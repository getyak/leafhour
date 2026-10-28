import {readFile,readdir,lstat} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {releaseFiles} from './release-policy.mjs';

const root=process.cwd(),app=path.join(root,'app'),dist=path.join(root,'dist');
async function list(dir,prefix=''){
  const result=[];for(const item of await readdir(dir,{withFileTypes:true})){const file=prefix+item.name;if(item.isSymbolicLink())throw Error('Unexpected symlink: '+file);if(item.isDirectory())result.push(...await list(path.join(dir,item.name),file+'/'));else result.push(file);}return result;
}
const allowed=new Set([...(await releaseFiles(root)).filter(file=>file.startsWith('app/')&&file!=='app/index.html').map(file=>file.slice(4)),'en/index.html','en.html','zh-hans/index.html','zh-hans.html','zh-hant/index.html','zh-hant.html','ja/index.html','ja.html','mcp.html','privacy.html','evals/index.html','404.html','release.json','admin/billing.html',...['pricing','terms','refunds'].flatMap(kind=>[kind+'.html',kind+'/index.html']),...['en','zh-hans','zh-hant','ja'].flatMap(locale=>['pricing','terms','refunds'].flatMap(kind=>[locale+'/'+kind+'.html',locale+'/'+kind+'/index.html']))]);
for(const file of await list(dist)){
  const generated=/^reader-web\/(reader|style)-([a-f0-9]{16})\.(js|css)$/.exec(file);
  if(generated&&!createHash('sha256').update(await readFile(path.join(dist,file))).digest('hex').startsWith(generated[2]))throw Error('Invalid reader bundle hash');
  if(!allowed.has(file)&&!generated)throw Error('Unexpected public build file: '+file);
  if((await lstat(path.join(dist,file))).size>2_000_000)throw Error('Unexpected public asset size: '+file);
}
for(const file of ['index.html','library.html','read.html']){try{await lstat(path.join(dist,file));throw Error('Static HTML shadows selected-language entry: '+file);}catch(error){if(error.code!=='ENOENT')throw error;}}
const readerTemplate=await readFile(path.join(root,'.ui-entry/read.html'),'utf8');
if(!/reader-web\/reader-[a-f0-9]{16}\.js/.test(readerTemplate))throw Error('Missing compiled private reader template');
const release=JSON.parse(await readFile(path.join(dist,'release.json'),'utf8'));
if(!/^[a-f0-9]{40}$/.test(release.sourceCommit))throw Error('Missing source provenance');
for(const file of ['billing.html','admin/billing.html','en/pricing.html','zh-hans/terms.html','ja/refunds.html','zh-hans/index.html','zh-hans.html','zh-hant/index.html','zh-hant.html','ja/index.html','ja.html','en/index.html','en.html','mcp.html','privacy.html','en/mcp.html','en/privacy.html','zh-hans/mcp.html','zh-hans/privacy.html','zh-hant/mcp.html','zh-hant/privacy.html','ja/mcp.html','ja/privacy.html','robots.txt','sitemap.xml','discovery.css','portal.js','library-workspace.mjs','library-workspace.css','reading-flow.mjs','library-chat-markdown.mjs','reading-load.mjs','reading-arrival.mjs','reading-arrival.css','save-receipts.mjs'])await lstat(path.join(dist,file));
console.log('Public build checked: expected assets and source provenance only.');
