import {build} from 'esbuild';
import {parse} from 'acorn';
import {readFile,writeFile,mkdir,realpath} from 'node:fs/promises';
import path from 'node:path';
import {releaseFiles} from './release-policy.mjs';

// Retain browser module identity across independently loaded entries and lazy
// boundaries. Only modules exclusive to this entry are folded into portal.js.
export async function buildPortalWeb({root,outputDir,html,additionalEntries=[]}){
 root=await realpath(root);const app=path.join(root,'app'),allowed=new Set(await releaseFiles(root)),cache=new Map();
 const relative=file=>path.relative(root,file).replaceAll('\\','/');
 const check=file=>{if(!file.startsWith(app+path.sep)||!allowed.has(relative(file)))throw Error('Portal dependency lacks public release backing: '+relative(file));return file;};
 function resolve(spec,importer){
  if(typeof spec!=='string'||!spec.startsWith('.')&&!spec.startsWith('/'))throw Error('Portal imports must use literal public paths');
  const offset=spec.search(/[?#]/),base=offset<0?spec:spec.slice(0,offset),suffix=offset<0?'':spec.slice(offset);
  const file=check(base.startsWith('/')?path.resolve(app,'.'+base):path.resolve(path.dirname(importer),base));
  return {file,url:'/'+path.relative(app,file).replaceAll('\\','/')+suffix};
 }
 async function edges(file){
  check(file);if(cache.has(file))return cache.get(file);
  const ast=parse(await readFile(file,'utf8'),{ecmaVersion:'latest',sourceType:'module'}),rows=[];
  function visit(node){
   if(!node||typeof node!=='object')return;
   if(node.type==='ImportExpression'){
    if(node.source.type!=='Literal'||typeof node.source.value!=='string')throw Error('Portal dynamic imports must be literal public paths');
    rows.push({...resolve(node.source.value,file),dynamic:true});
   }else if(['ImportDeclaration','ExportNamedDeclaration','ExportAllDeclaration'].includes(node.type)&&node.source)rows.push({...resolve(node.source.value,file),dynamic:false});
   for(const value of Object.values(node)){if(Array.isArray(value)){for(const child of value)visit(child);}else if(value&&typeof value==='object')visit(value);}
  }
  visit(ast);cache.set(file,rows);return rows;
 }
 async function closure(roots,{staticOnly=false,stop=null}={}){const seen=new Set();async function walk(file){if(file===stop||seen.has(file))return;seen.add(file);for(const edge of await edges(file))if(!staticOnly||!edge.dynamic)await walk(edge.file);}for(const file of roots)await walk(file);return seen;}
 const entry=check(path.join(app,'portal.js')),scripts=[...html.matchAll(/<script\s+type="module"\s+src="(\/[^"]+)"\s*><\/script>/g)].map(row=>resolve(row[1],entry).file);
 if(!scripts.includes(entry))throw Error('Portal document is missing its entry');
 const staticFiles=await closure([entry],{staticOnly:true}),lazy=[];for(const file of staticFiles)for(const edge of await edges(file))if(edge.dynamic)lazy.push(edge.file);
 const entries=[entry,...additionalEntries.map(name=>check(path.join(app,name)))],bundles=[],allInputs=new Set(),allRetained=new Set();
 for(const current of entries){
 const retained=await closure([...scripts.filter(file=>file!==entry),...lazy,...entries.filter(file=>file!==current)],{stop:current});
 for(const file of retained)allRetained.add(relative(file));
 const result=await build({absWorkingDir:root,entryPoints:[current],bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,metafile:true,write:false,outfile:path.join(outputDir,path.basename(current)),logLevel:'silent',plugins:[{name:'portal-public-boundaries',setup(builder){builder.onResolve({filter:/.*/},args=>{
  if(!args.importer)return undefined;
  const target=resolve(args.path,args.importer);
  if(args.kind==='dynamic-import'||retained.has(target.file)||entries.includes(target.file)&&target.file!==current)return {path:target.url,external:true};
  return undefined;
 });}}]});
 const inputs=Object.keys(result.metafile.inputs).map(file=>path.isAbsolute(file)?relative(file):file.replaceAll('\\','/'));
 for(const file of inputs)if(!allowed.has(file)||!file.startsWith('app/'))throw Error('Portal bundle contains a non-public input: '+file);
 const bytes=result.outputFiles[0].contents;if(bytes.length>200*1024)throw Error('Portal bundle exceeds the public JavaScript size limit: '+path.basename(current)+' '+bytes.length);
 for(const file of inputs)allInputs.add(file);bundles.push({file:path.basename(current),bytes,inputs});
 }
 await mkdir(outputDir,{recursive:true});for(const bundle of bundles)await writeFile(path.join(outputDir,bundle.file),bundle.bytes);
 return {inputs:[...allInputs].sort(),retained:[...allRetained].sort(),bytes:bundles.reduce((sum,b)=>sum+b.bytes.length,0),bundles:bundles.map(b=>({file:b.file,bytes:b.bytes.length,inputs:b.inputs}))};
}
