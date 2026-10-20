import test from 'node:test';
import assert from 'node:assert/strict';
import {createUiLocale} from '../app/ui-locale.mjs';
import en from '../app/ui-catalogs/en.mjs';
import ja from '../app/ui-catalogs/ja.mjs';
import {parseLibraryView,writeLibraryView,libraryViewReducer,normalizeOverlay,normalizeLibraryQuery,safeLibraryReturn,authReturnTarget,createLibraryViewHistory,LIBRARY_SETTINGS_TABS} from '../app/library-view-state.mjs';

const view=patch=>({query:'',scope:'all',status:'all',topic:'all',language:'all',...patch});

test('settings links reject inherited property names and preserve only the explicit reading alias',()=>{
  for(const value of ['constructor','toString','__proto__','hasOwnProperty','valueOf']){
    assert.equal(parseLibraryView('?settings='+value).overlay,null,value+' is not a settings tab');
  }
  assert.deepEqual(parseLibraryView('?settings=reading').overlay,{kind:'settings',tab:'reading-habits'});
});

// A small real-history harness: an entry stack with push/replace/back/forward and
// popstate dispatch, so lifecycle behavior is exercised against actual events.
function historyWindow(search='',{state=null,historyState=null}={}){
  const listeners=new Map(),entries=[{search,state:historyState}];let index=0;
  const emit=(type,event)=>{for(const fn of listeners.get(type)||[])fn(event);};
  const searchOf=url=>url===undefined||url===null?entries[index].search:(url.includes('?')?url.slice(url.indexOf('?')):'');
  const win={
    location:{pathname:'/library',get search(){return entries[index].search;}},
    history:{
      get state(){return entries[index].state;},
      pushState(next,title,url){entries.splice(index+1);entries.push({search:searchOf(url),state:next});index++;},
      replaceState(next,title,url){entries[index]={search:searchOf(url),state:next};},
      back(){if(index===0)throw Error('cannot go back');index--;emit('popstate',{state:entries[index].state});},
      forward(){if(index>=entries.length-1)throw Error('cannot go forward');index++;emit('popstate',{state:entries[index].state});}
    },
    addEventListener(type,fn){listeners.set(type,[...(listeners.get(type)||[]),fn]);},
    removeEventListener(type,fn){listeners.set(type,(listeners.get(type)||[]).filter(x=>x!==fn));}
  };
  return {win,entries,get index(){return index;},search:()=>entries[index].search};
}

function manualTimers(){
  let next=1;const pending=new Map();
  return {
    setTimeout(fn){const id=next++;pending.set(id,fn);return id;},
    clearTimeout(id){pending.delete(id);},
    pendingCount:()=>pending.size,
    runAll(){const batch=[...pending.values()];pending.clear();for(const fn of batch)fn();}
  };
}

test('owned view keys parse with validated enums and language syntax while unknown parameters stay unowned',()=>{
  assert.deepEqual(parseLibraryView('').view,view());
  assert.deepEqual(parseLibraryView('?q=alice&scope=private&status=reading&topic=fiction&language=zh').view,view({query:'alice',scope:'private',status:'reading',topic:'fiction',language:'zh'}));
  assert.deepEqual(parseLibraryView('?scope=weird&status=x&topic=nope&language=').view,view());
  assert.equal(parseLibraryView('?q='+('字'.repeat(121))).view.query,'字'.repeat(120),'query stays bounded at 120 characters in the URL exactly as in live state');
  assert.deepEqual(parseLibraryView('?q=a%00b').view,view());
  assert.equal(parseLibraryView('?language=EN-GB').view.language,'en');
  assert.equal(parseLibraryView('?language=zh-Hans').view.language,'zh');
  assert.equal(parseLibraryView('?language=unknown').view.language,'unknown');
  assert.equal(parseLibraryView('?language=x').view.language,'all');
  const kept=writeLibraryView('?other=kept&scope=private',parseLibraryView('?other=kept&scope=private'));
  assert.ok(kept.includes('other=kept')&&kept.includes('scope=private'));
  assert.ok(!kept.includes('secret'));
});

test('conflicting overlay keys normalize to exactly one known overlay in a fixed precedence',()=>{
  assert.deepEqual(normalizeOverlay({kind:'settings',tab:'data'}),{kind:'settings',tab:'data'});
  assert.deepEqual(parseLibraryView('?settings=data&calendar=1&upload=1&trash=1&filter=1').overlay,{kind:'settings',tab:'data'});
  assert.deepEqual(parseLibraryView('?calendar=1&upload=1&trash=1&filter=1').overlay,{kind:'calendar'});
  assert.deepEqual(parseLibraryView('?upload=1&trash=1&filter=1').overlay,{kind:'upload'});
  assert.deepEqual(parseLibraryView('?trash=1&filter=1').overlay,{kind:'trash'});
  assert.deepEqual(parseLibraryView('?filter=1').overlay,{kind:'filter'});
  assert.equal(parseLibraryView('?settings=../../etc&filter=1').overlay.kind,'filter');
  assert.equal(parseLibraryView('?settings=nonsense').overlay,null);
  assert.equal(parseLibraryView('?upload=yes').overlay,null);
});

