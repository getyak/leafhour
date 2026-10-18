// Task-owned Android acceptance adapter for the GET-173 typography path.
// Remote, anonymous evidence only: this module never accepts an external CDP
// endpoint and never touches anything outside the job-owned AVD/serial/mappings.
// Official references:
// - https://developer.android.com/studio/run/emulator-commandline
// - https://developer.android.com/tools/adb
// - https://developer.chrome.com/docs/devtools/remote-debugging
// - https://chromium.googlesource.com/chromium/src/+/main/base/android/java/src/org/chromium/base/CommandLineInitUtil.java
// Every side-effect boundary (exec, spawn, kill, filesystem) is injected so the
// unit tests can prove ownership and cleanup without any SDK, emulator or ADB.
import path from 'node:path';
import {pathToFileURL} from 'node:url';

export const ANDROID_TASK_ID='get173-android';
export const ANDROID_IMAGE_PACKAGE='system-images;android-34;google_apis_playstore;x86_64';
export const ANDROID_IMAGE_PINNED=Object.freeze({
  revision:14,
  zip:'x86_64-34_r14.zip',
  size:1510752654,
  sha1:'01d32617fd1937e540faf8731d70cf50e35af854',
});
export const SYSTEM_IMAGE_MANIFEST_URL='https://dl.google.com/android/repository/sys-img/google_apis_playstore/sys-img2-3.xml';
export const CHROME_PACKAGE='com.android.chrome';
export const CHROME_COMMAND_LINE_PATH='/data/local/tmp/chrome-command-line';
// Chromium CommandLine.initInternal takes argv[0] as the program name and
// parses switches from index 1, so the pushed file needs a harmless placeholder
// before the reviewed switch.
export const CHROME_PROGRAM_NAME='_';
export const DEVTOOLS_SOCKET='localabstract:chrome_devtools_remote';
// The reviewed Chrome setup flags may disable First Run Experience only. They
// must never alter typography, locale, network fallback or rendering.
export const SETUP_CHROME_FLAGS=Object.freeze(['--disable-fre']);
export const DEFAULT_ORIGINAL_SELECTOR='#library-books .binding-original';
const AVD_NAME='get173-api34-playstore';
const BOOT_TIMEOUT_MS=420_000;
const CHROME_TIMEOUT_MS=120_000;
const EXIT_PROOF_WAIT_MS=30_000;
const EMULATOR_PORT_MIN=5554;
const EMULATOR_PORT_MAX=5680;
const PHONE_PROFILE_PREFERENCE=['pixel_5','pixel_6','pixel_7','pixel_8','pixel_4a','pixel_3a','pixel_4','pixel_3','pixel_2','pixel','pixel_xl'];
const FIRST_RUN_MARKERS=['fre_','first_run','first-run','Accept & continue','Turn on sync'];
const FORBIDDEN_EFFECTIVE_FLAGS=/^--(?:lang|user-agent|force-device-scale-factor|force-dark-mode|blink-settings|disable-remote-fonts|disable-lcd-text|font-render-hinting|hide-scrollbars|disable-font-subpixel-positioning|enable-font-antialiasing|proxy-server|proxy-pac-url|host-resolver-rules|unsafely-treat-insecure-origin-as-secure)(?:=|$)/;

// --- runner admission: pure checks, run before any side effect --------------
export function assertRunnerGuard({env=process.env,platform=process.platform,mode}){
  if(env.GITHUB_ACTIONS!=='true')throw Error('Run only on the task-owned GitHub hosted runner');
  if(mode==='android'){
    if(platform!=='linux')throw Error('Android acceptance runs only on the task-owned Linux hosted runner');
    return;
  }
  if(mode!=='desktop')throw Error('Unknown acceptance mode: '+String(mode));
  if(!['linux','win32'].includes(platform))throw Error('Local Mac browser automation is prohibited');
}
export function parseScriptArgs(args=[]){
  const rest=[...args];
  let mode='desktop';
  if(rest[0]==='--android'){mode='android';rest.shift();}
  if(rest.some(arg=>arg.startsWith('--')))throw Error('Unsupported argument: external CDP endpoints and browser flags are never accepted');
  if(rest.length!==1||!rest[0])throw Error('Exactly one evidence directory argument is required');
  return {mode,out:rest[0]};
}
export function assertEvidenceOutputDir({out,runnerTemp}){
  if(!out||!runnerTemp)throw Error('Evidence must live inside this job RUNNER_TEMP');
  const resolved=path.resolve(out),base=path.resolve(runnerTemp);
  if(resolved===base||!resolved.startsWith(base+path.sep))throw Error('Evidence must live inside this job RUNNER_TEMP');
  return resolved;
}
export function ownedStatePaths({runnerTemp}){
  const stateDir=path.join(path.resolve(runnerTemp),ANDROID_TASK_ID);
  return {stateDir,androidUserHome:path.join(stateDir,'android-user-home'),androidAvdHome:path.join(stateDir,'android-avd-home')};
}
export function assertOwnedStatePaths({env,runnerTemp}){
  if(!runnerTemp)throw Error('Android state must live inside the job RUNNER_TEMP');
  const paths=ownedStatePaths({runnerTemp});
  for(const [key,expected] of [['ANDROID_USER_HOME',paths.androidUserHome],['ANDROID_AVD_HOME',paths.androidAvdHome]]){
    const value=env[key];
    if(!value)throw Error('Task-specific '+key+' must be set inside the job RUNNER_TEMP');
    const resolved=path.resolve(value);
    if(resolved!==path.resolve(expected))throw Error(key+' must be the task-owned path inside the job RUNNER_TEMP, never HOME');
  }
}

