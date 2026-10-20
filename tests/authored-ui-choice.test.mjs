import test from 'node:test';
import assert from 'node:assert/strict';
const module=await import('../app/authored-ui-choice.mjs').catch(()=>({}));
const make=options=>{assert.equal(typeof module.createAuthoredUiChoiceHandoff,'function');return module.createAuthoredUiChoiceHandoff(options);};
const setup=()=>{const rows=new Map(),writes=[],location={href:'https://leafhour.test/en'},clock={now:100000},identity={owner:'A'};const handoff=make({storage:{getItem:key=>rows.get(key)||null,setItem:(key,value)=>{rows.set(key,value);writes.push([key,value]);},removeItem:key=>rows.delete(key)},getLocation:()=>location,getOwner:()=>identity.owner,now:()=>clock.now});return {rows,writes,location,clock,identity,handoff,link:{href:'https://leafhour.test/ja',lang:'ja',target:'',hasAttribute:()=>false}};};
test('a primary authored language choice hands off once without changing the document or writing account preferences',()=>{
 const f=setup();assert.equal(f.handoff.capture(f.link,{button:0}),true);assert.equal(f.location.href,'https://leafhour.test/en');assert.equal(f.writes.length,1);f.location.href=f.link.href;assert.deepEqual(f.handoff.consume('A'),{code:'ja'});assert.equal(f.handoff.consume('A'),null);
});
test('a changed owner, a newer manual intent, a different path or an expired handoff never becomes a picker commit',()=>{
 for(const variant of ['owner','intent','path','expired','future']){const f=setup();f.handoff.capture(f.link,{button:0});f.location.href=f.link.href;let owner='A',manual=false;if(variant==='owner')owner='B';if(variant==='intent')manual=true;if(variant==='path')f.location.href='https://leafhour.test/library';if(variant==='expired')f.clock.now+=90001;if(variant==='future')f.clock.now-=5001;assert.equal(f.handoff.consume(owner,{manual}),null,variant);assert.equal(f.rows.size,0,'invalid handoffs are consumed rather than retried later');}
});
test('only same-origin authored links and native current-tab primary actions can create a handoff',()=>{
 for(const variant of ['modified','secondary','prevented','foreign','business','wrong-language','download','new-tab']){const f=setup(),event={button:0};if(variant==='unknown')f.identity.owner=undefined;if(variant==='modified')event.ctrlKey=true;if(variant==='secondary')event.button=1;if(variant==='prevented')event.defaultPrevented=true;if(variant==='foreign')f.link.href='https://foreign.invalid/ja';if(variant==='business')f.link.href='https://leafhour.test/library?ui=ja';if(variant==='wrong-language')f.link.lang='en';if(variant==='download')f.link.hasAttribute=name=>name==='download';if(variant==='new-tab')f.link.target='_blank';assert.equal(f.handoff.capture(f.link,event),false,variant);assert.equal(f.writes.length,0,variant);}
});
test('verified guests retain a manual choice while malformed and unavailable storage stay safe',()=>{
 const f=setup();f.identity.owner=null;f.handoff.capture(f.link,{button:0});f.location.href=f.link.href;assert.deepEqual(f.handoff.consume(null),{code:'ja'});
 const unavailable=make({storage:{getItem(){throw Error('denied');},setItem(){throw Error('denied');},removeItem(){throw Error('denied');}},getLocation:()=>f.location,getOwner:()=>null,now:()=>100000});assert.equal(unavailable.capture(f.link,{button:0}),false);assert.equal(unavailable.consume(null),null);
 for(const value of ['bad','{}','[]','null']){f.rows.set(module.AUTHORED_UI_CHOICE_KEY,value);assert.equal(f.handoff.consume(null),null);assert.equal(f.rows.size,0);}
});

test('a click before identity settles still remembers only a local explicit choice and cannot later bind to an account',()=>{
 const f=setup();f.identity.owner=undefined;assert.equal(f.handoff.capture(f.link,{button:0}),true);f.location.href=f.link.href;assert.deepEqual(f.handoff.takeLocalChoice(),{code:'ja'});assert.equal(f.handoff.consume('B'),null,'an unverified source never saves to a later account');
});
test('local document activation keeps a verified handoff for exactly one matching account commit',()=>{
 const f=setup();f.handoff.capture(f.link,{button:0});f.location.href=f.link.href;assert.deepEqual(f.handoff.takeLocalChoice(),{code:'ja'});assert.deepEqual(f.handoff.consume('A'),{code:'ja'});assert.equal(f.handoff.consume('A'),null);
});
