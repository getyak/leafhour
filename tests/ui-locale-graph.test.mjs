import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,readFile,realpath,symlink} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {assertStaticModuleSyntax,auditUiLocaleGraph,buildReaderWeb,syntacticImportEdges,syntacticImportEdgesMany} from '../tools/build-reader-web.mjs';

const yes=[
 `import('./x.mjs')`, 'import(`./x.mjs`)', `import('./x.mjs', {with:{type:'json'}})`,
 `export const example='import(path)';`, '// import(path)\nexport const x=1', 'const s=`import(path) ${1}`;',
 `const x={import(path){return path},require(path){return path}};x.require(p);`,
 `function f(require){require(p)}`, `function f(){require(p);var require=fake;}`,`function f(){require(p);function require(){}}`,
 `function f(){require(p);let require=fake;}`,`{require(p);const require=fake}`,`{class require{};require(p)}`,
 `import require from 'fake';require(p)`, `const {require}=fake;require(p)`, `const [require]=fake;require(p)`,
 `try{}catch(require){require(p)}`, `try{}catch({require}){require(p)}`,`for(let require of xs){require(p)}`,
 `for(let require=fake;ok;step){require(p)}`,`switch(x){case 1:require(p);break;case 2:let require=fake;}`,
 `const f=function require(){require(p)}`,`const c=class require{method(){require(p)}}`,
 `function f({require}={}){require(p)}`, `function f(require=fake,x=require(p)){}`, `function f(...require){require(p)}`,
 `const obj={require};function require(){}`,`const obj={require:'x'};obj.require(p)`,
 `const x={};x.require(p);x['require'](p)`, `const r=/require\(x\)/;`,
 `require('./x.mjs')`, `require?.('./x.mjs')`, 'require(`./x.mjs`)',
 `const c=class{static{require(p);var require=fake}}`,
 `class require{};export {require};`, `const f=(require)=>require.call(null,p)`,
 `function f(){function g(){require(p)};var require=fake}`,
 `const {[require('./x.mjs')]:value}=obj`,
];
const no=[
 `import(p)`, `import('./x.mjs'+variant)`, `import('./x.mjs'.replace('x','y'))`, 'import(`./${x}.mjs`)',
 'import(tag`./x.mjs`)', `import('./x.mjs',{with:{[require(p)]:'x'}})`,
 `require(p)`, `require('./x'+p)`, `require()`, `require('./x','./y')`,
 `const r=require;r(p)`, `(0,require)(p)`, `require.call(null,p)`, `new require('./x')`,
 `function f(x=require(p)){var require=fake;}`, `function f(x=require(p)){function require(){}}`,
 `function f({x=require(p)}){let require=fake}`,`for(let require of xs){}require(p)`,
 `try{}catch(require){}require(p)`, `const f=function require(){};require(p)`,
 `const c=class require{};require(p)`, `const o={require};`, `export {require};`,
 `const {[require(p)]:value}=obj`, `const x={ [require(p)](){}}`, `class C{[require(p)](){}}`,
 `function f(){ {let require=fake;} require(p)}`, `require?.(p)`,
 `const c=class{static{var require=fake}};require(p)`,
];

test('opaque module syntax distinguishes executable loaders from text, keys and lexical bindings',()=>{
 for(const source of yes)assert.doesNotThrow(()=>assertStaticModuleSyntax(source),source);
 for(const source of no)assert.throws(()=>assertStaticModuleSyntax(source),/Unable to validate ui-locale edge/,source);
});