// --- owned port, serial and argv validation ---------------------------------
export function validateEmulatorPort(port){
  if(!Number.isInteger(port)||port<EMULATOR_PORT_MIN||port>EMULATOR_PORT_MAX||port%2!==0)throw Error('Owned emulator port must be an even value between '+EMULATOR_PORT_MIN+' and '+EMULATOR_PORT_MAX);
  return port;
}
export function ownedSerial(port){return 'emulator-'+validateEmulatorPort(port);}
export function chooseEmulatorPort({runId}){
  const digits=String(runId??'').replace(/\D/g,'');
  const seed=digits?Number(digits):0;
  return validateEmulatorPort(EMULATOR_PORT_MIN+(seed%56)*2);
}
export function buildAdbArgs(serial,command,args=[],{ownedPort}={}){
  const match=/^emulator-(\d+)$/.exec(serial||'');
  if(!match)throw Error('Every adb command must target the owned emulator serial');
  if(ownedPort!==undefined&&serial!==ownedSerial(ownedPort))throw Error('adb command targets an unowned serial');
  return ['-s',serial,command,...args];
}
export function parseForwardPort(stdout){
  const value=String(stdout??'').trim();
  if(!/^\d{1,5}$/.test(value))throw Error('Owned adb forward must return one allocated tcp port');
  const port=Number(value);
  if(port<1||port>65535)throw Error('Owned adb forward port is out of range');
  return port;
}
// Host-side forward listings carry the device serial; device-side reverse
// listings never do (adb_listeners.cpp format_listeners emits no serial for
// reverse listeners: current placeholder (reverse), older versions UsbFfs).
export function parseForwardMappings(output){
  return String(output??'').split('\n').map(line=>line.trim()).filter(Boolean).map(line=>{
    const match=/^(\S+)\s+tcp:(\d{1,5})\s+(\S+)$/.exec(line);
    return match?{serial:match[1],port:Number(match[2]),target:match[3]}:null;
  }).filter(Boolean);
}
export function parseReverseMappings(output){
  return String(output??'').split('\n').map(line=>line.trim()).filter(Boolean).map(line=>{
    const match=/^(\(reverse\)|UsbFfs)\s+tcp:(\d{1,5})\s+tcp:(\d{1,5})$/.exec(line);
    return match?{placeholder:match[1],localPort:Number(match[2]),remotePort:Number(match[3])}:null;
  }).filter(Boolean);
}
export function findForwardMapping(output,{serial,forwardPort,socket=DEVTOOLS_SOCKET}={}){
  return parseForwardMappings(output).some(entry=>entry.serial===serial&&entry.port===forwardPort&&entry.target===socket);
}
export function findReverseMapping(output,{serverPort}={}){
  return parseReverseMappings(output).some(entry=>entry.localPort===serverPort&&entry.remotePort===serverPort);
}
export function validateDevtoolsTarget({host,port,forwardPort}){
  if(!['127.0.0.1','localhost'].includes(host))throw Error('DevTools must stay on the owned loopback forward');
  if(port!==forwardPort)throw Error('DevTools endpoint must be the owned adb forward port');
}

// --- stock Chrome setup verification ---------------------------------------
// Chromium CommandLine.initFromFile tokenizes the file and initInternal takes
// the first token as the program name, parsing switches from index 1.
export function parseChromeCommandLine(content){
  const tokens=String(content??'').trim().split(/\s+/).filter(Boolean);
  if(!tokens.length)throw Error('Chrome command line must include a program name before its switches');
  const [argv0,...rest]=tokens;
  if(argv0.startsWith('-'))throw Error('Chrome command line must start with a program name, not a switch');
  return {argv0,switches:rest.filter(token=>token.startsWith('-')),args:rest.filter(token=>!token.startsWith('-'))};
}
export function validateChromeCommandLineFlags(content){
  const {argv0,switches,args}=parseChromeCommandLine(content);
  if(args.length)throw Error('Chrome setup command line may not carry unexpected arguments: '+args.join(' '));
  const forbidden=switches.filter(token=>FORBIDDEN_EFFECTIVE_FLAGS.test(token));
  if(forbidden.length)throw Error('Chrome setup flags may not alter typography, locale or network fallback: '+forbidden.join(' '));
  if(switches.length!==SETUP_CHROME_FLAGS.length||switches.some(token=>!SETUP_CHROME_FLAGS.includes(token)))throw Error('Chrome setup flags may disable First Run Experience only: '+SETUP_CHROME_FLAGS.join(' '));
  return {argv0,switches:[...switches]};
}
export function validateEffectiveChromeCommandLine(text){
  const {switches}=parseChromeCommandLine(text);
  if(!SETUP_CHROME_FLAGS.every(flag=>switches.includes(flag)))throw Error('Chrome must keep the reviewed First Run Experience setup flag effective');
  const forbidden=switches.filter(token=>FORBIDDEN_EFFECTIVE_FLAGS.test(token));
  if(forbidden.length)throw Error('Chrome effective flags may not alter typography, locale or network fallback: '+forbidden.join(' '));
  return switches.filter(token=>SETUP_CHROME_FLAGS.includes(token));
}

// --- viewport/selector decisions -------------------------------------------
export function resolveLanguageEntrance({viewportWidth,locale}){
  if(!Number.isFinite(viewportWidth)||viewportWidth<=0)throw Error('Actual CSS viewport width is required');
  if(typeof locale!=='string'||!/^[A-Za-z][A-Za-z-]{0,19}$/.test(locale))throw Error('Actual authored locale is required');
  // Desktop navigation is hidden at <=700px (app/portal.css); the mobile
  // entrance is the hero-copy language switch. Never relabel desktop
  // navigation as the mobile entrance or vice versa.
  return viewportWidth<=700
    ?`.hero-copy .home-language-switch a[hreflang="${locale}"]`
    :`.home-navigation a[hreflang="${locale}"]`;
}
// Each product route binds its own current CSS viewport; the internal version
// page viewport is never reused for product decisions.
export function assertAndroidViewport({label,viewport}={}){
  const {width,height,dpr,ua}=viewport||{};
  if(!Number.isFinite(width)||width<=0||!Number.isFinite(height)||height<=0||!Number.isFinite(dpr)||dpr<=0)throw Error('Actual CSS width/height/DPR must be read on product route '+String(label));
  if(typeof ua!=='string'||!/Android/.test(ua)||!/Mobile/.test(ua))throw Error('Actual stock Android Chrome user agent required on product route '+String(label));
  if(width>700)throw Error('Actual Android CSS width must stay at the device width on product route '+String(label)+', never enlarged to pass hidden desktop targets');
  return {width,height,dpr,ua};
}
export async function bindAndroidProductViewport({receipt,label,read}={}){
  if(typeof read!=='function')throw Error('Product viewport reader must be injected');
  const value=assertAndroidViewport({label,viewport:await read()});
  const android=receipt.android??(receipt.android={});
  const productViewports=android.productViewports??(android.productViewports={});
  productViewports[label]=value;
  return value;
}
export function resolveOriginalTitleProbe({viewportWidth,titleText,nodes=[]}){
  if(!Number.isFinite(viewportWidth)||viewportWidth<=0)throw Error('Actual CSS viewport width is required');
  if(typeof titleText!=='string'||!titleText.trim())throw Error('A genuine same-title probe requires the actual original title text');
  const title=titleText.trim();
  const eligible=nodes.filter(node=>node&&node.text===title);
  const preferred=eligible.find(node=>node.selector===DEFAULT_ORIGINAL_SELECTOR&&node.visible);
  if(preferred)return {kind:'probe',selector:preferred.selector,reason:'default-binding-original-visible'};
  const alternate=eligible.find(node=>node.visible&&node.selector!==DEFAULT_ORIGINAL_SELECTOR);
  if(alternate)return {kind:'probe',selector:alternate.selector,reason:'visible-same-title-node'};
  return {kind:'unsupported',reason:'no-visible-same-title-node'};
}