test('GET-201: ?settings=reading aliases to canonical reading-habits without widening the owned tab set',()=>{
  assert.deepEqual(parseLibraryView('?settings=reading').overlay,{kind:'settings',tab:'reading-habits'},'the old URL slug opens the reading preferences tab');
  assert.deepEqual(parseLibraryView('?settings=reading&topic=fiction&q=alice').view,view({query:'alice',topic:'fiction'}),'the alias never touches book, filter or query state');
  assert.deepEqual(parseLibraryView('?settings=reading-habits').overlay,{kind:'settings',tab:'reading-habits'},'the canonical slug keeps working');
  assert.equal(LIBRARY_SETTINGS_TABS.includes('reading'),false,'the alias is a parse-only mapping, not a new owned tab');
  assert.deepEqual(normalizeOverlay({kind:'settings',tab:'reading'}),null,'app actions still open only canonical tabs');
  assert.equal(parseLibraryView('?settings=READING').overlay,null,'the alias is exact, not case-folded');
  // Serialization always writes the canonical slug so history entries converge.
  const written=writeLibraryView('?settings=reading&topic=fiction',parseLibraryView('?settings=reading&topic=fiction'));
  const params=new URLSearchParams(written);
  assert.equal(params.get('settings'),'reading-habits');assert.equal(params.get('topic'),'fiction');
  assert.equal(writeLibraryView('?settings=reading',parseLibraryView('?settings=reading')), '?settings=reading-habits');
  // Auth returns normalize the alias through the same bounded codec.
  assert.equal(safeLibraryReturn('/library?settings=reading&filter=x'),'/library?settings=reading-habits');
  assert.equal(safeLibraryReturn('/library?settings=reading'),'/library?settings=reading-habits');
});

test('serializing a default view removes only owned keys and keeps unrelated query and history fields',()=>{
  assert.equal(writeLibraryView('?other=kept&scope=private&q=alice&trash=1&settings=data&filter=1',{view:view(),overlay:null}),'?other=kept');
  const written=writeLibraryView('?other=kept',{view:view({query:'a long query',topic:'fiction'}),overlay:{kind:'settings',tab:'about'}});
  const params=new URLSearchParams(written);
  assert.equal(params.get('other'),'kept');assert.equal(params.get('q'),'a long query');assert.equal(params.get('topic'),'fiction');assert.equal(params.get('settings'),'about');
  assert.equal(params.get('trash'),null);
  assert.deepEqual(parseLibraryView(written).view,view({query:'a long query',topic:'fiction'}));
});

test('the pure reducer clears one key, clears all and keeps the chooser while routed modals replace it',()=>{
  let state={view:view({query:'q',status:'reading',topic:'fiction'}),overlay:null};
  state=libraryViewReducer(state,{type:'clear',key:'status'});
  assert.equal(state.view.status,'all');assert.equal(state.view.topic,'fiction');
  state=libraryViewReducer(state,{type:'clear-all'});
  assert.deepEqual(state.view,view());
  state=libraryViewReducer(state,{type:'open-overlay',overlay:{kind:'filter'}});
  assert.equal(state.overlay.kind,'filter');
  state=libraryViewReducer(state,{type:'set-view',patch:{topic:'fiction'}});
  assert.equal(state.overlay.kind,'filter');
  state=libraryViewReducer(state,{type:'open-overlay',overlay:{kind:'trash'}});
  assert.deepEqual(state.overlay,{kind:'trash'});
  state=libraryViewReducer(state,{type:'close-overlay'});
  assert.equal(state.overlay,null);
  assert.throws(()=>libraryViewReducer(state,{type:'open-overlay',overlay:{kind:'evil'}}),/overlay/i);
});

test('a bounded library return codec keeps owned view keys and never approves reader, gift or external targets',()=>{
  assert.equal(safeLibraryReturn('/library?q=alice&scope=private&other=x'),'/library?q=alice&scope=private');
  assert.equal(safeLibraryReturn('/library?upload=1&secret=private'),'/library?upload=1');
  assert.equal(safeLibraryReturn('/library'),'/library');
  for(const bad of ['https://evil.example/library','//evil.example/library','/library/../evil','/read?book=alice','/gift/'+'A'.repeat(43),'javascript:alert(1)'])assert.equal(safeLibraryReturn(bad),null,bad);
  assert.equal(safeLibraryReturn('/library?settings=../../etc'),'/library');
  assert.equal(safeLibraryReturn('/library?q='+('字'.repeat(200))).includes('字'.repeat(200)),false);
});

test('hydration reads the parsed URL once without history writes and keeps unrelated entries intact',()=>{
  const h=historyWindow('?q=alice&topic=fiction&upload=1&other=kept',{historyState:{keep:1}}),seen=[];
  const adapter=createLibraryViewHistory({window:h.win,timers:manualTimers(),onChange:(snapshot,meta)=>seen.push([snapshot,meta.source])});
  adapter.hydrate();
  assert.equal(h.entries.length,1);assert.equal(h.win.history.state.keep,1);
  assert.deepEqual(adapter.snapshot().view,view({query:'alice',topic:'fiction'}));
  assert.deepEqual(adapter.snapshot().overlay,{kind:'upload'});
  assert.equal(seen.at(-1)[1],'hydrate');
});

test('a debounced search replaces the current entry while a discrete filter push first flushes the query',()=>{
  const timers=manualTimers(),h=historyWindow(''),seen=[];
  const adapter=createLibraryViewHistory({window:h.win,timers,onChange:(snapshot,meta)=>seen.push(meta.source)});
  adapter.setQuery('a');adapter.setQuery('al');adapter.setQuery('ali');
  assert.equal(timers.pendingCount(),1);assert.equal(h.entries.length,1);
  timers.runAll();
  assert.equal(h.entries.length,1);assert.ok(h.search().includes('q=ali'));
  adapter.setQuery('alice');assert.equal(timers.pendingCount(),1);
  adapter.setView({topic:'fiction'});
  assert.equal(timers.pendingCount(),0);assert.equal(h.entries.length,2);
  assert.ok(h.search().includes('q=alice')&&h.search().includes('topic=fiction'));
  h.win.history.back();
  assert.ok(h.search().includes('q=alice')&&!h.search().includes('topic=fiction'),h.search());
  assert.deepEqual(adapter.snapshot().view,view({query:'alice'}));
  assert.equal(seen.at(-1),'pop');
});

