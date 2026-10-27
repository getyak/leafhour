import test from 'node:test';
import assert from 'node:assert/strict';
import {parseLibraryView,writeLibraryView,safeLibraryReturn,authReturnTarget,libraryViewDefaults} from '../app/library-view-state.mjs';

test('notebook is a routed overlay that survives authentication without private content in URL',()=>{
  const state=parseLibraryView('?notebook=1&q=alice&ui=zh-Hans');
  assert.deepEqual(state.overlay,{kind:'notebook'});
  assert.equal(safeLibraryReturn('/library?notebook=1&ui=zh-Hans'),'/library?notebook=1&ui=zh-Hans');
  assert.equal(authReturnTarget({libraryReturn:'/library?notebook=1&ui=zh-Hans'}),'/library?notebook=1&ui=zh-Hans');
});
test('notebook overlay is mutually exclusive and removed on close without losing shelf filters',()=>{
  const state=parseLibraryView('?notebook=1&q=alice');
  const closed=writeLibraryView('?notebook=1&q=alice',{view:state.view,overlay:null});
  assert.equal(closed,'?q=alice');
  assert.equal(parseLibraryView('?calendar=1&notebook=1').overlay.kind,'calendar');
  assert.equal(parseLibraryView('?notebook=1&notebook=1').overlay,null);
  assert.equal(writeLibraryView('?calendar=1',{view:libraryViewDefaults(),overlay:{kind:'notebook'}}),'?notebook=1');
});

test('the self-hosted server serves notebook and journal modules through the closed public asset map',async t=>{
  const {mkdtemp,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const path=await import('node:path');
  const {createReaderServer}=await import('../server/server.mjs');
  const dir=await mkdtemp(path.join(tmpdir(),'leafhour-journal-assets-'));
  const server=await createReaderServer({recordsPath:path.join(dir,'records.json'),portalDataDir:path.join(dir,'portal'),env:{},translator:null,sendCode:null});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+server.address().port;
  for(const file of ['reader-style-ready.mjs','reader-loading.mjs','reading-hub.mjs','reading-hub.css','paper-companion.mjs','library-notebook.mjs','library-notebook-state.mjs','library-notebook.css','reading-journal.mjs','reading-journal.css']){
    const response=await fetch(base+'/'+file);assert.equal(response.status,200,file);
    assert.match(response.headers.get('content-type'),file.endsWith('.css')?/text\/css/:/javascript/);
  }
  assert.equal((await fetch(base+'/server/portal.mjs')).status,404);
});

test('the actual OAuth return callback retains notebook intent after its dialog has closed',async()=>{
  const {readFile}=await import('node:fs/promises');const {parse}=await import('acorn');const vm=await import('node:vm');
  const source=await readFile(new URL('../app/portal.js',import.meta.url),'utf8');
  const ast=parse(source,{ecmaVersion:'latest',sourceType:'module'});
  const declaration=ast.body.flatMap(node=>node.declarations||[]).find(node=>node.id.name==='authDialog');
  const callback=declaration.init.arguments[0].properties.find(property=>property.key.name==='getReturnTo').value;
  const context={uiHref:value=>value,authReturnTarget,pendingUpload:false,pendingNotebook:true,returnToReader:null,returnToLibrary:null,currentLibraryReturn:()=>'/library',getUiNavigationLocale:()=> 'zh-Hans'};
  vm.createContext(context);const next=vm.runInContext('('+source.slice(callback.start,callback.end)+')()',context);
  assert.equal(next,'/library?notebook=1&ui=zh-Hans');
  context.pendingNotebook=false;
  assert.equal(vm.runInContext('('+source.slice(callback.start,callback.end)+')()',context),'/library?ui=zh-Hans');
});
