import test from 'node:test';
import assert from 'node:assert/strict';
import {audioBoundaryFixture,flush,deferred} from './audio-boundary-fixture.mjs';

async function narrationFixture(t,{pending=false,request}={}){
 let sequence=0;const sessions=new Map(),gate=deferred();
 const f=await audioBoundaryFixture({request:(url,options)=>{
  const override=request?.(url,options);if(override!==undefined)return override;
  const input=options.body&&JSON.parse(options.body);
  if(url.endsWith('/prepare/narration')){
   const id=input.from.passageId,text=id==='p1'?'First paragraph.':'Second paragraph.';
   return Response.json({input:{...input,mode:'selection',parts:[{passageId:id,start:0,end:text.length}]},clips:[{passageId:id,text,start:0,end:text.length}],continuation:id==='p1'?{passageId:'p2',start:0}:null,estimate:{seconds:2}});
  }
  if(url.endsWith('/sessions')){
   const part=input.parts[0],id='s'+ ++sequence;
   const s={id,bookId:'synthetic-book',contentVersion:'a'.repeat(64),chapterId:'ch01',language:'en',variant:'literal',mode:'selection',status:pending?'generating':'ready',clips:[{id:'clip'+sequence,passageId:part.passageId,start:part.start,end:part.end,text:part.passageId==='p1'?'First paragraph.':'Second paragraph.',status:pending?'pending':'ready'}],position:{clipIndex:0,seconds:0}};
   sessions.set(id,s);return Response.json(s);
  }
  if(/\/sessions\/s\d$/.test(url))return Response.json(sessions.get(url.split('/').at(-1)));
  if(url.includes('/clips/'))return new Response(new Blob(['unit-only media bytes']));
 }});
 f.book.sections[0].paragraphs=[{id:'p1',original:'First paragraph.'},{id:'p2',original:'Second paragraph.'}];
 f.book.chapters.push({id:'ch02',number:2,title:{en:'Next',zh:'下一章'}});
 f.book.sections.push({chapterId:'ch02',paragraphs:[{id:'p3',original:'Next chapter.'}]});
 t.after(()=>f.close());await flush();return {f,sessions,gate};
}
test('sidebar starts narration directly and continues exact source order until the chapter ends',async t=>{
 const {f}=await narrationFixture(t);
 f.$('listen-chapter').click();await flush();
 assert.equal(f.$('audio-dialog').open,false,'no preparation modal');
 assert.equal(f.media.paused,false);
 assert.equal(f.calls.filter(c=>c.url.endsWith('/sessions')).length,1);
 const ended=f.media.onended;ended();await flush();
 const requests=f.calls.filter(c=>c.url.endsWith('/sessions')).map(c=>JSON.parse(c.options.body));
 assert.deepEqual(requests.map(r=>r.parts[0].passageId),['p1','p2']);
 ended();await flush();assert.equal(f.calls.filter(c=>c.url.endsWith('/sessions')).length,2,'stale ended ignored');
 f.media.onended();await flush();assert.equal(f.calls.filter(c=>c.url.endsWith('/sessions')).length,2,'no next-chapter synthesis');
});
test('late created narration is canceled after its book scope is disposed',async t=>{
 const gate=deferred();const {f}=await narrationFixture(t,{request:url=>url.endsWith('/sessions')?gate.promise:undefined});
 f.$('listen-chapter').click();await flush();f.setBook({...f.book,bookId:'other-book'});
 gate.resolve(Response.json({id:'late',status:'generating',clips:[]}));await flush();
 assert.equal(f.calls.filter(c=>c.url==='/api/audio/sessions/late/cancel').length,1);
 assert.equal(f.counts.play,0);
});
test('disposing known generating narration cancels its owned session',async t=>{
 const {f}=await narrationFixture(t,{pending:true});f.$('listen-chapter').click();await flush();f.close();await flush();
 assert.equal(f.calls.filter(c=>c.url==='/api/audio/sessions/s1/cancel').length,1);
});
test('explicit play retries a failed preparation using the frozen start',async t=>{
 let attempts=0;const {f}=await narrationFixture(t,{request:url=>url.endsWith('/prepare/narration')&&++attempts===1?Response.json({error:'unavailable'},{status:503}):undefined});
 f.$('listen-chapter').click();await flush();assert.equal(attempts,1);
 f.$('audio-toggle').click();await flush();assert.equal(attempts,2);assert.equal(f.media.paused,false);
});
test('manual scrolling while the next batch is preparing disables following',async t=>{
 let prepares=0;const gate=deferred();const {f}=await narrationFixture(t,{request:url=>url.endsWith('/preferences')?Response.json({follow:true}):url.endsWith('/prepare/narration')&&++prepares===2?gate.promise:undefined});
 const jumps=[];f.reader.goToPassage=id=>jumps.push(id);
 f.$('listen-chapter').click();await flush();f.media.onended();await flush();f.event('wheel');
 gate.resolve(Response.json({input:{chapterId:'ch01',contentVersion:f.book.contentVersion,language:'en',variant:'literal',parts:[{passageId:'p2',start:0,end:17}]},continuation:null}));await flush();
 assert.deepEqual(jumps,['p1']);assert.equal(f.$('audio-return-follow').hidden,false);
});
test('pagehide cannot be undone by an awaited source navigation',async t=>{
 const gate=deferred();const {f}=await narrationFixture(t,{request:url=>url.endsWith('/preferences')?Response.json({follow:true}):undefined});
 f.reader.goToPassage=()=>gate.promise;f.$('listen-chapter').click();await flush();f.event('pagehide',{persisted:true});gate.resolve(true);await flush();
 assert.equal(f.counts.play,0);assert.equal(f.media.paused,true);
});
test('stopping an uncertain create cancels by its original idempotency key',async t=>{
 const {f}=await narrationFixture(t,{request:url=>url.endsWith('/sessions')?Promise.reject(new TypeError('response lost after acceptance')):undefined});
 f.$('listen-chapter').click();await flush();
 const input=JSON.parse(f.calls.find(c=>c.url==='/api/audio/sessions').options.body);f.$('audio-close').click();await flush();
 assert.equal(f.calls.filter(c=>c.url==='/api/audio/requests/'+input.idempotencyKey+'/cancel').length,1);
});
for(const stage of ['prepare','create'])test('BFCache returns an invalid '+stage+' intent to explicit recovery',async t=>{
 const gate=deferred();let waits=0;
 const {f}=await narrationFixture(t,{request:url=>url.endsWith(stage==='prepare'?'/prepare/narration':'/sessions')&&++waits===1?gate.promise:undefined});
 f.$('listen-chapter').click();await flush();f.event('pagehide',{persisted:true});f.event('pageshow',{persisted:true});
 gate.resolve(Response.json(stage==='prepare'?{input:{parts:[{passageId:'p1'}]}}:{id:'late',status:'generating',clips:[]}));await flush();
 assert.equal(f.counts.play,0);f.$('audio-toggle').click();await flush();assert.ok(waits>=2);assert.equal(f.media.paused,false);
});
test('BFCache interrupted create failure can be explicitly recovered',async t=>{
 let attempts=0;const gate=deferred();const {f}=await narrationFixture(t,{request:url=>url.endsWith('/sessions')&&++attempts===1?gate.promise:undefined});
 f.$('listen-chapter').click();await flush();f.event('pagehide',{persisted:true});f.event('pageshow',{persisted:true});gate.reject(new TypeError('lost response'));await flush();
 f.$('audio-toggle').click();await flush();assert.equal(attempts,2);assert.equal(f.media.paused,false);
});
test('missing translation offers explicit original narration without silently switching or synthesizing',async t=>{
 const {f}=await narrationFixture(t,{request:url=>url.endsWith('/prepare/narration')?Response.json({error:'translation unavailable',code:'missing_translation'},{status:409}):undefined});
 f.reader.getState=()=>({chapterId:'ch01',mode:'zh',variant:'literal'});f.$('listen-chapter').click();await flush();
 assert.equal(f.calls.filter(c=>c.url.endsWith('/sessions')).length,0);
 assert.equal(f.$('audio-dialog').open,true);assert.ok(f.$('audio-dialog').textContent.includes('original')||f.$('audio-dialog').textContent.includes('原文'));
});
test('pause while a clip is being prepared prevents late automatic playback',async t=>{
 const {f,sessions}=await narrationFixture(t,{pending:true});
 f.$('listen-chapter').click();await flush();
 f.$('audio-toggle').click();await flush();
 const s=sessions.get('s1');s.clips[0].status='ready';s.status='ready';
 const poll=[...f.timers.values()].find(timer=>timer.ms===750);await poll.fn();await flush();
 assert.equal(f.media.paused,true);assert.equal(f.counts.play,0);
 f.$('audio-toggle').click();await flush();assert.equal(f.media.paused,false);
});
test('from-here captures a bounded batch instead of copying the remaining chapter into selected parts',async t=>{
 const f=await audioBoundaryFixture();t.after(()=>f.close());await flush();
 f.$('listen-from-here').click();await flush();
 const call=f.calls.find(c=>c.url.endsWith('/prepare/narration'));
 assert.ok(call);const input=JSON.parse(call.options.body);
 assert.deepEqual(input.from,{passageId:'p1',start:0});assert.equal(input.parts,undefined);
});
test('a ready clip transport failure can be explicitly retried without a new session',async t=>{
 let gets=0;const f=await audioBoundaryFixture({request:(url,options)=>{
  if(url.endsWith('/prepare'))return Response.json({clips:[],estimate:{seconds:2}});
  if(url.endsWith('/sessions')||url.endsWith('/sessions/s'))return Response.json({id:'s',mode:'selection',status:'ready',clips:[{id:'c',passageId:'p1',status:'ready'}]});
  if(url.includes('/clips/'))return ++gets===1?new Response('{}',{status:503}):new Response(new Blob(['unit-only']));
 }});t.after(()=>f.close());await flush();f.$('show-audio').click();await flush();
 assert.equal(gets,1);assert.equal(f.counts.play,0);f.$('audio-toggle').click();await flush();
 assert.equal(gets,2);assert.equal(f.counts.play,1);assert.equal(f.calls.filter(c=>c.url.endsWith('/sessions')).length,1);
});
test('automatic continuation preserves manual reading rather than restoring follow',async t=>{
 const {f}=await narrationFixture(t);f.reader.goToPassage=()=>assert.fail('must preserve manual reading');
 f.$('listen-chapter').click();await flush();f.event('wheel');
 f.media.onended();await flush();assert.equal(f.$('audio-return-follow').hidden,false);
});