test('popstate, owner switches and resets cancel pending search timers with real URL and emit assertions',()=>{
  for(const invalidate of ['pop','owner','hydrate']){
    const timers=manualTimers(),h=historyWindow('?topic=fiction'),emitted=[];
    const adapter=createLibraryViewHistory({window:h.win,timers,onChange:(snapshot,meta)=>emitted.push(meta.source)});adapter.hydrate();
    adapter.setQuery('stale');
    if(invalidate==='pop'){h.win.history.pushState(null,'','/library?topic=philosophy');h.win.history.back();}
    else if(invalidate==='owner')adapter.adoptOwner();
    else adapter.hydrate();
    const before=h.search();
    const emitsBefore=emitted.length;
    timers.runAll();
    assert.equal(h.search(),before,'stale timer must not rewrite the URL after '+invalidate);
    assert.equal(emitted.length,emitsBefore,'stale timer must not emit after '+invalidate);
  }
});

test('back and forward restore the view without recursive pushes',()=>{
  const timers=manualTimers(),h=historyWindow(''),sources=[];
  const adapter=createLibraryViewHistory({window:h.win,timers,onChange:(snapshot,meta)=>sources.push(meta.source)});
  adapter.setView({topic:'fiction'});adapter.setView({language:'zh'});
  assert.equal(h.entries.length,3);
  h.win.history.back();h.win.history.back();
  assert.deepEqual(adapter.snapshot().view,view());
  h.win.history.forward();
  assert.deepEqual(adapter.snapshot().view,view({topic:'fiction'}));
  assert.equal(h.entries.length,3);
  assert.deepEqual(sources.slice(-2),['pop','pop']);
});

test('an app-opened overlay close consumes only its own entry',()=>{
  const timers=manualTimers(),h=historyWindow('?q=alice'),events=[];
  const adapter=createLibraryViewHistory({window:h.win,timers,onChange:(snapshot,meta)=>events.push([snapshot.overlay,meta])});
  adapter.hydrate();const before=h.entries.length;
  adapter.openOverlay({kind:'upload'});
  assert.equal(h.entries.length,before+1);
  assert.equal(h.win.history.state.libraryOverlay.kind,'upload');
  assert.equal(h.win.history.state.keep,undefined);
  adapter.closeOverlay('user');
  assert.equal(h.entries.length,before+1,'close first consumes the entry through back');
  assert.deepEqual(adapter.snapshot().view,view({query:'alice'}));
  assert.equal(adapter.snapshot().overlay,null);
  assert.equal(h.search(),'?q=alice');
});

test('closing an overlay opened from a direct URL removes its own keys and any stale marker instead of leaving the site',()=>{
  const timers=manualTimers(),h=historyWindow('?trash=1&other=kept',{historyState:{keep:2,libraryOverlay:{kind:'trash',owned:true,consumable:false}}}),events=[];
  const adapter=createLibraryViewHistory({window:h.win,timers,onChange:(snapshot,meta)=>events.push(meta.source)});
  adapter.hydrate();assert.deepEqual(adapter.snapshot().overlay,{kind:'trash'});
  adapter.closeOverlay('user');
  assert.equal(h.entries.length,1,'no history.back() for direct URLs');
  assert.ok(h.search().includes('other=kept')&&!h.search().includes('trash'));
  assert.equal(h.win.history.state.keep,2);
  assert.equal(h.win.history.state.libraryOverlay,undefined,'a non-owned close removes its marker');
});

test('a routed modal over a direct-URL chooser keeps its own entry and its close never leaves the site',()=>{
  const timers=manualTimers(),h=historyWindow('?filter=1&other=kept'),adapter=createLibraryViewHistory({window:h.win,timers,onChange:()=>{}});
  adapter.hydrate();
  assert.deepEqual(adapter.snapshot().overlay,{kind:'filter'});
  adapter.openOverlay({kind:'settings',tab:'data'});
  assert.deepEqual(adapter.snapshot().overlay,{kind:'settings',tab:'data'});
  assert.ok(h.search().includes('settings=data')&&!h.search().includes('filter=1'),'the chooser is closed behind the modal entry');
  adapter.closeOverlay('user');
  assert.deepEqual(adapter.snapshot().overlay,{kind:'filter'},'close returns to the chooser state through its own entry');
  assert.ok(h.search().includes('filter=1')&&h.search().includes('other=kept'));
  adapter.closeOverlay('user');
  assert.equal(adapter.snapshot().overlay,null);
  assert.equal(h.index,0,'closing the direct-URL chooser replaces its keys and never calls back');
  assert.ok(h.search().includes('other=kept')&&!h.search().includes('filter=1'));
});

test('overlay tab changes replace their own entry instead of stacking history',()=>{
  const timers=manualTimers(),h=historyWindow(''),adapter=createLibraryViewHistory({window:h.win,timers,onChange:()=>{}});
  adapter.openOverlay({kind:'settings',tab:'account'});const entries=h.entries.length;
  adapter.openOverlay({kind:'settings',tab:'data'});
  assert.equal(h.entries.length,entries);assert.equal(adapter.snapshot().overlay.tab,'data');
  assert.ok(h.search().includes('settings=data'));
});

test('owner switch drops stale owner filters and pending queries without pushing or backing',()=>{
  const timers=manualTimers(),h=historyWindow('?q=mine&topic=fiction'),adapter=createLibraryViewHistory({window:h.win,timers,onChange:()=>{}});
  adapter.hydrate();adapter.setQuery('more');
  adapter.adoptOwner();
  assert.deepEqual(adapter.snapshot().view,view());
  assert.equal(h.entries.length,1);
  assert.ok(!h.search().includes('q='));
  assert.equal(h.win.history.state===null||h.win.history.state===undefined||typeof h.win.history.state==='object',true);
});

