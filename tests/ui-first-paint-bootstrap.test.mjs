import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {UI_FIRST_PAINT_SCRIPT,runUiFirstPaintHandoff,mirrorUiLanguageHint} from '../app/ui-first-paint-bootstrap.mjs';
import {UI_HINT_COOKIE} from '../app/ui-first-paint-codec.mjs';
function fixture({source='browser',locale='en',preference='',device=null,session=null,cookie='',blocked=false}={}){
 const attrs=new Map(Object.entries({'data-ui-initial-locale':locale,'data-ui-initial-source':source,'data-ui-initial-preference':preference,'data-ui-initial-owner':source==='account'?'owner-a':'','data-ui-device-hint':cookie}));
 const root={hidden:false,getAttribute:k=>attrs.get(k)??null,setAttribute:(k,v)=>attrs.set(k,String(v))};let saved=cookie?UI_HINT_COOKIE+'='+cookie:'';const document={documentElement:root,get cookie(){return saved;},set cookie(value){if(!blocked)saved=value.split(';')[0];}};
 const targets=[],timers=[],location={href:'https://leafhour.test/library?book=literal%2Fid#p1',protocol:'https:',replace:value=>targets.push(value)};
 return {document,location,storage:{getItem:()=>device},sessionStorage:{getItem:()=>session},languages:['en'],targets,timers,setTimeout:fn=>(timers.push(fn),timers.length),clearTimeout(){},view:{addEventListener(){}}};
}
test('a legacy device choice hands off before paint and mirrors only a bounded presentation hint',()=>{
 const f=fixture({device:'ja'});const result=runUiFirstPaintHandoff(f);assert.equal(result.kind,'handoff');assert.equal(result.locale,'ja');assert.equal(f.document.documentElement.hidden,true);assert.equal(f.targets.length,1);assert.match(f.document.cookie,/leafhour\.ui\.hint\.v1=1\.ja\.en/);assert.ok(f.targets[0].includes('book=literal%2Fid'));assert.ok(f.targets[0].endsWith('#p1'));
});
test('explicit page and verified account languages outrank device hints without reloading',()=>{
 for(const source of ['page','account']){const f=fixture({source,locale:'zh-Hans',preference:'zh-Hans',device:'ja'});assert.equal(runUiFirstPaintHandoff(f).kind,'continue');assert.equal(f.targets.length,0);assert.equal(f.document.documentElement.hidden,false);assert.match(f.document.cookie,/1\.ja\.en/);}
});
test('blocked cookies use one explicit owned language while keeping business coordinates',()=>{
 const f=fixture({device:'ja',blocked:true});runUiFirstPaintHandoff(f);const next=new URL(f.targets[0]);assert.equal(next.searchParams.get('ui'),'ja');assert.equal(next.searchParams.get('book'),'literal/id');assert.equal(next.hash,'#p1');
});
test('hint mirroring never stores a tab-only choice in a shared cookie',()=>{
 const f=fixture({device:'en',session:'ja'});mirrorUiLanguageHint(f);assert.match(f.document.cookie,/1\.en\.en/);
});
test('the exact classic script is self-contained and can execute under strict CSP without eval',()=>{
 const f=fixture({device:'en'});assert.doesNotMatch(UI_FIRST_PAINT_SCRIPT,/<\/script|eval\(|new Function/);assert.ok(Buffer.byteLength(UI_FIRST_PAINT_SCRIPT)<12000);
 const context={document:f.document,location:f.location,navigator:{languages:['en']},localStorage:f.storage,sessionStorage:f.sessionStorage,window:f.view,setTimeout:f.setTimeout,clearTimeout:f.clearTimeout,URL,URLSearchParams,Intl};vm.runInNewContext(UI_FIRST_PAINT_SCRIPT,context);assert.equal(f.targets.length,0);assert.match(f.document.cookie,/1\.en\.en/);
});

test('the exact serialized script honors a real non-English stored choice and unknown navigator fallback',()=>{
 for(const languages of [['en'],['unsupported']]){const f=fixture({device:'ja'});const context={document:f.document,location:f.location,navigator:{languages},localStorage:f.storage,sessionStorage:f.sessionStorage,window:f.view,setTimeout:f.setTimeout,clearTimeout:f.clearTimeout,URL,URLSearchParams,Intl};vm.runInNewContext(UI_FIRST_PAINT_SCRIPT,context);assert.equal(f.targets.length,1);assert.equal(f.document.documentElement.hidden,true);assert.match(f.document.cookie,/1\.ja\.en/);}
});

test('a failed initial catalogue keeps the selected shell and a native retry instead of releasing English owners',async()=>{
 const {settleInitialUi}=await import('../app/ui-first-paint-bootstrap.mjs');
 const nodes=new Map();const make=tag=>({tagName:tag,children:[],setAttribute(){},append(...children){this.children.push(...children);},replaceChildren(...children){this.children=children;}});
 const f=fixture({source:'page',locale:'ja',preference:'ja'});f.document.body=make('body');f.document.createElement=make;f.document.getElementById=id=>nodes.get(id)||null;
 let released=false;settleInitialUi({initializeOnce:async()=>{},getUiLocaleState:()=>({phase:'error',initialFallback:true})},{document:f.document,location:f.location}).then(()=>released=true);
 await new Promise(setImmediate);assert.equal(released,false);assert.equal(f.document.documentElement.lang,'ja');const panel=f.document.body.children[0];assert.equal(panel.children[0].textContent,'選択した言語を読み込めませんでした。');assert.equal(panel.children[1].href,f.location.href);
});
for(const visible of ['home-view','library-view','book-page'])test('initial language recovery uses the visible '+visible+' without replacing hidden views',async()=>{
 const {settleInitialUi}=await import('../app/ui-first-paint-bootstrap.mjs');
 const nodes=new Map(),make=tag=>({tagName:tag,children:[],hidden:false,setAttribute(){},append(...children){this.children.push(...children);},replaceChildren(...children){this.children=children;}});
 const f=fixture({source:'page',locale:'ja',preference:'ja'});f.document.body=make('body');f.document.createElement=make;f.document.getElementById=id=>nodes.get(id)||null;
 for(const id of ['book-page','library-view','home-view']){const node=make('div');node.id=id;node.hidden=id!==visible;node.children=[{kept:id}];nodes.set(id,node);}
 let released=false;settleInitialUi({initializeOnce:async()=>{},getUiLocaleState:()=>({phase:'error',initialFallback:true})},{document:f.document,location:f.location}).then(()=>released=true);await new Promise(setImmediate);
 assert.equal(released,false,'failed language must not release owners in a fallback language');
 for(const [id,node]of nodes){if(id===visible){assert.equal(node.children[0].id,'ui-first-paint-error');assert.equal(node.children[0].children[1].href,f.location.href);}else assert.deepEqual(node.children,[{kept:id}],'hidden view remains untouched');}
});

test('legacy hints with fragments force a distinct document and restore the canonical address before owners',()=>{
 const f=fixture({device:'ja'});runUiFirstPaintHandoff(f);const target=new URL(f.targets[0]);assert.equal(target.pathname,'/_ui/library');assert.equal(target.hash,'#p1');
 const next=fixture({source:'device',locale:'ja',preference:'ja',device:'ja',cookie:'1.ja.en'});next.location.href=target.href;next.history={state:0,replaceState(state,_title,url){assert.equal(state,0);next.location.href=url;}};assert.equal(runUiFirstPaintHandoff(next).kind,'continue');const restored=new URL(next.location.href);assert.equal(restored.pathname,'/library');assert.equal(restored.searchParams.get('book'),'literal/id');assert.equal(restored.hash,'#p1');
});
test('a strict-cookie session handoff uses an owned document before account language is known',()=>{
 const f=fixture();f.document.documentElement.setAttribute('data-ui-session-handoff','true');const result=runUiFirstPaintHandoff(f);assert.equal(result.kind,'handoff');assert.equal(new URL(f.targets[0]).pathname,'/_ui/library');assert.equal(f.document.documentElement.hidden,true);
});
