import test from 'node:test';
import assert from 'node:assert/strict';
import {createLibraryChatState} from '../app/library-chat-state.mjs';
const quote=(text='Source',version='v1')=>({kind:'leafhour-reading-quote',schemaVersion:1,bookId:'one',contentVersion:version,chapterId:'ch1',parts:[{passageId:'p1',layer:'original',start:0,end:text.length,text}]});
const content={available:true,bookId:'one',contentVersion:'v1',scope:{mode:'book',revision:0},context:{passageId:'p1'},turns:[]};
function fixture(){
 const heads=new Map(),acks=new Map(),pending=new Map(),drafts=new Map();let revision=0,id=0,onAck=()=>{},denyWrites=false;
 const create=(owner='alice',book='one',denied=false)=>{
  const key=(o,b)=>o+'/'+b,copy=value=>value?structuredClone(value):null;
  const state=createLibraryChatState({makeId:()=> 'request-'+(++id),makeQuoteRevision:()=> 'quote-'+(++revision),readDraft:(o,b)=>drafts.get(key(o,b))||'',writeDraft:(o,b,v)=>drafts.set(key(o,b),v),readPending:(o,b)=>copy(pending.get(key(o,b))),writePending:(o,b,v)=>pending.set(key(o,b),copy(v)),readQuoteHead:(o,b)=>{if(denied)throw Error('denied');return copy(heads.get(key(o,b)));},writeQuoteHead:(o,b,v)=>{if(denied||denyWrites)throw Error('denied');heads.set(key(o,b),copy(v));},readQuoteAck:(o,b,r)=>copy(acks.get(key(o,b)+'/'+r)),writeQuoteAck:(o,b,r,v)=>{onAck();if(denied)throw Error('denied');acks.set(key(o,b)+'/'+r,copy(v));}});
  state.setContext(owner,book);state.resolveLoad(state.beginLoad(),{...content,bookId:book});return state;
 };
 return {create,heads,acks,pending,drafts,denyWrites:()=>{denyWrites=true;},onAck:fn=>{onAck=fn;}};
}
const receipt=(payload,status='completed')=>({...payload,status,answer:status==='completed'?{summary:'A bounded fixture',sourceRefs:[]}:null});
test('selected quote and own question survive close-equivalent reload without auto-send',()=>{
 const f=fixture(),s=f.create();s.setDraft('My own question');assert.equal(s.setQuote(quote()),true);const reloaded=f.create();assert.deepEqual(reloaded.view().quote,quote());assert.equal(reloaded.view().draft,'My own question');assert.equal(reloaded.view().pending,null);const sent=reloaded.beginSend();assert.deepEqual(sent.payload.quote,quote());assert.equal(sent.payload.text,'My own question');assert.equal(reloaded.setQuote(null),false);
});
test('uncertain recovery freezes quote, revision and request identity through reload',()=>{
 const f=fixture(),s=f.create();s.setDraft('Question');s.setQuote(quote());const sent=s.beginSend();s.rejectSend(sent.ticket,Error('offline'),{uncertain:true});assert.equal(s.setQuote(quote('Other')),false);const next=f.create();assert.equal(next.view().retry.payload.id,sent.payload.id);assert.deepEqual(next.beginSend().payload,sent.payload);assert.equal(next.view().pending.quoteRevision,s.view().retry.quoteRevision);
});
test('completion acknowledges submitted revision without deleting a newer cross-tab head',()=>{
 const f=fixture(),s=f.create();s.setDraft('Question');s.setQuote(quote());const old=s.view().quoteRevision,other=f.create(),sent=s.beginSend();f.onAck(()=>{other.setQuote(quote('Other'));});assert.equal(s.resolveSend(sent.ticket,receipt(sent.payload)),true);assert.notEqual(f.heads.get('alice/one').revision,old);assert.equal(s.view().quote.parts[0].text,'Other');assert.equal(f.create().view().quote.parts[0].text,'Other');assert.ok(f.acks.has('alice/one/'+old));
});
test('a tombstone and same-text fresh revision remain explicit intent after old completion',()=>{
 for(const replacement of [null,quote()]){const f=fixture(),s=f.create();s.setDraft('Question');s.setQuote(quote());const old=s.view().quoteRevision,other=f.create(),sent=s.beginSend();other.setQuote(replacement);s.resolveSend(sent.ticket,receipt(sent.payload));assert.notEqual(f.heads.get('alice/one').revision,old);assert.deepEqual(f.create().view().quote,replacement);}
});
test('POST, GET recovery and cancellation cannot acknowledge changed question or quote',()=>{
 for(const channel of ['post','get','cancel'])for(const change of ['text','quote','passageId','scopeRevision','contentVersion']){
  const f=fixture(),s=f.create();s.setDraft('Question');s.setQuote(quote());const sent=s.beginSend(),bad=receipt(sent.payload);bad[change]=change==='quote'?quote('Other'):change==='scopeRevision'?3:'changed';
  if(channel==='post')assert.equal(s.resolveSend(sent.ticket,bad),false);
  if(channel==='get')assert.equal(s.resolveLoad(s.beginLoad(),{...content,turns:[bad]}),false);
  if(channel==='cancel')assert.equal(s.resolveCancel(s.beginCancel(),bad),false);
  assert.equal(s.view().draft,'Question');assert.equal(s.view().quote.parts[0].text,'Source');assert.equal(f.acks.size,0);
 }
});
test('failed or cancelled callbacks never overwrite a later shared quote head',()=>{
 for(const status of ['failed','cancelled']){const f=fixture(),s=f.create();s.setDraft('Question');s.setQuote(quote());const other=f.create(),sent=s.beginSend();other.setQuote(null);const head=structuredClone(f.heads.get('alice/one'));if(status==='failed')s.resolveSend(sent.ticket,receipt(sent.payload,status));else s.resolveCancel(s.beginCancel(),receipt(sent.payload,status));assert.deepEqual(f.heads.get('alice/one'),head);assert.equal(f.create().view().quote,null);assert.equal(s.view().draft,'Question');}
});
test('stale and foreign quotes cannot be submitted; corrupt head and pending are unusable',()=>{
 const f=fixture(),s=f.create();s.setDraft('Question');s.setQuote(quote('Source','old'));assert.equal(s.view().quoteStale,true);assert.equal(s.beginSend(),null);assert.equal(f.create('bob').view().quote,null);assert.equal(f.create('alice','two').view().quote,null);f.heads.set('alice/one',{schemaVersion:1,owner:'bob',bookId:'one',revision:'quote-bad',quote:quote()});assert.equal(f.create().view().quote,null);
 f.pending.set('alice/one',{schemaVersion:1,owner:'alice',bookId:'one',draftText:'Question',payload:{id:'bad',text:'Question',passageId:'p1',contentVersion:'v1',quote:{kind:'fake'}},quoteRevision:'quote-old'});assert.equal(f.create().view().retry,null);
});
test('denied storage preserves a usable in-memory quotation and exact terminal clear',()=>{
 const f=fixture(),s=f.create('alice','one',true);s.setDraft('Question');assert.equal(s.setQuote(quote()),true);const sent=s.beginSend();assert.deepEqual(sent.payload.quote,quote());s.resolveSend(sent.ticket,receipt(sent.payload));assert.equal(s.view().quote,null);assert.equal(s.view().draft,'');
});