test('ownership of the one app-created modal entry survives tab and overlay replacement',()=>{
  const timers=manualTimers(),h=historyWindow(''),adapter=createLibraryViewHistory({window:h.win,timers,onChange:()=>{}});
  const base=h.index;
  adapter.openOverlay({kind:'settings',tab:'account'});
  assert.equal(h.win.history.state.libraryOverlay.consumable,true);
  adapter.openOverlay({kind:'settings',tab:'data'});
  assert.equal(h.index,base+1,'tab switching replaces its own entry');
  assert.equal(h.win.history.state.libraryOverlay.consumable,true,'tab change keeps ownership of the same entry');
  adapter.openOverlay({kind:'calendar'});
  assert.equal(h.index,base+1,'overlay replacement reuses the owned entry');
  assert.deepEqual(adapter.snapshot().overlay,{kind:'calendar'});
  assert.equal(h.win.history.state.libraryOverlay.kind,'calendar');
  assert.equal(h.win.history.state.libraryOverlay.owned,true);
  assert.equal(h.win.history.state.libraryOverlay.consumable,true,'overlay replacement keeps ownership of the same entry');
  adapter.closeOverlay('user');
  assert.equal(h.index,base,'explicit close consumes exactly that app entry');
  assert.deepEqual(adapter.snapshot().overlay,null);
  adapter.openOverlay({kind:'calendar'});
  assert.equal(h.index,base+1,'opening after close creates one fresh entry');
  assert.equal(h.win.history.state.libraryOverlay.consumable,true);
});

test('the non-modal filter owns no entry while a modal over it pushes and consumes its own',()=>{
  const timers=manualTimers(),h=historyWindow(''),adapter=createLibraryViewHistory({window:h.win,timers,onChange:()=>{}});
  adapter.openOverlay({kind:'filter'});
  assert.equal(h.index,0);
  assert.equal(h.win.history.state?.libraryOverlay??null,null,'the chooser never claims modal entry ownership');
  adapter.openOverlay({kind:'settings',tab:'account'});
  assert.equal(h.index,1,'a modal over the chooser owns a fresh entry');
  assert.equal(h.win.history.state.libraryOverlay.consumable,true);
  adapter.closeOverlay('user');
  assert.equal(h.index,0,'close consumes only the modal entry');
  assert.deepEqual(adapter.snapshot().overlay,{kind:'filter'});
  assert.ok(h.search().includes('filter=1'));
});

test('a discrete view change while an app-owned modal is open keeps one owned entry for the close',()=>{
  const timers=manualTimers(),h=historyWindow(''),adapter=createLibraryViewHistory({window:h.win,timers,onChange:()=>{}});
  adapter.openOverlay({kind:'settings',tab:'data'});
  const entries=h.entries.length;
  adapter.setView({topic:'fiction'});
  assert.equal(h.entries.length,entries,'the view change extends the app-owned modal entry instead of orphaning its ownership');
  assert.equal(h.win.history.state.libraryOverlay.consumable,true);
  assert.ok(h.search().includes('topic=fiction')&&h.search().includes('settings=data'));
  adapter.closeOverlay('user');
  assert.equal(adapter.snapshot().overlay,null);
  assert.ok(!h.search().includes('settings='),'close consumes the whole app entry');
});

test('owner epochs tag app entries and a pop to an old owner epoch clears only its stale owned state',()=>{
  const timers=manualTimers(),h=historyWindow(''),adapter=createLibraryViewHistory({window:h.win,timers,onChange:()=>{}});
  adapter.setView({query:'alice-private'});
  adapter.setView({topic:'fiction'});
  const staleEntry=h.entries[h.index-1];
  adapter.adoptOwner();
  assert.deepEqual(adapter.snapshot().view,view());
  assert.ok(!h.search().includes('q='));
  h.win.history.back();
  assert.deepEqual(adapter.snapshot().view,view(),'a pop to the previous owner entry cannot resurrect its query');
  assert.ok(!h.search().includes('q=')&&!h.search().includes('topic='));
  assert.equal(h.entries.length,3,'clearing on pop never pushes or leaves the site');
  assert.equal(staleEntry.state.libraryState.epoch,0);
});

test('foreign history entries and foreign state fields survive pops untouched',()=>{
  const timers=manualTimers(),h=historyWindow('?other=kept',{historyState:{foreign:{a:1}}}),adapter=createLibraryViewHistory({window:h.win,timers,onChange:()=>{}});
  adapter.hydrate();
  h.win.history.pushState({foreign:{a:2}},'','/library?other=kept&q=foreign');
  adapter.setView({topic:'philosophy'});
  adapter.adoptOwner();
  h.win.history.back();
  assert.ok(h.search().includes('q=foreign')&&h.search().includes('other=kept'),'an untagged foreign entry is not app-owned state');
  assert.deepEqual(h.win.history.state.foreign,{a:2});
  assert.equal(h.win.history.state.libraryOverlay??null,null);
});

test('the session-ready overlay reconciliation follows the current snapshot instead of a stale hydrate capture',()=>{
  const timers=manualTimers(),h=historyWindow('?upload=1'),adapter=createLibraryViewHistory({window:h.win,timers,onChange:()=>{}});
  adapter.hydrate();
  assert.deepEqual(adapter.snapshot().overlay,{kind:'upload'});
  adapter.openOverlay({kind:'calendar'});
  assert.deepEqual(adapter.takeSessionOverlay(),{kind:'calendar'},'the ready reconciliation hands back the current overlay, never the stale one');
  assert.equal(adapter.takeSessionOverlay(),null,'the ready handoff happens once');
});

