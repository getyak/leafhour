import test from 'node:test';
import assert from 'node:assert/strict';
import {createPersonalRecordRenderer} from '../app/personal-record-editor.mjs';
import {applyPersonalRecordEdit} from '../app/personal-records.mjs';
import {readingBook} from './reading-fixtures.mjs';
import {requestUiRoute} from '../app/ui-locale.mjs';
test.beforeEach(async()=>{await requestUiRoute('zh-Hans');});

class Node{
  constructor(tag,document){this.tag=tag;this.document=document;this.children=[];this.events=new Map();this.dataset={};this.attributes={};this.value='';this.disabled=false;this.connected=false;}
  set innerHTML(value){throw Error('User text must never be rendered as HTML');}
  set textContent(value){this.text=String(value);this.children=[];}
  get textContent(){return (this.text||'')+this.children.map(c=>c.textContent).join('');}
  get isConnected(){return this.connected||!!this.parent?.isConnected;}
  append(...nodes){for(const node of nodes){node.parent=this;this.children.push(node);}}
  replaceChildren(...nodes){for(const child of this.children)child.parent=null;this.children=[];this.text='';this.append(...nodes);}
  setAttribute(key,value){this.attributes[key]=value;}
  addEventListener(type,fn){if(!this.events.has(type))this.events.set(type,[]);this.events.get(type).push(fn);}
  async fire(type){let stopped=false,prevented=false;for(const fn of this.events.get(type)||[])await fn({type,preventDefault(){prevented=true;},stopPropagation(){stopped=true;}});this.lastEvent={stopped,prevented};}
  all(){return this.children.flatMap(c=>[c,...c.all()]);}
  querySelector(selector){return this.all().find(n=>selector==='[data-edit-trigger]'?n.dataset.editTrigger!==undefined:n.tag===selector)||null;}
  focus(){this.document.activeElement=this;}
}
function fixture(options={}){
  const book=structuredClone(readingBook),record={id:'note-one',bookId:book.bookId,contentVersion:book.contentVersion,passageId:'p1',text:'Original <script>private words</script>.',origin:'user',createdAt:'2026-10-17T00:00:00.000Z',revision:0,updatedAt:'2026-10-17T00:00:00.000Z',quote:'Read this first.'};
  const document={createElement:tag=>new Node(tag,document)},data=new Map(),storage={get length(){return data.size;},key:i=>[...data.keys()][i],getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)};
  let serial=0,stored=structuredClone(record);const calls=[],updates=[];
  const defaultApi=async(url,input)=>{calls.push({url,input});if(!input)return {comments:[structuredClone(stored)],questions:[]};return structuredClone(applyPersonalRecordEdit(stored,input,book));};
  const renderer=createPersonalRecordRenderer({document,getBook:()=>book,scope:'owner-book',storage,newId:()=> 'edit-'+(++serial),api:options.api?((url,input)=>options.api(url,input,{defaultApi,get:()=>stored,set:value=>{stored=value;}})):defaultApi,onUpdate:value=>updates.push(value),onJump:()=>{throw Error('Unexpected source navigation');},...options.renderer});
  const mount=(value=record)=>{const row=renderer.recordNode(value,'comment',true);row.connected=true;return row;};
  const find=(row,text)=>{const node=row.all().find(n=>n.tag==='button'&&n.textContent===text);assert.ok(node,'button '+text);return node;};
  return {book,record,document,storage,mount,find,calls,updates,renderer,get:()=>stored,ids:()=>serial};
}
const write=async(row,value)=>{const area=row.querySelector('textarea');area.value=value;await area.fire('input');};
const submit=row=>row.querySelector('form').fire('submit');

test('a restored unsent edit retains its original base until explicit conflict resolution',async()=>{
  const f=fixture(),first=f.mount();await f.find(first,'修改原话').fire('click');await write(first,'Draft from revision zero.');
  const newer=applyPersonalRecordEdit(f.get(),{text:'Saved on another device.',contentVersion:f.book.contentVersion,baseRevision:0,editId:'other-device'},f.book);
  let serial=0;const renderer=createPersonalRecordRenderer({document:f.document,getBook:()=>f.book,scope:'owner-book',storage:f.storage,newId:()=> 'reopen-'+(++serial),api:async(url,input)=>input?structuredClone(applyPersonalRecordEdit(newer,input,f.book)):{comments:[structuredClone(newer)],questions:[]},onUpdate(){},onJump(){}});
  const row=renderer.recordNode(structuredClone(newer),'comment');row.connected=true;await f.find(row,'修改原话').fire('click');await submit(row);
  assert.equal(newer.text,'Saved on another device.');assert.equal(row.querySelector('textarea').value,'Draft from revision zero.');assert.match(row.textContent,/读取较新/);
  await f.find(row,'读取较新原话').fire('click');assert.equal(newer.revision,1);await submit(row);assert.equal(newer.text,'Draft from revision zero.');assert.equal(newer.revision,2);
});