test('an uncertain original request can recover while preserving a newer quote on another passage',()=>{
 const f=fixture(),s=f.create();s.setDraft('Question');s.setQuote(quote());const sent=s.beginSend();s.rejectSend(sent.ticket,Error('offline'),{uncertain:true});const later={...quote('Later'),parts:[{...quote('Later').parts[0],passageId:'p2'}]};f.heads.set('alice/one',{schemaVersion:1,owner:'alice',bookId:'one',revision:'quote-later',quote:later});
 const reloaded=f.create(),retry=reloaded.beginSend();assert.deepEqual(retry.payload,sent.payload);reloaded.resolveSend(retry.ticket,receipt(sent.payload));assert.deepEqual(reloaded.view().quote,later);
});

test('write-only storage failure cannot resurrect an older readable quote on failure, cancel or completion',()=>{
 for(const status of ['failed','cancelled','completed']){const f=fixture(),s=f.create();s.setDraft('Question');s.setQuote(quote('Old'));const persisted=structuredClone(f.heads.get('alice/one'));f.denyWrites();s.setQuote(quote('New'));const sent=s.beginSend();if(status==='cancelled')s.resolveCancel(s.beginCancel(),receipt(sent.payload,status));else s.resolveSend(sent.ticket,receipt(sent.payload,status));assert.deepEqual(f.heads.get('alice/one'),persisted);assert.deepEqual(s.view().quote,status==='completed'?null:quote('New'),status);}
});
test('a stray quote revision on a no-quote pending record cannot acknowledge an unrelated head',()=>{
 const f=fixture(),s=f.create();s.setQuote(quote());const revision=s.view().quoteRevision;f.pending.set('alice/one',{schemaVersion:1,owner:'alice',bookId:'one',draftText:'Question',payload:{id:'stray',text:'Question',passageId:'p1',contentVersion:'v1'},quoteRevision:revision});const loaded=f.create();assert.equal(loaded.view().retry,null);assert.deepEqual(loaded.view().quote,quote());assert.equal(f.acks.size,0);
});