test('adopting a validated safe return applies its view and overlay without pushing or backing',()=>{
  const timers=manualTimers(),h=historyWindow('?stale=1&topic=history'),adapter=createLibraryViewHistory({window:h.win,timers,onChange:()=>{}});
  adapter.hydrate();
  const overlay=adapter.adoptReturn('/library?q=alice&topic=fiction&settings=data&secret=x');
  assert.deepEqual(overlay,{kind:'settings',tab:'data'});
  assert.deepEqual(adapter.snapshot().view,view({query:'alice',topic:'fiction'}));
  assert.equal(h.entries.length,1);
  assert.equal(h.index,0,'auth return adoption never calls back');
  assert.ok(h.search().includes('stale=1')&&!h.search().includes('secret'));
  assert.equal(adapter.adoptReturn('/read?book=alice&passage=p1'),null);
  assert.equal(adapter.adoptReturn('https://evil.example/library'),null);
  assert.deepEqual(adapter.snapshot().view,view({query:'alice',topic:'fiction'}),'invalid returns change nothing');
});

test('live queries share one bounded normalizer with URL parsing and never commit unfinished IME text',()=>{
  assert.equal(normalizeLibraryQuery('  a  '),'a');
  assert.equal(normalizeLibraryQuery('   '),'');
  assert.equal(normalizeLibraryQuery('a\u0000b'),'');
  assert.equal(normalizeLibraryQuery('字'.repeat(121)).length,120);
  const timers=manualTimers(),h=historyWindow(''),emitted=[];
  const adapter=createLibraryViewHistory({window:h.win,timers,onChange:(snapshot,meta)=>emitted.push(meta)});
  adapter.compositionStart();
  adapter.setQuery('拼');
  timers.runAll();
  assert.ok(!h.search().includes('q='),'unfinished composition never commits to the URL');
  assert.equal(emitted.length,0);
  adapter.compositionEnd('拼音输入');
  timers.runAll();
  assert.ok(h.search().includes('q='),'only the final composition query commits');
  assert.equal(decodeURIComponent(h.search()).includes('拼音输入'),true);
  assert.equal(adapter.snapshot().view.query,'拼音输入');
});

test('auth return targets prefer upload and reader returns, then the parsed library return, then the live view',()=>{
  assert.equal(authReturnTarget({pendingUpload:true,readerReturn:'/read?book=a',libraryReturn:'/library?q=x',current:'/library?q=y'}),'/library?upload=1');
  assert.equal(authReturnTarget({readerReturn:'/read?book=a&passage=p1',libraryReturn:'/library?q=x',current:'/library?q=y'}),'/read?book=a&passage=p1');
  assert.equal(authReturnTarget({libraryReturn:'/library?q=alice&topic=fiction&settings=data',current:'/library?q=y'}),'/library?q=alice&topic=fiction&settings=data');
  assert.equal(authReturnTarget({current:'/library?q=y'}),'/library?q=y');
  assert.equal(authReturnTarget({}),'/library');
});


test('an owner epoch survives adapter reload before Back reaches an old owner entry',()=>{
 const timers=manualTimers(),h=historyWindow('');let adapter=createLibraryViewHistory({window:h.win,timers});
 adapter.setView({query:'synthetic-old-owner'});adapter.setView({topic:'fiction'});adapter.adoptOwner();adapter.destroy();
 const epoch=h.win.history.state.libraryState.epoch;adapter=createLibraryViewHistory({window:h.win,timers});adapter.hydrate();assert.equal(h.win.history.state.libraryState.epoch,epoch);
 h.win.history.back();assert.deepEqual(adapter.snapshot().view,view());assert.ok(!h.search().includes('q='));
});
test('bounded query truncation keeps well-formed UTF-16 and an identical URL round trip',()=>{
 const query=normalizeLibraryQuery('a'.repeat(119)+'😀');assert.ok(query.isWellFormed());assert.ok(query.length<=120);
 assert.equal(parseLibraryView(writeLibraryView('',{view:view({query}),overlay:null})).view.query,query);
});
test('only a successfully adopted auth handoff consumes its one-time keys and modal ownership',()=>{
 const timers=manualTimers(),h=historyWindow('?other=kept&login=1&auth_error=cancelled&next=%2Flibrary%3Fsettings%3Ddata'),adapter=createLibraryViewHistory({window:h.win,timers});
 adapter.openOverlay({kind:'calendar'});const index=h.index;
 assert.equal(adapter.adoptReturn('https://evil.example/library'),null);assert.ok(new URLSearchParams(h.search()).has('next'));
 adapter.adoptReturn('/library?q=alice&settings=data');const p=new URLSearchParams(h.search());
 for(const key of ['login','auth_error','next'])assert.equal(p.has(key),false,key+' is consumed once');
 assert.equal(p.get('other'),'kept');assert.equal(p.get('q'),'alice');adapter.closeOverlay();assert.equal(h.index,index,'closing an adopted direct return never consumes a prior modal entry');
 assert.equal(new URLSearchParams(h.search()).has('settings'),false);
});

