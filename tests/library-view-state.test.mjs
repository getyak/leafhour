import test from 'node:test';
import assert from 'node:assert/strict';
import {parseLibraryView,writeLibraryView,libraryViewReducer,normalizeOverlay,normalizeLibraryQuery,safeLibraryReturn,authReturnTarget,createLibraryViewHistory} from '../app/library-view-state.mjs';

const view=patch=>({query:'',scope:'all',status:'all',topic:'all',language:'all',...patch});

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
