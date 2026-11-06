import {build} from 'esbuild';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {homeDocument,homeLocales} from '../app/home-locale.mjs';
import {publicHomeDocument} from '../app/home-public-document.mjs';
import {sampleInterpretations} from '../app/home-sample.mjs';
import en from '../app/ui-catalogs/en.mjs';
import hans from '../app/ui-catalogs/zh-Hans.mjs';
import hant from '../app/ui-catalogs/zh-Hant.mjs';
import ja from '../app/ui-catalogs/ja.mjs';
export async function buildHomeAssets({root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')}={}){
const app=path.join(root,'app');
// Keep native CJK fonts first. Hosts without them still need the verified
// fallback; include only existing subset declarations covering public copy,
// rather than the reader's complete CJK font index.
const typography=(await readFile(path.join(app,'typography.css'),'utf8')).replace(/^@import[^;]+;\s*/gm,'').replaceAll('newsreader-var.woff2','newsreader-home.woff2').replaceAll('newsreader-italic-var.woff2','newsreader-home-italic.woff2');
const html=await readFile(path.join(app,'home.html'),'utf8');
const appearanceKeys=['shell.appearance.title','shell.appearance.system','shell.appearance.paper','shell.appearance.night','appearance.trigger'];
const dynamicCopy=JSON.stringify(sampleInterpretations)+[en,hans,hant,ja].flatMap(catalog=>appearanceKeys.map(key=>catalog[key]||'')).join('');
const publicCopy=homeLocales.map(locale=>publicHomeDocument(homeDocument(html,locale.code))).join('')+dynamicCopy;
const points=[...new Set([...publicCopy].map(char=>char.codePointAt(0)).filter(point=>point>=0x2e80))].sort((a,b)=>a-b);
const fullCjk=await readFile(path.join(app,'fonts/noto-serif-sc/font-faces.css'),'utf8');
const cjk=[...fullCjk.matchAll(/@font-face\{[^}]+\}/g)].flatMap(([face])=>{
 const expression=/unicode-range:([^}]+)/.exec(face);if(!expression)return [];
 const ranges=expression[1].split(',').map(value=>value.trim().replace(/^U\+/i,'').split('-').map(hex=>parseInt(hex,16)));
 const used=points.filter(point=>ranges.some(([start,end=start])=>point>=start&&point<=end));
 return used.length?[face.replace(expression[1],used.map(point=>'U+'+point.toString(16).toUpperCase()).join(','))]:[];
}).join('\n');
const names=['interface-tokens','home-public-base','home-navigation','home-books','home-story','home-sample','home-experience'];
let contents=cjk+'\n'+typography+'\n'+(await Promise.all(names.map(name=>readFile(path.join(app,name+'.css'),'utf8')))).join('\n');
contents+='\n.library-only{display:none!important}';
const result=await build({stdin:{contents,loader:'css',resolveDir:app},bundle:false,minify:true,write:false});
await writeFile(path.join(app,'home-public.css'),result.outputFiles[0].contents);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await buildHomeAssets();
