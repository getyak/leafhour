import test from 'node:test';
import assert from 'node:assert/strict';
import {createLibraryChatState,chatFailureUncertain} from '../app/library-chat-state.mjs';

const content={available:true,bookId:'one',title:{zh:'一本书',en:'A book'},contentVersion:'v1',context:{passageId:'p1',chapterId:'ch1',chapterTitle:'第一章',original:'Source.',literal:null,interpretive:null,translationStatus:{literal:'missing',interpretive:'missing'}},turns:[]};
const turn=(id,status='completed')=>({id,passageId:'p1',contentVersion:'v1',text:'这个词是什么意思？',origin:'user',createdAt:'2026-10-15T01:00:00Z',status,answer:status==='completed'?{summary:'一个解释候选。',sourceRefs:[{passageId:'p1',quote:'Source.'}],origin:'ai'}:null});
function setup(){const drafts=new Map();let next=0;const state=createLibraryChatState({readDraft:(owner,book)=>drafts.get(owner+'/'+book)||'',writeDraft:(owner,book,text)=>drafts.set(owner+'/'+book,text),makeId:()=>`request-${++next}`});state.setContext('alice','one');state.resolveLoad(state.beginLoad(),content);return {state,drafts};}
function durableSetup(){
  const drafts=new Map(),requests=new Map();let next=0;
  const create=(owner='alice',book='one')=>{const state=createLibraryChatState({readDraft:(o,b)=>drafts.get(o+'/'+b)||'',writeDraft:(o,b,text)=>drafts.set(o+'/'+b,text),readPending:(o,b)=>structuredClone(requests.get(o+'/'+b)||null),writePending:(o,b,record)=>{if(record)requests.set(o+'/'+b,structuredClone(record));else requests.delete(o+'/'+b);},makeId:()=>`durable-${++next}`});state.setContext(owner,book);return state;};
  const state=create();state.resolveLoad(state.beginLoad(),content);return {state,create,drafts,requests};
}

test('AI companion messages never become pending user questions or overwrite drafts',()=>{
  const {state}=setup();state.setDraft('我还没写完的想法');
  const ai={id:'squirrel',kind:'companion',origin:'ai',text:null,passageId:'p1',status:'running',answer:null};
  state.resolveLoad(state.beginLoad(),{...content,turns:[ai]});assert.equal(state.view().pending,null);assert.equal(state.view().draft,'我还没写完的想法');
  state.resolveLoad(state.beginLoad(),{...content,turns:[{...ai,status:'completed',answer:{summary:'前面那段又有了新意思。'}}]});
  assert.equal(state.view().draft,'我还没写完的想法');assert.equal(state.view().canSend,true);
});

test('switching books restores only each book draft and discards a late view',()=>{const {state}=setup();state.setDraft('第一本的问题');const old=state.beginLoad();state.setContext('alice','two');assert.equal(state.view().draft,'');assert.equal(state.resolveLoad(old,content),false);state.setDraft('第二本的问题');state.setContext('alice','one');assert.equal(state.view().draft,'第一本的问题');assert.deepEqual(state.view().turns,[]);});

test('switching owners clears private text and rejects a previous owner answer',()=>{const {state}=setup();state.setDraft('这个词是什么意思？');const request=state.beginSend();state.setContext('bob','one');assert.equal(state.view().draft,'');assert.deepEqual(state.view().turns,[]);assert.equal(state.resolveSend(request.ticket,turn(request.payload.id)),false);assert.deepEqual(state.view().turns,[]);state.setContext('alice','one');assert.equal(state.view().draft,'这个词是什么意思？');});

test('empty and oversized questions cannot send, but the limit itself can',()=>{const {state}=setup();for(const text of ['', ' \n ', '字'.repeat(2001)]){state.setDraft(text);assert.equal(state.beginSend(),null);}state.setDraft('字'.repeat(2000));assert.equal(state.beginSend().payload.text.length,2000);assert.equal(state.beginSend(),null);});

test('unavailable service still keeps a draft without allowing submission',()=>{const {state}=setup();state.resolveLoad(state.beginLoad(),{...content,available:false});state.setDraft('以后再问');assert.equal(state.beginSend(),null);assert.equal(state.view().draft,'以后再问');});

test('cancel invalidates a late completion and restores the question for a fresh run',()=>{const {state}=setup();state.setDraft('这个词是什么意思？');const request=state.beginSend(),cancel=state.beginCancel();assert.equal(state.resolveSend(request.ticket,turn(request.payload.id)),false);assert.equal(state.beginSend(),null);state.resolveCancel(cancel,turn(request.payload.id,'cancelled'));assert.equal(state.view().draft,'这个词是什么意思？');const next=state.beginSend();assert.notEqual(next.payload.id,request.payload.id);});

