// Run with GET216_BASE, GET216_OUT, GET216_CHROMIUM and optional GET216_PLAYWRIGHT_MODULE.
// GET216_AUTH=keychain verifies only the project's authorized test account; secrets stay in memory.
const {chromium}=await import(process.env.GET216_PLAYWRIGHT_MODULE||'playwright');
import {mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const out=process.env.GET216_OUT,base=process.env.GET216_BASE;
if(!out||!base||!process.env.GET216_CHROMIUM)throw Error('Explicit output, base and installed Chromium are required');
await mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.GET216_CHROMIUM,headless:true,ignoreDefaultArgs:['--mute-audio'],args:['--autoplay-policy=document-user-activation-required']});
const checks=[],verify=(ok,label)=>{if(!ok)throw Error(label);checks.push(label);};
async function setup(context){
 await context.route('**/*',route=>route.request().method()==='POST'&&!new URL(route.request().url()).pathname.startsWith('/api/auth/')?route.abort():route.continue());
 await context.addInitScript(()=>{
  const Native=window.AudioContext,connect=AudioNode.prototype.connect,start=AudioBufferSourceNode.prototype.start;
  window.__contexts=[];
  window.AudioContext=class extends Native{constructor(options){super(options);this.__tap=this.createMediaStreamDestination();this.__meter=this.createAnalyser();this.__meter.fftSize=2048;this.__starts=[];window.__contexts.push(this);}};
  AudioNode.prototype.connect=function(destination,...args){const result=connect.call(this,destination,...args);if(destination===this.context.destination&&this.context.__tap){connect.call(this,this.context.__tap);connect.call(this,this.context.__meter);}return result;};
  AudioBufferSourceNode.prototype.start=function(...args){if(this.context.__starts)this.context.__starts.push({at:this.context.currentTime,scheduled:args[0]||0,loop:this.loop,seconds:this.buffer?.duration});return start.apply(this,args);};
 });
}
const context=await browser.newContext({viewport:{width:1280,height:900}});await setup(context);
let owner=null;
if(process.env.GET216_AUTH==='keychain'){try{
 const email='test@cubxxw.com',password=execFileSync('/usr/bin/security',['find-generic-password','-s','com.cubxxw.agents.default-data-workspace','-a',email,'-w'],{encoding:'utf8'}).trim();
 const response=await context.request.post(base+'/api/auth/password',{headers:{Origin:base},data:{email,password}});
 if(!response.ok())throw Error('Authorized test account login failed: '+response.status());
 const session=await (await context.request.get(base+'/api/auth/session')).json();
 if(session.user?.email!==email||!session.user?.id)throw Error('Unexpected account identity');
 owner=createHash('sha256').update(session.user.id).digest('hex');
 verify(true,'Supabase-backed session belongs to the authorized default account');
}catch(error){await browser.close();throw error;}}
const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
async function openAtmosphere(target=page){await target.locator('#reading-tools-trigger').click();await target.locator('#open-atmosphere').click();}
async function nonzero(target=page){return target.evaluate(()=>{const c=window.__contexts[0];if(!c)return false;const b=new Float32Array(c.__meter.fftSize);c.__meter.getFloatTimeDomainData(b);return b.some(v=>Math.abs(v)>.0001);});}
try{
 await page.goto(base+'/read?book=gutenberg-alice');await openAtmosphere();
 await page.locator('.atmosphere-choice[data-scene="rain"]').click();
 await page.waitForFunction(()=>document.querySelector('#atmosphere-dialog').dataset.playback==='playing');
 await page.locator('#atmosphere-music').focus();await page.keyboard.press('Home');
 verify(await page.locator('#atmosphere-music').inputValue()==='0','music muted through trusted keyboard input to isolate environmental loops');
 const offline=await page.evaluate(async()=>{
  const {prepareAtmosphereLoop}=await import('/atmosphere-audio.mjs'),result=[],decode=new AudioContext();
  for(const id of ['wind','birds','rain','fire','waves']){
   const original=await decode.decodeAudioData(await (await fetch('/assets/atmospheres/'+id+'.mp3')).arrayBuffer());
   const loop=prepareAtmosphereLoop(decode,original),offline=new OfflineAudioContext(1,loop.length*3,loop.sampleRate),source=offline.createBufferSource();
   source.buffer=loop;source.loop=true;source.connect(offline.destination);source.start(0);const pcm=(await offline.startRendering()).getChannelData(0);
   const rms=(a,b)=>{let sum=0;for(let i=a;i<b;i++)sum+=pcm[i]*pcm[i];return Math.sqrt(sum/(b-a));};
   const half=Math.floor(loop.sampleRate*.15),seams=[loop.length,loop.length*2].map(n=>({at:n/loop.sampleRate,rms:rms(n-half,n+half),sampleStep:Math.abs(pcm[n]-pcm[n-1])}));
   let maximumStep=0;for(let i=1;i<loop.length;i++)maximumStep=Math.max(maximumStep,Math.abs(pcm[i]-pcm[i-1]));
   const samples=pcm.slice(loop.length-loop.sampleRate,loop.length+loop.sampleRate),bytes=new Uint8Array(samples.buffer);let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
   result.push({id,originalSeconds:original.duration,loopSeconds:loop.duration,sampleRate:loop.sampleRate,seams,maximumStep,overallRms:rms(0,pcm.length),seamPcm:btoa(binary)});
  }await decode.close();return result;
 });
 for(const item of offline){await writeFile(out+'/'+item.id+'-seam.f32',Buffer.from(item.seamPcm,'base64'));delete item.seamPcm;verify(item.seams.every(s=>s.rms>.0001&&s.sampleStep<=item.maximumStep),item.id+' real offline boundaries remain non-silent without an exceptional adjacent-sample jump');}
 await writeFile(out+'/waveforms.json',JSON.stringify(offline,null,2));
 const live=[];
 for(const scene of ['rain','forest','hearth','sea']){
  if(scene!=='rain')await page.locator('.atmosphere-choice[data-scene="'+scene+'"]').click();
  await page.waitForFunction(()=>document.querySelector('#atmosphere-dialog').dataset.playback==='playing');
  await page.waitForTimeout(800);
  await page.evaluate(()=>{
   const ctx=window.__contexts[0];window.__live={start:ctx.currentTime,values:[],chunks:[]};
   const recorder=new MediaRecorder(ctx.__tap.stream);window.__live.recorder=recorder;recorder.ondataavailable=e=>window.__live.chunks.push(e.data);recorder.start();
   const buffer=new Float32Array(ctx.__meter.fftSize);window.__live.timer=setInterval(()=>{ctx.__meter.getFloatTimeDomainData(buffer);let sum=0;for(const v of buffer)sum+=v*v;window.__live.values.push([ctx.currentTime-window.__live.start,Math.sqrt(sum/buffer.length)]);},20);
  });
  await page.waitForTimeout(61000);
  const capture=await page.evaluate(async scene=>{const live=window.__live,ctx=window.__contexts[0];clearInterval(live.timer);const blob=await new Promise(resolve=>{live.recorder.onstop=()=>resolve(new Blob(live.chunks,{type:live.recorder.mimeType}));live.recorder.stop();});const bytes=new Uint8Array(await blob.arrayBuffer());let text='';for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,i+8192));return {values:live.values,seconds:ctx.currentTime-live.start,contextStart:live.start,starts:ctx.__starts.filter(s=>s.loop).slice(scene==='forest'?-2:-1),recording:btoa(text)};},scene);
  await writeFile(out+'/'+scene+'-live.webm',Buffer.from(capture.recording,'base64'));delete capture.recording;
  verify(capture.seconds>=60&&capture.values.filter(v=>v[1]>.0001).length>capture.values.length*.98,scene+' real-time output is non-silent across two loops');
  capture.boundaries=capture.starts.flatMap(source=>[1,2].map(n=>{const at=source.at+n*source.seconds-capture.contextStart,values=capture.values.filter(v=>Math.abs(v[0]-at)<.3);return {at,samples:values.length,minimumRms:Math.min(...values.map(v=>v[1]))};}));
  verify(capture.boundaries.every(b=>b.samples>=5&&b.minimumRms>.0001),scene+' real-time analyser has no silent gap within 300ms of each scheduled boundary');
  live.push({scene,...capture});console.log('Captured '+scene+' '+capture.seconds.toFixed(2)+'s');
 }
 await page.locator('#atmosphere-return').click();await page.reload();
 await page.waitForFunction(()=>['blocked','playing'].includes(document.querySelector('#atmosphere-dialog')?.dataset.playback));
 const restored=await page.locator('#atmosphere-dialog').getAttribute('data-playback');verify(await page.evaluate(()=>document.documentElement.dataset.atmosphere==='sea'),'selected scene restored on reentry');
 await openAtmosphere();
 await page.waitForFunction(()=>document.querySelector('#atmosphere-dialog').dataset.playback==='playing');await page.waitForTimeout(1500);
 verify(await nonzero(),'restored intent becomes actual nonzero output after browser-authorized interaction');
 await page.locator('#atmosphere-play').click();await page.reload();await page.locator('#atmosphere-dialog').waitFor({state:'attached'});await page.waitForTimeout(1500);
 verify(await page.locator('#atmosphere-dialog').getAttribute('data-playback')==='paused','explicit pause persists across reentry');
 await openAtmosphere();await page.locator('#atmosphere-play').click();await page.waitForFunction(()=>document.querySelector('#atmosphere-dialog').dataset.playback==='playing');
 await page.locator('#atmosphere-none').click();await page.reload();await page.waitForTimeout(1500);
 verify(await page.locator('#atmosphere-dialog').getAttribute('data-playback')==='paused'&&await page.evaluate(()=>document.documentElement.dataset.atmosphere==='none'),'no-scene persists and remains silent');
 verify(errors.length===0,'reader has no uncaught browser errors');await openAtmosphere();await page.screenshot({path:out+'/browser.png'});
 await writeFile(out+'/browser.json',JSON.stringify({base,checks,ownerSha256:owner,restored,live,errors,browser:browser.version()},null,2));
 console.log(JSON.stringify({checks,restored,errors}));
}catch(error){await writeFile(out+'/browser-failure.json',JSON.stringify({error:error.message,checks,errors,url:page.url()},null,2));throw error;}
finally{await browser.close();}