const codes=['en','zh-Hans','zh-Hant','ja'];
const six=codes.slice(1).flatMap(c=>['./ui-catalogs/'+c+'.mjs','./ui-catalogs/'+c+'.mjs?retry=1']);
const runtime="import en from './ui-catalogs/en.mjs';export const uiLocale={en};export const loaders=["+six.map(x=>'()=>import('+JSON.stringify(x)+')').join(',')+"];";
const html='<head><script type="module" src="/reader.js"></script><script type="module" src="/reader-translation.js"></script><link rel="stylesheet" href="/styles.css"></head>';
async function fixture(extra={},runtimeSource=runtime){
 const root=await mkdtemp(path.join(tmpdir(),'leafhour-locale-graph-'));
 const files={'app/browser-globals.mjs':await readFile(new URL('../app/browser-globals.mjs',import.meta.url),'utf8'),'app/reader.js':"import {uiLocale} from './ui-locale.mjs';import {label} from './library-shell.mjs';console.log(label,uiLocale);",'app/reader-translation.js':"import {uiLocale} from './ui-locale.mjs';export const translationLocale=uiLocale;",'app/styles.css':'body{color:black}',
 'app/library-shell.mjs':"import {uiLocale} from './ui-locale.mjs';export const label=uiLocale;",'app/ui-locale.mjs':runtimeSource,'app/ui-locale-codec.mjs':'export const codec=true;','app/account-ui-preferences-browser.mjs':'export const factory=true;','app/account-ui-preferences.mjs':'export const factory=true;','app/account-ui-preferences-transport.mjs':'export const factory=true;','app/authored-ui-choice.mjs':'export const factory=true;',
 ...Object.fromEntries(codes.map(c=>['app/ui-catalogs/'+c+'.mjs','export default Object.freeze({label:'+JSON.stringify(c)+'});'])),...extra};
 for(const [name,source]of Object.entries(files)){await mkdir(path.dirname(path.join(root,name)),{recursive:true});await writeFile(path.join(root,name),source);}
 await writeFile(path.join(root,'release-files.json'),JSON.stringify(Object.keys(files)));
 return {root,dispose:()=>rm(root,{recursive:true,force:true})};
}
async function checkFixture({extra,runtimeSource,allowed}){
 const f=await fixture(extra,runtimeSource);
 try{
  if(allowed){
   const audit=await auditUiLocaleGraph({root:f.root});assert.deepEqual(audit.owners,['app/library-shell.mjs','app/reader-translation.js','app/reader.js']);assert.equal(audit.catalogueEdges.length,6);
   const built=await buildReaderWeb({root:f.root,outputDir:path.join(f.root,'out'),html});assert.ok(!built.inputs.includes('app/ui-locale.mjs'));
   const js=await readFile(path.join(f.root,'out',built.files[0]),'utf8');assert.match(js,/from["']\/ui-locale\.mjs["']/);
  }else{
   await assert.rejects(auditUiLocaleGraph({root:f.root}),/Unable to validate|Unauthorized ui-/);
   await assert.rejects(buildReaderWeb({root:f.root,outputDir:path.join(f.root,'out'),html}),/Unable to validate|Unauthorized ui-/);
  }
 }finally{await f.dispose();}
}

test('actual source audit and esbuild retain harmless text, lexical require and development-tool controls',async()=>{
 await checkFixture({allowed:true});
 for(const source of ["export const example='import(path)';",'export const example=`import(path)`;',"// import(path)\nexport const example=1;",'export function use(require){return require(path)}'])await checkFixture({extra:{'app/example.mjs':source},allowed:true});
 await checkFixture({extra:{'tools/development.mjs':'export const load=p=>import(p)'},allowed:true});
});

test('actual builds reject computed import forms including quoted prefixes before esbuild can fold them',async()=>{
 for(const expression of ["'./ui-locale.mjs'+globalThis.variant","'./ui-locale.mjs'.replace('x','y')",'`./ui-${globalThis.variant}.mjs`','globalThis.path']){
  await checkFixture({extra:{'app/example.mjs':'export const load=()=>import('+expression+')'},allowed:false});
 }
});

test('catalogue permission compares full decoded specifiers including fragments and retry query',async()=>{
 for(const replacement of ['./ui-catalogs/ja.mjs#copy','./ui-catalogs/ja.mjs?retry=1#copy','./ui-catalogs/ja.mjs?retry=2']){
  const runtimeSource=runtime.replace("import(\"./ui-catalogs/ja.mjs\")",'import('+JSON.stringify(replacement)+')');assert.notEqual(runtimeSource,runtime);
  await checkFixture({runtimeSource,allowed:false});
 }
 const runtimeSource=runtime.replace('ja.mjs?retry=1','ja.mjs?retry=1\\x23copy');assert.notEqual(runtimeSource,runtime);await checkFixture({runtimeSource,allowed:false});
});

test('unauthorized backend edges fail in every actual product runtime root and extension',async()=>{
 for(const name of ['app/wrong.mjs','server/wrong.mjs','api/wrong.js','deploy/wrong.mjs']){
  const specifier=(name.startsWith('app/')?'./':'../app/')+'ui-locale.mjs';
  await checkFixture({extra:{[name]:'import {uiLocale} from '+JSON.stringify(specifier)+';export const locale=uiLocale;'},allowed:false});
 }
});


test('actual audits and builds reject browser-normalized path and deployment-origin aliases',async()=>{
 const aliases=[
  './x/%2e%2e/ui-locale.mjs','./x/.%2e/ui-locale.mjs','./x/%2E./ui-locale.mjs',
  '../ui-locale.mjs','./x\\../ui-locale.mjs','./ui-\nlocale.mjs',
  'https://leafhour.com/ui-locale.mjs','//leafhour.com/ui-locale.mjs',
  'https://another-deployment.example/ui-locale.mjs#copy',
  '\u0000https://leafhour.com/ui-locale.mjs','ht\ttps://leafhour.com/ui-locale.mjs','ht\ntps://leafhour.com/ui-locale.mjs',
  './x/%2e%2e/ui-catalogs/en.mjs','https://leafhour.com/ui-catalogs/en.mjs',
 ];
 for(const specifier of aliases)await checkFixture({extra:{'app/unreviewed.mjs':'import '+JSON.stringify(specifier)+';'},allowed:false});
 for(const root of ['server','api','deploy'])await checkFixture({extra:{[root+'/unreviewed.mjs']:"import '../app/x/%2e%2e/ui-locale.mjs';"},allowed:false});
});


test('filesystem root aliases produce identical exact importer edges, audits and builds',async()=>{
 const f=await fixture({
  'app/reader.js':"import {uiLocale} from './ui-locale.mjs';import {label} from './library-shell.mjs';import './palette-bootstrap.mjs';console.log(label,uiLocale);",
  'app/palette-bootstrap.mjs':"import {uiLocale} from './ui-locale.mjs';export const open=()=>import('./command-palette.mjs');console.log(uiLocale,open);",
  'app/command-palette.mjs':"import {uiLocale} from './ui-locale.mjs';export const palette=uiLocale;",
  'app/styles.css':'@import "./typography.css";body{color:black}',
  'app/typography.css':'@import "/fonts/noto-serif-sc/font-faces.css";',
  'app/fonts/noto-serif-sc/font-faces.css':'@font-face{font-family:synthetic;src:url(/synthetic.woff2)}'
 });const alias=f.root+'-alias';
 try{
  await symlink(f.root,alias,'dir');const physical=await realpath(f.root),files=['app/library-shell.mjs','app/ui-locale.mjs'];
  const sorted=edges=>edges.sort((a,b)=>(a.importer+' '+a.specifier+' '+a.kind).localeCompare(b.importer+' '+b.specifier+' '+b.kind));
  const canonical=sorted(await syntacticImportEdgesMany(physical,files));
  assert.ok(canonical.every(edge=>edge.importer.startsWith('app/')));
  for(const root of [f.root,alias]){
   assert.deepEqual(sorted(await syntacticImportEdgesMany(root,files)),canonical);
   assert.deepEqual(await syntacticImportEdges(root,'app/library-shell.mjs'),canonical.filter(edge=>edge.importer==='app/library-shell.mjs'));
   assert.deepEqual(await auditUiLocaleGraph({root}),await auditUiLocaleGraph({root:physical}));
   const outputDir=path.join(root,'out'),built=await buildReaderWeb({root,outputDir,html});
   assert.ok(built.inputs.includes('app/library-shell.mjs'));assert.ok(built.inputs.every(file=>file.startsWith('app/')));
   const js=await readFile(path.join(outputDir,built.files[0]),'utf8'),css=await readFile(path.join(outputDir,built.files[1]),'utf8');
   assert.match(js,/from["']\/ui-locale\.mjs["']/);assert.match(js,/import\(["']\/command-palette\.mjs["']\)/);assert.match(css,/\/fonts\/noto-serif-sc\/font-faces\.css/);
  }
  await writeFile(path.join(f.root,'app/unreviewed.mjs'),"import './ui-locale.mjs';");
  for(const root of [f.root,alias,physical])await assert.rejects(auditUiLocaleGraph({root}),/Unauthorized ui-locale edge from app\/unreviewed\.mjs: wrong caller/);
 }finally{await rm(alias,{force:true});await f.dispose();}
});
