import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import vm from 'node:vm';
import {parse} from 'acorn';
import {t} from '../app/ui-locale.mjs';
import {audioFailureCode} from '../app/audio-errors.mjs';
import {createReaderServer} from '../server/server.mjs';
import {createPortal} from '../server/portal.mjs';
import {createHostedHandler} from '../api/[...path].js';

const disabled={translator:null,chatGenerator:null,companionGenerator:null,introductionGenerator:null,speechProvider:{available:false},dialogueGenerator:null,guideGenerator:null,paddleProvider:null};
const selection=book=>({chapterId:book.chapters[0].id,contentVersion:book.contentVersion,language:'zh',variant:'literal',parts:[{passageId:book.sections[0].paragraphs[0].id,language:'zh'}]});
const narration=book=>({...selection(book),from:{passageId:book.sections[0].paragraphs[0].id,start:0}});
const memoryStore=()=>{const rows=new Map(),blobs=new Map();return {read:async(k,f)=>structuredClone(rows.has(k)?rows.get(k):f),mutate:async(k,f,fn)=>{const d=structuredClone(rows.has(k)?rows.get(k):f),result=await fn(d);rows.set(k,d);return result;},putBlob:async(k,bytes)=>{assert.ok(!k.includes('/audio/'),'No audio generation');blobs.set(k,Buffer.from(bytes));},blob:async k=>Buffer.from(blobs.get(k)||[])};};

const source=await readFile(new URL('../app/reader-audio.js',import.meta.url),'utf8');
const tree=parse(source,{ecmaVersion:'latest',sourceType:'module'});
const actualFunction=name=>{let f;const walk=n=>{if(!n||typeof n!=='object')return;if(n.type==='FunctionDeclaration'&&n.id?.name===name)f=n;for(const [key,value]of Object.entries(n))if(key!=='parent')if(Array.isArray(value))value.forEach(walk);else if(value&&typeof value==='object')walk(value);};walk(tree);assert.ok(f,name);return source.slice(f.start,f.end);};
async function clientPreparation(response,input){
 const buttons=[],messages=[];let requests=0;
 const context=vm.createContext({t,audioFailureCode,readerFetch:async()=>{requests++;return response.clone();},preparedInput:null,panelRevision:1,panel:()=>1,unavailable:()=>false,body:{append(){}},node:()=>({}),status:(text,error)=>messages.push({text,error}),button:(text,action)=>{const b={text,action};buttons.push(b);return b;}});
 // Actual owner descriptor/formatter dependencies; transport fixtures and assertions stay unchanged.
 vm.runInContext('const disposed=false,entryIntent=null,assertScope=()=>{};const M=(key,params={})=>({id:"audio."+key,params});function uiError(key){return Object.assign(Error(key),{ui:M(key)});}',context);
 vm.runInContext(actualFunction('api')+'\n'+actualFunction('prepare'),context);
 await context.prepare(input);
 assert.equal(requests,1,'Error labels must not automatically request original or restart preparation');
 assert.equal(context.preparedInput,input,'Preparation scope remains the supplied snapshot');
 assert.equal(messages.at(-1)?.error,true);
 return {buttons,messages,context};
}

