import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,copyFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createDialogueGenerator} from '../server/dialogue-generator.mjs';
import {mediaConfiguration} from '../server/media-config.mjs';
import {loadLocalEnvironment} from '../server/local-env.mjs';
import {createTranslator} from '../server/translation.mjs';

test('the shared example can be copied directly for local reading without enabling providers or hosted settings',async t=>{
 const directory=await mkdtemp(path.join(tmpdir(),'leafhour-example-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 await copyFile(new URL('../.env.example',import.meta.url),path.join(directory,'.env'));
 const env={};await loadLocalEnvironment({directory,env});
 for(const key of ['SUPABASE_URL','SUPABASE_SECRET_KEY','SUPABASE_PUBLISHABLE_KEY','READER_PUBLIC_ORIGIN','READER_EMAIL_ENABLED','READER_ADDITIONAL_WEB_ORIGINS'])assert.equal(env[key],undefined,key);
 assert.equal(createTranslator(env),null);assert.equal(createDialogueGenerator({env}),null);
 assert.equal(mediaConfiguration(env).public.speechAvailable,false);assert.equal(mediaConfiguration(env).public.dialogueAvailable,false);
});

test('an explicitly empty canonical key disables the same credential from the legacy file',async t=>{
 const directory=await mkdtemp(path.join(tmpdir(),'leafhour-empty-env-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 await writeFile(path.join(directory,'.env.audio'),'GEMINI_API_KEY=old-speech\n');
 await writeFile(path.join(directory,'.env'),'GEMINI_API_KEY=\n');
 const env={};await loadLocalEnvironment({directory,env});
 assert.equal(env.GEMINI_API_KEY,'');assert.equal(mediaConfiguration(env).public.speechAvailable,false);
});

test('one local env file overrides legacy audio settings while shell variables remain authoritative',async t=>{
 const api=await import('../server/local-env.mjs').catch(()=>({}));assert.equal(typeof api.loadLocalEnvironment,'function');
 const directory=await mkdtemp(path.join(tmpdir(),'leafhour-env-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 await writeFile(path.join(directory,'.env.audio'),'GEMINI_API_KEY=old-speech\nREADER_DIALOGUE_MODEL=old-script\nSHARED=legacy\nMULTILINE="one\ntwo"\n');
 await writeFile(path.join(directory,'.env'),'DEEPSEEK_API_KEY=text-secret\nGEMINI_API_KEY=new-speech\nSHARED=main\nREADER_AUDIO_SCRIPT_MODEL=new-script\n');
 const env={SHARED:'shell',DEEPSEEK_API_KEY:''},result=await api.loadLocalEnvironment({directory,env});
 assert.equal(env.SHARED,'shell');assert.equal(env.DEEPSEEK_API_KEY,'');assert.equal(env.GEMINI_API_KEY,'new-speech');assert.equal(env.READER_DIALOGUE_MODEL,'old-script');assert.equal(env.READER_AUDIO_SCRIPT_MODEL,'new-script');assert.equal(env.MULTILINE,'one\ntwo');
 assert.equal(result.legacyAudio,true);assert.ok(!JSON.stringify(result).includes('speech'));
});

test('reading starts without either optional env file and the loader does not invent credentials',async t=>{
 const api=await import('../server/local-env.mjs').catch(()=>({}));assert.equal(typeof api.loadLocalEnvironment,'function');
 const directory=await mkdtemp(path.join(tmpdir(),'leafhour-no-env-'));t.after(()=>rm(directory,{recursive:true,force:true}));const env={};
 assert.deepEqual(await api.loadLocalEnvironment({directory,env}),{legacyAudio:false});assert.deepEqual(env,{});
});

test('audio script generation uses the clearer model name with a backward-compatible legacy fallback',async()=>{
 for(const [configuration,expected]of [[{READER_AUDIO_SCRIPT_MODEL:'new-script',READER_DIALOGUE_MODEL:'old-script'},'new-script'],[{READER_DIALOGUE_MODEL:'old-script'},'old-script'],[{},'deepseek-flash']]){
  const env={DEEPSEEK_API_KEY:'fixture-secret',...configuration};let payload;
  const generate=createDialogueGenerator({env,fetcher:async(_url,options)=>{payload=JSON.parse(options.body);return Response.json({choices:[{message:{content:'{"turns":[]}'}}]});}});
  await generate({bookId:'b',contentVersion:'v',passages:[{id:'p',original:'Read this.'}]});assert.equal(payload.model,expected);assert.deepEqual(payload.thinking,{type:'disabled'});assert.equal(mediaConfiguration(env).public.textModel,expected);
 }
});

test('translation requests use Flash without thinking by default and preserve explicit model attribution',async t=>{
 let payload;
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  assert.equal(url,'https://api.deepseek.com/chat/completions');payload=JSON.parse(options.body);
  return Response.json({choices:[{message:{content:JSON.stringify({literal:'直译',interpretive:'意译'})}}]});
 });
 for(const [configuration,expected]of [[{},'deepseek-flash'],[{READER_TRANSLATION_MODEL:'custom-translation'},'custom-translation']]){
  const generate=createTranslator({DEEPSEEK_API_KEY:'fixture-only',...configuration});
  const result=await generate({passageId:'p',passages:[{id:'p',original:'Read this.'}]});
  assert.equal(payload.model,expected);assert.deepEqual(payload.thinking,{type:'disabled'});assert.equal(result.model,expected);
 }
});

test('startup distinguishes absent credentials, unverified configuration and unsupported hosted speech without revealing secrets',async()=>{
 const api=await import('../server/model-config.mjs').catch(()=>({}));assert.equal(typeof api.configurationSummary,'function');
 const absent=api.configurationSummary({env:{},speechSupported:true});assert.match(absent,/未配置/);assert.match(absent,/DEEPSEEK_API_KEY/);assert.match(absent,/GEMINI_API_KEY/);
 const env={DEEPSEEK_API_KEY:'text-secret-sentinel',GEMINI_API_KEY:'speech-secret-sentinel'};
 const local=api.configurationSummary({env,speechSupported:true}),hosted=api.configurationSummary({env,speechSupported:false});
 assert.match(local,/已配置.*待验证/);assert.match(hosted,/当前部署尚未支持/);assert.doesNotMatch(local+hosted,/secret-sentinel/);assert.doesNotMatch(local,/验证通过|余额充足/);
});