// Traversal is queued. Window popstate runs at target in registration order,
// matching the native failure; capture does not outrun the earlier runtime.
function queuedHistoryWindow(href='/library?ui=en',initialState={foreign:{kept:true}}){
  const entries=[{url:new URL(href,'https://leafhour.invalid'),state:structuredClone(initialState)}],listeners=[],tasks=[],writes=[];
  let index=0,backs=0;
  const current=()=>entries[index];
  const win={location:{get href(){return current().url.href;},get pathname(){return current().url.pathname;},get search(){return current().url.search;},get hash(){return current().url.hash;}},history:{
    get state(){return current().state;},
    replaceState(state,title,url){const next={url:url==null?current().url:new URL(url,current().url),state:structuredClone(state)};entries[index]=next;writes.push({mode:'replace',href:next.url.href});},
    pushState(state,title,url){const next={url:new URL(url,current().url),state:structuredClone(state)};entries.splice(index+1);entries.push(next);index++;writes.push({mode:'push',href:next.url.href});},
    back(){backs++;tasks.push(()=>{assert.ok(index>0);index--;dispatch();});},
    forward(){tasks.push(()=>{assert.ok(index+1<entries.length);index++;dispatch();});}
  },addEventListener(type,fn,options){if(type==='popstate')listeners.push({fn,capture:options===true||!!options?.capture});},removeEventListener(type,fn,options){const capture=options===true||!!options?.capture;const i=listeners.findIndex(x=>x.fn===fn&&x.capture===capture);if(i>=0)listeners.splice(i,1);}};
  function dispatch(){const event={state:structuredClone(current().state)};for(const row of [...listeners])row.fn(event);}
  return {win,entries,writes,get index(){return index;},get backs(){return backs;},get listeners(){return listeners.length;},flush(){assert.ok(tasks.length);tasks.shift()();}};
}
async function historyWithRuntime(href,options={}){
  const h=queuedHistoryWindow(href),popPromises=[],preferenceWrites=[];
  const runtime=createUiLocale({history:h.win.history,getLocation:()=>h.win.location,storage:{getItem:()=>options.saved??null,setItem:(key,value)=>preferenceWrites.push({key,value})},loadCatalogue:options.loadCatalogue|| (async code=>({en,ja}[code]))});
  await runtime.initializeOnce();
  h.win.addEventListener('popstate',()=>popPromises.push(runtime.handlePopstate()));
  const adapter=createLibraryViewHistory({window:h.win,timers:manualTimers(),getUiLocale:runtime.getUiLocale,onBeforeUiPopstate:runtime.onBeforeUiPopstate});
  return {h,runtime,adapter,preferenceWrites,async flush(){h.flush();await Promise.all(popPromises.splice(0));}};
}

test('explicit modal close normalizes its exact predecessor inside the earlier runtime pop handler',async()=>{
  const {h,runtime,adapter,flush,preferenceWrites}=await historyWithRuntime('/library?other=kept&ui=en#shelf');
  adapter.hydrate();const predecessor=structuredClone(h.win.history.state);
  adapter.openOverlay({kind:'settings',tab:'account'});adapter.openOverlay({kind:'settings',tab:'data'});
  await runtime.setUiLocale('ja');adapter.setView({topic:'fiction'});
  const writes=preferenceWrites.length;adapter.closeOverlay();
  assert.equal(h.backs,1);assert.equal(runtime.getUiLocale(),'ja','queued traversal has not run');
  await flush();
  assert.equal(runtime.getUiLocale(),'ja','the runtime protocol normalizes only the consumed entry before reading the route');
  assert.equal(new URL(h.win.location.href).searchParams.get('ui'),'ja');
  assert.equal(h.win.location.hash,'#shelf');assert.equal(h.win.location.search.includes('topic='),false,'the predecessor view is restored');
  assert.equal(new URL(h.win.location.href).searchParams.get('other'),'kept');
  assert.deepEqual(h.win.history.state,predecessor,'foreign and exact predecessor history metadata stay unchanged');
  assert.equal(h.entries.length,2);assert.equal(preferenceWrites.length,writes,'close is not another picker preference write');
  adapter.destroy();assert.equal(h.listeners,1,'the business pop listener is removed on destroy');
});

test('ordinary native Back remains an explicit old-route locale override, including after one carried close',async()=>{
  const {h,runtime,adapter,flush}=await historyWithRuntime('/library?ui=en');adapter.hydrate();
  adapter.setView({topic:'fiction'});adapter.openOverlay({kind:'settings',tab:'account'});
  await runtime.setUiLocale('ja');adapter.closeOverlay();await flush();assert.equal(runtime.getUiLocale(),'ja');
  h.win.history.back();await flush();assert.equal(runtime.getUiLocale(),'en','the one-shot carry cannot rewrite a later ordinary Back');
  assert.equal(new URL(h.win.location.href).searchParams.get('ui'),'en');adapter.destroy();
});

test('ordinary Back with an open modal does not carry the picker locale',async()=>{
  const {h,runtime,adapter,flush}=await historyWithRuntime('/library?ui=en');adapter.hydrate();adapter.openOverlay({kind:'calendar'});
  await runtime.setUiLocale('ja');h.win.history.back();await flush();assert.equal(runtime.getUiLocale(),'en');assert.equal(h.backs,1);adapter.destroy();
});

test('adapter writes inherit current validated ui while the pure codec keeps explicit return ui precedence',()=>{
  assert.equal(writeLibraryView('?ui=en',{view:view(),overlay:null,ui:'ja'}),'?ui=ja');
  const h=queuedHistoryWindow('/library?ui=en#anchor'),adapter=createLibraryViewHistory({window:h.win,timers:manualTimers()});
  h.win.history.replaceState(h.win.history.state,'','/library?ui=ja#anchor');adapter.hydrate();adapter.setView({status:'reading'});adapter.openOverlay({kind:'settings',tab:'account'});adapter.openOverlay({kind:'settings',tab:'data'});
  assert.equal(new URL(h.win.location.href).searchParams.get('ui'),'ja');assert.equal(h.win.location.hash,'#anchor');adapter.destroy();
});