test('uncertain network failure requires readback before retrying the same id',()=>{const {state}=setup();state.setDraft('这个词是什么意思？');const request=state.beginSend();state.rejectSend(request.ticket,new Error('连接中断'),{uncertain:true});assert.equal(state.beginSend(),null);state.resolveLoad(state.beginLoad(),content);const retry=state.beginSend();assert.equal(retry.payload.id,request.payload.id);assert.deepEqual(retry.payload,request.payload);});

test('readback recovers a completed request without resending or losing a newer draft',()=>{const {state}=setup();state.setDraft('这个词是什么意思？');const request=state.beginSend();state.rejectSend(request.ticket,new Error('连接中断'),{uncertain:true});state.setDraft('下一个问题');state.resolveLoad(state.beginLoad(),{...content,turns:[turn(request.payload.id)]});assert.equal(state.view().pending,null);assert.equal(state.view().retry,null);assert.equal(state.view().turns[0].answer.summary,'一个解释候选。');assert.equal(state.view().draft,'下一个问题');});

test('readback of a running request blocks a second send and recovers its result',()=>{const {state}=setup();state.resolveLoad(state.beginLoad(),{...content,turns:[turn('running-id','running')]});state.setDraft('另一个问题');assert.equal(state.beginSend(),null);assert.equal(state.view().pending.id,'running-id');state.resolveLoad(state.beginLoad(),{...content,turns:[turn('running-id')]});assert.equal(state.view().pending,null);assert.equal(state.view().draft,'另一个问题');});

test('a definite failed run gets a new id while preserving text',()=>{const {state}=setup();state.setDraft('这个词是什么意思？');const request=state.beginSend();state.resolveSend(request.ticket,turn(request.payload.id,'failed'));assert.equal(state.view().draft,'这个词是什么意思？');assert.notEqual(state.beginSend().payload.id,request.payload.id);});

test('draft persistence failure never prevents composing or sending',()=>{const state=createLibraryChatState({readDraft:()=>{throw Error('denied');},writeDraft:()=>{throw Error('denied');},makeId:()=> 'safe-id'});state.setContext('alice','one');state.resolveLoad(state.beginLoad(),content);state.setDraft('仍然可以提问');assert.equal(state.beginSend().payload.id,'safe-id');});

test('changing passage cannot send a question against the previous context while loading',()=>{const {state}=setup();state.setDraft('下一段的意思');const loading=state.beginLoad();assert.equal(state.beginSend(),null);state.resolveLoad(loading,{...content,context:{...content.context,passageId:'p2'}});assert.equal(state.beginSend().payload.passageId,'p2');});

test('a changed source version after uncertain failure requires a fresh request',()=>{const {state}=setup();state.setDraft('这个词是什么意思？');const request=state.beginSend();state.rejectSend(request.ticket,new Error('连接中断'),{uncertain:true});state.resolveLoad(state.beginLoad(),{...content,contentVersion:'v2'});const next=state.beginSend();assert.notEqual(next.payload.id,request.payload.id);assert.equal(next.payload.contentVersion,'v2');});

test('a view requested before stopping cannot reveal a late completion',()=>{const {state}=setup();state.setDraft('这个词是什么意思？');const request=state.beginSend(),oldView=state.beginLoad(),cancel=state.beginCancel();state.resolveCancel(cancel,turn(request.payload.id,'cancelled'));assert.equal(state.resolveLoad(oldView,{...content,turns:[turn(request.payload.id)]}),false);assert.equal(state.view().turns[0].status,'cancelled');assert.equal(state.view().turns[0].answer,null);});

test('a mismatched send receipt cannot acknowledge the submitted question',()=>{const {state}=setup();state.setDraft('这个词是什么意思？');const request=state.beginSend();assert.equal(state.resolveSend(request.ticket,turn('different-request')),false);assert.equal(state.view().pending.id,request.payload.id);assert.equal(state.view().draft,'这个词是什么意思？');});

test('stopping an already failed run preserves its actual terminal status',()=>{const {state}=setup();state.setDraft('这个词是什么意思？');const request=state.beginSend(),cancel=state.beginCancel();state.resolveCancel(cancel,turn(request.payload.id,'failed'));assert.equal(state.view().turns[0].status,'failed');assert.equal(state.view().draft,'这个词是什么意思？');});