test('an explicit 413 rejection permits correcting the text instead of replaying it forever',async()=>{
  const sent=[],f=fixture({api:async(url,input,{defaultApi})=>{sent.push(input);if(input?.text==='Rejected expansion.')throw Object.assign(Error('Record capacity exceeded.'),{status:413});return defaultApi(url,input);}}),row=f.mount();
  await f.find(row,'修改原话').fire('click');await write(row,'Rejected expansion.');await submit(row);assert.equal(row.querySelector('textarea').value,'Rejected expansion.');
  await write(row,'Short correction.');await submit(row);assert.equal(f.get().text,'Short correction.');assert.equal(sent.length,2);assert.notEqual(sent[0].editId,sent[1].editId);
});

test('a pre-metadata local edit is retained but cannot adopt the current server revision silently',async()=>{
  const f=fixture(),first=f.mount();await f.find(first,'修改原话').fire('click');await write(first,'An older local draft.');
  for(let n=0;n<f.storage.length;n++){const key=f.storage.key(n);if(!key.includes('|draft|'))continue;const row=JSON.parse(f.storage.getItem(key));delete row.editBaseRevision;f.storage.setItem(key,JSON.stringify(row));}
  let count=0,serial=0;const renderer=createPersonalRecordRenderer({document:f.document,getBook:()=>f.book,scope:'owner-book',storage:f.storage,newId:()=> 'legacy-'+(++serial),api:async()=>{count++;return {comments:[f.record],questions:[]};},onUpdate(){},onJump(){}}),row=renderer.recordNode(f.record,'comment');row.connected=true;
  await f.find(row,'修改原话').fire('click');await submit(row);assert.equal(count,0);assert.equal(row.querySelector('textarea').value,'An older local draft.');assert.ok(f.find(row,'读取较新原话'));
});

test('lost edit responses freeze the retry while newer typed words survive and then save at the next revision',async()=>{
  let first=true;const f=fixture({api:async(url,input,{defaultApi})=>{const result=await defaultApi(url,input);if(input&&first){first=false;throw Object.assign(Error('Response lost.'),{status:503});}return result;}}),row=f.mount();
  assert.ok(row.textContent.includes(f.record.text));await f.find(row,'修改原话').fire('click');await write(row,'First changed words.');await submit(row);
  assert.equal(f.get().revision,1);assert.match(row.textContent,/修改尚未确认/);assert.equal(row.textContent.includes('Response lost.'),false,'unknown remote prose is replaced by an honest local notice');
  await write(row,'Newer <img> words.');await submit(row);
  assert.equal(f.get().revision,1);assert.equal(row.querySelector('textarea').value,'Newer <img> words.');
  assert.deepEqual(f.calls[0].input,f.calls[1].input,'retry sends the frozen command');
  await submit(row);assert.equal(f.get().revision,2);assert.equal(f.get().text,'Newer <img> words.');assert.equal(row.querySelector('textarea'),null);assert.ok(row.textContent.includes('修改已保存'));
  assert.equal(f.document.activeElement.textContent,'修改原话');
});

test('record buttons stop outside-click propagation even when drawing detaches their original DOM ancestors',async()=>{
  const f=fixture(),row=f.mount(),open=f.find(row,'修改原话');await open.fire('click');assert.equal(open.lastEvent.stopped,true);assert.ok(row.querySelector('textarea'));
  const save=f.find(row,'保存修改');await save.fire('click');assert.equal(save.lastEvent.stopped,true);assert.equal(save.lastEvent.prevented,false,'native form submission remains available');
  const cancel=f.find(row,'取消修改');await cancel.fire('click');assert.equal(cancel.lastEvent.stopped,true);assert.equal(row.querySelector('textarea'),null);
});

test('an explicit conflict refresh shows new server words but preserves the draft until another save',async()=>{
  let conflict=true;const f=fixture({api:async(url,input,{defaultApi,get,set})=>{if(input&&conflict){conflict=false;set({...get(),text:'New words from another tab.',revision:1,lastEditId:'other-tab'});throw Object.assign(Error('Changed elsewhere.'),{status:409});}return defaultApi(url,input);}}),row=f.mount();
  await f.find(row,'修改原话').fire('click');await write(row,'My pending revision.');await submit(row);
  assert.equal(f.find(row,'重试上次修改').disabled,true);assert.equal(row.querySelector('textarea').value,'My pending revision.');
  await f.find(row,'读取较新原话').fire('click');assert.ok(row.textContent.includes('New words from another tab.'));assert.equal(row.querySelector('textarea').value,'My pending revision.');assert.equal(f.get().text,'New words from another tab.');
  await submit(row);assert.equal(f.get().text,'My pending revision.');assert.equal(f.get().revision,2);assert.equal(f.calls.at(-1).input.baseRevision,1);
});