// --- native readiness decisions --------------------------------------------
// Strict, non-executing parser for the actual uiautomator hierarchy grammar:
// one <hierarchy> root with <node> children, balanced tags, quoted attributes,
// no DTD/entity declarations/comments, and XML entity decoding of attribute
// values before any native phrase check. No external entity, network or DTD
// expansion exists here.
const XML_TEXT_ENTITIES={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};
// XML 1.0 character validity: raw characters and numeric references alike.
const isValidXmlChar=code=>code===0x9||code===0xa||code===0xd||(code>=0x20&&code<=0xd7ff)||(code>=0xe000&&code<=0xfffd)||(code>=0x10000&&code<=0x10ffff);
function assertXmlChars(text){
  for(const char of text){
    const code=char.codePointAt(0);
    if(!isValidXmlChar(code))throw Error('Invalid XML character: #x'+code.toString(16));
  }
}
function decodeXmlAttributeValue(raw){
  let decoded='';
  for(let index=0;index<raw.length;index++){
    const char=raw[index];
    if(char!=='&'){decoded+=char;continue;}
    const end=raw.indexOf(';',index+1);
    if(end<0)throw Error('Invalid XML entity: unterminated reference');
    const reference=raw.slice(index+1,end);
    let code;
    if(/^#\d+$/.test(reference))code=Number.parseInt(reference.slice(1),10);
    else if(/^#[xX][0-9a-fA-F]+$/.test(reference))code=Number.parseInt(reference.slice(2),16);
    else if(Object.hasOwn(XML_TEXT_ENTITIES,reference)){decoded+=XML_TEXT_ENTITIES[reference];index=end;continue;}
    else throw Error('Invalid or unsupported XML entity: &'+reference+';');
    if(!isValidXmlChar(code))throw Error('Invalid XML character reference: &'+reference+';');
    decoded+=String.fromCodePoint(code);
    index=end;
  }
  return decoded;
}
export function parseUiHierarchy(xml){
  const text=String(xml??'');
  if(!text.trim())throw Error('uiautomator hierarchy is empty or unavailable');
  assertXmlChars(text);
  if(/<!DOCTYPE|<!ENTITY|<!\[CDATA\[|<!--/.test(text))throw Error('DTD, entity declarations and comments are not allowed in uiautomator hierarchy');
  let cursor=0;
  const whitespace=()=>{while(cursor<text.length&&/\s/.test(text[cursor]))cursor++;};
  const findTagEnd=start=>{
    let quote=null;
    for(let index=start;index<text.length;index++){
      const char=text[index];
      if(quote){if(char===quote)quote=null;continue;}
      if(char==='"'||char==="'"){quote=char;continue;}
      if(char==='>')return index;
    }
    return -1;
  };
  const parseAttributes=source=>{
    const attrs={};
    let index=0;
    while(index<source.length){
      const before=index;
      while(index<source.length&&/\s/.test(source[index]))index++;
      if(index>=source.length)break;
      if(index===before)throw Error('Attributes must be whitespace-separated in uiautomator hierarchy');
      const name=/^[A-Za-z_][A-Za-z0-9_.:-]*/.exec(source.slice(index));
      if(!name)throw Error('Invalid attribute in uiautomator hierarchy');
      index+=name[0].length;
      while(index<source.length&&/\s/.test(source[index]))index++;
      if(source[index]!=='=')throw Error('Invalid attribute in uiautomator hierarchy: '+name[0]);
      index++;
      while(index<source.length&&/\s/.test(source[index]))index++;
      const quote=source[index];
      if(quote!=='"'&&quote!=="'")throw Error('Invalid attribute value in uiautomator hierarchy: '+name[0]);
      const end=source.indexOf(quote,index+1);
      if(end<0)throw Error('Unterminated attribute value in uiautomator hierarchy: '+name[0]);
      const raw=source.slice(index+1,end);
      if(raw.includes('<'))throw Error('Illegal "<" in attribute value: '+name[0]);
      if(Object.hasOwn(attrs,name[0]))throw Error('Duplicate attribute in uiautomator hierarchy: '+name[0]);
      attrs[name[0]]=decodeXmlAttributeValue(raw);
      index=end+1;
    }
    return attrs;
  };
  whitespace();
  if(text.startsWith('<?xml',cursor)){const end=text.indexOf('?>',cursor);if(end<0)throw Error('Unterminated XML declaration');cursor=end+2;whitespace();}
  const tokens=[];
  while(cursor<text.length){
    whitespace();
    if(cursor>=text.length)break;
    if(text[cursor]!=='<')throw Error('Unexpected text content in uiautomator hierarchy');
    if(text.startsWith('</',cursor)){
      const end=findTagEnd(cursor);
      if(end<0)throw Error('Unterminated end tag in uiautomator hierarchy');
      tokens.push({type:'end',name:text.slice(cursor+2,end).trim()});
      cursor=end+1;
      continue;
    }
    const end=findTagEnd(cursor);
    if(end<0)throw Error('Unterminated start tag in uiautomator hierarchy');
    const inner=text.slice(cursor+1,end);
    const selfClosing=/\/\s*$/.test(inner);
    const body=selfClosing?inner.replace(/\/\s*$/,''):inner;
    const name=/^[A-Za-z_][A-Za-z0-9_.:-]*/.exec(body);
    if(!name)throw Error('Invalid element name in uiautomator hierarchy');
    tokens.push({type:selfClosing?'empty':'start',name:name[0],attrs:parseAttributes(body.slice(name[0].length))});
    cursor=end+1;
  }
  const stack=[],nodes=[];
  let rootSeen=false,rootClosed=false;
  for(const token of tokens){
    if(token.type==='end'){
      const open=stack.pop();
      if(!open||open.name!==token.name)throw Error('Mismatched end tag in uiautomator hierarchy: '+token.name);
      if(open.name==='hierarchy')rootClosed=true;
      continue;
    }
    if(rootClosed)throw Error('Node outside the hierarchy root');
    if(token.name==='hierarchy'){
      if(rootSeen||stack.length)throw Error('Unexpected nested hierarchy root in uiautomator hierarchy');
      rootSeen=true;
      if(token.type==='start')stack.push(token);
      else rootClosed=true;
      continue;
    }
    if(!rootSeen||!stack.length||stack[0].name!=='hierarchy')throw Error('Node outside the hierarchy root');
    if(token.name!=='node')throw Error('Unexpected element in uiautomator hierarchy: '+token.name);
    nodes.push(token);
    if(token.type==='start')stack.push(token);
  }
  if(!rootSeen)throw Error('uiautomator hierarchy must contain exactly one hierarchy root');
  if(stack.length)throw Error('Unclosed element in uiautomator hierarchy: '+stack.map(open=>open.name).join(', '));
  return {nodes:nodes.map(({attrs})=>({attrs}))};
}
export function assessNativeForeground({dumpsysText='',expectedPackage=CHROME_PACKAGE}){
  const lines=String(dumpsysText).split('\n').filter(line=>/topResumedActivity|mResumedActivity|ResumedActivity/.test(line));
  const resumed=lines[0]||null;
  return {ok:!!resumed&&resumed.includes(expectedPackage),resumed};
}
export function assessFirstRunOverlay(uiautomatorXml=''){
  // Fail closed: an empty, unavailable, truncated, garbage or non-native
  // hierarchy can never prove that no native FirstRun overlay covers the
  // browser. Attribute values are entity-decoded before native phrase checks.
  const text=String(uiautomatorXml??'');
  let parsed;
  try{parsed=parseUiHierarchy(text);}
  catch(error){return {ok:false,markers:[],xmlBytes:text.length,nodes:0,chromeNodes:0,reason:'uiautomator hierarchy unavailable or malformed: '+error.message};}
  const nodes=parsed.nodes;
  if(!nodes.length)return {ok:false,markers:[],xmlBytes:text.length,nodes:0,chromeNodes:0,reason:'uiautomator hierarchy unavailable or malformed'};
  const chromeNodes=nodes.filter(node=>node.attrs.package===CHROME_PACKAGE||String(node.attrs['resource-id']||'').startsWith(CHROME_PACKAGE+':'));
  if(!chromeNodes.length)return {ok:false,markers:[],xmlBytes:text.length,nodes:nodes.length,chromeNodes:0,reason:'no Chrome UI node observed in the hierarchy'};
  const decoded=nodes.flatMap(node=>Object.values(node.attrs)).join('\n');
  const markers=FIRST_RUN_MARKERS.filter(marker=>decoded.toLowerCase().includes(marker.toLowerCase()));
  return {ok:markers.length===0,markers,xmlBytes:text.length,nodes:nodes.length,chromeNodes:chromeNodes.length,reason:markers.length?'first-run overlay markers observed':null};
}

// --- official SDK inventory -----------------------------------------------
export function selectPhoneProfile(listOutput){
  const blocks=String(listOutput).split(/^-{5,}$/m).map(block=>{
    const id=/id:\s*\d+\s+or\s+"([^"]+)"/.exec(block)?.[1];
    const name=/Name:\s*(.+)/.exec(block)?.[1]?.trim();
    return id&&name?{id,name}:null;
  }).filter(Boolean);
  const phones=blocks.filter(({id,name})=>/^pixel/i.test(id)&&!/(tablet|fold|tv|watch|automotive|desktop)/i.test(id+' '+name));
  if(!phones.length)throw Error('No official phone device profile is available from the SDK');
  for(const preferred of PHONE_PROFILE_PREFERENCE){const hit=phones.find(profile=>profile.id===preferred);if(hit)return hit;}
  return phones[0];
}
export function verifySystemImageManifest(xml,expected=ANDROID_IMAGE_PINNED){
  const text=String(xml);
  let block=null;
  for(const match of text.matchAll(/<remotePackage\s+path="([^"]+)">([\s\S]*?)<\/remotePackage>/g)){
    if(match[1]===ANDROID_IMAGE_PACKAGE)block=match[2];
  }
  if(!block)throw Error('Official system-image manifest is missing the pinned system image package');
  const revision=Number(/<revision>\s*<major>(\d+)<\/major>/.exec(block)?.[1]);
  const complete=/<complete>([\s\S]*?)<\/complete>/.exec(block)?.[1]||'';
  const size=Number(/<size>(\d+)<\/size>/.exec(complete)?.[1]);
  const sha1=/<checksum\s+type="sha1">([0-9a-fA-F]+)<\/checksum>/.exec(complete)?.[1];
  const zip=/<url>([^<]+)<\/url>/.exec(complete)?.[1];
  const facts={path:ANDROID_IMAGE_PACKAGE,revision,zip,size,sha1,pinned:{...expected}};
  for(const [key,pinnedKey] of [['revision','revision'],['zip','zip'],['size','size'],['sha1','sha1']]){
    if(String(facts[key])!==String(expected[pinnedKey]))throw Error('Official system-image manifest no longer matches the pinned package facts: '+key+' '+facts[key]+' != '+expected[pinnedKey]);
  }
  return facts;
}

// --- run finalization and lifecycle ----------------------------------------
// The final result gate is the single place that decides success: a clean main
// body can never hide cleanup, cancellation, draining or close failures.
export function finalRunStatus({failures=[],receiptErrors=[],cleanupErrors=[],cancelled=null,runError=null}={}){
  const reasons=[];
  if(cancelled)reasons.push('cancelled: '+cancelled);
  if(runError)reasons.push('run failure: '+(runError.message||runError));
  for(const failure of failures)reasons.push('background/protocol failure: '+failure);
  for(const error of receiptErrors)reasons.push('page/network/runtime error: '+(error?.error||error?.message||JSON.stringify(error)));
  for(const error of cleanupErrors)reasons.push('cleanup failure: '+error);
  return reasons.length
    ?{result:'failed',exitCode:1,reasons}
    :{result:'machine assertions passed; screenshots pending human visual review',exitCode:0,reasons};
}
// One bounded, idempotent lifecycle finalizer covers normal completion, errors
// and SIGINT/SIGTERM cancellation: it stops future work, drains tracked
// in-flight acquisitions, refuses late resource creation, cleans up owned
// resources exactly once and removes its handlers.
export function createRunLifecycle({addSignalHandler,removeSignalHandler,signals=['SIGINT','SIGTERM'],drainMs=15_000}={}){
  if(typeof addSignalHandler!=='function'||typeof removeSignalHandler!=='function')throw Error('Lifecycle signal boundaries must be injected');
  let stopped=false,cancelled=null,cleanup=null,finalized=null;
  const handlers=new Map(),tracked=new Set();
  const lifecycle={
    get stopped(){return stopped;},
    get cancelled(){return cancelled;},
    get finalized(){return finalized!==null;},
    get pendingAcquisitions(){return tracked.size;},
    setCleanup(task){
      if(typeof task!=='function')throw Error('Lifecycle cleanup task required');
      if(finalized)throw Error('Lifecycle cleanup cannot be registered after finalization');
      cleanup=task;
    },
    requestStop(reason){
      if(cancelled)return;
      stopped=true;
      cancelled=reason||'stop requested';
    },
    guard(label='work'){
      if(stopped)throw Error('Run is stopping; refusing late work: '+(label||'work'));
    },
    throwIfStopping(label='work'){
      if(stopped)throw Error('Run is stopping; refusing late work: '+(label||'work'));
    },
    track(work){
      const settled=Promise.resolve(work).then(value=>{tracked.delete(settled);return value;},error=>{tracked.delete(settled);throw error;});
      tracked.add(settled);
      return settled;
    },
    async drain(timeoutMs=drainMs){
      if(!tracked.size)return {pending:0};
      let timer;
      const timeout=new Promise(resolve=>{timer=setTimeout(resolve,timeoutMs);});
      await Promise.race([Promise.allSettled([...tracked]),timeout]);
      clearTimeout(timer);
      return {pending:tracked.size};
    },
    attach(){
      if(handlers.size)return;
      for(const signal of signals){
        const handler=()=>{lifecycle.requestStop(signal);lifecycle.finalize();};
        handlers.set(signal,handler);
        addSignalHandler(signal,handler);
      }
    },
    detach(){
      for(const [signal,handler] of handlers)removeSignalHandler(signal,handler);
      handlers.clear();
    },
    finalize(){
      if(!finalized)finalized=(async()=>{
        stopped=true;
        // In-flight owned acquisitions settle (bounded) before cleanup so no
        // deletion races unfinished owned work.
        await lifecycle.drain();
        const errors=cleanup?await cleanup():[];
        lifecycle.detach();
        return {errors,cancelled};
      })();
      return finalized;
    },
  };
  return lifecycle;
}
// The real finalization path: release owned resources, then persist the receipt
// and set the exit code so cancellation can never be lost across final receipt
// I/O. Signal handlers stay installed until EVERY awaited write has completed:
// after each write the cancel state is re-read and rewritten when it changed,
// then handlers detach and the exit code is set synchronously — there is no
// later asynchronous success write. Cancellation transitions once, so the
// bounded rewrite loop terminates.
export async function finalizeRunReceipt({lifecycle,receipt,failures=[],release,write,setExitCode,now=()=>Date.now()}){
  if(!lifecycle||typeof write!=='function')throw Error('Final receipt requires the run lifecycle and a receipt writer');
  const cleanupErrors=[...((await (typeof release==='function'?release():[]))||[])];
  if(lifecycle.pendingAcquisitions)cleanupErrors.push('owned acquisitions unresolved after bounded drain: '+lifecycle.pendingAcquisitions);
  const compose=cancelled=>{
    const status=finalRunStatus({failures,receiptErrors:receipt.errors||[],cleanupErrors,cancelled,runError:receipt.failure||null});
    receipt.result=status.result;
    receipt.cancelled=cancelled;
    receipt.cleanupErrors=cleanupErrors;
    receipt.finishedAt=new Date(now()).toISOString();
    receipt.backgroundFailures=failures;
    return status;
  };
  let status;
  while(true){
    const seen=lifecycle.cancelled;
    status=compose(seen);
    await write(receipt);
    if(lifecycle.cancelled===seen)break;
  }
  lifecycle.detach();
  if(typeof setExitCode==='function')setExitCode(status.exitCode);
  return status;
}

// --- launch facts ----------------------------------------------------------
export function verifyLaunchFacts({returned,readback}){
  for(const key of ['pid','avdName','avdPath','serial','forwardPort','reversePort']){
    if(returned[key]!==readback[key])throw Error('Owned launch readback mismatch for '+key);
  }
  if(!readback.pidAlive)throw Error('Owned emulator process is not alive after launch readback');
  if(!readback.devicesConfirmed)throw Error('Owned serial is not confirmed in adb devices after launch readback');
}
export function parseAttachedDevices(devicesOutput){
  return String(devicesOutput).split('\n').slice(1).map(line=>line.trim()).filter(Boolean).map(line=>{
    const [serial,state]=line.split(/\s+/);
    return state?{serial,state}:null;
  }).filter(Boolean);
}

// --- task-owned adapter ----------------------------------------------------
export function createAndroidAdapter({env=process.env,platform=process.platform,exec,spawnProcess,killProcess,fsOps,sleep=async ms=>new Promise(resolve=>setTimeout(resolve,ms)),now=()=>Date.now(),fence,acquireDrainMs=15_000}){
  assertRunnerGuard({env,platform,mode:'android'});
  const runnerTemp=env.RUNNER_TEMP||'';
  assertOwnedStatePaths({env,runnerTemp});
  if(!env.ANDROID_HOME)throw Error('The official SDK root must be provided by the runner');
  // The shared stopping fence is mandatory: a silent default hid missing
  // production wiring and let cancelled acquisitions continue.
  if(!fence||typeof fence.throwIfStopping!=='function')throw Error('Adapter requires the shared stopping fence (throwIfStopping) before any side effect');
  for(const [name,boundary] of [['exec',exec],['spawnProcess',spawnProcess],['killProcess',killProcess]]){
    if(typeof boundary!=='function')throw Error('Adapter boundary '+name+' must be injected');
  }
  for(const name of ['readFile','writeFile','mkdir','rm','exists']){
    if(typeof fsOps?.[name]!=='function')throw Error('Adapter filesystem boundary '+name+' must be injected');
  }
  const paths=ownedStatePaths({runnerTemp});
  const emulatorPort=chooseEmulatorPort({runId:env.GITHUB_RUN_ID});
  const serial=ownedSerial(emulatorPort);
  const adbBin=path.join(env.ANDROID_HOME,'platform-tools','adb');
  const avdmanagerBin=path.join(env.ANDROID_HOME,'cmdline-tools','latest','bin','avdmanager');
  const emulatorBin=path.join(env.ANDROID_HOME,'emulator','emulator');
  const avdPath=path.join(paths.androidAvdHome,AVD_NAME+'.avd');
  const flagFile=path.join(paths.stateDir,'chrome-command-line');
  const state={pid:null,handle:null,forwardPort:null,reversePort:null,booted:false,cleanedUp:false};
  // Shared stopping fence through every await boundary plus tracked in-flight
  // acquisitions: cancellation can never spawn late owned resources, and state
  // is only deleted after owned work settles (bounded).
  const trackedAcquisitions=new Set();
  const acquire=async(label,operation)=>{
    fence.throwIfStopping(label);
    const work=Promise.resolve().then(()=>{fence.throwIfStopping(label);return operation();});
    const settled=work.then(value=>{trackedAcquisitions.delete(settled);return value;},error=>{trackedAcquisitions.delete(settled);throw error;});
    trackedAcquisitions.add(settled);
    return settled;
  };
  const drainAcquisitions=async()=>{
    if(!trackedAcquisitions.size)return {pending:0};
    let timer;
    const timeout=new Promise(resolve=>{timer=setTimeout(resolve,acquireDrainMs);});
    await Promise.race([Promise.allSettled([...trackedAcquisitions]),timeout]);
    clearTimeout(timer);
    return {pending:trackedAcquisitions.size};
  };

  // Global adb is limited to read-only inventory; everything else is forced
  // onto the owned serial through buildAdbArgs.
  const adbGlobal=(command,args=[])=>{
    const allowed=(command==='devices'||command==='version')||(args[0]==='--list'&&['forward','reverse'].includes(command));
    if(!allowed)throw Error('Global adb is limited to read-only inventory: '+[command,...args].join(' '));
    return String(exec(adbBin,[command,...args]));
  };
  const adb=(command,args=[])=>String(exec(adbBin,buildAdbArgs(serial,command,args,{ownedPort:emulatorPort})));
  const adbBinary=(command,args=[])=>exec(adbBin,buildAdbArgs(serial,command,args,{ownedPort:emulatorPort}),{binary:true});
  const waitUntil=async(operation,label,timeoutMs)=>{
    const deadline=now()+timeoutMs;
    let last;
    while(now()<deadline){
      fence.throwIfStopping(label);
      try{const value=await operation();if(value)return value;}catch(error){last=error;}
      await sleep(1000);
    }
    throw Error('Timed out: '+label+(last?' ('+last.message+')':''));
  };

  return {
    statePaths:paths,
    emulatorPort,
    serial,
    jobFacts(){
      return {
        taskId:ANDROID_TASK_ID,
        runId:env.GITHUB_RUN_ID,
        runAttempt:env.GITHUB_RUN_ATTEMPT,
        repository:env.GITHUB_REPOSITORY,
        workflow:env.GITHUB_WORKFLOW,
        emulatorPort,
        serial,
        avdName:AVD_NAME,
      };
    },
    boot(){return acquire('AVD launch',async()=>{
      const attached=parseAttachedDevices(adbGlobal('devices'));
      if(attached.length)throw Error('Preexisting adb devices must not exist before the task-owned AVD boots: '+attached.map(device=>device.serial).join(', '));
      const profile=selectPhoneProfile(String(exec(avdmanagerBin,['list','device'])));
      await fsOps.mkdir(paths.androidUserHome,{recursive:true});
      fence.throwIfStopping('AVD user home creation');
      await fsOps.mkdir(paths.androidAvdHome,{recursive:true});
      fence.throwIfStopping('AVD state creation');
      exec(avdmanagerBin,['create','avd','--force','-n',AVD_NAME,'-k',ANDROID_IMAGE_PACKAGE,'-d',profile.id],{input:'no\n'});
      // Pin the reviewed 2048MiB AVD memory explicitly in the owned AVD config.
      const configPath=path.join(avdPath,'config.ini');
      const config=String(await fsOps.readFile(configPath,'utf8'));
      fence.throwIfStopping('AVD configuration');
      const pinned=/^hw\.ramSize=/m.test(config)?config.replace(/^hw\.ramSize=.*$/m,'hw.ramSize=2048'):config+(/\n$/.test(config)?'':'\n')+'hw.ramSize=2048\n';
      if(pinned!==config){await fsOps.writeFile(configPath,pinned);fence.throwIfStopping('AVD configuration write');}
      fence.throwIfStopping('AVD launch');
      const handle=spawnProcess(emulatorBin,['-avd',AVD_NAME,'-port',String(emulatorPort),'-no-window','-no-audio','-camera-back','none','-camera-front','none','-no-boot-anim','-no-snapshot','-gpu','swiftshader_indirect'],{env:{...env,ANDROID_USER_HOME:paths.androidUserHome,ANDROID_AVD_HOME:paths.androidAvdHome},stdio:['ignore','ignore','pipe']});
      if(!Number.isInteger(handle?.pid))throw Error('Owned emulator process must expose its PID');
      state.handle=handle;state.pid=handle.pid;
      let exited=false;
      handle.on?.('exit',()=>{exited=true;state.exited=true;});
      const deadline=now()+BOOT_TIMEOUT_MS;
      let last;
      while(now()<deadline){
        fence.throwIfStopping('AVD boot poll');
        if(exited)throw Error('Owned emulator process exited before boot completed');
        try{
          if(adb('shell',['getprop','sys.boot_completed']).trim()==='1'){state.booted=true;return {pid:state.pid,avdName:AVD_NAME,avdPath,serial,emulatorPort};}
        }catch(error){last=error;}
        await sleep(2000);
      }
      throw Error('Timed out waiting for the owned AVD boot'+(last?' ('+last.message+')':''));
    });},
    setupChrome({serverPort}){return acquire('stock Chrome setup',async()=>{
      if(!state.booted)throw Error('Chrome setup requires the task-owned AVD boot');
      if(!Number.isInteger(serverPort)||serverPort<1||serverPort>65535)throw Error('Owned loopback server port is required');
      adb('shell',['am','set-debug-app','--persistent',CHROME_PACKAGE]);
      // Reviewed flag file per Chromium argv semantics: program-name placeholder
      // then the one allowed switch (First Run Experience only).
      const content=[CHROME_PROGRAM_NAME,...SETUP_CHROME_FLAGS].join(' ')+'\n';
      const flags=validateChromeCommandLineFlags(content).switches;
      await fsOps.mkdir(paths.stateDir,{recursive:true});
      fence.throwIfStopping('stock Chrome flag state');
      await fsOps.writeFile(flagFile,content);
      fence.throwIfStopping('stock Chrome flag file');
      adb('push',[flagFile,CHROME_COMMAND_LINE_PATH]);
      adb('shell',['am','force-stop',CHROME_PACKAGE]);
      adb('shell',['am','start','-n',CHROME_PACKAGE+'/com.google.android.apps.chrome.Main']);
      const chromePid=await waitUntil(()=>{
        const value=adb('shell',['pidof',CHROME_PACKAGE]).trim().split(/\s+/)[0];
        return /^\d+$/.test(value)?value:null;
      },'owned stock Chrome process',CHROME_TIMEOUT_MS);
      // Each owned mapping is registered the moment it exists so every partial
      // failure path removes exactly what was created.
      fence.throwIfStopping('devtools forward mapping');
      const forwardPort=parseForwardPort(adb('forward',['tcp:0',DEVTOOLS_SOCKET]));
      state.forwardPort=forwardPort;
      fence.throwIfStopping('owned reverse mapping');
      adb('reverse',['tcp:'+serverPort,'tcp:'+serverPort]);
      state.reversePort=serverPort;
      const forwards=adbGlobal('forward',['--list']);
      const reverses=adb('reverse',['--list']);
      if(!findForwardMapping(forwards,{serial,forwardPort,socket:DEVTOOLS_SOCKET}))throw Error('Owned adb forward mapping readback mismatch');
      if(!findReverseMapping(reverses,{serverPort}))throw Error('Owned adb reverse mapping readback mismatch: '+JSON.stringify({serverPort,listing:reverses.slice(0,2048)}));
      return {serial,forwardPort,reversePort:serverPort,chromePid:Number(chromePid),debugApp:true,flags,flagFile:CHROME_COMMAND_LINE_PATH};
    });},
    async readbackLaunchFacts(){
      const devices=parseAttachedDevices(adbGlobal('devices')).map(device=>device.serial);
      const forwards=parseForwardMappings(adbGlobal('forward',['--list']));
      const reverses=parseReverseMappings(adb('reverse',['--list']));
      let pidAlive=false;
      if(state.pid!=null){try{pidAlive=String(exec('ps',['-p',String(state.pid),'-o','pid='])).trim().length>0;}catch{pidAlive=false;}}
      return {
        pid:state.pid,
        avdName:AVD_NAME,
        avdPath,
        serial,
        forwardPort:forwards.find(entry=>entry.serial===serial)?.port??null,
        reversePort:reverses[0]?.localPort??null,
        pidAlive,
        devicesConfirmed:devices.includes(serial),
      };
    },
    async imageFacts(){
      const sourcePropertiesPath=path.join(env.ANDROID_HOME,'system-images','android-34','google_apis_playstore','x86_64','source.properties');
      const text=String(await fsOps.readFile(sourcePropertiesPath,'utf8'));
      const revision=Number(/Pkg\.Revision=(\d+)/.exec(text)?.[1]);
      if(!Number.isInteger(revision)||revision<1)throw Error('Official system image package revision must be readable from source.properties');
      return {package:ANDROID_IMAGE_PACKAGE,revision,sourcePropertiesPath};
    },
    async deviceFacts(){
      const prop=name=>adb('shell',['getprop',name]).trim();
      return {fingerprint:prop('ro.build.fingerprint'),api:Number(prop('ro.build.version.sdk')),release:prop('ro.build.version.release'),abi:prop('ro.product.cpu.abi')};
    },
    async wmFacts(){
      const size=/Physical size:\s*(\d+x\d+)/.exec(adb('shell',['wm','size']))?.[1]||null;
      const density=Number(/Physical density:\s*(\d+)/.exec(adb('shell',['wm','density']))?.[1]);
      return {size,density};
    },
    async chromeFacts(){
      const apkPath=adb('shell',['pm','path',CHROME_PACKAGE]).trim().split('\n').map(line=>line.replace(/^package:/,'').trim()).filter(Boolean)[0]||null;
      const dump=adb('shell',['dumpsys','package',CHROME_PACKAGE]);
      return {
        package:CHROME_PACKAGE,
        apkPath,
        versionName:/versionName=([^\s]+)/.exec(dump)?.[1]||null,
        versionCode:/versionCode=(\d+)/.exec(dump)?.[1]||null,
      };
    },
    async versions(){
      return {
        adb:adbGlobal('version').trim(),
        emulator:String(exec(emulatorBin,['-version'])).split('\n').slice(0,2).join('\n').trim(),
        kvm:{devicePresent:await fsOps.exists('/dev/kvm')},
      };
    },
    async nativeState(){
      const dumpsys=adb('shell',['dumpsys','activity','activities']);
      const raw=adb('shell',['uiautomator','dump','/dev/tty']);
      const start=raw.indexOf('<hierarchy');
      return {dumpsys,uiautomatorXml:start>=0?raw.slice(start):''};
    },
    async screencap(){return adbBinary('exec-out',['screencap','-p']);},
    // Cleanup touches only owned mappings, the owned serial/process and the
    // task-owned state directories. No global kill, wipe or delete. A kill
    // request is not process exit: state is removed only after bounded exit
    // proof on the owned child, with owned-PID fallback signals if needed.
    async cleanup(){
      // In-flight owned acquisitions settle first (bounded); state is never
      // deleted while owned work is still running.
      const drained=await drainAcquisitions();
      const ownedExited=()=>state.exited||state.handle?.exitCode!=null;
      const awaitOwnedExit=async timeoutMs=>{
        const deadline=now()+timeoutMs;
        while(!ownedExited()){
          if(now()>=deadline)return false;
          await sleep(250);
        }
        return true;
      };
      if(state.cleanedUp)return {errors:[],exited:!state.pid||ownedExited()};
      state.cleanedUp=true;
      const errors=[];
      const step=async(label,operation)=>{try{await operation();}catch(error){errors.push(label+': '+error.message);}};
      if(state.reversePort)await step('owned reverse mapping',()=>adb('reverse',['--remove','tcp:'+state.reversePort]));
      if(state.forwardPort)await step('owned forward mapping',()=>adb('forward',['--remove','tcp:'+state.forwardPort]));
      if(state.pid){
        await step('owned serial shutdown',()=>adb('emu',['kill']));
        let exited=await awaitOwnedExit(EXIT_PROOF_WAIT_MS);
        if(!exited){await step('owned emulator SIGTERM',()=>killProcess(state.pid,'SIGTERM'));exited=await awaitOwnedExit(EXIT_PROOF_WAIT_MS);}
        if(!exited){await step('owned emulator SIGKILL',()=>killProcess(state.pid,'SIGKILL'));exited=await awaitOwnedExit(EXIT_PROOF_WAIT_MS);}
        if(!exited)errors.push('owned emulator exit proof failed: pid '+state.pid+' still running after bounded waits');
      }
      const exited=!state.pid||ownedExited();
      if(drained.pending){
        errors.push('owned state kept on disk: in-flight owned acquisition never settled');
        return {errors,exited:false};
      }
      if(exited){
        await step('owned android user home',()=>fsOps.rm(paths.androidUserHome,{recursive:true,force:true}));
        await step('owned android avd home',()=>fsOps.rm(paths.androidAvdHome,{recursive:true,force:true}));
      }else{
        errors.push('owned state kept on disk: owned emulator process still running');
      }
      return {errors,exited};
    },
  };
}

// Workflow CLI: verify the currently served official manifest against the
// pinned preparation facts before any SDK provisioning happens.
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const [command]=process.argv.slice(2);
  assertRunnerGuard({env:process.env,platform:process.platform,mode:'android'});
  if(command==='verify-system-image-manifest'){
    const response=await fetch(SYSTEM_IMAGE_MANIFEST_URL,{signal:AbortSignal.timeout(30_000)});
    if(!response.ok)throw Error('Official system-image manifest HTTP '+response.status);
    console.log(JSON.stringify(verifySystemImageManifest(await response.text())));
  }else{
    throw Error('Usage: node tools/lib/platform-android.mjs verify-system-image-manifest');
  }
}