test('explicit close cannot carry a requested but uncommitted locale',async()=>{
  let resolveJa;
  const {h,runtime,adapter,flush}=await historyWithRuntime('/library?ui=en',{loadCatalogue:code=>code==='ja'?new Promise(resolve=>{resolveJa=resolve;}):Promise.resolve(en)});
  adapter.hydrate();adapter.openOverlay({kind:'settings',tab:'account'});const pending=runtime.setUiLocale('ja');
  assert.equal(runtime.getRequestedUiLocale(),'ja');assert.equal(new URL(h.win.location.href).searchParams.get('ui'),'en');
  adapter.closeOverlay();await flush();assert.equal(runtime.getUiLocale(),'en');resolveJa(ja);await pending;assert.equal(runtime.getUiLocale(),'en');adapter.destroy();
});

test('close carry is cancelled by new lifecycle or business ownership before queued traversal',async()=>{
  for(const action of ['owner','hydrate','return','view','query','overlay','composition','destroy']){
    const {h,runtime,adapter,flush}=await historyWithRuntime('/library?ui=en');adapter.hydrate();adapter.openOverlay({kind:'settings',tab:'account'});await runtime.setUiLocale('ja');adapter.closeOverlay();
    if(action==='owner')adapter.adoptOwner();else if(action==='hydrate')adapter.hydrate();else if(action==='return')adapter.adoptReturn('/library?settings=data');else if(action==='view')adapter.setView({status:'reading'});else if(action==='query')adapter.setQuery('new query');else if(action==='overlay')adapter.openOverlay({kind:'calendar'});else if(action==='composition')adapter.compositionStart();else adapter.destroy();
    await flush();assert.equal(runtime.getUiLocale(),'en',action+' invalidates the carry');assert.equal(new URL(h.win.location.href).searchParams.get('ui'),'en');adapter.destroy();
  }
});

test('unmatched predecessor entry or owner epoch consumes no carry and cannot affect a later pop',async()=>{
  for(const field of ['entry','epoch','pathname']){
    const {h,runtime,adapter,flush}=await historyWithRuntime('/library?ui=en');adapter.hydrate();adapter.openOverlay({kind:'settings',tab:'account'});await runtime.setUiLocale('ja');adapter.closeOverlay();
    if(field==='pathname')h.entries[0].url.pathname='/read';else h.entries[0].state.libraryState[field]=field==='entry'?'different-entry':99;
    const writes=h.writes.length;await flush();assert.equal(runtime.getUiLocale(),'en',field+' mismatch must not normalize');
    if(field!=='epoch')assert.equal(h.writes.length,writes,'no unrelated URL write');adapter.destroy();
  }
});

test('direct URL modal close replaces in place with live locale, and a remounted owned modal keeps its predecessor',async()=>{
  const direct=await historyWithRuntime('/library?ui=en&settings=data#anchor');direct.adapter.hydrate();await direct.runtime.setUiLocale('ja');direct.adapter.closeOverlay();
  assert.equal(direct.h.backs,0);assert.equal(direct.h.win.location.hash,'#anchor');assert.equal(new URL(direct.h.win.location.href).searchParams.get('ui'),'ja');assert.equal(new URL(direct.h.win.location.href).searchParams.has('settings'),false);direct.adapter.destroy();
  const {h,runtime,adapter,flush}=await historyWithRuntime('/library?ui=en');adapter.hydrate();adapter.openOverlay({kind:'calendar'});adapter.destroy();
  const remount=createLibraryViewHistory({window:h.win,timers:manualTimers(),getUiLocale:runtime.getUiLocale,onBeforeUiPopstate:runtime.onBeforeUiPopstate});remount.hydrate();remount.openOverlay({kind:'settings',tab:'data'});await runtime.setUiLocale('ja');remount.closeOverlay();await flush();assert.equal(runtime.getUiLocale(),'ja');assert.equal(h.backs,1);remount.destroy();
});


test('initial or route catalogue fallback does not carry an unsuccessful URL locale',async()=>{
  for(const phase of ['initial','route']){
    const h=queuedHistoryWindow('/library?ui=en');let runtime,pops=[];
    let adapter=createLibraryViewHistory({window:h.win,timers:manualTimers(),getUiLocale:()=>runtime?.getUiLocale()});
    adapter.hydrate();adapter.openOverlay({kind:'settings',tab:'account'});adapter.destroy();
    if(phase==='initial')h.win.history.replaceState(h.win.history.state,'','/library?settings=account&ui=ja');
    runtime=createUiLocale({history:h.win.history,getLocation:()=>h.win.location,loadCatalogue:async code=>{if(code==='ja')throw Error('synthetic catalogue unavailable');return en;}});
    await runtime.initializeOnce();
    if(phase==='route'){h.win.history.replaceState(h.win.history.state,'','/library?settings=account&ui=ja');await runtime.handlePopstate();}
    assert.equal(runtime.getUiLocale(),'en');assert.equal(runtime.getRequestedUiLocale(),'ja');
    h.win.addEventListener('popstate',()=>pops.push(runtime.handlePopstate()));
    adapter=createLibraryViewHistory({window:h.win,timers:manualTimers(),getUiLocale:runtime.getUiLocale,onBeforeUiPopstate:runtime.onBeforeUiPopstate});adapter.hydrate();
    const writes=h.writes.length;adapter.closeOverlay();h.flush();await Promise.all(pops);
    assert.equal(h.writes.length,writes,phase+' fallback causes no target normalization');
    assert.equal(new URL(h.win.location.href).searchParams.get('ui'),'en');assert.equal(runtime.getUiLocale(),'en');adapter.destroy();
  }
});