test('unavailable readback releases an unstarted question so its draft stays editable',()=>{const {state}=setup();state.setDraft('这个词是什么意思？');const request=state.beginSend();state.rejectSend(request.ticket,new Error('服务不可用'),{uncertain:true});state.resolveLoad(state.beginLoad(),{...content,available:false});assert.equal(state.view().retry.uncertain,false);assert.equal(state.view().draft,'这个词是什么意思？');assert.equal(state.beginSend(),null);});

test('a failed replacement passage read cannot send against the old passage',()=>{const {state}=setup();state.setDraft('下一段的意思');const ticket=state.beginLoad({passageId:'p2'});state.rejectLoad(ticket,new Error('连接中断'));assert.equal(state.beginSend(),null);assert.equal(state.view().draft,'下一段的意思');});

test('reload after server completion acknowledges the original request and clears its exact draft',()=>{const {state,create,requests}=durableSetup();state.setDraft(' 这个词是什么意思？ ');const sent=state.beginSend(),reloaded=create();assert.equal(reloaded.view().retry?.payload.id,sent.payload.id);reloaded.resolveLoad(reloaded.beginLoad(),{...content,turns:[turn(sent.payload.id)]});assert.equal(reloaded.view().draft,'');assert.equal(reloaded.beginSend(),null);assert.equal(requests.size,0);assert.equal(create().view().retry,null);});

test('reload during generation restores one running request and later acknowledges its answer',()=>{const {state,create,requests}=durableSetup();state.setDraft('这个词是什么意思？');const sent=state.beginSend(),reloaded=create();assert.equal(reloaded.view().retry?.payload.id,sent.payload.id);assert.equal(reloaded.beginSend(),null);reloaded.resolveLoad(reloaded.beginLoad(),{...content,turns:[turn(sent.payload.id,'running')]});assert.equal(reloaded.view().pending.id,sent.payload.id);assert.equal(reloaded.beginSend(),null);reloaded.resolveLoad(reloaded.beginLoad(),{...content,turns:[turn(sent.payload.id)]});assert.equal(reloaded.view().draft,'');assert.equal(requests.size,0);});

test('reload without a server receipt retries the persisted payload with the same id after readback',()=>{const {state,create}=durableSetup();state.setDraft('这个词是什么意思？');const sent=state.beginSend(),reloaded=create();assert.equal(reloaded.beginSend(),null);reloaded.resolveLoad(reloaded.beginLoad(),content);assert.deepEqual(reloaded.beginSend().payload,sent.payload);});

test('persisted pending questions belong only to their original owner and book',()=>{const {state,create}=durableSetup();state.setDraft('这个词是什么意思？');const sent=state.beginSend();for(const other of [create('bob','one'),create('alice','two')]){assert.equal(other.view().retry,null);assert.equal(other.view().draft,'');}assert.equal(create().view().retry?.payload.id,sent.payload.id);});

test('reload completion preserves a draft edited after the original question was sent',()=>{const {state,create,requests}=durableSetup();state.setDraft('这个词是什么意思？');const sent=state.beginSend();state.setDraft('后来写下的新问题');const reloaded=create();assert.equal(reloaded.view().retry?.payload.id,sent.payload.id);reloaded.resolveLoad(reloaded.beginLoad(),{...content,turns:[turn(sent.payload.id)]});assert.equal(reloaded.view().draft,'后来写下的新问题');assert.equal(requests.size,0);assert.notEqual(reloaded.beginSend().payload.id,sent.payload.id);});

test('a completed answer does not clear a newer draft saved by another tab',()=>{const {state,create,drafts}=durableSetup();state.setDraft('这个词是什么意思？');const sent=state.beginSend(),reloaded=create();drafts.set('alice/one','另一个页面刚写下的问题');reloaded.resolveLoad(reloaded.beginLoad(),{...content,turns:[turn(sent.payload.id)]});assert.equal(reloaded.view().draft,'另一个页面刚写下的问题');assert.equal(drafts.get('alice/one'),'另一个页面刚写下的问题');});

test('completion clears only the exact submitted draft snapshot, including whitespace edits',()=>{const {state}=durableSetup();state.setDraft(' 这个词是什么意思？ ');const sent=state.beginSend();state.setDraft('这个词是什么意思？');state.resolveSend(sent.ticket,turn(sent.payload.id));assert.equal(state.view().draft,'这个词是什么意思？');});

