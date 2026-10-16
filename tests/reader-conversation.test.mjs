import test from 'node:test';
import assert from 'node:assert/strict';
import {readerConversationContext,mountReaderConversation,readerInteractionBlocked} from '../app/reader-conversation.mjs';

const book={bookId:'book-one',sections:[{paragraphs:[{id:'p1'},{id:'p2'}]}]};
const reader=(selected='p2',anchor='p1')=>({getBook:()=>book,isSelectionActive:()=>true,getSelectedId:()=>selected,getAnchor:()=>({passageId:anchor})});

test('nonmodal conversation does not block reading keys while chat controls keep their own keys',()=>{
  const document={querySelector:selector=>selector.includes(':not(.library-chat-dialog)')?null:{open:true}};
  assert.equal(readerInteractionBlocked(document,{closest:()=>null}),false);
  assert.equal(readerInteractionBlocked(document,{closest:()=>({tagName:'DIALOG'})}),true);
  assert.equal(readerInteractionBlocked({querySelector:()=>({open:true})},{closest:()=>null}),true);
});

test('reader chat uses a valid selection, then a valid visible paragraph, and rejects another book',()=>{
  assert.equal(readerConversationContext(reader(),'book-one').passageId,'p2');
  assert.equal(readerConversationContext(reader('unknown'),'book-one').passageId,'p1');
  assert.equal(readerConversationContext({...reader(),isSelectionActive:()=>false},'book-one').passageId,'p1');
  assert.equal(readerConversationContext(reader('unknown','missing'),'book-one').passageId,null);
  assert.equal(readerConversationContext(reader(),'another-book'),null);
  assert.equal(readerConversationContext(null,'book-one'),null);
});

function mount(options={}){
  const events=new EventTarget();globalThis.document=events;
  let hooks,updates=0,resets=0;const navigations=[],replacements=[];
  const instance=mountReaderConversation({bookId:'book-one',session:{user:{id:'reader-one'}},getReader:()=>reader(),root:{},mountChat:value=>{hooks=value;return {update(){updates++;},reset(){resets++;}};},navigate:url=>navigations.push(url),replace:url=>replacements.push(url),...options});
  return {instance,hooks,events,navigations,replacements,counts:()=>({updates,resets})};
}

test('reader adapter preserves the real current book and login return paragraph',()=>{
  const f=mount();assert.deepEqual(f.hooks.getBooks(),[book]);assert.equal(f.hooks.getCurrentPassage(),'p2');assert.equal(f.hooks.getOwner(),'reader-one');
  f.hooks.openAuth();const login=new URL(f.navigations[0],'http://reader.test'),next=new URL(login.searchParams.get('next'),'http://reader.test');assert.equal(login.pathname,'/library');assert.equal(next.pathname,'/read');assert.equal(next.searchParams.get('book'),'book-one');assert.equal(next.searchParams.get('passage'),'p2');
  f.events.dispatchEvent(new Event('reader:ready'));assert.equal(f.counts().updates,2);
});

test('source navigation stays within the same book and a real passage',()=>{
  const visits=[],current={...reader(),dismissTools(){visits.push('dismiss');},goToPassage:id=>visits.push(id)},f=mount({getReader:()=>current});
  assert.equal(f.hooks.onNavigateToPassage('book-one','p1'),true);assert.deepEqual(visits,['dismiss','p1']);
  assert.equal(f.hooks.onNavigateToPassage('other','p1'),false);assert.equal(f.hooks.onNavigateToPassage('book-one','unknown'),false);assert.equal(visits.length,2);
});

test('reader chat requests keep owner guards without remapping library URLs',async()=>{
  const requests=[],f=mount({request:async(url,options)=>{requests.push({url,options});return new Response(JSON.stringify({ok:true}),{status:200});}});
  const url='/api/library/books/book-one/chat';await f.hooks.api(url);await f.hooks.api(url,{text:'原话'});
  assert.equal(requests[0].url,url);assert.equal(requests[0].options.headers['X-Reader-Owner'],'reader-one');assert.equal(requests[1].options.method,'POST');assert.deepEqual(JSON.parse(requests[1].options.body),{text:'原话'});
});

test('session-change responses clear private chat before returning to the library',async()=>{
  const f=mount({request:async()=>new Response(JSON.stringify({error:'changed'}),{status:409,headers:{'X-Reader-Session-Changed':'1'}})});
  await assert.rejects(f.hooks.api('/api/library/books/book-one/chat'),error=>error.status===409);assert.equal(f.counts().resets,1);assert.deepEqual(f.replacements,['/library']);
});

test('HTTP errors preserve status for idempotent recovery and do not fabricate replies',async()=>{
  const f=mount({request:async()=>new Response(JSON.stringify({error:'稍后继续'}),{status:503})});await assert.rejects(f.hooks.api('/api/library/books/book-one/chat'),error=>error.status===503&&error.message==='稍后继续');assert.equal(f.counts().resets,0);
});

test('a companion result rechecks the current cookie identity before exposing old-account text',async()=>{
  const f=mount({request:async url=>new Response(JSON.stringify(url==='/api/auth/session'?{user:{id:'different-reader'}}:{kind:'companion',answer:{summary:'原账号的私有消息'}}),{status:200})});
  await assert.rejects(f.hooks.api('/api/library/books/book-one/companion/messages',{id:'one'}),e=>e.status===409);
  assert.equal(f.counts().resets,1);assert.deepEqual(f.replacements,['/library']);
});