test('closing an unconfirmed edit keeps its frozen request instead of claiming the server change was cancelled',async()=>{
  let first=true;const f=fixture({api:async(url,input,{defaultApi})=>{const saved=await defaultApi(url,input);if(input&&first){first=false;throw Object.assign(Error('Lost acknowledgement.'),{status:503});}return saved;}}),row=f.mount();
  await f.find(row,'修改原话').fire('click');await write(row,'A possibly committed edit.');await submit(row);
  await f.find(row,'暂存并关闭').fire('click');assert.equal(row.querySelector('textarea'),null);assert.ok(row.textContent.includes('不会撤回'));assert.equal(f.get().revision,1);
  await f.find(row,'修改原话').fire('click');assert.equal(row.querySelector('textarea').value,'A possibly committed edit.');await submit(row);assert.equal(f.get().revision,1);assert.equal(f.get().text,'A possibly committed edit.');
});

test('a reader rerender during saving updates the current row when the response arrives',async()=>{
  let release;const pending=new Promise(resolve=>{release=resolve;});const f=fixture({api:async(url,input,{defaultApi})=>{if(input)await pending;return defaultApi(url,input);}}),old=f.mount();
  await f.find(old,'修改原话').fire('click');await write(old,'Words saved during a view change.');const saving=submit(old);old.connected=false;
  const current=f.mount();assert.equal(current.querySelector('textarea').value,'Words saved during a view change.');assert.equal(f.find(current,'正在保存…').disabled,true);
  release();await saving;assert.equal(current.querySelector('textarea'),null);assert.ok(current.textContent.includes('Words saved during a view change.'));assert.equal(f.find(current,'修改原话').disabled,false);
});

test('retained per-record drafts reopen safely, and quota failures preserve current words with an honest warning',async()=>{
  const f=fixture(),row=f.mount();await f.find(row,'修改原话').fire('click');await write(row,'A retained edit.');
  const restored=createPersonalRecordRenderer({document:f.document,getBook:()=>f.book,scope:'owner-book',storage:f.storage,newId:()=> 'fresh-draft',api:async()=>{},onUpdate(){},onJump(){}}).recordNode(f.record,'comment');restored.connected=true;
  await f.find(restored,'修改原话').fire('click');assert.equal(restored.querySelector('textarea').value,'A retained edit.');
  f.storage.setItem=()=>{throw Error('QuotaExceededError');};await write(restored,'Current words still here.');assert.equal(restored.querySelector('textarea').value,'Current words still here.');assert.ok(restored.textContent.includes('本机无法保留修改草稿'));
});

test('stale source records remain text-safe and readable without speculative links or edit access',()=>{
  const f=fixture(),row=f.mount({...f.record,passageId:'missing',createdAt:'bad-time'});
  assert.ok(row.textContent.includes(f.record.text));assert.ok(row.textContent.includes(f.record.quote));assert.ok(row.textContent.includes('原文位置待确认'));assert.ok(row.textContent.includes('时间待确认'));
  assert.equal(row.all().filter(n=>n.tag==='button').length,0);
});

test('blocked local storage does not prevent reading saved words or replace the unavailable draft',async()=>{
  const f=fixture({renderer:{storage:undefined}});Object.defineProperty(f.document,'defaultView',{get(){throw Error('Storage unavailable');}});const row=f.mount();
  assert.ok(row.textContent.includes(f.record.text));await f.find(row,'修改原话').fire('click');assert.ok(row.textContent.includes('修改草稿暂时无法安全读取'));assert.equal(row.querySelector('textarea'),null);
});

test('an older owner-scoped record without a per-row bookId can confirm its edit without changing its source',async()=>{
  const f=fixture({api:async(url,input,{get,set,defaultApi})=>{const old={...get()};delete old.bookId;delete old.revision;delete old.updatedAt;set(old);return defaultApi(url,input);}}),old={...f.record};delete old.bookId;delete old.revision;delete old.updatedAt;
  const row=f.mount(old);await f.find(row,'修改原话').fire('click');await write(row,'Older original words revised safely.');await submit(row);
  assert.equal(f.get().revision,1);assert.equal(f.get().bookId,undefined);assert.equal(row.querySelector('textarea'),null);assert.ok(row.textContent.includes('修改已保存'));
});

