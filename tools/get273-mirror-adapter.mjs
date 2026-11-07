// Reuses only Tormie's reviewed direct-native fixed Primary frame/touch contract.
// Importing this module never loads the addon or contacts a Simulator.
import {createServer} from 'node:http';
import {randomBytes,createHash} from 'node:crypto';
import {readFileSync,writeFileSync,realpathSync} from 'node:fs';
import {join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import assert from 'node:assert/strict';
import {createMirrorRuntime,installMirrorSignals} from './get273-mirror-runtime.mjs';

const UDID='02B4F0C1-A92F-469D-9DCC-5ED13F119507';
const sha=b=>createHash('sha256').update(b).digest('hex');
export function createAdapterRuntime(options){
  return createMirrorRuntime({...options,onCleanStop:code=>{process.exit(code);}});
}
export function transportRejection(req,origin){
  if(req.socket.remoteAddress!=='127.0.0.1')return 'remote-address';
  if(req.headers.host!==new URL(origin).host)return 'host';
  if(req.headers.origin&&req.headers.origin!==origin)return 'origin';
  if(req.headers['sec-fetch-site']==='cross-site')return 'fetch-site';
  return null;
}
function page(csrf,syntheticTransport){
const label=syntheticTransport?'SYNTHETIC TRANSPORT ONLY · no device · fixed image':'GET-273 · actual Primary frame · awaiting fresh capture';
const captureLabel=syntheticTransport?'SYNTHETIC TRANSPORT ONLY · no device · image ':'GET-273 · actual capture ';
return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${syntheticTransport?'SYNTHETIC TRANSPORT ONLY':'GET-273 owned Primary'}</title><style>body{margin:0;background:#222;color:#eee;font:14px system-ui;display:flex;align-items:center;flex-direction:column}p{margin:8px}img{display:block;max-height:calc(100vh - 60px);max-width:95vw;touch-action:none;user-select:none;-webkit-user-drag:none}</style></head><body><p id="status">${label}</p><img id="screen" alt="${syntheticTransport?'Fixed synthetic image; no device':'Actual owned Primary screen'}" draggable="false"><script nonce="${csrf}">
const image=document.getElementById('screen'),status=document.getElementById('status');
let down=false,inflight=false,ending=false,desired=null,stopped=false,last={x:.5,y:.5},frameBusy=false,blobURL=null;
let downAt=0,beginAckAt=0,heldMs=0,lastSent=null,releaseTimer=null;
function clearReleaseTimer(){if(releaseTimer!==null)clearTimeout(releaseTimer);releaseTimer=null;}
function point(e){const r=image.getBoundingClientRect();return{x:Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))};}
async function pump(){
 if(inflight||stopped)return;
 if(ending&&performance.now()-beginAckAt<heldMs){if(releaseTimer===null)releaseTimer=setTimeout(()=>{releaseTimer=null;void pump();},heldMs-(performance.now()-beginAckAt));return;}
 const p=ending?{phase:lastSent&&(last.x!==lastSent.x||last.y!==lastSent.y)?'move':'end',...last}:desired;if(!p)return;
 desired=null;inflight=true;
 try{const r=await fetch('/touch',{method:'POST',credentials:'omit',headers:{'Content-Type':'application/json','X-QA-CSRF':'${csrf}'},body:JSON.stringify(p)});if(!r.ok)throw Error();if(p.phase==='begin')beginAckAt=performance.now();lastSent={x:p.x,y:p.y};if(p.phase==='end'){ending=false;clearReleaseTimer();}}
 catch{stopped=true;down=false;desired=null;status.textContent='Input stopped; inspect owned cleanup receipt.';}
 finally{inflight=false;if(!stopped)void pump();}
}
function end(force=false){if(force)clearReleaseTimer();if(down||ending){if(down)heldMs=force?0:Math.min(1200,Math.max(0,performance.now()-downAt));else if(force)heldMs=0;down=false;ending=true;desired=null;void pump();}}
image.onpointerdown=e=>{e.preventDefault();if(stopped||down||inflight||ending||e.button!==0)return;clearReleaseTimer();down=true;downAt=performance.now();heldMs=0;lastSent=null;last=point(e);image.setPointerCapture(e.pointerId);desired={phase:'begin',...last};void pump();};
image.onpointermove=e=>{if(down){e.preventDefault();last=point(e);desired={phase:'move',...last};void pump();}};
image.onpointerup=e=>{last=point(e);end(false);};image.onpointercancel=()=>end(true);image.onlostpointercapture=()=>{if(down)end(true);};
window.addEventListener('blur',()=>end(true));window.addEventListener('pagehide',()=>end(true));image.oncontextmenu=e=>e.preventDefault();
async function frame(){
 if(frameBusy||stopped)return;frameBusy=true;
 try{const r=await fetch('/frame.jpg',{cache:'no-store',credentials:'omit',headers:{'X-QA-CSRF':'${csrf}'}});if(!r.ok)throw Error();const next=URL.createObjectURL(await r.blob());image.src=next;if(blobURL)URL.revokeObjectURL(blobURL);blobURL=next;status.textContent='${captureLabel}'+r.headers.get('X-QA-Frame')+' · '+new Date().toISOString();}
 catch{end(true);stopped=true;status.textContent='Frame stopped; no further input.';}
 finally{frameBusy=false;if(!stopped)setTimeout(frame,500);}
}void frame();
</script></body></html>`;}

export function createMirrorServer(control,{syntheticTransport=false}={}){
  const csrf=randomBytes(32).toString('hex');
  const refusals={'remote-address':0,host:0,origin:0,'fetch-site':0};
  let origin,closing=false,frames=0;
  function respond(res,code,body='',type='text/plain'){
    res.writeHead(code,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});res.end(body);
  }
  const server=createServer(async(req,res)=>{
    try{
      if(closing)return respond(res,503);
      const refusal=transportRejection(req,origin);
      if(refusal){refusals[refusal]=Math.min(1000000,refusals[refusal]+1);return respond(res,403);}
      if(req.method==='GET'&&req.url==='/'){
        res.setHeader('Content-Security-Policy',"default-src 'none'; img-src 'self' blob:; connect-src 'self'; style-src 'unsafe-inline'; script-src 'nonce-"+csrf+"'; frame-ancestors 'none'; form-action 'none'");
        return respond(res,200,page(csrf,syntheticTransport),'text/html');
      }
      // Cookies share a localhost host across ports. Require this origin's memory-only
      // header capability for every frame/touch instead; emit and read no cookies.
      if(req.headers['x-qa-csrf']!==csrf)return respond(res,403);
      if(req.method==='GET'&&req.url==='/frame.jpg'){
        res.once('close',()=>{if(!res.writableEnded)control.abort('client-disconnected');});
        const data=await control.frame();if(closing||res.destroyed)return;
        res.setHeader('X-QA-Frame',String(++frames));return respond(res,200,Buffer.from(data),'image/jpeg');
      }
      if(req.method==='POST'&&req.url==='/touch'){
        if(req.headers.origin!==origin||req.headers['content-type']!=='application/json'||req.headers['x-qa-csrf']!==csrf)return respond(res,403);
        req.once('aborted',()=>control.abort('client-disconnected'));
        res.once('close',()=>{if(!res.writableEnded)control.abort('client-disconnected');});
        if(Number(req.headers['content-length']??0)>256)throw Error('Body limit');
        let raw='';for await(const b of req){raw+=b.toString();if(raw.length>256)throw Error('Body limit');}
        const p=JSON.parse(raw);assert.deepEqual(Object.keys(p).sort(),['phase','x','y']);
        assert(['begin','move','end'].includes(p.phase));assert(Number.isFinite(p.x)&&p.x>=0&&p.x<=1&&Number.isFinite(p.y)&&p.y>=0&&p.y<=1);
        await control.touch(p.phase,p.x,p.y);if(!res.destroyed)return respond(res,200,'ok');return;
      }
      respond(res,404);
    }catch{control.abort('invalid-request');if(!res.headersSent&&!res.destroyed)respond(res,400,'Rejected');else res.destroy();}
  });
  server.requestTimeout=1500;server.headersTimeout=1500;server.timeout=3500;
  return {
    transportRejections:()=>({...refusals}),
    listen:async()=>{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});origin='http://127.0.0.1:'+server.address().port;return origin;},
    close:async()=>{closing=true;server.closeAllConnections();await new Promise(resolve=>server.close(resolve));},
  };
}

async function main(){
  assert.deepEqual(process.argv.slice(2,3),['--artifact']);assert.equal(process.argv.length,4);
  const root=realpathSync(process.argv[3]),freeze=JSON.parse(readFileSync(join(root,'execution-freeze.json')));
  assert.equal(process.env.SERVE_SIM_DISABLE_DEVICE_HUB_KEYBOARD,'1');assert.equal(process.env.SERVE_SIM_DEBUG_HID,undefined);
  const fixed={
    'native/serve-sim-native.node':'8fc9402be4863e80926f388cd6eca8320871ca92e0bdb494cfa8ab9cc2004b2d',
    'native/serve-sim-duo-hid':'2b11c2c10b2de8f07c18dd7bd109b2c5c4aae35c1d957e0d356f2300f245d221',
  };
  for(const relative of ['frozen-inputs/get273-mirror-adapter.mjs','frozen-inputs/get273-mirror-control.mjs','frozen-inputs/get273-mirror-runtime.mjs',...Object.keys(fixed)]){
    const file=realpathSync(join(root,relative));assert(file.startsWith(root+sep));
    const hash=sha(readFileSync(file));assert.equal(hash,freeze.files[relative]);if(fixed[relative])assert.equal(hash,fixed[relative]);
  }
  assert.equal(realpathSync(fileURLToPath(import.meta.url)),join(root,'frozen-inputs/get273-mirror-adapter.mjs'));
  const run=promisify(execFile);
  const owner=async()=>{const {stdout}=await run('/Users/cubxxw/.local/bin/dev-ios-session',['is-owner','--profile','primary','--udid',UDID],{encoding:'utf8',timeout:1000,maxBuffer:128});assert.equal(stdout.trim(),'true');};
  let holdTimer=null,activeMirror=null,transportWritten=false;
  const runtime=createAdapterRuntime({
    assertOwner:owner,
    createNative:resources=>{
      const addon=createRequire(import.meta.url)(join(root,'native/serve-sim-native.node'));addon.setDeviceSet(null);
      resources.capture=new addon.SimCapture(UDID,null);
      resources.hid=new addon.SimHID(UDID,join(root,'native/serve-sim-duo-hid'));
    },
    createServer:control=>{activeMirror=createMirrorServer(control);return activeMirror;},
    writeReceipt:(kind,value)=>{
      if(activeMirror&&!transportWritten&&['stopped','blocked'].includes(kind)){
        // One bounded four-counter file. Never retain request/header/URL/cap data.
        writeFileSync(join(root,'mirror-transport-rejections.json'),JSON.stringify(activeMirror.transportRejections())+'\n',{flag:'wx',mode:0o600});transportWritten=true;
      }
      writeFileSync(join(root,'mirror-'+kind+'.json'),JSON.stringify({at:new Date().toISOString(),pid:process.pid,udid:UDID,...value}),{flag:'wx',mode:0o600});
    },
    hold:value=>{if(value&&holdTimer===null)holdTimer=setInterval(()=>{},60000);else if(!value&&holdTimer!==null){clearInterval(holdTimer);holdTimer=null;}},
  });
  // Installed before any native construction. A blocked child remains held; no forced exit.
  installMirrorSignals(runtime);
  const result=await runtime.start();
  if(result.phase==='ready')console.log(JSON.stringify({pid:process.pid,origin:result.origin,udid:UDID,scope:['frame','touch']}));
  else process.exitCode=1;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main().catch(()=>{console.error('GET-273 adapter startup failed closed; inspect owned receipt.');process.exitCode=1;});
}