// --- production assembly and owned acquisitions -----------------------------
// Main assembles the adapter through this helper so the lifecycle stopping
// fence can never be omitted silently; production must fail before any side
// effect when the fence is missing.
export function createProductionAndroidAdapter({lifecycle,...options}={}){
  if(!lifecycle||typeof lifecycle.throwIfStopping!=='function')throw Error('Production Android adapter assembly requires the lifecycle shared stopping fence');
  return createAndroidAdapter({...options,fence:lifecycle});
}
// One shared owned-acquisition helper for main assembly (server, devtools):
// guard before start, track the COMPLETE acquire+adopt-or-dispose chain, and
// never adopt a resource that completed after cancellation. Disposal failures
// and unbounded disposals are recorded, never swallowed, and an unbounded
// disposal can never report success.
export async function acquireOwned({lifecycle,label='owned resource',start,dispose,onError,disposeTimeoutMs=15_000}={}){
  if(!lifecycle||typeof lifecycle.throwIfStopping!=='function'||typeof lifecycle.track!=='function')throw Error('Owned acquisition requires the shared stopping fence and tracker');
  if(typeof start!=='function'||typeof dispose!=='function')throw Error('Owned acquisition requires start and dispose boundaries');
  const recordError=message=>{if(typeof onError==='function')onError(message);};
  lifecycle.throwIfStopping(label);
  const chain=(async()=>{
    const created=await start();
    if(lifecycle.stopped){
      let timer;
      try{
        await Promise.race([
          Promise.resolve().then(()=>dispose(created)),
          new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('owned disposal timed out')),disposeTimeoutMs);}),
        ]);
      }catch(error){recordError('owned disposal failed for '+label+': '+(error?.message||error));}
      finally{clearTimeout(timer);}
      throw Error('Run is stopping; refusing late work: '+label);
    }
    return created;
  })();
  return lifecycle.track(chain);
}