test('missing or invalid URL ui remains absent on explicit close despite a saved effective locale',async()=>{
  for(const query of ['', '?ui=bad', '?ui=ja&ui=en']){
    const {h,runtime,adapter,flush}=await historyWithRuntime('/library'+query,{saved:'ja'});adapter.hydrate();adapter.openOverlay({kind:'settings',tab:'account'});
    assert.equal(runtime.getUiLocale(),'ja');const writes=h.writes.length;adapter.closeOverlay();await flush();assert.equal(h.writes.length,writes);
    assert.equal(new URL(h.win.location.href).searchParams.has('ui'),false);assert.equal(runtime.getUiLocale(),'ja');adapter.destroy();
  }
});


test('adoptReturn uses its validated explicit ui over the old current URL, then future writes follow the live URL',()=>{
  const h=queuedHistoryWindow('/library?ui=en&foreign=kept&login=1&next=old#anchor'),adapter=createLibraryViewHistory({window:h.win,timers:manualTimers()});
  adapter.hydrate();adapter.openOverlay({kind:'calendar'});const entries=h.entries.length;
  assert.deepEqual(adapter.adoptReturn('/library?q=returned&settings=data&ui=ja'),{kind:'settings',tab:'data'});
  let params=new URL(h.win.location.href).searchParams;
  assert.equal(params.get('ui'),'ja');assert.equal(params.get('q'),'returned');assert.equal(params.get('foreign'),'kept');
  assert.equal(params.has('login'),false);assert.equal(params.has('next'),false);assert.equal(h.entries.length,entries);assert.equal(h.backs,0);
  h.win.history.replaceState(h.win.history.state,'','/library?q=returned&settings=data&ui=en#anchor');adapter.setView({status:'reading'});
  params=new URL(h.win.location.href).searchParams;assert.equal(params.get('ui'),'en','later business writes do not retain the adopted old ui');assert.equal(h.win.location.hash,'#anchor');adapter.destroy();
});


test('a newer successful picker choice before queued traversal invalidates the old close locale',async()=>{
  const {h,runtime,adapter,flush}=await historyWithRuntime('/library?ui=en');adapter.hydrate();adapter.openOverlay({kind:'settings',tab:'account'});
  await runtime.setUiLocale('ja');adapter.closeOverlay();await runtime.setUiLocale('en');
  const writes=h.writes.length;await flush();assert.equal(runtime.getUiLocale(),'en');assert.equal(h.writes.length,writes,'an old carry cannot overwrite a newer effective choice');adapter.destroy();
});


test('first modal open before hydrate tags only predecessor metadata and preserves its exact URL and foreign state',async()=>{
  const {h,runtime,adapter,flush}=await historyWithRuntime('/library?foreign=kept&ui=en#anchor');const href=h.win.location.href;
  adapter.openOverlay({kind:'settings',tab:'account'});assert.equal(h.entries[0].url.href,href);assert.deepEqual(h.entries[0].state.foreign,{kept:true});
  await runtime.setUiLocale('ja');adapter.closeOverlay();await flush();assert.equal(runtime.getUiLocale(),'ja');assert.equal(h.backs,1);assert.equal(h.entries.length,2);assert.equal(h.win.location.hash,'#anchor');adapter.destroy();
});


test('non-secure self-hosted history works without crypto.randomUUID and keeps bounded distinct entry identities',async()=>{
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'crypto');
  Object.defineProperty(globalThis,'crypto',{configurable:true,value:undefined});
  try{
    const {h,runtime,adapter,flush}=await historyWithRuntime('/library?ui=en');adapter.hydrate();const first=h.win.history.state.libraryState.entry;
    adapter.openOverlay({kind:'settings',tab:'account'});const second=h.win.history.state.libraryState.entry;
    assert.notEqual(first,second);for(const id of [first,second])assert.match(id,/^[a-z0-9-]{1,80}$/);
    assert.equal(h.win.history.state.libraryOverlay.parentEntry,first);
    await runtime.setUiLocale('ja');adapter.closeOverlay();await flush();assert.equal(runtime.getUiLocale(),'ja');assert.equal(h.backs,1);adapter.destroy();
  }finally{if(descriptor)Object.defineProperty(globalThis,'crypto',descriptor);else delete globalThis.crypto;}
});


test('history owner releases its before-pop subscription on destroy and a fresh owner subscribes once',async()=>{
  const h=queuedHistoryWindow('/library?ui=en'),active=new Set(),pops=[];
  const runtime=createUiLocale({history:h.win.history,getLocation:()=>h.win.location,loadCatalogue:async code=>({en,ja}[code])});await runtime.initializeOnce();
  h.win.addEventListener('popstate',()=>pops.push(runtime.handlePopstate()));
  const subscribe=fn=>{active.add(fn);const off=runtime.onBeforeUiPopstate(fn);return()=>{active.delete(fn);off();};};
  const mount=()=>createLibraryViewHistory({window:h.win,timers:manualTimers(),getUiLocale:runtime.getUiLocale,onBeforeUiPopstate:subscribe});
  const adapter=mount();assert.equal(active.size,1);assert.equal(h.listeners,2,'one runtime and one business pop listener, no capture listener');
  adapter.hydrate();adapter.openOverlay({kind:'settings',tab:'account'});await runtime.setUiLocale('ja');adapter.closeOverlay();adapter.destroy();adapter.destroy();
  assert.equal(active.size,0);assert.equal(h.listeners,1);const writes=h.writes.length;h.flush();await Promise.all(pops.splice(0));
  assert.equal(h.writes.length,writes);assert.equal(runtime.getUiLocale(),'en','destroyed close intent cannot normalize a later traversal');
  const fresh=mount();assert.equal(active.size,1);fresh.hydrate();fresh.openOverlay({kind:'calendar'});await runtime.setUiLocale('ja');fresh.closeOverlay();h.flush();await Promise.all(pops.splice(0));
  assert.equal(runtime.getUiLocale(),'ja');fresh.destroy();assert.equal(active.size,0);assert.equal(h.listeners,1);
});