test('draft cleanup failure retains the original id for the next reload',()=>{let draft='',saved=null;const create=()=>{const state=createLibraryChatState({readDraft:()=>draft,writeDraft:(o,b,text)=>{if(text==='')throw Error('temporarily denied');draft=text;},readPending:()=>saved,writePending:(o,b,record)=>{saved=structuredClone(record);},makeId:()=> 'persist-until-ack'});state.setContext('alice','one');return state;};const state=create();state.resolveLoad(state.beginLoad(),content);state.setDraft('这个词是什么意思？');const sent=state.beginSend();state.resolveSend(sent.ticket,turn(sent.payload.id));assert.equal(create().view().retry?.payload.id,sent.payload.id);});

test('an uncertain retry cannot silently use a different passage than the one shown',()=>{const {state,create}=durableSetup();state.setDraft('这个词是什么意思？');state.beginSend();const reloaded=create();reloaded.resolveLoad(reloaded.beginLoad(),{...content,context:{...content.context,passageId:'p2'}});assert.equal(reloaded.beginSend(),null);});

test('recovery can retry the old id while preserving a different new draft',()=>{const {state,create}=durableSetup();state.setDraft('这个词是什么意思？');const sent=state.beginSend();state.setDraft('后来写下的新问题');const reloaded=create();reloaded.resolveLoad(reloaded.beginLoad(),content);const retry=reloaded.beginSend();assert.ok(retry);assert.deepEqual(retry.payload,sent.payload);reloaded.resolveSend(retry.ticket,turn(sent.payload.id));assert.equal(reloaded.view().draft,'后来写下的新问题');});

test('failed persistence of a later edit cannot erase the last recoverable request id',()=>{let draft='',saved=null,deny=false;const create=()=>{const state=createLibraryChatState({readDraft:()=>draft,writeDraft:(o,b,text)=>{if(deny)throw Error('denied');draft=text;},readPending:()=>saved,writePending:(o,b,record)=>{saved=structuredClone(record);},makeId:()=> 'keep-request-id'});state.setContext('alice','one');return state;};const state=create();state.resolveLoad(state.beginLoad(),content);state.setDraft('这个词是什么意思？');const sent=state.beginSend();deny=true;state.setDraft('后来写的新问题');state.resolveSend(sent.ticket,turn(sent.payload.id));assert.equal(create().view().retry?.payload.id,sent.payload.id);});

for(const terminal of ['completed','failed','cancelled'])test(`a terminal ${terminal} send receipt invalidates earlier empty reads and remains ready`,()=>{
 const {state}=setup();state.setDraft('这个词是什么意思？');const request=state.beginSend(),early=state.beginLoad();
 assert.equal(state.resolveSend(request.ticket,turn(request.payload.id,terminal)),true);
 assert.equal(state.resolveLoad(early,content),false);assert.equal(state.view().turns.length,1);assert.equal(state.view().turns[0].status,terminal);assert.equal(state.view().pending,null);
 state.setDraft('下一个问题');assert.equal(state.view().canSend,true);
 assert.equal(state.rejectLoad(early,new Error('迟到的网络错误')),false);assert.equal(state.view().loadError,'');
});

test('preference write consent belongs only to the selected turn and survives exact pending recovery',()=>{
 const {state,create}=durableSetup();state.setDraft('这个词是什么意思？');
 const request=state.beginSend({preferenceWrites:true});assert.equal(request.payload.preferenceWrites,true);
 state.resolveSend(request.ticket,{...turn(request.payload.id),preferenceWrites:true});
 state.setDraft('这个词是什么意思？');assert.equal(state.beginSend().payload.preferenceWrites,undefined);
 const recovered=create();recovered.resolveLoad(recovered.beginLoad(),content);assert.equal(recovered.view().retry?.payload.preferenceWrites,undefined);
});


test('a confirmed expired or released billing attempt starts a new question ID, while ambiguous failures keep the original',()=>{
  for(const status of ['not_started','released','cancelled','reversed']){
    const {state,requests}=durableSetup();state.setDraft('这个词是什么意思？');const first=state.beginSend();
    const error=Object.assign(Error('Quote expired'),{status:409,billingOperation:{id:'operation',status}});
    assert.equal(chatFailureUncertain(error),false);state.rejectSend(first.ticket,error,{uncertain:chatFailureUncertain(error)});
    assert.equal(requests.size,0);assert.equal(state.view().draft,'这个词是什么意思？');
    assert.notEqual(state.beginSend().payload.id,first.payload.id);
  }
  assert.equal(chatFailureUncertain({status:409}),true);
  assert.equal(chatFailureUncertain({status:503,billingOperation:{status:'running'}}),true);
  assert.equal(chatFailureUncertain({status:503,preSubmit:true}),false);
});
