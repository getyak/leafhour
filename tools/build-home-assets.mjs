import {build} from 'esbuild';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
export async function buildHomeAssets({root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')}={}){
const app=path.join(root,'app');
// System CJK fonts on the presentation page avoid loading the reader's entire
// CJK font index. The reading application retains its original typography.
const typography=(await readFile(path.join(app,'typography.css'),'utf8')).replace(/^@import[^;]+;\s*/gm,'').replaceAll('newsreader-var.woff2','newsreader-home.woff2').replaceAll('newsreader-italic-var.woff2','newsreader-home-italic.woff2');
const names=['interface-tokens','home-public-base','home-navigation','home-books','home-story','home-sample','home-experience'];
let contents=typography+'\n'+(await Promise.all(names.map(name=>readFile(path.join(app,name+'.css'),'utf8')))).join('\n');
contents+='\n.library-only{display:none!important}';
const result=await build({stdin:{contents,loader:'css',resolveDir:app},bundle:false,minify:true,write:false});
await writeFile(path.join(app,'home-public.css'),result.outputFiles[0].contents);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await buildHomeAssets();
