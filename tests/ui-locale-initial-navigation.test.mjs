import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {parse} from 'acorn';
import {createUiLocale} from '../app/ui-locale.mjs';
import {uiAuthoredPath} from '../app/ui-locale-codec.mjs';
import {libraryViewDefaults,writeLibraryView,safeLibraryReturn} from '../app/library-view-state.mjs';
const source=await readFile(new URL('../app/command-palette.mjs',import.meta.url),'utf8');
const ast=parse(source,{ecmaVersion:'latest',sourceType:'module'});
const declaration=name=>{const node=ast.body.find(n=>(n.declaration||n).id?.name===name);assert.ok(node);const inner=node.declaration||node;return source.slice(inner.start,inner.end);};
const labels={library:'Library',settings:'Settings',calendar:'Calendar',home:'Home'};
function commands(runtime){const destinations=[],context={paletteLabels:()=>labels,uiHref:runtime.uiHref,getUiNavigationLocale:runtime.getUiNavigationLocale,uiAuthoredPath,libraryViewDefaults,writeLibraryView,safeLibraryReturn};vm.createContext(context);vm.runInContext(declaration('paletteLibraryUrl')+';'+declaration('paletteCommands')+';this.commands=paletteCommands;',context);return {destinations,run(){destinations.length=0;for(const c of context.commands('home',null,url=>destinations.push(url)))c.run();return [...destinations];}};}
for(const code of ['ja','zh-Hans','zh-Hant'])for(const surface of ['','/mcp','/privacy'])test(`initial ${code}${surface} navigation uses authored route until fallback, then effective locale through retry`,async()=>{
 const prefix={ja:'/ja','zh-Hans':'/zh-hans','zh-Hant':'/zh-hant'}[code];let reject;const pending=new Promise((_,r)=>reject=r),catalogue=(await import('../app/ui-catalogs/'+code+'.mjs')).default;let retry=false;
 const writes=[],runtime=createUiLocale({getLocation:()=>({href:'https://leafhour.com'+prefix+surface+'?ui=en'}),storage:{getItem:()=> 'en',setItem:(...v)=>writes.push(v)},loadCatalogue:()=>retry?Promise.resolve(catalogue):pending});
 const verify=expected=>{assert.equal(runtime.getUiNavigationLocale(),expected);assert.equal(runtime.uiHref('/read?book=literal%2Fid&layer=original#p1'),'/read?book=literal%2Fid&layer=original&ui='+expected+'#p1');const c=commands(runtime),routes=c.run();assert.equal(routes.length,4);assert.deepEqual(routes.slice(0,3),['/library?ui='+expected,'/library?settings=appearance&ui='+expected,'/library?calendar=1&ui='+expected]);assert.equal(routes[3],uiAuthoredPath('/',expected));};
 verify(code);const initial=runtime.initializeOnce();assert.equal(runtime.getUiLocale(),'en');verify(code);assert.equal(writes.length,0);reject(Error('synthetic failure'));await initial;verify('en');assert.equal(runtime.getUiLocale(),'en');assert.equal(runtime.getUiLocaleState().initialFallback,true);assert.equal(writes.length,0);retry=true;await runtime.retryUiLocale();verify(code);assert.equal(runtime.getUiLocale(),code);assert.equal(writes.length,1);
});
test('canonical initial loading and later authored picker requests retain effective navigation; loading navigation never writes preferences',async()=>{
 let resolve;const pending=new Promise(r=>resolve=r),ja=(await import('../app/ui-catalogs/ja.mjs')).default;
 const canonical=createUiLocale({getLocation:()=>({href:'https://leafhour.com/library?ui=ja'}),loadCatalogue:()=>pending});const initial=canonical.initializeOnce();assert.equal(canonical.getUiNavigationLocale(),'en');resolve(ja);await initial;assert.equal(canonical.getUiNavigationLocale(),'ja');
 let reject;const later=new Promise((_,r)=>reject=r);let mode='initial';const writes=[];
 const runtime=createUiLocale({getLocation:()=>({href:'https://leafhour.com/ja'}),storage:{setItem:(...v)=>writes.push(v)},history:{replaceState(){}},loadCatalogue:()=>mode==='initial'?Promise.resolve(ja):later});await runtime.initializeOnce();mode='later';const picker=runtime.setUiLocale('zh-Hant');assert.equal(runtime.getUiNavigationLocale(),'ja');assert.equal(runtime.getUiLocale(),'ja');const before=writes.length;for(let i=0;i<10;i++)assert.equal(runtime.uiHref('/library'),'/library?ui=ja');assert.equal(writes.length,before);reject(Error('later failure'));await picker;assert.equal(runtime.getUiNavigationLocale(),'ja');assert.equal(runtime.getUiLocaleState().initialFallback,false);
});
