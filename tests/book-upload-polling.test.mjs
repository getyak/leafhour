import test from 'node:test';
import assert from 'node:assert/strict';
import {createBookUploadController} from '../app/book-upload-controller.mjs';

const flush=async()=>{for(let i=0;i<16;i++)await Promise.resolve();};
function fixture(t,{state='running',hidden=false,api:read}={}){
 t.mock.timers.enable({apis:['setTimeout']});
 const document=Object.assign(new EventTarget(),{hidden}),calls=[];
 let nextState=state;
 const controller=createBookUploadController({document,getOwner:()=> 'synthetic-owner',getSession:()=>({user:{id:'synthetic-owner'}}),pollMs:2500,api:async(path,body)=>{
  calls.push({path,body});
  if(read)return read(path,body);
  if(body!==undefined){nextState=path.endsWith('/cancel')?'cancelled':'running';return {id:'synthetic-job',state:nextState,sourceHash:'synthetic-hash'};}
  return {jobs:[{id:'synthetic-job',filename:'Synthetic.pdf',state:nextState,sourceHash:'synthetic-hash',ocrAvailable:true}]};
 }});
 t.after(()=>controller.dispose());
 return {controller,document,calls,setState:value=>{nextState=value;},async tick(){t.mock.timers.tick(2500);await flush();},async visibility(value){document.hidden=value;document.dispatchEvent(new Event('visibilitychange'));await flush();}};
}

for(const state of ['awaiting_consent','failed','needs_review'])test('a '+state+' import waits for an explicit action instead of polling unchanged work',async t=>{
 const f=fixture(t,{state});await f.controller.refresh();
 for(let i=0;i<4;i++)await f.tick();
 assert.equal(f.calls.length,1,'a stalled task cannot advance without a user action');
 await f.controller.act('job-synthetic-job',state==='awaiting_consent'?'consent':'resume');
 assert.equal(f.controller.tasks()[0].stage,'organizing');await f.tick();
 assert.equal(f.calls.at(-1).path,'/api/library/ingestion','resumed work must regain automatic progress reads');
 await f.controller.cancel('job-synthetic-job');const calls=f.calls.length;
 await f.tick();assert.equal(f.calls.length,calls,'cancellation stops future polling');
});

test('hidden imports suspend polling and returning to the page reconciles their current state once',async t=>{
 const f=fixture(t);await f.controller.refresh();await f.tick();assert.equal(f.calls.length,2);
 await f.visibility(true);for(let i=0;i<4;i++)await f.tick();assert.equal(f.calls.length,2);
 f.setState('done');await f.visibility(false);assert.equal(f.calls.length,3);assert.equal(f.controller.tasks()[0].stage,'ready');
 await f.tick();assert.equal(f.calls.length,3);
 f.controller.dispose();await f.visibility(true);await f.visibility(false);assert.equal(f.calls.length,3,'disposal releases the visibility listener');
});

test('an in-flight progress read cannot rearm polling after the page becomes hidden',async t=>{
 let resolve;const pending=new Promise(r=>{resolve=r;});const f=fixture(t,{api:()=>pending});
 const refreshing=f.controller.refresh();await f.visibility(true);resolve({jobs:[{id:'synthetic-job',filename:'Synthetic.pdf',state:'running'}]});await refreshing;
 await f.tick();assert.equal(f.calls.length,1);
 await f.visibility(false);assert.equal(f.calls.length,2);
});

test('a page first mounted in the background waits until visible to restore import tasks',async t=>{
 const f=fixture(t,{hidden:true});await f.controller.refresh();assert.equal(f.calls.length,0);
 await f.visibility(false);assert.equal(f.calls.length,1);assert.equal(f.controller.tasks()[0].stage,'organizing');
});