test('reopening after a confirmed save or cancel starts from current saved words rather than an empty editor',async()=>{
  const f=fixture(),row=f.mount();await f.find(row,'修改原话').fire('click');await write(row,'Confirmed current words.');await submit(row);
  await f.find(row,'修改原话').fire('click');assert.equal(row.querySelector('textarea').value,'Confirmed current words.');
  await write(row,'Discard this unsaved change.');await f.find(row,'取消修改').fire('click');await f.find(row,'修改原话').fire('click');assert.equal(row.querySelector('textarea').value,'Confirmed current words.');assert.equal(f.get().revision,1);
});

test('locale relabels an in-flight edit without replacing composition, draft, UUID, source or frozen request',async()=>{
  let release;const gate=new Promise(resolve=>release=resolve),sent=[];
  const f=fixture({api:async(url,input,{defaultApi})=>{sent.push(structuredClone(input));await gate;return defaultApi(url,input);}}),row=f.mount();
  await f.find(row,'修改原话').fire('click');await write(row,'My revised words.');const saving=submit(row);
  const area=row.querySelector('textarea');area.focus();area.selectionStart=3;area.selectionEnd=7;await area.fire('compositionstart');
  const value=area.value,id=area.id,serial=f.ids(),storage=Array.from({length:f.storage.length},(_,i)=>{const k=f.storage.key(i);return [k,f.storage.getItem(k)];});let writes=0;
  Object.defineProperty(area,'value',{configurable:true,get:()=>value,set(){writes++;}});
  for(const [code,label] of [['en','Saving…'],['ja','保存中…'],['zh-Hant','正在儲存…'],['zh-Hans','正在保存…']]){
    await requestUiRoute(code);assert.ok(row.all().some(n=>n.tag==='button'&&n.textContent===label),code+' must update the actual saving button');
    assert.equal(row.querySelector('textarea'),area);assert.equal(area.id,id);assert.equal(f.document.activeElement,area);assert.equal(area.selectionStart,3);assert.equal(area.selectionEnd,7);
    assert.ok(row.textContent.includes(f.record.text));assert.ok(row.textContent.includes(f.record.quote));assert.equal(f.ids(),serial);assert.equal(sent.length,1);
    assert.deepEqual(Array.from({length:f.storage.length},(_,i)=>{const k=f.storage.key(i);return [k,f.storage.getItem(k)];}),storage);
  }
  assert.equal(writes,0);release();await saving;assert.equal(f.get().text,'My revised words.');assert.equal(f.get().revision,1);assert.equal(f.updates.length,1);assert.equal(sent[0].baseRevision,0);
  f.renderer.unmount();const detached=row.textContent;await requestUiRoute('en');assert.equal(row.textContent,detached);
});

test('a disposed record renderer consumes late saving results without reviving UI or publishing a stale update',async()=>{
  let release;const gate=new Promise(resolve=>release=resolve);
  const f=fixture({api:async(url,input,{defaultApi})=>{await gate;return defaultApi(url,input);}}),row=f.mount();
  await f.find(row,'修改原话').fire('click');await write(row,'A pending edit.');const saving=submit(row),before=row.textContent;
  f.renderer.unmount();release();await saving;
  assert.equal(f.updates.length,0);assert.equal(row.textContent,before);assert.equal(f.get().revision,1,'the remote save may complete even after local disposal');
});

test('a late result after book A to B to A releases busy controls without adopting the result or replacing a new editor',async()=>{
  let release,current;const gate=new Promise(resolve=>release=resolve);
  const f=fixture({renderer:{getBook:()=>current},api:async(url,input,{defaultApi})=>{await gate;return defaultApi(url,input);}});current=f.book;
  const first=f.mount();await f.find(first,'修改原话').fire('click');await write(first,'An uncertain edit.');const saving=submit(first);first.connected=false;
  current={...f.book,bookId:'other-book'};const other=f.renderer.recordNode({...f.record,id:'other-record',bookId:'other-book'},'comment');other.connected=true;
  current=f.book;other.connected=false;const row=f.mount(),area=row.querySelector('textarea');area.focus();area.selectionStart=2;area.selectionEnd=4;const ids=f.ids();
  release();await saving;
  assert.equal(f.updates.length,0);assert.equal(row.querySelector('textarea'),area);assert.equal(f.document.activeElement,area);assert.equal(area.selectionStart,2);assert.equal(area.selectionEnd,4);assert.equal(f.ids(),ids);
  assert.equal(f.find(row,'重试上次修改').disabled,false);assert.equal(f.find(row,'暂存并关闭').disabled,false);assert.match(row.textContent,/修改尚未确认/);
  await submit(row);assert.equal(f.updates.length,1);assert.equal(f.get().revision,1);assert.deepEqual(f.calls[0].input,f.calls[1].input,'an explicit retry confirms the same frozen edit');
  f.renderer.unmount();
});