for(const hosting of ['local','hosted'])test(hosting+' actual audio routes transport a missing-translation cause for selection and narration',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'locale-audio-transport-'));let portal,request;
 if(hosting==='local'){
  const server=await createReaderServer({...disabled,env:{},sendCode:null,bookPath:path.join(dir,'absent.json'),recordsPath:path.join(dir,'records.json')});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});});
  portal=server.portal;const origin='http://127.0.0.1:'+server.address().port,session=await portal.auth.localSession();
  const moduleBytes=await readFile(new URL('../app/audio-errors.mjs',import.meta.url));
  for(const method of ['GET','HEAD']){const response=await fetch(origin+'/audio-errors.mjs',{method});assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/^text\/javascript(?:;|$)/);assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.deepEqual(Buffer.from(await response.arrayBuffer()),method==='GET'?moduleBytes:Buffer.alloc(0));}
  for(const file of ['reader-audio.js','reader-audio.js?retry=1','reader-audio-bootstrap.mjs','reader-audio-metadata.mjs','audio-state.mjs','listening-guide-state.mjs','action-focus.mjs','reader-return.mjs']){const bytes=await readFile(new URL('../app/'+file.split('?')[0],import.meta.url));for(const method of ['GET','HEAD']){const response=await fetch(origin+'/'+file,{method});assert.equal(response.status,200,file);assert.match(response.headers.get('content-type'),/^text\/javascript(?:;|$)/);assert.deepEqual(Buffer.from(await response.arrayBuffer()),method==='GET'?bytes:Buffer.alloc(0));}}
  const staticPost=await fetch(origin+'/audio-errors.mjs',{method:'POST',headers:{Origin:origin}});assert.equal(staticPost.status,405);await staticPost.arrayBuffer();
  const alias=await fetch(origin+'/audio-errors.js');assert.equal(alias.status,404);await alias.arrayBuffer();

  const book=await portal.library.importDocument(session.user,{filename:'locale-audio-source.txt',bytes:Buffer.from('Only the original exists. No translation has been created.')});
  request=async(action,input)=>fetch(origin+'/api/library/books/'+book.bookId+'/audio/'+action,{method:'POST',headers:{origin,'content-type':'application/json',cookie:'marginalia_session='+session.token,'x-reader-owner':session.user.id},body:JSON.stringify(input)});
  for(const[action,input]of [['prepare',selection(book)],['prepare/narration',narration(book)]]){const response=await request(action,input),value=await response.clone().json();assert.equal(response.status,409);assert.equal(value.code,'missing_translation');const ui=await clientPreparation(response,{...input,batch:action.endsWith('/narration')});assert.equal(ui.buttons.length,1,'Actual client offers corresponding original for the transported domain cause');}
  const staleInput={...selection(book),language:'en',parts:[{passageId:book.sections[0].paragraphs[0].id,language:'en'}],contentVersion:'stale-synthetic-version'};
  const stale=await request('prepare',staleInput);assert.equal(stale.status,409);assert.equal((await stale.clone().json()).code,undefined);assert.equal((await clientPreparation(stale,staleInput)).buttons.length,0);

 }else{
  const origin='https://leafhour.example',user={id:'synthetic-audio-owner',email:'reader@example.test'},token='synthetic-session';
  const handler=createHostedHandler({env:{READER_PUBLIC_ORIGIN:origin},background:()=>assert.fail('No background generation'),storeFactory:memoryStore,authFactory:()=>({userFor:async value=>value===token?user:null}),portalFactory:async options=>(portal=await createPortal({...options,...disabled,dataDir:dir,env:{}}))});
  t.after(async()=>{if(portal)await Promise.all([portal.audio?.close(),portal.chat.close(),portal.ingestionRunner.close()]);await rm(dir,{recursive:true,force:true});});
  const invoke=async(url,body)=>{let bytes;const res={setHeader(){},end(value){bytes=value;}};await handler({url,method:body?'POST':'GET',headers:{origin,'content-type':'application/json',cookie:'marginalia_session='+token,'x-reader-owner':user.id},body,socket:{remoteAddress:'127.0.0.1'}},res);return Response.json(JSON.parse(bytes),{status:res.statusCode});};
  assert.equal((await invoke('/api/auth/session')).status,200);assert.ok(portal.audio,'Configured durable audio, not a 503 stub');
  const book=await portal.library.importDocument(user,{filename:'locale-audio-source.txt',bytes:Buffer.from('Only the original exists. No translation has been created.')});
  request=(action,input)=>invoke('/api/library/books/'+book.bookId+'/audio/'+action,input);
  for(const[action,input]of [['prepare',selection(book)],['prepare/narration',narration(book)]]){const response=await request(action,input),value=await response.clone().json();assert.equal(response.status,409);assert.equal(value.code,'missing_translation');const ui=await clientPreparation(response,{...input,batch:action.endsWith('/narration')});assert.equal(ui.buttons.length,1,'Actual client offers corresponding original for the transported domain cause');}
  const staleInput={...selection(book),language:'en',parts:[{passageId:book.sections[0].paragraphs[0].id,language:'en'}],contentVersion:'stale-synthetic-version'};
  const stale=await request('prepare',staleInput);assert.equal(stale.status,409);assert.equal((await stale.clone().json()).code,undefined);assert.equal((await clientPreparation(stale,staleInput)).buttons.length,0);

 }
});

test('only the exact 409 domain code offers an original; prose and unknown/status-mismatched codes do not',async()=>{
 for(const [status,code,prose,expected]of [[409,'missing_translation','Translation is not ready.',1],[409,'stale_source','译文 is mentioned but this is a stale-source error.',0],[403,'missing_translation','译文',0],[500,'missing_translation','译文',0],[409,'MISSING_TRANSLATION','译文',0],[409,null,'译文',0],[409,{code:'missing_translation'},'译文',0]]){
  const response=Response.json({error:prose,code},{status}),ui=await clientPreparation(response,{language:'zh',parts:[{passageId:'p',language:'zh'}]});
  assert.equal(ui.buttons.length,expected,JSON.stringify({status,code}));
  let error;try{await ui.context.api('prepare',{});}catch(e){error=e;}
  assert.ok(error);assert.equal(error.code,expected?'missing_translation':undefined);
 }
 for(const status of ['409',409.1,null,undefined,200])assert.equal(audioFailureCode(status,'missing_translation'),null);
});
