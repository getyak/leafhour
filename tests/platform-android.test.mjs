// Synthetic unit tests for the task-owned Android typography acceptance adapter.
// No browser, SDK, emulator, ADB server or network is ever started here: every
// side-effect boundary (exec, spawn, kill, filesystem) is injected and recorded.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {
  ANDROID_IMAGE_PACKAGE,
  ANDROID_IMAGE_PINNED,
  CHROME_COMMAND_LINE_PATH,
  SETUP_CHROME_FLAGS,
  parseScriptArgs,
  assertRunnerGuard,
  assertEvidenceOutputDir,
  ownedStatePaths,
  assertOwnedStatePaths,
  chooseEmulatorPort,
  validateEmulatorPort,
  ownedSerial,
  buildAdbArgs,
  parseForwardPort,
  parseForwardMappings,
  parseReverseMappings,
  findForwardMapping,
  findReverseMapping,
  parseChromeCommandLine,
  validateDevtoolsTarget,
  validateChromeCommandLineFlags,
  validateEffectiveChromeCommandLine,
  finalRunStatus,
  createRunLifecycle,
  assertAndroidViewport,
  bindAndroidProductViewport,
  finalizeRunReceipt,
  parseUiHierarchy,
  createProductionAndroidAdapter,
  acquireOwned,
  resolveLanguageEntrance,
  resolveOriginalTitleProbe,
  assessNativeForeground,
  assessFirstRunOverlay,
  planStartupNotificationRejection,
  verifyNativeStartup,
  selectPhoneProfile,
  verifyLaunchFacts,
  verifySystemImageManifest,
  createAndroidAdapter,
} from '../tools/lib/platform-android.mjs';
import {createEvidenceSession,observeNativeScroll,italicFontEvidence,observeDocumentFontFaces} from '../tools/lib/platform-font-observer.mjs';
import vm from 'node:vm';

const RUNNER_TEMP='/tmp/runner/get173-run';
const TEST_FENCE={throwIfStopping(){}};
function baseEnv(extra={}){
  return {
    GITHUB_ACTIONS:'true',
    GITHUB_RUN_ID:'39129031901',
    GITHUB_RUN_ATTEMPT:'1',
    GITHUB_REPOSITORY:'getyak/leafhour',
    GITHUB_WORKFLOW:'Platform typography acceptance',
    RUNNER_TEMP,
    ANDROID_HOME:'/opt/android-sdk',
    ANDROID_USER_HOME:path.join(RUNNER_TEMP,'get173-android','android-user-home'),
    ANDROID_AVD_HOME:path.join(RUNNER_TEMP,'get173-android','android-avd-home'),
    HOME:'/home/runner',
    ...extra,
  };
}
const PORT=chooseEmulatorPort({runId:baseEnv().GITHUB_RUN_ID});
const SERIAL=ownedSerial(PORT);
function boundaries(){
  const record={exec:[],spawn:[],kill:[],fs:[]};
  const exec=(file,args,options={})=>{record.exec.push({file,args:[...args],options});return '';};
  const spawnProcess=(file,args,options={})=>{record.spawn.push({file,args:[...args],options});const handle={pid:4242,exitCode:null,on(){}};record.handle=handle;return handle;};
  const killProcess=(pid,signal)=>{record.kill.push({pid,signal});};
  const fsOps={
    readFile:async target=>{record.fs.push(['readFile',target]);throw Object.assign(Error('ENOENT '+target),{code:'ENOENT'});},
    writeFile:async (target,data)=>{record.fs.push(['writeFile',target,String(data)]);},
    mkdir:async target=>{record.fs.push(['mkdir',target]);},
    rm:async target=>{record.fs.push(['rm',target]);},
    exists:async target=>{record.fs.push(['exists',target]);return false;},
  };
  return {record,exec,spawnProcess,killProcess,fsOps,sleep:async()=>{},now:()=>1_000};
}
const UIAUTOMATOR_CHROME_XML=`<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.android.chrome" content-desc="" checkable="false" checked="false" clickable="false" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[0,0][1080,2340]">
    <node index="0" text="" resource-id="com.android.chrome:id/toolbar" class="android.view.ViewGroup" package="com.android.chrome" content-desc="Address and search bar" clickable="true" enabled="true" focusable="true" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[0,72][1080,168]" />
    <node index="1" text="Leafhour" resource-id="com.android.chrome:id/title" class="android.widget.TextView" package="com.android.chrome" clickable="false" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[24,200][1056,260]" />
    <node index="2" text="" resource-id="com.android.chrome:id/menu_button" class="android.widget.ImageView" package="com.android.chrome" content-desc="More options" clickable="true" enabled="true" focusable="true" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[984,84][1064,156]" />
  </node>
</hierarchy>`;
const UIAUTOMATOR_CHROME_DUMP='UI hierchary dumped to: /dev/tty\n'+UIAUTOMATOR_CHROME_XML;
// Actual anonymous Chrome113 startup hierarchy, run39154653054; only UI setup data.
// SHA256 ca4ae8e7a6560466664688c566edfd19cbc8aec235c42e3e3ecf3b0196f59ad8.
const NOTIFICATION_XML="<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation=\"0\"><node index=\"0\" text=\"\" resource-id=\"\" class=\"android.widget.FrameLayout\" package=\"com.android.chrome\" content-desc=\"\" checkable=\"false\" checked=\"false\" clickable=\"false\" enabled=\"true\" focusable=\"false\" focused=\"false\" scrollable=\"false\" long-clickable=\"false\" password=\"false\" selected=\"false\" bounds=\"[27,576][1053,1834]\"><node index=\"0\" text=\"\" resource-id=\"\" class=\"android.widget.LinearLayout\" package=\"com.android.chrome\" content-desc=\"\" checkable=\"false\" checked=\"false\" clickable=\"false\" enabled=\"true\" focusable=\"false\" focused=\"false\" scrollable=\"false\" long-clickable=\"false\" password=\"false\" selected=\"false\" bounds=\"[27,576][1053,1834]\"><node index=\"0\" text=\"\" resource-id=\"android:id/content\" class=\"android.widget.FrameLayout\" package=\"com.android.chrome\" content-desc=\"\" checkable=\"false\" checked=\"false\" clickable=\"false\" enabled=\"true\" focusable=\"false\" focused=\"false\" scrollable=\"false\" long-clickable=\"false\" password=\"false\" selected=\"false\" bounds=\"[27,576][1053,1834]\"><node index=\"0\" text=\"\" resource-id=\"\" class=\"android.widget.LinearLayout\" package=\"com.android.chrome\" content-desc=\"\" checkable=\"false\" checked=\"false\" clickable=\"false\" enabled=\"true\" focusable=\"false\" focused=\"false\" scrollable=\"false\" long-clickable=\"false\" password=\"false\" selected=\"false\" bounds=\"[27,576][1053,1834]\"><node index=\"0\" text=\"\" resource-id=\"com.android.chrome:id/custom\" class=\"android.widget.FrameLayout\" package=\"com.android.chrome\" content-desc=\"\" checkable=\"false\" checked=\"false\" clickable=\"false\" enabled=\"true\" focusable=\"false\" focused=\"false\" scrollable=\"false\" long-clickable=\"false\" password=\"false\" selected=\"false\" bounds=\"[27,576][1053,1646]\"><node index=\"0\" text=\"\" resource-id=\"\" class=\"android.widget.LinearLayout\" package=\"com.android.chrome\" content-desc=\"\" checkable=\"false\" checked=\"false\" clickable=\"false\" enabled=\"true\" focusable=\"false\" focused=\"false\" scrollable=\"false\" long-clickable=\"false\" password=\"false\" selected=\"false\" bounds=\"[27,576][1053,1646]\"><node index=\"0\" text=\"\" resource-id=\"\" class=\"android.widget.ImageView\" package=\"com.android.chrome\" content-desc=\"\" checkable=\"false\" checked=\"false\" clickable=\"false\" enabled=\"true\" focusable=\"false\" focused=\"false\" scrollable=\"false\" long-clickable=\"false\" password=\"false\" selected=\"false\" bounds=\"[232,631][848,1305]\" /><node index=\"1\" text=\"Chrome notifications make things easier\" resource-id=\"\" class=\"android.widget.TextView\" package=\"com.android.chrome\" content-desc=\"\" checkable=\"false\" checked=\"false\" clickable=\"false\" enabled=\"true\" focusable=\"false\" focused=\"false\" scrollable=\"false\" long-clickable=\"false\" password=\"false\" selected=\"false\" bounds=\"[71,1360][1009,1514]\" /><node index=\"2\" text=\"You’ll be able to easily manage media controls, Incognito sessions, downloads and more\" resource-id=\"\" class=\"android.widget.TextView\" package=\"com.android.chrome\" content-desc=\"\" checkable=\"false\" checked=\"false\" clickable=\"false\" enabled=\"true\" focusable=\"false\" focused=\"false\" scrollable=\"false\" long-clickable=\"false\" password=\"false\" selected=\"false\" bounds=\"[71,1547][1009,1646]\" /></node></node><node index=\"1\" text=\"\" resource-id=\"com.android.chrome:id/button_bar\" class=\"android.view.ViewGroup\" package=\"com.android.chrome\" content-desc=\"\" checkable=\"false\" checked=\"false\" clickable=\"false\" enabled=\"true\" focusable=\"false\" focused=\"false\" scrollable=\"false\" long-clickable=\"false\" password=\"false\" selected=\"false\" bounds=\"[27,1646][1053,1834]\"><node index=\"0\" text=\"No thanks\" resource-id=\"com.android.chrome:id/negative_button\" class=\"android.widget.Button\" package=\"com.android.chrome\" content-desc=\"\" checkable=\"false\" checked=\"false\" clickable=\"true\" enabled=\"true\" focusable=\"true\" focused=\"false\" scrollable=\"false\" long-clickable=\"false\" password=\"false\" selected=\"false\" bounds=\"[457,1674][699,1806]\" /><node index=\"1\" text=\"Continue\" resource-id=\"com.android.chrome:id/positive_button\" class=\"android.widget.Button\" package=\"com.android.chrome\" content-desc=\"\" checkable=\"false\" checked=\"false\" clickable=\"true\" enabled=\"true\" focusable=\"true\" focused=\"false\" scrollable=\"false\" long-clickable=\"false\" password=\"false\" selected=\"false\" bounds=\"[721,1674][1009,1806]\" /></node></node></node></node></node></hierarchy>";
function happyRouter(file,args){
  const base=file.split('/').pop(),joined=args.join(' ');
  if(base==='avdmanager'){
    if(args.includes('device'))return 'id: 21 or "pixel_6"\n    Name: Pixel 6\n    OEM : Google\n    Tag : google_apis\n---------\nid: 14 or "pixel_5"\n    Name: Pixel 5\n    OEM : Google\n    Tag : google_apis\n---------\n';
    return '';
  }
  if(base==='emulator')return args.includes('-version')?'Android emulator version 35.6.10.0 (build_id: 13018748)\n':'';
  if(base!=='adb')return '';
  if(args[0]==='devices')return 'List of devices attached\n\n';
  if(args[0]==='version')return 'Android Debug Bridge version 1.0.41\nVersion 36.0.0\n';
  if(args[0]==='forward'&&args[1]==='--list')return SERIAL+' tcp:54321 localabstract:chrome_devtools_remote\n';
  // Device-side fixture uses the newer placeholder. A separate production
  // regression covers API34's observed daemon transport label host-23.
  if(joined.includes('reverse --list'))return '(reverse) tcp:43210 tcp:43210\n';
  if(joined.includes('getprop sys.boot_completed'))return '1\n';
  if(joined.includes('ro.build.fingerprint'))return 'google/sdk_gphone64_x86_64/emu64x:14/UE1A.230829.036/11228894:user/release-keys\n';
  if(joined.includes('ro.build.version.sdk'))return '34\n';
  if(joined.includes('ro.build.version.release'))return '14\n';
  if(joined.includes('ro.product.cpu.abi'))return 'x86_64\n';
  if(joined.includes('wm size'))return 'Physical size: 1080x2340\n';
  if(joined.includes('wm density'))return 'Physical density: 440\n';
  if(joined.includes('pidof'))return '4242\n';
  if(joined.includes('forward tcp:0'))return '54321\n';
  if(joined.includes('pm path'))return 'package:/product/priv-app/Chrome/Chrome.apk\n';
  if(joined.includes('dumpsys package'))return '    versionName=155.0.8059.39\n    versionCode=805903933\n';
  if(joined.includes('dumpsys activity'))return '  topResumedActivity=ActivityRecord{1 u0 com.android.chrome/com.google.android.apps.chrome.Main t12}\n';
  if(joined.includes('uiautomator'))return UIAUTOMATOR_CHROME_DUMP;
  if(joined.includes('shell cat /data/local/tmp/get173-'))return UIAUTOMATOR_CHROME_XML;
  if(args.includes('exec-out'))return Buffer.from([0x89,0x50,0x4e,0x47]);
  return '';
}
function makeAdapter(overrides={}){
  const harness=boundaries();
  const adapter=createAndroidAdapter({
    env:baseEnv(overrides.env||{}),
    platform:overrides.platform||'linux',
    exec:overrides.exec||harness.exec,
    spawnProcess:overrides.spawnProcess||harness.spawnProcess,
    killProcess:overrides.killProcess||harness.killProcess,
    fsOps:overrides.fsOps||harness.fsOps,
    sleep:overrides.sleep||harness.sleep,
    now:overrides.now||harness.now,
    fence:TEST_FENCE,
  });
  return {adapter,harness};
}
const recRouter=(router)=>{const record={exec:[],spawn:[],kill:[],fs:[]};return {record,exec:(file,args,options={})=>{record.exec.push({file,args:[...args],options});return router(file,args,options);},spawnProcess:(file,args,options={})=>{record.spawn.push({file,args:[...args],options});const handle={pid:4242,exitCode:null,on(event,cb){if(event==='exit')this.__onexit=cb;}};record.handle=handle;return handle;},killProcess:(pid,signal)=>{record.kill.push({pid,signal});if(record.handle)record.handle.exitCode=0;},fsOps:{readFile:async target=>{record.fs.push(['readFile',target]);if(target.endsWith('source.properties'))return 'Pkg.UserSrc=false\nPkg.Revision=14\n';if(target.endsWith('config.ini'))return 'avd.ini.displayname=Pixel 5\nhw.ramSize=1536\n';throw Object.assign(Error('ENOENT '+target),{code:'ENOENT'});},writeFile:async (target,data)=>{record.fs.push(['writeFile',target,String(data)]);},mkdir:async target=>{record.fs.push(['mkdir',target]);},rm:async target=>{record.fs.push(['rm',target]);},exists:async target=>{record.fs.push(['exists',target]);return target==='/dev/kvm';}},sleep:async()=>{},now:(()=>{let clock=0;return()=>{clock+=60_000;return clock;};})()};};

test('runner admission rejects non-runner environments before any side-effect boundary runs',()=>{
  for(const env of [baseEnv({GITHUB_ACTIONS:'false'}),baseEnv({GITHUB_ACTIONS:undefined}),{}]){
    const harness=boundaries();
    assert.throws(()=>createAndroidAdapter({env,platform:'linux',...harness,fence:TEST_FENCE}),/runner/i);
    assert.deepEqual(harness.record.exec,[],'no SDK/ADB probing may happen before admission');
    assert.deepEqual(harness.record.spawn,[],'no process may start before admission');
    assert.deepEqual(harness.record.fs,[],'no output or state file may be touched before admission');
    assert.deepEqual(harness.record.kill,[]);
  }
});

test('runner admission rejects Mac desktop automation and non-Linux Android modes',()=>{
  assert.throws(()=>assertRunnerGuard({env:baseEnv(),platform:'darwin',mode:'desktop'}),/Mac|platform/i);
  assert.throws(()=>assertRunnerGuard({env:baseEnv(),platform:'win32',mode:'android'}),/Linux/i);
  assert.throws(()=>assertRunnerGuard({env:{},platform:'linux',mode:'android'}),/runner/i);
  assert.equal(assertRunnerGuard({env:baseEnv(),platform:'linux',mode:'desktop'}),undefined);
  assert.equal(assertRunnerGuard({env:baseEnv(),platform:'win32',mode:'desktop'}),undefined);
  assert.equal(assertRunnerGuard({env:baseEnv(),platform:'linux',mode:'android'}),undefined);
});

test('evidence output and Android state must live under the job RUNNER_TEMP',()=>{
  assert.equal(assertEvidenceOutputDir({out:path.join(RUNNER_TEMP,'typography-android'),runnerTemp:RUNNER_TEMP}),path.join(RUNNER_TEMP,'typography-android'));
  assert.throws(()=>assertEvidenceOutputDir({out:'/tmp/other/typography',runnerTemp:RUNNER_TEMP}),/RUNNER_TEMP/);
  assert.throws(()=>assertEvidenceOutputDir({out:path.join(RUNNER_TEMP,'typography'),runnerTemp:''}),/RUNNER_TEMP/);
  assert.throws(()=>assertEvidenceOutputDir({out:RUNNER_TEMP,runnerTemp:RUNNER_TEMP}),/RUNNER_TEMP/);
  const paths=ownedStatePaths({runnerTemp:RUNNER_TEMP});
  assert.deepEqual(paths,{
    stateDir:path.join(RUNNER_TEMP,'get173-android'),
    androidUserHome:path.join(RUNNER_TEMP,'get173-android','android-user-home'),
    androidAvdHome:path.join(RUNNER_TEMP,'get173-android','android-avd-home'),
  });
  assert.equal(assertOwnedStatePaths({env:baseEnv(),runnerTemp:RUNNER_TEMP}),undefined);
  assert.throws(()=>assertOwnedStatePaths({env:baseEnv({ANDROID_AVD_HOME:'/tmp/elsewhere/avd'}),runnerTemp:RUNNER_TEMP}),/RUNNER_TEMP|ANDROID_AVD_HOME/);
  assert.throws(()=>assertOwnedStatePaths({env:baseEnv({ANDROID_USER_HOME:'/home/runner/.android'}),runnerTemp:RUNNER_TEMP}),/HOME|RUNNER_TEMP/);
  assert.throws(()=>assertOwnedStatePaths({env:baseEnv({ANDROID_AVD_HOME:undefined}),runnerTemp:RUNNER_TEMP}),/ANDROID_AVD_HOME/);
});

test('script arguments accept only the owned mode and evidence directory and reject external CDP endpoints',()=>{
  assert.deepEqual(parseScriptArgs(['/tmp/runner/get173-run/typography']),{mode:'desktop',out:'/tmp/runner/get173-run/typography'});
  assert.deepEqual(parseScriptArgs(['--android','/tmp/runner/get173-run/typography-android']),{mode:'android',out:'/tmp/runner/get173-run/typography-android'});
  for(const args of [
    [],
    ['--android'],
    ['/tmp/a','/tmp/b'],
    ['--android','/tmp/a','extra'],
    ['--cdp-endpoint=ws://127.0.0.1:9222'],
    ['--android','--cdp','ws://127.0.0.1:9222'],
    ['--remote-debugging-port=9222'],
  ])assert.throws(()=>parseScriptArgs(args),/argument|endpoint|accept/i,args.join(' ')||'(empty)');
});

test('emulator port and serial ownership are explicit and validated',()=>{
  assert.equal(validateEmulatorPort(5554),5554);
  assert.equal(ownedSerial(5554),'emulator-5554');
  for(const port of [5553,5552,5684,-2,55.5,'5554',null])assert.throws(()=>validateEmulatorPort(port),/port/i,String(port));
  assert.throws(()=>ownedSerial(5682),/port/i);
  const port=chooseEmulatorPort({runId:'39129031901'});
  assert.equal(chooseEmulatorPort({runId:'39129031901'}),port,'the owned port must be deterministic per job');
  assert.equal(port%2,0);assert.ok(port>=5554&&port<=5680);
  assert.notEqual(chooseEmulatorPort({runId:'2'}),chooseEmulatorPort({runId:'3'}),'different jobs must not collide on one port');
  assert.deepEqual(buildAdbArgs('emulator-5554','shell',['getprop'],{ownedPort:5554}),['-s','emulator-5554','shell','getprop']);
  assert.throws(()=>buildAdbArgs('emulator-5556','shell',['getprop'],{ownedPort:5554}),/owned/i);
  assert.throws(()=>buildAdbArgs('S3X12345','shell',['getprop'],{ownedPort:5554}),/serial/i);
  assert.equal(parseForwardPort('54321\n'),54321);
  for(const value of ['','abc','0','70000','54321 54322'])assert.throws(()=>parseForwardPort(value),/port/i,JSON.stringify(value));
});

test('owned devtools endpoints accept only the loopback forward port',()=>{
  assert.equal(validateDevtoolsTarget({host:'127.0.0.1',port:54321,forwardPort:54321}),undefined);
  assert.equal(validateDevtoolsTarget({host:'localhost',port:54321,forwardPort:54321}),undefined);
  assert.throws(()=>validateDevtoolsTarget({host:'127.0.0.1',port:9222,forwardPort:54321}),/owned/i);
  assert.throws(()=>validateDevtoolsTarget({host:'10.0.0.7',port:54321,forwardPort:54321}),/loopback/i);
  assert.throws(()=>validateDevtoolsTarget({host:'example.com',port:54321,forwardPort:54321}),/loopback/i);
});

test('every device adb command targets the owned serial and global adb stays read-only inventory',async()=>{
  const {record,exec,spawnProcess,killProcess,fsOps,sleep,now}=recRouter(happyRouter);
  const adapter=createAndroidAdapter({env:baseEnv(),platform:'linux',exec,spawnProcess,killProcess,fsOps,sleep,now,fence:TEST_FENCE});
  const launched=await adapter.boot();
  const chrome=await adapter.setupChrome({serverPort:43210});
  assert.equal(launched.serial,SERIAL);
  assert.equal(launched.pid,4242);
  assert.equal(chrome.forwardPort,54321);
  assert.equal(chrome.reversePort,43210);
  const adbCalls=record.exec.filter(call=>call.file.endsWith('/adb'));
  const globals=adbCalls.filter(call=>call.args[0]!=='-s');
  for(const call of adbCalls){
    if(call.args[0]==='-s'){
      assert.deepEqual(call.args.slice(0,2),['-s',SERIAL],'adb must always target the owned serial: '+call.args.join(' '));
      continue;
    }
    assert.ok(['devices','version'].includes(call.args[0])||((call.args[0]==='forward'||call.args[0]==='reverse')&&call.args[1]==='--list'),'global adb is read-only inventory: '+call.args.join(' '));
  }
  assert.ok(globals.length>=2,'host-side devices/forward inventory must be read back');
  assert.ok(!globals.some(call=>call.args[0]==='reverse'),'reverse listings are device-side and must use the owned serial');
  for(const forbidden of ['kill-server','disconnect','kill-emulator','-wipe-data','uninstall','erase'])assert.ok(!adbCalls.some(call=>call.args.join(' ').includes(forbidden)),'forbidden global command observed: '+forbidden);
  const spawn=record.spawn[0];
  assert.ok(spawn.file.endsWith('/emulator/emulator'));
  assert.deepEqual(spawn.args,['-avd','get173-api34-playstore','-port',String(PORT),'-no-window','-no-audio','-camera-back','none','-camera-front','none','-no-boot-anim','-no-snapshot','-gpu','swiftshader_indirect']);
  assert.equal(spawn.options.env.ANDROID_AVD_HOME,path.join(RUNNER_TEMP,'get173-android','android-avd-home'));
  const deviceCalls=adbCalls.filter(call=>call.args[0]==='-s');
  assert.ok(deviceCalls.some(call=>call.args.join(' ').includes('set-debug-app --persistent com.android.chrome')));
  assert.ok(deviceCalls.some(call=>call.args.join(' ').includes('force-stop com.android.chrome')));
  assert.ok(deviceCalls.some(call=>call.args.join(' ').includes('am start')));
  assert.ok(deviceCalls.some(call=>call.args.join(' ').includes('forward tcp:0 localabstract:chrome_devtools_remote')));
  assert.ok(deviceCalls.some(call=>call.args.join(' ').includes('reverse tcp:43210 tcp:43210')));
  assert.ok(deviceCalls.some(call=>call.args.join(' ')==='-s '+SERIAL+' reverse --list'),'reverse readback must target the owned serial exactly');
});

test('preexisting adb devices block provisioning before any owned launch',async()=>{
  const {record,exec,spawnProcess,killProcess,fsOps,sleep,now}=recRouter((file,args)=>{
    if(args[0]==='devices')return 'List of devices attached\n0123456789ABCDEF\tdevice\n';
    return happyRouter(file,args);
  });
  const adapter=createAndroidAdapter({env:baseEnv(),platform:'linux',exec,spawnProcess,killProcess,fsOps,sleep,now,fence:TEST_FENCE});
  await assert.rejects(()=>adapter.boot(),/preexisting|device/i);
  assert.deepEqual(record.spawn,[],'no emulator may launch while foreign devices are attached');
  assert.ok(!record.exec.some(call=>call.args.includes('create')),'no AVD may be created while foreign devices are attached');
});

test('Chrome setup pushes exactly the reviewed flag file and verifies effective flags',async()=>{
  const {record,exec,spawnProcess,killProcess,fsOps,sleep,now}=recRouter(happyRouter);
  const adapter=createAndroidAdapter({env:baseEnv(),platform:'linux',exec,spawnProcess,killProcess,fsOps,sleep,now,fence:TEST_FENCE});
  await adapter.boot();
  const chrome=await adapter.setupChrome({serverPort:43210});
  assert.deepEqual(chrome.flags,[...SETUP_CHROME_FLAGS]);
  assert.deepEqual(SETUP_CHROME_FLAGS,['--disable-fre'],'setup may disable First Run Experience only');
  const pushed=record.fs.find(entry=>entry[0]==='writeFile'&&entry[1]===path.join(RUNNER_TEMP,'get173-android','chrome-command-line'));
  assert.ok(pushed,'the reviewed flag file must be written under the task-owned state directory');
  assert.equal(pushed[2],'_ --disable-fre\n','Chromium takes argv[0] as the program name; the reviewed switch must follow a harmless placeholder');
  assert.deepEqual(validateChromeCommandLineFlags(pushed[2]),{argv0:'_',switches:['--disable-fre']});
  assert.ok(record.fs.some(entry=>entry[0]==='writeFile'&&entry[1].endsWith('config.ini')),'the AVD config write stays separate from the reviewed flag file');
  const pushCall=record.exec.find(call=>call.args.join(' ').includes('push'));
  assert.deepEqual(pushCall.args,['-s',SERIAL,'push',pushed[1],CHROME_COMMAND_LINE_PATH]);
  assert.equal(CHROME_COMMAND_LINE_PATH,'/data/local/tmp/chrome-command-line');
  assert.deepEqual(validateChromeCommandLineFlags('_ --disable-fre\n'),{argv0:'_',switches:['--disable-fre']});
  for(const content of [
    '--disable-fre',
    '_ --disable-fre extra',
    '_ unexpected --disable-fre',
    '_ --disable-fre --lang=ja',
    '_ --disable-fre --force-device-scale-factor=2',
    '_ --disable-fre --blink-settings=x',
    '_ --disable-fre --proxy-server=http://127.0.0.1:8080',
    '',
    null,
  ])assert.throws(()=>validateChromeCommandLineFlags(content),/program name|argument|First Run|typography|locale|network|reviewed/i,JSON.stringify(content));
  const effective='/data/app/~~8fK2==/com.android.chrome-1q2w3e==/base.apk --disable-fre --remote-debugging-port=0 --enable-features=X';
  assert.deepEqual(validateEffectiveChromeCommandLine(effective),['--disable-fre']);
  for(const text of [
    '--disable-fre --remote-debugging-port=0',
    '/data/app/base.apk --remote-debugging-port=0',
    '/data/app/base.apk --disable-fre --force-device-scale-factor=2',
    '/data/app/base.apk --disable-fre --lang=ja',
    '/data/app/base.apk --disable-fre --disable-remote-fonts',
    '/data/app/base.apk --disable-fre --user-agent=Desktop',
  ])assert.throws(()=>validateEffectiveChromeCommandLine(text),/effective|typography|locale|First Run|program name/i,JSON.stringify(text));
});

test('native readiness requires stock Chrome foreground and a valid observed hierarchy without FirstRun',()=>{
  const foreground=assessNativeForeground({dumpsysText:'  topResumedActivity=ActivityRecord{1 u0 com.android.chrome/com.google.android.apps.chrome.Main t12}\n'});
  assert.equal(foreground.ok,true);assert.match(foreground.resumed,/com\.android\.chrome/);
  assert.equal(assessNativeForeground({dumpsysText:'  topResumedActivity=ActivityRecord{1 u0 com.google.android.apps.nexuslauncher/.Launcher t3}\n'}).ok,false);
  assert.equal(assessNativeForeground({dumpsysText:''}).ok,false);
  const clean=assessFirstRunOverlay(UIAUTOMATOR_CHROME_XML);
  assert.equal(clean.ok,true);
  assert.deepEqual(clean.markers,[]);
  assert.ok(clean.nodes>=3&&clean.chromeNodes>=3,'visible Chrome UI nodes must actually be observed before claiming no overlay');
  assert.equal(clean.xmlBytes,UIAUTOMATOR_CHROME_XML.length);
  for(const xml of [
    '<hierarchy rotation="0"><node text="Accept &amp; continue" resource-id="com.android.chrome:id/fre_pager" class="android.widget.Button" package="com.android.chrome" clickable="true" enabled="true" focusable="true" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[24,1900][1056,2010]" /></hierarchy>',
    '<hierarchy rotation="0"><node text="Turn on sync" class="android.widget.Button" package="com.android.chrome" clickable="true" enabled="true" focusable="true" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[24,1900][1056,2010]" /></hierarchy>',
    '<hierarchy rotation="0"><node text="" resource-id="com.android.chrome:id/first_run_welcome" class="android.view.ViewGroup" package="com.android.chrome" clickable="false" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[0,0][1080,2340]" /></hierarchy>',
  ]){
    const assessment=assessFirstRunOverlay(xml);
    assert.equal(assessment.ok,false,'FirstRun overlay must fail readiness: '+xml);
    assert.ok(assessment.markers.length>0);
  }
  for(const xml of [
    '',
    'UI hierarchy dump failed',
    '<hierarchy rotation="0"></hierarchy>',
    '<hierarchy rotation="0"><node text="Leafhour" package="com.android.chrome" bounds="[0,0][1080,2340]" />',
    '<node text="Leafhour" package="com.android.chrome" bounds="[0,0][1080,2340]" />',
  ]){
    const assessment=assessFirstRunOverlay(xml);
    assert.equal(assessment.ok,false,'empty, unavailable or malformed hierarchy must fail closed: '+JSON.stringify(xml));
    assert.match(assessment.reason||'',/hierarchy/i);
  }
  const launcher=assessFirstRunOverlay('<hierarchy rotation="0"><node text="Search" class="android.widget.TextView" package="com.google.android.apps.nexuslauncher" clickable="false" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[0,0][1080,2340]" /></hierarchy>');
  assert.equal(launcher.ok,false,'no Chrome UI observation cannot prove a Chrome overlay is absent');
  assert.match(launcher.reason||'',/Chrome/i);
});

test('language entrance and original-title probes follow the actual CSS width',()=>{
  assert.equal(resolveLanguageEntrance({viewportWidth:392,locale:'zh-Hans'}),'.hero-copy .home-language-switch a[hreflang="zh-Hans"]');
  assert.equal(resolveLanguageEntrance({viewportWidth:360,locale:'ja'}),'.hero-copy .home-language-switch a[hreflang="ja"]');
  assert.equal(resolveLanguageEntrance({viewportWidth:1200,locale:'zh-Hant'}),'.home-navigation a[hreflang="zh-Hant"]');
  assert.throws(()=>resolveLanguageEntrance({viewportWidth:0,locale:'ja'}),/width/i);
  assert.throws(()=>resolveLanguageEntrance({viewportWidth:392,locale:'ja" onload="x'}),/locale/i);
  const title='Alice’s Adventures in Wonderland';
  const defaultSelector='#library-books .binding-original';
  const wide=resolveOriginalTitleProbe({viewportWidth:392,titleText:title,nodes:[{selector:defaultSelector,text:title,visible:true}]});
  assert.deepEqual(wide,{kind:'probe',selector:defaultSelector,reason:'default-binding-original-visible'});
  const narrow=resolveOriginalTitleProbe({viewportWidth:360,titleText:title,nodes:[{selector:defaultSelector,text:title,visible:false}]});
  assert.deepEqual(narrow,{kind:'unsupported',reason:'no-visible-same-title-node'});
  const alternate=resolveOriginalTitleProbe({viewportWidth:360,titleText:title,nodes:[
    {selector:defaultSelector,text:title,visible:false},
    {selector:'[data-platform-original-probe="1"]',text:title,visible:true},
    {selector:'[data-platform-original-probe="2"]',text:'爱丽丝漫游奇境',visible:true},
  ]});
  assert.deepEqual(alternate,{kind:'probe',selector:'[data-platform-original-probe="1"]',reason:'visible-same-title-node'});
  const impostor=resolveOriginalTitleProbe({viewportWidth:360,titleText:title,nodes:[
    {selector:defaultSelector,text:title,visible:false},
    {selector:'[data-platform-original-probe="1"]',text:'爱丽丝漫游奇境',visible:true},
  ]});
  assert.deepEqual(impostor,{kind:'unsupported',reason:'no-visible-same-title-node'},'a different title is never a same-title node');
  assert.throws(()=>resolveOriginalTitleProbe({viewportWidth:392,titleText:'',nodes:[]}),/title/i);
});

test('phone device profile selection prefers the official Pixel phone definition',()=>{
  const list='Available devices definitions:\nid: 21 or "pixel_6"\n    Name: Pixel 6\n    OEM : Google\n    Tag : google_apis\n---------\nid: 14 or "pixel_5"\n    Name: Pixel 5\n    OEM : Google\n    Tag : google_apis\n---------\nid: 3 or "tv_1080p"\n    Name: Android TV (1080p)\n    OEM : Google\n    Tag : android-tv\n---------\n';
  assert.deepEqual(selectPhoneProfile(list),{id:'pixel_5',name:'Pixel 5'});
  const withoutPixel5='Available devices definitions:\nid: 21 or "pixel_6"\n    Name: Pixel 6\n    OEM : Google\n    Tag : google_apis\n---------\nid: 3 or "tv_1080p"\n    Name: Android TV (1080p)\n    OEM : Google\n    Tag : android-tv\n---------\n';
  assert.deepEqual(selectPhoneProfile(withoutPixel5),{id:'pixel_6',name:'Pixel 6'});
  assert.throws(()=>selectPhoneProfile('Available devices definitions:\nid: 3 or "tv_1080p"\n    Name: Android TV (1080p)\n    OEM : Google\n---------\n'),/phone/i);
});

test('the owned AVD pins the reviewed 2048MiB RAM inside the task-owned AVD home',async()=>{
  const {record,exec,spawnProcess,killProcess,fsOps,sleep,now}=recRouter(happyRouter);
  const reads=[];
  const adapter=createAndroidAdapter({
    env:baseEnv(),platform:'linux',exec,spawnProcess,killProcess,sleep,now,
    fsOps:{...fsOps,readFile:async target=>{reads.push(target);if(target.endsWith('config.ini'))return 'avd.ini.displayname=Pixel 5\nhw.ramSize=1536\n';return fsOps.readFile(target);}},
    fence:TEST_FENCE,
  });
  await adapter.boot();
  const configPath=path.join(RUNNER_TEMP,'get173-android','android-avd-home','get173-api34-playstore.avd','config.ini');
  assert.ok(reads.includes(configPath),'the AVD configuration must be read from the task-owned AVD home');
  const write=record.fs.find(entry=>entry[0]==='writeFile'&&entry[1]===configPath);
  assert.ok(write,'the AVD configuration must be written back');
  assert.match(write[2],/^hw\.ramSize=2048$/m,'the reviewed 2048MiB AVD memory must be explicit');
  assert.match(write[2],/avd\.ini\.displayname=Pixel 5/,'unrelated AVD configuration must be preserved');
});

test('failed provisioning cleans up only owned processes, mappings and files',async()=>{
  const {record,exec,spawnProcess,killProcess,fsOps,sleep,now}=recRouter((file,args)=>{
    if(args.join(' ').includes('getprop sys.boot_completed'))throw Error('adb: device offline');
    return happyRouter(file,args);
  });
  const adapter=createAndroidAdapter({env:baseEnv(),platform:'linux',exec,spawnProcess,killProcess,fsOps,sleep,now,fence:TEST_FENCE});
  await assert.rejects(()=>adapter.boot(),/boot|offline/i);
  const cleanup=await adapter.cleanup();
  assert.ok(Array.isArray(cleanup.errors),'cleanup reports but never throws');
  assert.deepEqual(record.kill,[{pid:4242,signal:'SIGTERM'}],'only the owned emulator process may be killed');
  assert.ok(record.spawn.length===1,'exactly one owned emulator process is launched');
  const removals=record.fs.filter(entry=>entry[0]==='rm').map(entry=>entry[1]);
  assert.deepEqual(removals.sort(),[
    path.join(RUNNER_TEMP,'get173-android','android-avd-home'),
    path.join(RUNNER_TEMP,'get173-android','android-user-home'),
  ].sort(),'only task-owned state directories may be removed');
  for(const call of record.exec){
    assert.ok(!call.args.join(' ').includes('kill-server'));
    assert.ok(!call.args.join(' ').includes('-wipe-data'));
    if(call.args[0]==='-s')assert.equal(call.args[1],SERIAL);
    if(call.args.join(' ').includes('--remove'))assert.ok(call.args.join(' ').includes(SERIAL));
  }
  const again=await adapter.cleanup();
  assert.deepEqual(again.errors,[],'cleanup is idempotent and issues no second round of commands');
  assert.equal(again.exited,true);
  assert.deepEqual(record.kill,[{pid:4242,signal:'SIGTERM'}]);
});

test('cleanup after a full launch removes only the owned reverse and forward mappings',async()=>{
  const {record,exec,spawnProcess,killProcess,fsOps,sleep,now}=recRouter(happyRouter);
  const adapter=createAndroidAdapter({env:baseEnv(),platform:'linux',exec,spawnProcess,killProcess,fsOps,sleep,now,fence:TEST_FENCE});
  await adapter.boot();
  await adapter.setupChrome({serverPort:43210});
  await adapter.cleanup();
  const removals=record.exec.filter(call=>call.args.includes('--remove')).map(call=>call.args.join(' '));
  assert.deepEqual(removals.sort(),[
    '-s '+SERIAL+' forward --remove tcp:54321',
    '-s '+SERIAL+' reverse --remove tcp:43210',
  ].sort());
  assert.ok(record.exec.some(call=>call.args.join(' ')==='-s '+SERIAL+' emu kill'),'the owned serial is shut down explicitly');
});

test('launch readback must match the owned AVD facts and immutable job facts',async()=>{
  const {adapter}=makeAdapter();
  const returned={pid:4242,avdName:'get173-api34-playstore',avdPath:path.join(RUNNER_TEMP,'get173-android','android-avd-home','get173-api34-playstore.avd'),serial:'emulator-5554',forwardPort:54321,reversePort:43210};
  const readback={...returned,pidAlive:true,devicesConfirmed:true};
  assert.equal(verifyLaunchFacts({returned,readback}),undefined);
  assert.deepEqual(adapter.jobFacts(),{
    taskId:'get173-android',
    runId:'39129031901',
    runAttempt:'1',
    repository:'getyak/leafhour',
    workflow:'Platform typography acceptance',
    emulatorPort:PORT,
    serial:SERIAL,
    avdName:'get173-api34-playstore',
  });
  for(const change of [{forwardPort:9222},{reversePort:1},{serial:'emulator-5556'},{pid:999},{avdName:'other'},{avdPath:'/tmp/other.avd'}]){
    assert.throws(()=>verifyLaunchFacts({returned,readback:{...readback,...change}}),/owned|readback/i,JSON.stringify(change));
  }
  assert.throws(()=>verifyLaunchFacts({returned,readback:{...readback,pidAlive:false}}),/alive|readback/i);
  assert.throws(()=>verifyLaunchFacts({returned,readback:{...readback,devicesConfirmed:false}}),/serial|readback|device/i);
});

test('official system-image manifest must match the pinned package facts',()=>{
  const xml=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sdk:sdk-repository xmlns:sdk="http://schemas.android.com/repository/android/common/02">
  <remotePackage path="system-images;android-34;google_apis_playstore;x86_64">
    <display-name>Google Play</display-name>
    <type-details><api-level>34</api-level><tag><id>google_apis_playstore</id></tag><abi>x86_64</abi></type-details>
    <revision><major>14</major></revision>
    <archives><archive><complete><size>1510752654</size><checksum type="sha1">01d32617fd1937e540faf8731d70cf50e35af854</checksum><url>x86_64-34_r14.zip</url></complete></archive></archives>
  </remotePackage>
</sdk:sdk-repository>`;
  assert.deepEqual(verifySystemImageManifest(xml),{
    path:'system-images;android-34;google_apis_playstore;x86_64',
    revision:14,
    zip:'x86_64-34_r14.zip',
    size:1510752654,
    sha1:'01d32617fd1937e540faf8731d70cf50e35af854',
    pinned:{...ANDROID_IMAGE_PINNED},
  });
  assert.equal(ANDROID_IMAGE_PACKAGE,'system-images;android-34;google_apis_playstore;x86_64');
  assert.deepEqual(ANDROID_IMAGE_PINNED,{revision:14,zip:'x86_64-34_r14.zip',size:1510752654,sha1:'01d32617fd1937e540faf8731d70cf50e35af854'});
  const bumped=xml.replace('<major>14</major>','<major>15</major>').replace('x86_64-34_r14.zip','x86_64-34_r15.zip').replace('1510752654','1510752655');
  assert.throws(()=>verifySystemImageManifest(bumped),/manifest|pinned/i);
  const tampered=xml.replace('01d32617fd1937e540faf8731d70cf50e35af854','11d32617fd1937e540faf8731d70cf50e35af854');
  assert.throws(()=>verifySystemImageManifest(tampered),/manifest|pinned/i);
  assert.throws(()=>verifySystemImageManifest('<?xml version="1.0"?><sdk:sdk-repository xmlns:sdk="http://schemas.android.com/repository/android/common/02"></sdk:sdk-repository>'),/manifest|missing/i);
});

test('image, device, chrome and version facts are read back through the owned serial',async()=>{
  const {record,exec,spawnProcess,killProcess,fsOps,sleep,now}=recRouter(happyRouter);
  const adapter=createAndroidAdapter({env:baseEnv(),platform:'linux',exec,spawnProcess,killProcess,fsOps,sleep,now,fence:TEST_FENCE});
  await adapter.boot();
  assert.deepEqual(await adapter.imageFacts(),{package:ANDROID_IMAGE_PACKAGE,revision:14,sourcePropertiesPath:path.join('/opt/android-sdk','system-images','android-34','google_apis_playstore','x86_64','source.properties')});
  const device=await adapter.deviceFacts();
  assert.deepEqual(device,{fingerprint:'google/sdk_gphone64_x86_64/emu64x:14/UE1A.230829.036/11228894:user/release-keys',api:34,release:'14',abi:'x86_64'});
  assert.deepEqual(await adapter.wmFacts(),{size:'1080x2340',density:440});
  assert.deepEqual(await adapter.chromeFacts(),{package:'com.android.chrome',apkPath:'/product/priv-app/Chrome/Chrome.apk',versionName:'155.0.8059.39',versionCode:'805903933'});
  const versions=await adapter.versions();
  assert.match(versions.adb,/Android Debug Bridge/);
  assert.match(versions.emulator,/Android emulator/);
  assert.deepEqual(versions.kvm,{devicePresent:true});
  assert.equal(record.exec.filter(call=>call.file.endsWith('/adb')&&call.args.join(' ').includes('getprop')).every(call=>call.args[0]==='-s'&&call.args[1]===SERIAL),true);
  const native=await adapter.nativeState();
  assert.match(native.dumpsys,/com\.android\.chrome/);
  assert.match(native.uiautomatorXml,/<hierarchy/);
  const png=await adapter.screencap();
  assert.ok(Buffer.isBuffer(png)&&png.length>0);
});

test('native hierarchy is read from an owned device file when non-PTY dump stdout contains no XML',async()=>{
  const target='/data/local/tmp/get173-'+SERIAL+'-hierarchy.xml';
  const router=(file,args)=>args.includes('uiautomator')?'UI hierchary dumped to: '+target+'\n':happyRouter(file,args);
  const {record,exec,spawnProcess,killProcess,fsOps,sleep,now}=recRouter(router);
  const adapter=createAndroidAdapter({env:baseEnv(),platform:'linux',exec,spawnProcess,killProcess,fsOps,sleep,now,fence:TEST_FENCE});
  await adapter.boot();
  const native=await adapter.nativeState();
  assert.equal(native.uiautomatorXml,UIAUTOMATOR_CHROME_XML,'read the actual file, never a manufactured stdout hierarchy');
  assert.equal(native.uiautomatorPath,target);
  const calls=record.exec.map(call=>call.args.join(' '));
  const remove='-s '+SERIAL+' shell rm -f '+target,dump='-s '+SERIAL+' shell uiautomator dump '+target,read='-s '+SERIAL+' shell cat '+target;
  assert.ok(calls.indexOf(remove)<calls.indexOf(dump)&&calls.indexOf(dump)<calls.indexOf(read),'remove stale own file, dump then read');
  await adapter.cleanup();
  assert.equal(record.exec.filter(call=>call.args.join(' ')===remove).length,2,'cleanup removes exactly the owned capture file');
});

test('failed hierarchy dump still cleans only its registered device file',async()=>{
  const target='/data/local/tmp/get173-'+SERIAL+'-hierarchy.xml';
  const router=(file,args)=>{if(args.includes('uiautomator'))throw Error('dump failed');return happyRouter(file,args);};
  const {record,exec,spawnProcess,killProcess,fsOps,sleep,now}=recRouter(router);
  const adapter=createAndroidAdapter({env:baseEnv(),platform:'linux',exec,spawnProcess,killProcess,fsOps,sleep,now,fence:TEST_FENCE});
  await adapter.boot();await assert.rejects(adapter.nativeState(),/dump failed/);await adapter.cleanup();
  const deletes=record.exec.filter(call=>call.args.includes('rm'));
  assert.equal(deletes.length,2);assert.ok(deletes.every(call=>call.args.join(' ')==='-s '+SERIAL+' shell rm -f '+target));
});

test('native startup gate rejects notification rationale, unknown native dialogs and OS permission UI',()=>{
  assert.equal(assessFirstRunOverlay(NOTIFICATION_XML).ok,false);
  assert.equal(assessFirstRunOverlay('<hierarchy><node package="com.android.chrome" resource-id="com.android.chrome:id/modal_dialog"/></hierarchy>').ok,false);
  assert.equal(assessFirstRunOverlay('<hierarchy><node package="com.android.chrome"/><node package="com.google.android.permissioncontroller"/></hierarchy>').ok,false);
});

test('startup rejection is limited to the complete known native notification prompt and unique safe negative button',()=>{
  const args={xml:NOTIFICATION_XML,foreground:{ok:true},size:'1080x2340'};
  assert.deepEqual(planStartupNotificationRejection(args),{resourceId:'com.android.chrome:id/negative_button',text:'No thanks',bounds:'[457,1674][699,1806]',x:578,y:1740});
  for(const xml of [NOTIFICATION_XML.replace('Chrome notifications make things easier','Unknown title'),NOTIFICATION_XML.replace('No thanks','Continue'),NOTIFICATION_XML.replace('clickable="true"','clickable="false"'),NOTIFICATION_XML.replace('[699,1806]','[1200,1806]'),NOTIFICATION_XML.replace('</hierarchy>',NOTIFICATION_XML.match(/<node[^>]+negative_button[^>]+\/>/)[0]+'</hierarchy>')])assert.equal(planStartupNotificationRejection({...args,xml}),null);
  assert.equal(planStartupNotificationRejection({...args,foreground:{ok:false}}),null);
});

test('production startup rejection uses fresh native bounds on the owned serial and never the positive action',async()=>{
  const router=(file,args)=>args.join(' ').includes('shell cat /data/local/tmp/get173-')?NOTIFICATION_XML:happyRouter(file,args);
  const {record,exec,spawnProcess,killProcess,fsOps,sleep,now}=recRouter(router);
  const adapter=createAndroidAdapter({env:baseEnv(),platform:'linux',exec,spawnProcess,killProcess,fsOps,sleep,now,fence:TEST_FENCE});
  await adapter.boot();const result=await adapter.rejectStartupNotification({recordBefore:before=>{assert.equal(before.uiautomatorXml,NOTIFICATION_XML);assert.equal(record.exec.some(call=>call.args.includes("input")),false);}});assert.equal(result.performed,true);
  assert.deepEqual(record.exec.filter(call=>call.args.includes('input')).map(call=>call.args),[['-s',SERIAL,'shell','input','tap','578','1740']]);
  await adapter.cleanup();
});

test('known rationale never authorizes a tap through another native overlay or an unrelated button',()=>{
  const args={foreground:{ok:true},size:'1080x2340'};
  for(const extra of ['<node package="com.google.android.permissioncontroller"/>','<node package="com.android.chrome" resource-id="com.android.chrome:id/unknown_dialog"/>','<node package="com.android.chrome" resource-id="com.android.chrome:id/fre_welcome"/>']){
    const xml=NOTIFICATION_XML.replace('</hierarchy>',extra+'</hierarchy>');
    assert.equal(assessFirstRunOverlay(xml).ok,false);
    assert.equal(planStartupNotificationRejection({...args,xml}),null);
  }
  const button=NOTIFICATION_XML.match(/<node[^>]+negative_button[^>]+\/>/)[0];
  const xml=NOTIFICATION_XML.replace(button,'').replace('</hierarchy>',button+'</hierarchy>');
  assert.equal(planStartupNotificationRejection({...args,xml}),null,'same label outside the rationale container is unrelated');
});

test('actual notification structure rejects extra overlapping controls and FRE markers before a production tap',async()=>{
  const extra='<node package="com.android.chrome" resource-id="" class="android.widget.Button" text="Continue" clickable="true" enabled="true" bounds="[457,1674][699,1806]"/>';
  const xmls=[NOTIFICATION_XML.replace(/(<node[^>]*class="android.widget.ImageView"[^>]*content-desc=")"/,'$1first_run_welcome"'),NOTIFICATION_XML.replace('</node></node></node></node></node></hierarchy>',extra+'</node></node></node></node></node></hierarchy>')];
  assert.notEqual(xmls[0],NOTIFICATION_XML,'fixture must actually mutate the existing ImageView content-desc');
  assert.notEqual(xmls[1],NOTIFICATION_XML,'fixture must actually add the unknown overlapping button');
  xmls.push(NOTIFICATION_XML.replace('[721,1674][1009,1806]','[457,1674][699,1806]'));
  for(const xml of xmls){
    const h=recRouter((file,args)=>args.join(' ').includes('shell cat /data/local/tmp/get173-')?xml:happyRouter(file,args));
    const adapter=createAndroidAdapter({env:baseEnv(),platform:'linux',...h,fence:TEST_FENCE});await adapter.boot();
    const result=await adapter.rejectStartupNotification({recordBefore(){}});
    assert.equal(result.performed,false);assert.equal(h.record.exec.filter(call=>call.args.includes('input')).length,0);
    await adapter.cleanup();
  }
});

test('production negative action is forbidden until complete bounded evidence is recorded',async()=>{
  for(const mode of ['oversize','receipt-full','missing-callback']){
    const xml=mode==='oversize'?NOTIFICATION_XML.replace('</hierarchy>','<node package="com.android.chrome" text="'+'x'.repeat(65536)+'"/></hierarchy>'):NOTIFICATION_XML;
    const h=recRouter((file,args)=>args.join(' ').includes('shell cat /data/local/tmp/get173-')?xml:happyRouter(file,args));
    const adapter=createAndroidAdapter({env:baseEnv(),platform:'linux',...h,fence:TEST_FENCE});
    await adapter.boot();
    await assert.rejects(()=>adapter.rejectStartupNotification(mode==='missing-callback'?{}:{recordBefore:()=>{throw Error('complete bounded XML budget exhausted');}}),/evidence|budget/i);
    assert.equal(h.record.exec.filter(call=>call.args.includes('input')).length,0,mode+' must not tap');
    await adapter.cleanup();
  }
});

test('actual startup orchestration retains an after system image on failure and stops capture on cancellation',async()=>{
  for(const cancelled of [false,true]){
    const screenshots=[],receipt={},lifecycle={cancelled:null,stopped:false,track:value=>value,guard(){if(this.stopped)throw Error('stopping');}};
    const snapshot={uiautomatorXml:NOTIFICATION_XML,dumpsys:'topResumedActivity=com.android.chrome/Main'};
    const adapter={nativeState:async()=>snapshot,screencap:async()=>Buffer.from('actual-injected-system-image'),rejectStartupNotification:async({recordBefore})=>{await recordBefore(snapshot);return {performed:true};}};
    await assert.rejects(()=>verifyNativeStartup({lifecycle,adapter,receipt,recordNative(){},capture:async name=>screenshots.push(name),readInternal:async()=>'chrome://version',waitForClear:async check=>{await check();if(cancelled){lifecycle.cancelled='SIGTERM';lifecycle.stopped=true;}throw Error('strict-clear timeout');}}),/strict-clear timeout/);
    assert.deepEqual(screenshots,cancelled?['android-native-startup']:['android-native-startup','android-native-version']);
    if(cancelled)assert.match(receipt.nativeAfterCaptureSkipped,/SIGTERM/);
  }
});

test('cancelled startup admission performs zero device or evidence operations',async()=>{
  const calls=[],lifecycle={cancelled:'SIGTERM',stopped:true,guard(){throw Error('stopping: SIGTERM');}};
  const forbidden=async()=>{calls.push('unexpected operation');};
  await assert.rejects(()=>verifyNativeStartup({lifecycle,adapter:{screencap:forbidden,nativeState:forbidden,rejectStartupNotification:forbidden},capture:forbidden,recordNative:forbidden,readInternal:forbidden,waitForClear:forbidden,receipt:{}}),/SIGTERM/);
  assert.deepEqual(calls,[]);
});

function fontLayoutScenario({alwaysInvisible=false,cold=false}={}){
  let positioned=false,visible=false;
  const receipt={checks:[]},calls=[];
  const cdp={async evaluate(expression){
    if(expression==='document.fonts.ready.then(()=>true)'){assert.equal(cold,false,'withheld-font probe must not wait on the held request');calls.push('ready');if(positioned)visible=false;return true;}
    if(expression.includes('scrollIntoView')){calls.push('scroll');positioned=true;visible=true;return {status:'settled'};}
    if(expression.includes('getComputedStyle'))return {text:'synthetic title',rect:{x:0,y:alwaysInvisible?1200:visible?100:1200,width:200,height:40},viewport:{width:393,height:722,scrollY:100,fontStatus:'loaded'},visible:visible&&!alwaysInvisible};
    throw Error('Unexpected synthetic observation');
  },async send(method){if(method==='DOM.getDocument')return {root:{nodeId:1}};if(method==='DOM.querySelector')return {nodeId:2};if(method==='CSS.getPlatformFontsForNode')return {fonts:[]};throw Error(method);}};
  return {receipt,calls,session:createEvidenceSession({cdp,out:'/synthetic-unused',receipt,root:'/synthetic-unused',origin:'http://127.0.0.1',failures:[]})};
}

async function nativeScrollModel({mode='delayed',padding=0,initialOffset=0}={}){
  let now=0,offset=initialOffset,innerOffset=350,nextId=0,requests=0,done=false;
  const frames=new Map(),timers=new Map(),listeners=new Map();
  const root={parentElement:null,clientLeft:0,clientTop:0,clientWidth:393,clientHeight:722,scrollWidth:393,scrollHeight:3000,get scrollTop(){return offset;},scrollLeft:0};
  const inner={parentElement:root,clientLeft:0,clientTop:0,clientWidth:393,clientHeight:200,scrollWidth:393,scrollHeight:800,get scrollTop(){return innerOffset;},scrollLeft:0,getBoundingClientRect:()=>({x:0,y:1000-offset})};
  const y=()=>mode==='unchanged'?116:mode==='inside-animation'?now===0?138:116:mode==='nested'?1000-innerOffset-offset:mode==='layout-shift'&&now===0?116:padding?50+initialOffset-offset:1060-offset;
  const node={parentElement:mode==='nested'?inner:root,getBoundingClientRect:()=>({x:20,y:y(),width:350,height:mode==='nested'?40:84}),scrollIntoView(){requests++;assert.ok(listeners.has('scroll'),'observation must precede the only native scroll request');}};
  const document={querySelector:()=>node,scrollingElement:root,addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:(name,fn)=>{assert.equal(listeners.get(name),fn);listeners.delete(name);}};
  const sandbox={document,innerWidth:393,innerHeight:722,scrollX:0,get scrollY(){return offset;},performance:{now:()=>now},getComputedStyle:element=>element===root?{scrollPaddingTop:String(padding),overflowY:'auto'}:element===inner?{overflowY:'auto'}:{},requestAnimationFrame:fn=>{const id=++nextId;frames.set(id,fn);return id;},cancelAnimationFrame:id=>frames.delete(id),setTimeout:(fn,ms)=>{const id=++nextId;timers.set(id,{fn,at:now+ms});return id;},clearTimeout:id=>timers.delete(id)};
  const result=vm.runInNewContext('('+observeNativeScroll.toString()+')("#actual-target")',sandbox);result.then(()=>{done=true;});
  const step=['inside-animation','slow-scroll'].includes(mode)?1100:16;
  for(now=step;now<=10000+step+16&&!done;now+=step){
    if(mode==='delayed'&&now>=208&&now<=528){offset+=25;listeners.get('scroll')?.({target:document});}
    if(mode==='nested'&&now>=208&&now<=304){innerOffset-=50;listeners.get('scroll')?.({target:inner});}
    if(mode==='nested'&&now>=704&&now<=816){offset+=70;listeners.get('scroll')?.({target:document});}
    if(mode==='slow-scroll'&&now===step){offset=600;listeners.get('scroll')?.({target:document});}
    for(const [id,timer] of [...timers])if(now>=timer.at){timers.delete(id);timer.fn();}
    const batch=[...frames];frames.clear();for(const [,fn] of batch)fn(now);
    await Promise.resolve();await Promise.resolve();
  }
  const proof=await result;
  assert.equal(requests,1);assert.equal(listeners.size,0);assert.equal(timers.size,0);assert.equal(frames.size,0);
  return proof;
}

test('production scroll observer waits past pre-start still frames for one native smooth scroll to settle',async()=>{
  const proof=await nativeScrollModel();assert.equal(proof.status,'settled');assert.ok(proof.elapsedMs>=628);assert.equal(proof.before.scrollY,0);assert.ok(proof.after.scrollY>0);assert.ok(proof.scrollEvents>0);
});

test('native scroll no-motion and timeout are distinct, including the actual scroll-padding boundary',async()=>{
  const still=await nativeScrollModel({mode:'unchanged'});assert.equal(still.status,'unchanged');assert.equal(still.frames,2);
  const timeout=await nativeScrollModel({mode:'blocked'});assert.equal(timeout.status,'timeout');assert.equal(timeout.started,false);assert.equal(timeout.after.scrollY,0);
  const padding=await nativeScrollModel({mode:'blocked',padding:90,initialOffset:200});assert.equal(padding.status,'timeout','a target above scroll-padding must move when the required offset is attainable');assert.equal(padding.needsMovement,true);
  const clamped=await nativeScrollModel({mode:'blocked',padding:90});assert.equal(clamped.status,'unchanged','at scrollTop0 a negative target offset is clamped to0');assert.equal(clamped.needsMovement,false);
  const animation=await nativeScrollModel({mode:'inside-animation'});assert.equal(animation.status,'unchanged','on-screen CSS animation is not unfinished native scrolling');
  assert.equal(animation.frames,2);assert.equal(animation.after.rect.y,116);
});

test('actual completion stays bounded while allowing four observed stable frames at a slow native RAF cadence',async()=>{
  const proof=await nativeScrollModel({mode:'slow-scroll'});assert.equal(proof.status,'settled');assert.equal(proof.frames,5);assert.equal(proof.elapsedMs,5500);assert.equal(proof.deadlineMs,10000);assert.equal(proof.after.scrollY,600);
});

test('native completion accounts for newly required outer scrolling and pre-start layout shifts',async()=>{
  const nested=await nativeScrollModel({mode:'nested'});assert.equal(nested.status,'settled');assert.ok(nested.elapsedMs>=916,'queued outer native scroll must finish before observation');assert.deepEqual([...nested.startedScrollers].sort(),[0,1]);assert.ok(nested.after.scrollY>0);
  const shifted=await nativeScrollModel({mode:'layout-shift'});assert.equal(shifted.status,'timeout');assert.equal(shifted.after.rect.y,1060,'new offscreen position cannot pass as unchanged');assert.equal(shifted.started,false);
});

test('production font observation positions text after font layout completes and preserves the cold withheld path',async()=>{
  const normal=fontLayoutScenario();assert.equal((await normal.session.fonts('#title','synthetic layout')).visible,true);assert.deepEqual(normal.calls,['ready','scroll']);
  const cold=fontLayoutScenario({cold:true});assert.equal((await cold.session.fonts('#title','synthetic withheld',{awaitFonts:false})).visible,true);assert.deepEqual(cold.calls,['scroll']);
});

test('font visibility failure retains its actual rectangle and viewport in the receipt',async()=>{
  const {session,receipt}=fontLayoutScenario({alwaysInvisible:true});await assert.rejects(session.fonts('#title','synthetic offscreen'),/inside the viewport/);
  assert.equal(receipt.checks.length,1);assert.equal(receipt.checks[0].rect.y,1200);assert.equal(receipt.checks[0].viewport.height,722);assert.equal(receipt.checks[0].visible,false);
});

test('cold-font interception must precede product navigation on the owned origin',async()=>{
  const sends=[];
  const cdp={
    send:async(method,params={})=>{sends.push({method,params});return method==='Page.navigate'?{frameId:'f'}:{};},
    on:()=>()=>{},
    close:async()=>{},
    evaluate:async()=>true,
  };
  const receipt={screenshots:[],fonts:[],checks:[],errors:[]};
  const session=createEvidenceSession({cdp,out:'/tmp/runner/get173-run/typography-android',receipt,root:'/repo',origin:'http://localhost:43210'});
  await assert.rejects(()=>session.navigateProduct('http://localhost:43210/'),/font/i,'product navigation before cold-font interception must fail');
  await session.installFontHold();
  await assert.rejects(()=>session.navigateProduct('https://example.com/'),/origin|owned/i,'external product navigation must fail');
  await session.navigateProduct('http://localhost:43210/');
  const methods=sends.map(entry=>entry.method);
  assert.ok(methods.includes('Fetch.enable'));
  assert.ok(methods.indexOf('Fetch.enable')<methods.indexOf('Page.navigate'),'cold-font interception must be installed first');
  assert.deepEqual(sends.find(entry=>entry.method==='Fetch.enable').params.patterns,[{urlPattern:'*/fonts/newsreader/*.woff2',requestStage:'Request'}]);
  await session.close();
  await assert.rejects(()=>session.navigateProduct('http://localhost:43210/'),/closed/i,'no product navigation may be created after cleanup');
  await assert.rejects(()=>session.installFontHold(),/closed/i,'no font interception may be created after cleanup');
});

test('hierarchy parsing is strict XML structure and decodes entities before native FRE checks',()=>{
  // Independent reviewer repros: all three must fail closed.
  assert.equal(assessFirstRunOverlay('<hierarchy><node package="com.android.chrome"></hierarchy>').ok,false,'an unclosed node must fail closed');
  assert.equal(assessFirstRunOverlay('<hierarchy><node package="com.android.chrome" resource-id="com.android.chrome:id/toolbar"/><junk></hierarchy>').ok,false,'garbage elements must fail closed');
  const encoded=assessFirstRunOverlay('<hierarchy><node package="com.android.chrome" text="Accept &amp; continue" /></hierarchy>');
  assert.equal(encoded.ok,false,'entity-encoded native FRE text must be decoded before checking');
  assert.ok(encoded.markers.includes('Accept & continue'));
  // Strict entity, DTD and structure handling.
  assert.throws(()=>parseUiHierarchy('<hierarchy><node text="&bogus;" /></hierarchy>'),/entity/i);
  assert.throws(()=>parseUiHierarchy('<hierarchy><node text="&amp" /></hierarchy>'),/entity/i);
  assert.throws(()=>parseUiHierarchy('<!DOCTYPE hierarchy><hierarchy><node package="com.android.chrome" /></hierarchy>'),/DOCTYPE|DTD|entity|declaration/i);
  assert.throws(()=>parseUiHierarchy('<hierarchy><node text="x"></hierarchy>'),/Mismatched|Unclosed/i);
  assert.throws(()=>parseUiHierarchy('<hierarchy><node text="a<b" /></hierarchy>'),/Illegal|invalid|Unexpected/i);
  assert.throws(()=>parseUiHierarchy('<hierarchy><node unknown junk /></hierarchy>'),/attribute|Unexpected/i);
  // Meaningful legal XML positive fixtures.
  const parsed=parseUiHierarchy(UIAUTOMATOR_CHROME_XML);
  assert.equal(parsed.nodes.length,4);
  assert.equal(parsed.nodes[1].attrs['resource-id'],'com.android.chrome:id/toolbar');
  assert.equal(parseUiHierarchy('<hierarchy rotation="0"><node text="She&#39;s here" package="com.android.chrome" /></hierarchy>').nodes[0].attrs.text,"She's here",'numeric character references decode');
  assert.deepEqual(parseUiHierarchy('<hierarchy rotation="0"></hierarchy>').nodes,[],'an empty hierarchy parses but carries no nodes');
});

test('cancellation cannot spawn the emulator after finalization or delete state before owned work settles',async()=>{
  const events=[];
  let resumeConfig;
  const pendingConfig=new Promise(resolve=>{resumeConfig=resolve;});
  const registry=new Map();
  const lifecycle=createRunLifecycle({
    addSignalHandler:(signal,handler)=>registry.set(signal,handler),
    removeSignalHandler:signal=>registry.delete(signal),
    sleep:ms=>new Promise(resolve=>setTimeout(resolve,Math.min(ms,2))),
  });
  const record={exec:[],spawn:[],kill:[],fs:[]};
  const exec=(file,args,options={})=>{record.exec.push({file,args:[...args]});return happyRouter(file,args);};
  const spawnProcess=(file,args,options={})=>{record.spawn.push({file,args:[...args]});events.push('SPAWN');const handle={pid:4242,exitCode:null,on(){}};record.handle=handle;return handle;};
  const killProcess=(pid,signal)=>{record.kill.push({pid,signal});};
  const fsOps={
    readFile:async target=>{
      record.fs.push(['readFile',target]);
      if(target.endsWith('config.ini')){events.push('CONFIG-PENDING');await pendingConfig;events.push('CONFIG-RESUMED');return 'avd.ini.displayname=Pixel 5\nhw.ramSize=1536\n';}
      if(target.endsWith('source.properties'))return 'Pkg.Revision=14\n';
      throw Object.assign(Error('ENOENT '+target),{code:'ENOENT'});
    },
    writeFile:async (target,data)=>{record.fs.push(['writeFile',target,String(data)]);},
    mkdir:async target=>{record.fs.push(['mkdir',target]);events.push('MKDIR');},
    rm:async target=>{record.fs.push(['rm',target]);events.push('DELETE');},
    exists:async()=>false,
  };
  const adapter=createAndroidAdapter({env:baseEnv(),platform:'linux',exec,spawnProcess,killProcess,fsOps,sleep:ms=>new Promise(resolve=>setTimeout(resolve,Math.min(ms,2))),now:()=>Date.now(),fence:lifecycle});
  lifecycle.setCleanup(async()=>{const cleanup=await adapter.cleanup();return cleanup.errors;});
  lifecycle.attach();
  const booting=adapter.boot();
  booting.then(()=>events.push('BOOT-SETTLED'),()=>events.push('BOOT-SETTLED'));
  while(!events.includes('CONFIG-PENDING'))await new Promise(resolve=>setTimeout(resolve,1));
  registry.get('SIGTERM')();
  await new Promise(resolve=>setTimeout(resolve,30));
  assert.ok(!events.includes('DELETE'),'no deletion may happen before owned work settles');
  assert.equal(record.spawn.length,0);
  resumeConfig();
  await assert.rejects(()=>booting,/stopping|late/i);
  const result=await lifecycle.finalize();
  assert.deepEqual(result.errors,[],'settled owned work leaves no cleanup error');
  assert.equal(record.spawn.length,0,'the owned emulator must never spawn after finalization');
  assert.equal(record.fs.filter(entry=>entry[0]==='rm').length,2,'owned state is removed once settled');
  const settledAt=events.indexOf('BOOT-SETTLED'),deletedAt=events.indexOf('DELETE');
  assert.ok(settledAt>=0&&deletedAt>settledAt,'state must be deleted only after owned work settles');
  assert.ok(record.exec.some(call=>call.args.includes('create')),'the acquisition had legitimately started');
  assert.deepEqual(record.kill,[],'nothing owned was running, so no signals are sent');
});

test('cancellation stays finite and keeps state when an owned acquisition never settles',async()=>{
  const registry=new Map();
  const lifecycle=createRunLifecycle({
    addSignalHandler:(signal,handler)=>registry.set(signal,handler),
    removeSignalHandler:signal=>registry.delete(signal),
    sleep:ms=>new Promise(resolve=>setTimeout(resolve,Math.min(ms,2))),
  });
  const record={exec:[],spawn:[],kill:[],fs:[]};
  const never=new Promise(()=>{});
  const fsOps={
    readFile:async target=>target.endsWith('config.ini')?never:'Pkg.Revision=14\n',
    writeFile:async()=>{},
    mkdir:async target=>{record.fs.push(['mkdir',target]);},
    rm:async target=>{record.fs.push(['rm',target]);},
    exists:async()=>false,
  };
  const adapter=createAndroidAdapter({env:baseEnv(),platform:'linux',exec:(file,args)=>{record.exec.push({file,args:[...args]});return happyRouter(file,args);},spawnProcess:()=>{throw Error('must not spawn');},killProcess:()=>{},fsOps,sleep:ms=>new Promise(resolve=>setTimeout(resolve,Math.min(ms,2))),now:()=>Date.now(),fence:lifecycle,acquireDrainMs:60});
  lifecycle.setCleanup(async()=>{const cleanup=await adapter.cleanup();return cleanup.errors;});
  lifecycle.attach();
  adapter.boot().catch(()=>{});
  while(!record.fs.some(entry=>entry[0]==='mkdir'))await new Promise(resolve=>setTimeout(resolve,1));
  registry.get('SIGTERM')();
  const started=Date.now();
  const result=await lifecycle.finalize();
  assert.ok(Date.now()-started<5000,'finalization must stay finite');
  assert.ok(result.errors.some(error=>/settl|acquisition/i.test(error)),'unsettled owned work must be recorded');
  assert.deepEqual(record.fs.filter(entry=>entry[0]==='rm'),[],'state stays on disk while owned work is unsettled');
  assert.deepEqual(record.spawn,[],'no late emulator process');
});

test('cancellation during final receipt I/O stays nonzero and recorded',async()=>{
  const registry=new Map();
  const lifecycle=createRunLifecycle({
    addSignalHandler:(signal,handler)=>registry.set(signal,handler),
    removeSignalHandler:signal=>registry.delete(signal),
    sleep:ms=>new Promise(resolve=>setTimeout(resolve,Math.min(ms,2))),
  });
  lifecycle.attach();
  const receipt={errors:[],fonts:[],checks:[],screenshots:[]};
  const writes=[];
  let resumeWrite;
  const pendingWrite=new Promise(resolve=>{resumeWrite=resolve;});
  let firstWrite=true,exitCode=null;
  const finalizePromise=finalizeRunReceipt({
    lifecycle,
    receipt,
    failures:[],
    release:async()=>[],
    write:async value=>{
      writes.push(JSON.parse(JSON.stringify(value)));
      if(firstWrite){firstWrite=false;registry.get('SIGTERM')();await pendingWrite;}
    },
    setExitCode:code=>{exitCode=code;},
  });
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(lifecycle.cancelled,'SIGTERM','the installed signal handler must record cancellation');
  resumeWrite();
  const status=await finalizePromise;
  assert.equal(status.result,'failed');
  assert.equal(status.exitCode,1);
  assert.equal(exitCode,1,'cancellation during final receipt I/O must still exit nonzero');
  assert.equal(receipt.result,'failed');
  assert.equal(receipt.cancelled,'SIGTERM','cancellation must be recorded even during final receipt I/O');
  assert.ok(writes.length>=2,'the receipt must be rewritten after cancellation changed during the write');
  assert.equal(writes.at(-1).result,'failed');
  assert.equal(writes.at(-1).cancelled,'SIGTERM');
});


test('the shared stopping fence is required before any adapter side effect',()=>{
  for(const label of ['createAndroidAdapter','createProductionAndroidAdapter']){
    const harness=boundaries();
    const build=()=>label==='createAndroidAdapter'
      ?createAndroidAdapter({env:baseEnv(),platform:'linux',...harness})
      :createProductionAndroidAdapter({env:baseEnv(),platform:'linux',...harness});
    assert.throws(build,/fence/i,'production assembly must fail when the shared stopping fence is omitted: '+label);
    assert.deepEqual(harness.record.exec,[],'no boundary may run without the fence');
    assert.deepEqual(harness.record.spawn,[]);
    assert.deepEqual(harness.record.fs,[]);
    assert.deepEqual(harness.record.kill,[]);
    assert.throws(()=>createProductionAndroidAdapter({env:baseEnv(),platform:'linux',fenceLike:null,...harness}),/fence|lifecycle/i);
    assert.throws(()=>createProductionAndroidAdapter({env:baseEnv(),platform:'linux',lifecycle:{},...harness}),/fence|lifecycle/i,'a lifecycle without throwIfStopping is not a fence');
  }
  const harness=boundaries();
  const adapter=createProductionAndroidAdapter({env:baseEnv(),platform:'linux',lifecycle:{throwIfStopping(){}},...harness});
  assert.equal(typeof adapter.boot,'function');
  assert.deepEqual(harness.record.exec,[],'assembly itself runs no side effect');
});

test('the production assembly cannot spawn the emulator after cancellation continues late',async()=>{
  // Reviewer repro 1 with the production assembly and 1ms drains (runtime uses
  // 15s): cancel while config.ini is pending, let finalization complete, then
  // release the read. The late continuation must not spawn or kill anything.
  const events=[];
  let resumeConfig;
  const pendingConfig=new Promise(resolve=>{resumeConfig=resolve;});
  const registry=new Map();
  const lifecycle=createRunLifecycle({
    addSignalHandler:(signal,handler)=>registry.set(signal,handler),
    removeSignalHandler:signal=>registry.delete(signal),
    drainMs:1,
    sleep:ms=>new Promise(resolve=>setTimeout(resolve,Math.min(ms,2))),
  });
  const record={exec:[],spawn:[],kill:[],fs:[]};
  const fsOps={
    readFile:async target=>{
      record.fs.push(['readFile',target]);
      if(target.endsWith('config.ini')){events.push('CONFIG-PENDING');await pendingConfig;events.push('CONFIG-RESUMED');return 'avd.ini.displayname=Pixel 5\nhw.ramSize=1536\n';}
      if(target.endsWith('source.properties'))return 'Pkg.Revision=14\n';
      throw Object.assign(Error('ENOENT '+target),{code:'ENOENT'});
    },
    writeFile:async (target,data)=>{record.fs.push(['writeFile',target,String(data)]);},
    mkdir:async target=>{record.fs.push(['mkdir',target]);},
    rm:async target=>{record.fs.push(['rm',target]);events.push('DELETE');},
    exists:async()=>false,
  };
  const adapter=createProductionAndroidAdapter({
    env:baseEnv(),platform:'linux',
    lifecycle,
    exec:(file,args)=>{record.exec.push({file,args:[...args]});return happyRouter(file,args);},
    spawnProcess:(file,args)=>{record.spawn.push({file,args:[...args]});events.push('SPAWN');const handle={pid:4242,exitCode:null,on(){}};record.handle=handle;return handle;},
    killProcess:(pid,signal)=>{record.kill.push({pid,signal});},
    fsOps,
    sleep:ms=>new Promise(resolve=>setTimeout(resolve,Math.min(ms,2))),
    now:()=>Date.now(),
    acquireDrainMs:1,
  });
  lifecycle.setCleanup(async()=>{const cleanup=await adapter.cleanup();return cleanup.errors;});
  lifecycle.attach();
  const booting=adapter.boot();
  booting.catch(()=>{});
  while(!events.includes('CONFIG-PENDING'))await new Promise(resolve=>setTimeout(resolve,1));
  registry.get('SIGTERM')();
  const result=await lifecycle.finalize();
  assert.ok(result.errors.some(error=>/settl|acquisition/i.test(error)),'the timed-out acquisition must be recorded, not hidden');
  resumeConfig();
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(record.spawn.length,0,'the late continuation must never spawn the emulator');
  assert.equal(record.kill.length,0,'no process existed, so no kill may be sent');
  assert.ok(record.fs.filter(entry=>entry[0]==='rm').length===0||events.indexOf('DELETE')<events.indexOf('CONFIG-RESUMED')||!events.includes('DELETE'),'owned state handling stays ordered');
});

test('owned acquisition tracks adopt-or-dispose completely and records disposal failures',async()=>{
  const events=[],recorded=[];
  const registry=new Map();
  const lifecycle=createRunLifecycle({
    addSignalHandler:(signal,handler)=>registry.set(signal,handler),
    removeSignalHandler:signal=>registry.delete(signal),
    drainMs:200,
    sleep:ms=>new Promise(resolve=>setTimeout(resolve,Math.min(ms,2))),
  });
  lifecycle.attach();
  let resumeStart,resumeDispose;
  const pendingStart=new Promise(resolve=>{resumeStart=resolve;});
  const pendingDispose=new Promise(resolve=>{resumeDispose=resolve;});
  const acquiring=acquireOwned({
    lifecycle,
    label:'devtools connection',
    start:async()=>{events.push('START');await pendingStart;events.push('START-RESOLVED');return {close:async()=>{events.push('DISPOSE-START');await pendingDispose;events.push('DISPOSE-DONE');}};},
    dispose:async created=>{await created.close();},
    onError:message=>recorded.push(message),
    disposeTimeoutMs:2000,
  });
  acquiring.catch(()=>{});
  registry.get('SIGTERM')();
  const finalizing=lifecycle.finalize();
  let finalized=false;
  finalizing.then(()=>{finalized=true;events.push('FINALIZED');},()=>{finalized=true;events.push('FINALIZED');});
  await new Promise(resolve=>setTimeout(resolve,20));
  resumeStart();
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(finalized,false,'finalization must not finish while the late disposal is pending');
  assert.ok(events.includes('DISPOSE-START'),'the late acquisition must be disposed instead of adopted');
  assert.ok(!events.includes('DISPOSE-DONE'));
  resumeDispose();
  const result=await finalizing;
  assert.ok(events.indexOf('DISPOSE-DONE')>=0&&events.indexOf('DISPOSE-DONE')<events.indexOf('FINALIZED'),'the resource must actually close before the run is declared released');
  await assert.rejects(()=>acquiring,/stopping|late/i);
  assert.deepEqual(result.errors,[],'a completed disposal leaves no cleanup error');
  assert.deepEqual(recorded,[],'a successful disposal records nothing');
  // disposal failure is recorded, never swallowed
  const failing=acquireOwned({
    lifecycle:{throwIfStopping(){},cancelled:'SIGTERM',stopped:true,track:work=>work,detach(){}},
    label:'server creation',
    start:async()=>({name:'x'}),
    dispose:async()=>{throw Error('EPERM dispose');},
    onError:message=>recorded.push(message),
    disposeTimeoutMs:50,
  }).catch(error=>error);
  await failing;
  assert.ok(recorded.some(message=>/EPERM dispose/.test(message)),'disposal failures must be recorded as failures');
  // disposal that never settles is bounded and recorded, not hidden by success
  const pendingRecorded=[];
  const late=await acquireOwned({
    lifecycle:{throwIfStopping(){},cancelled:null,stopped:true,track:work=>work,detach(){}},
    label:'server creation',
    start:async()=>({}),
    dispose:async()=>new Promise(()=>{}),
    onError:message=>pendingRecorded.push(message),
    disposeTimeoutMs:30,
  }).catch(error=>error);
  assert.ok(late instanceof Error,'an unbounded disposal cannot report success');
  assert.ok(pendingRecorded.some(message=>/timeout|dispos/i.test(message)),'pending disposal must be recorded');
});

test('a cancellation during a pending final receipt write stays recorded and nonzero',async()=>{
  const registry=new Map();
  const lifecycle=createRunLifecycle({
    addSignalHandler:(signal,handler)=>registry.set(signal,handler),
    removeSignalHandler:signal=>registry.delete(signal),
    drainMs:50,
    sleep:ms=>new Promise(resolve=>setTimeout(resolve,Math.min(ms,2))),
  });
  const receipt={errors:[],fonts:[],checks:[],screenshots:[]};
  const writes=[];
  const resumeFns=[];
  let exitCode=null;
  let finalReceiptStatus;
  lifecycle.setCleanup(async()=>{finalReceiptStatus=await finalizeRunReceipt({
    lifecycle,
    receipt,
    failures:[],
    release:async()=>[],
    write:async value=>{
      writes.push(JSON.parse(JSON.stringify(value)));
      await new Promise(resolve=>{resumeFns.push(resolve);});
    },
    setExitCode:code=>{exitCode=code;},
  });return [];});
  lifecycle.attach();
  let pump;
  try{
  const finalizing=lifecycle.finalize();
  await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(writes.length,1,'one awaited receipt write is in flight');
  assert.throws(()=>lifecycle.guard('late acquisition'),/stopping|late/i,'normal finalization stops new resource admission before its write');
  registry.get('SIGTERM')();
  resumeFns.shift()();
  await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(writes.length,2,'the changed cancellation state must trigger a rewrite while handlers are attached');
  resumeFns.shift()();
  pump=setInterval(()=>{while(resumeFns.length)resumeFns.shift()();},5);
  const status=await finalizing;
  assert.equal(status.cancelled,'SIGTERM');
  assert.equal(finalReceiptStatus.exitCode,1);
  assert.equal(exitCode,1,'a cancellation during final receipt I/O must exit nonzero');
  assert.equal(writes.length,2,'no asynchronous write may happen after the final stable write');
  assert.equal(writes.at(-1).result,'failed');
  assert.equal(writes.at(-1).cancelled,'SIGTERM');
  assert.equal(receipt.cancelled,'SIGTERM');
  }finally{if(pump)clearInterval(pump);}
  // exact repro 3: a late requestStop during the pending final write must not
  // produce a passing receipt or exit 0.
  const registry2=new Map();
  const lifecycle2=createRunLifecycle({
    addSignalHandler:(signal,handler)=>registry2.set(signal,handler),
    removeSignalHandler:signal=>registry2.delete(signal),
    drainMs:50,
    sleep:ms=>new Promise(resolve=>setTimeout(resolve,Math.min(ms,2))),
  });
  const receipt2={errors:[],fonts:[],checks:[],screenshots:[]};
  const resume2=[];
  let exitCode2=null;
  let finalReceiptStatus2;
  lifecycle2.setCleanup(async()=>{finalReceiptStatus2=await finalizeRunReceipt({
    lifecycle:lifecycle2,
    receipt:receipt2,
    failures:[],
    release:async()=>[],
    write:async value=>{receipt2writes.count++;await new Promise(resolve=>{resume2.push(resolve);});},
    setExitCode:code=>{exitCode2=code;},
  });return [];});
  function receipt2writes(){return receipt2writes.count;}
  receipt2writes.count=0;
  lifecycle2.attach();
  let pump2;
  try{
  const finalizing2=lifecycle2.finalize();
  await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(lifecycle2.finalized,true);
  lifecycle2.requestStop('SIGTERM');
  resume2.shift()();
  await new Promise(resolve=>setTimeout(resolve,10));
  resume2.shift()();
  pump2=setInterval(()=>{while(resume2.length)resume2.shift()();},5);
  const status2=await finalizing2;
  assert.equal(receipt2writes(),2,'no asynchronous write may happen after the final stable write');
  assert.equal(status2.cancelled,'SIGTERM');
  assert.equal(finalReceiptStatus2.exitCode,1);
  assert.equal(exitCode2,1);
  assert.equal(receipt2.cancelled,'SIGTERM');
  assert.equal(receipt2.result,'failed');
  }finally{if(pump2)clearInterval(pump2);}
});

test('unresolved owned acquisition is recorded when bounded cancellation finishes',async()=>{
  const signals=new Map(),writes=[];let exitCode;
  const lifecycle=createRunLifecycle({addSignalHandler:(name,fn)=>signals.set(name,fn),removeSignalHandler:name=>signals.delete(name),drainMs:1});
  lifecycle.track(new Promise(()=>{}));
  const receipt={errors:[]};
  lifecycle.setCleanup(async()=>{
    await finalizeRunReceipt({lifecycle,receipt,release:async()=>[],write:async row=>writes.push(structuredClone(row)),setExitCode:code=>{exitCode=code;}});
    return [];
  });
  lifecycle.attach();signals.get('SIGTERM')();
  await lifecycle.finalize();
  assert.equal(exitCode,1);
  assert.equal(writes.at(-1).result,'failed');
  assert.equal(writes.at(-1).cancelled,'SIGTERM');
  assert.ok(writes.at(-1).cleanupErrors.some(error=>/unresolved after bounded drain: 1/.test(error)));
});

test('hierarchy parsing rejects nodes outside the root, duplicate attributes and invalid references',()=>{
  for(const xml of [
    '<hierarchy/><node package="com.android.chrome"/>',
    '<node package="com.android.chrome"/><hierarchy/>',
    '<hierarchy><node package="com.android.chrome" text="Accept &amp; continue" text="fine"/></hierarchy>',
    '<hierarchy><node package="com.android.ch&#114junk;ome"/></hierarchy>',
    '<hierarchy><node package="com.android.chrome" text="&#0;"/></hierarchy>',
  ]){
    assert.throws(()=>parseUiHierarchy(xml),/root|attribute|entity|character|Unexpected|after/i,xml);
    assert.equal(assessFirstRunOverlay(xml).ok,false,'must fail closed: '+xml);
  }
  assert.throws(()=>parseUiHierarchy('<hierarchy><node a="1"b="2"/></hierarchy>'),/attribute/i,'attributes require whitespace separation');
  assert.throws(()=>parseUiHierarchy('<hierarchy><node text="&#x110000;"/></hierarchy>'),/character|entity/i);
  assert.throws(()=>parseUiHierarchy('<hierarchy><node text="\u0001"/></hierarchy>'),/character|invalid/i,'raw control characters are invalid XML');
  assert.equal(parseUiHierarchy('<hierarchy rotation="0"><node text="a&#32;b" package="com.android.chrome" /></hierarchy>').nodes[0].attrs.text,'a b');
  assert.equal(parseUiHierarchy('<hierarchy rotation="0"><node text="&#x41;&#x42;" package="com.android.chrome" /></hierarchy>').nodes[0].attrs.text,'AB');
  assert.equal(assessFirstRunOverlay('<hierarchy rotation="0"><node text="Turn on sync" package="com.android.chrome" /></hierarchy>').ok,false,'entity-decoded FRE detection is preserved');
});

test('the release allowlist carries the platform acceptance software',async()=>{
  const root=path.resolve(import.meta.dirname,'..');
  const allowed=JSON.parse(await readFile(path.join(root,'release-files.json'),'utf8'));
  for(const file of [
    '.github/workflows/platform-typography.yml',
    'tools/platform-typography.mjs',
    'tools/lib/platform-android.mjs',
    'tools/lib/platform-cdp.mjs',
    'tools/lib/platform-font-observer.mjs',
  ])assert.ok(allowed.includes(file),'release allowlist misses '+file);
});

test('owned emulator argv uses only documented options and records the effective emulator version',async()=>{
  const {record,exec,spawnProcess,killProcess,fsOps,sleep,now}=recRouter(happyRouter);
  const adapter=createAndroidAdapter({env:baseEnv(),platform:'linux',exec,spawnProcess,killProcess,fsOps,sleep,now,fence:TEST_FENCE});
  await adapter.boot();
  const spawn=record.spawn[0];
  assert.ok(!spawn.args.includes('-no-camera'),'-no-camera is not an official emulator option');
  for(const [flag,mode] of [['-camera-back','none'],['-camera-front','none']]){
    const index=spawn.args.indexOf(flag);
    assert.ok(index>=0&&spawn.args[index+1]===mode,'official camera-none option required: '+flag+' '+mode);
  }
  const versions=await adapter.versions();
  assert.equal(versions.emulator,'Android emulator version 35.6.10.0 (build_id: 13018748)','the effective emulator version must be recorded at runtime, never assumed');
});

test('Chromium command-line parsing treats the first token as the program name',()=>{
  assert.deepEqual(parseChromeCommandLine('/data/app/base.apk --disable-fre --remote-debugging-port=0'),{argv0:'/data/app/base.apk',switches:['--disable-fre','--remote-debugging-port=0'],args:[]});
  assert.deepEqual(parseChromeCommandLine('_  --disable-fre '),{argv0:'_',switches:['--disable-fre'],args:[]});
  assert.deepEqual(parseChromeCommandLine('_ plain --disable-fre'),{argv0:'_',switches:['--disable-fre'],args:['plain']});
  assert.throws(()=>parseChromeCommandLine('--disable-fre'),/program name/i);
  assert.throws(()=>parseChromeCommandLine(''),/program name/i);
});

test('device-side reverse listener listings carry a placeholder, never the host serial',()=>{
  assert.equal(findReverseMapping('(reverse) tcp:43210 tcp:43210\n',{serverPort:43210}),true);
  assert.equal(findReverseMapping('UsbFfs tcp:43210 tcp:43210\n',{serverPort:43210}),true,'the legacy legitimate placeholder stays accepted');
  assert.equal(findReverseMapping('host-23 tcp:36589 tcp:36589\n\n',{serverPort:36589}),true,'actual API34 daemon TCP transport listing from run39150492073');
  assert.deepEqual(parseReverseMappings('host-23 tcp:36589 tcp:36589\n\n'),[{placeholder:'host-23',localPort:36589,remotePort:36589}]);
  assert.equal(findReverseMapping('host-other tcp:36589 tcp:36589\n',{serverPort:36589}),false);
  assert.equal(findReverseMapping('host-23 tcp:36589 tcp:1\n',{serverPort:36589}),false);
  assert.equal(findReverseMapping(SERIAL+' tcp:43210 tcp:43210\n',{serverPort:43210}),false,'host-serial output is not a valid device-side reverse listing');
  assert.equal(findReverseMapping('(reverse) tcp:43210 tcp:9999\n',{serverPort:43210}),false);
  assert.equal(findReverseMapping('UI hierarchy dump failed\n',{serverPort:43210}),false);
  assert.deepEqual(parseReverseMappings('(reverse) tcp:43210 tcp:43210\n'),[{placeholder:'(reverse)',localPort:43210,remotePort:43210}]);
  assert.deepEqual(parseReverseMappings(''),[]);
  assert.deepEqual(parseForwardMappings(SERIAL+' tcp:54321 localabstract:chrome_devtools_remote\n'),[{serial:SERIAL,port:54321,target:'localabstract:chrome_devtools_remote'}]);
  assert.equal(findForwardMapping(SERIAL+' tcp:54321 localabstract:chrome_devtools_remote\n',{serial:SERIAL,forwardPort:54321}),true);
  assert.equal(findForwardMapping(SERIAL+' tcp:54321 localabstract:chrome_devtools_remote\n',{serial:SERIAL,forwardPort:9222}),false);
  assert.equal(findForwardMapping('emulator-5556 tcp:54321 localabstract:chrome_devtools_remote\n',{serial:SERIAL,forwardPort:54321}),false);
});

test('production adapter accepts the observed API34 daemon reverse label on the owned serial',async()=>{
  const router=(file,args,options)=>args.join(' ').includes('reverse --list')?'host-23 tcp:43210 tcp:43210\n\n':happyRouter(file,args,options);
  const {record,exec,spawnProcess,killProcess,fsOps,sleep,now}=recRouter(router);
  const adapter=createAndroidAdapter({env:baseEnv(),platform:'linux',exec,spawnProcess,killProcess,fsOps,sleep,now,fence:TEST_FENCE});
  await adapter.boot();
  const setup=await adapter.setupChrome({serverPort:43210});
  assert.deepEqual(setup.reverseMapping,{placeholder:'host-23',localPort:43210,remotePort:43210});
  assert.ok(record.exec.some(call=>call.args.join(' ')==='-s '+SERIAL+' reverse --list'));
  await adapter.cleanup();
});

test('a reverse mapping failure still removes the earlier owned forward mapping',async()=>{
  const {record,exec,spawnProcess,killProcess,fsOps,sleep,now}=recRouter((file,args)=>{
    if(args.join(' ').includes('reverse tcp:'))throw Error('adb: device offline');
    return happyRouter(file,args);
  });
  const adapter=createAndroidAdapter({env:baseEnv(),platform:'linux',exec,spawnProcess,killProcess,fsOps,sleep,now,fence:TEST_FENCE});
  await adapter.boot();
  await assert.rejects(()=>adapter.setupChrome({serverPort:43210}),/offline/i);
  await adapter.cleanup();
  const removals=record.exec.filter(call=>call.args.includes('--remove')).map(call=>call.args.join(' '));
  assert.deepEqual(removals,['-s '+SERIAL+' forward --remove tcp:54321'],'the already-created forward mapping must be registered and removed');
  assert.ok(!record.exec.some(call=>call.args.join(' ').includes('reverse --remove')),'no unrecorded reverse mapping may be touched');
});

test('a reverse readback failure removes exactly the recorded owned mappings',async()=>{
  const {record,exec,spawnProcess,killProcess,fsOps,sleep,now}=recRouter((file,args)=>{
    if(args.join(' ').includes('reverse --list'))throw Error('adb: readback unavailable');
    return happyRouter(file,args);
  });
  const adapter=createAndroidAdapter({env:baseEnv(),platform:'linux',exec,spawnProcess,killProcess,fsOps,sleep,now,fence:TEST_FENCE});
  await adapter.boot();
  await assert.rejects(()=>adapter.setupChrome({serverPort:43210}),/readback/i);
  await adapter.cleanup();
  const removals=record.exec.filter(call=>call.args.includes('--remove')).map(call=>call.args.join(' '));
  assert.deepEqual(removals.sort(),['-s '+SERIAL+' forward --remove tcp:54321','-s '+SERIAL+' reverse --remove tcp:43210'].sort());
});

test('cleanup keeps owned state when the owned emulator process cannot be proven exited',async()=>{
  const {record,exec,spawnProcess,fsOps,sleep,now}=recRouter(happyRouter);
  const adapter=createAndroidAdapter({env:baseEnv(),platform:'linux',exec,spawnProcess,killProcess:(pid,signal)=>{record.kill.push({pid,signal});},fsOps,sleep,now,fence:TEST_FENCE});
  await adapter.boot();
  const cleanup=await adapter.cleanup();
  assert.equal(cleanup.exited,false);
  assert.ok(cleanup.errors.some(error=>/exit/i.test(error)),'bounded exit-proof failure must be recorded');
  assert.deepEqual(record.kill,[{pid:4242,signal:'SIGTERM'},{pid:4242,signal:'SIGKILL'}],'only owned-PID fallback signals are permitted');
  assert.deepEqual(record.fs.filter(entry=>entry[0]==='rm'),[],'owned state stays on disk while the owned process runs');
});

test('cleanup proves owned exit with bounded owned-PID fallback signals',async()=>{
  const {record,exec,spawnProcess,fsOps,sleep,now}=recRouter(happyRouter);
  const adapter=createAndroidAdapter({env:baseEnv(),platform:'linux',exec,spawnProcess,killProcess:(pid,signal)=>{record.kill.push({pid,signal});if(signal==='SIGKILL')record.handle.exitCode=0;},fsOps,sleep,now,fence:TEST_FENCE});
  await adapter.boot();
  const cleanup=await adapter.cleanup();
  assert.equal(cleanup.exited,true);
  assert.deepEqual(cleanup.errors,[]);
  assert.deepEqual(record.kill,[{pid:4242,signal:'SIGTERM'},{pid:4242,signal:'SIGKILL'}]);
  assert.deepEqual(record.fs.filter(entry=>entry[0]==='rm').map(entry=>entry[1]).sort(),[
    path.join(RUNNER_TEMP,'get173-android','android-avd-home'),
    path.join(RUNNER_TEMP,'get173-android','android-user-home'),
  ].sort());
});

test('cleanup sends no signals when the owned child exits after the serial shutdown',async()=>{
  const {record,exec,spawnProcess,killProcess,fsOps,sleep,now}=recRouter(happyRouter);
  const gracefulExec=(file,args,options={})=>{
    const output=exec(file,args,options);
    if(args.includes('emu')&&args.includes('kill'))record.handle.exitCode=0;
    return output;
  };
  const adapter=createAndroidAdapter({env:baseEnv(),platform:'linux',exec:gracefulExec,spawnProcess,killProcess,fsOps,sleep,now,fence:TEST_FENCE});
  await adapter.boot();
  const cleanup=await adapter.cleanup();
  assert.equal(cleanup.exited,true);
  assert.deepEqual(cleanup.errors,[]);
  assert.deepEqual(record.kill,[],'no signal is sent when the owned child already exited');
  assert.deepEqual(record.fs.filter(entry=>entry[0]==='rm').length,2);
});

test('the final run status fails on cleanup errors and cancellation after a clean body',()=>{
  const clean=finalRunStatus({failures:[],receiptErrors:[],cleanupErrors:[],cancelled:null});
  assert.equal(clean.result,'machine assertions passed; screenshots pending human visual review');
  assert.equal(clean.exitCode,0);
  const cleanupFailed=finalRunStatus({failures:[],receiptErrors:[],cleanupErrors:['owned android avd home: EPERM'],cancelled:null});
  assert.equal(cleanupFailed.result,'failed');
  assert.equal(cleanupFailed.exitCode,1,'a clean main body must never hide a cleanup failure');
  const cancelled=finalRunStatus({failures:[],receiptErrors:[],cleanupErrors:[],cancelled:'SIGTERM'});
  assert.equal(cancelled.result,'failed');
  assert.equal(cancelled.exitCode,1,'cancellation must exit nonzero');
  const lateFailure=finalRunStatus({failures:['CDP close timeout'],receiptErrors:[],cleanupErrors:[],cancelled:null});
  assert.equal(lateFailure.exitCode,1,'draining and close failures keep failing the run');
  const pageError=finalRunStatus({failures:[],receiptErrors:[{type:'network',error:'net::ERR_FAILED'}],cleanupErrors:[],cancelled:null});
  assert.equal(pageError.exitCode,1);
  const runError=finalRunStatus({failures:[],receiptErrors:[],cleanupErrors:[],cancelled:null,runError:'assertion stack'});
  assert.equal(runError.result,'failed');
  assert.equal(runError.exitCode,1,'a main-body failure always keeps the run failed');
});

test('run lifecycle installs bounded signal handling and one idempotent finalizer',async()=>{
  const registry=new Map(),removed=[],cleanupRuns=[];
  const lifecycle=createRunLifecycle({
    addSignalHandler:(signal,handler)=>{assert.ok(!registry.has(signal),'one handler per signal');registry.set(signal,handler);},
    removeSignalHandler:(signal,handler)=>{assert.equal(registry.get(signal),handler);registry.delete(signal);removed.push(signal);},
    signals:['SIGINT','SIGTERM'],
  });
  lifecycle.setCleanup(async()=>{cleanupRuns.push('run');return ['cleanup error sample'];});
  lifecycle.attach();
  assert.deepEqual([...registry.keys()].sort(),['SIGINT','SIGTERM']);
  assert.equal(lifecycle.guard('probe'),undefined);
  registry.get('SIGTERM')();
  assert.equal(lifecycle.stopped,true);
  assert.equal(lifecycle.cancelled,'SIGTERM');
  await assert.rejects(async()=>lifecycle.guard('resource creation'),/stopping|late/i);
  const first=await lifecycle.finalize();
  const second=await lifecycle.finalize();
  assert.equal(first,second,'the finalizer runs exactly once');
  assert.deepEqual(cleanupRuns,['run']);
  assert.deepEqual(first.errors,['cleanup error sample']);
  assert.equal(first.cancelled,'SIGTERM');
  assert.deepEqual(removed.sort(),['SIGINT','SIGTERM'],'handlers are removed after finalization');
  assert.deepEqual([...registry.keys()],[]);
  assert.throws(()=>lifecycle.setCleanup(async()=>[]),/finalization|registered/i);
  const status=finalRunStatus({failures:first.errors,receiptErrors:[],cleanupErrors:[],cancelled:first.cancelled});
  assert.equal(status.exitCode,1);
});

test('run lifecycle stop requests are idempotent and refuse late work',()=>{
  const lifecycle=createRunLifecycle({addSignalHandler:()=>{},removeSignalHandler:()=>{}});
  assert.equal(lifecycle.stopped,false);
  assert.equal(lifecycle.guard('initial work'),undefined);
  lifecycle.requestStop('SIGINT');
  lifecycle.requestStop('SIGTERM');
  assert.equal(lifecycle.cancelled,'SIGINT','the first cancellation reason is kept');
  assert.throws(()=>lifecycle.guard('late work'),/stopping|late/i);
  assert.equal(lifecycle.finalized,false,'no cleanup runs before finalize is requested');
});

test('product viewport binding records each current product route and keeps the version viewport separate',async()=>{
  const ANDROID_UA='Mozilla/5.0 (Linux; Android 14; sdk_gphone64_x86_64 Build/UE1A.230829.036) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36';
  const reads=[{width:393,height:781,dpr:2.75,ua:ANDROID_UA},{width:412,height:892,dpr:2.625,ua:ANDROID_UA}];
  let calls=0;
  const receipt={android:{versionViewport:{width:393,height:781,dpr:2.75,ua:ANDROID_UA}}};
  const home=await bindAndroidProductViewport({receipt,label:'home-cold',read:async()=>reads[calls++]});
  const library=await bindAndroidProductViewport({receipt,label:'library',read:async()=>reads[calls++]});
  assert.deepEqual(home,reads[0]);
  assert.equal(library.width,412,'each product route binds its own current width, not the internal version width');
  assert.deepEqual(receipt.android.productViewports,{'home-cold':reads[0],library:reads[1]});
  assert.deepEqual(receipt.android.versionViewport,reads[0],'the version viewport stays a separate record');
  const title='Alice’s Adventures in Wonderland';
  assert.deepEqual(resolveOriginalTitleProbe({viewportWidth:library.width,titleText:title,nodes:[{selector:'#library-books .binding-original',text:title,visible:true}]}),{kind:'probe',selector:'#library-books .binding-original',reason:'default-binding-original-visible'});
  for(const [label,viewport] of [
    ['desktop-ua',{width:412,height:892,dpr:2.625,ua:'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/155.0.0.0 Safari/537.36'}],
    ['enlarged',{width:1200,height:900,dpr:1,ua:ANDROID_UA}],
    ['missing-width',{height:892,dpr:2.625,ua:ANDROID_UA}],
  ])await assert.rejects(()=>bindAndroidProductViewport({receipt,label,read:async()=>viewport}),/user agent|width|viewport/i,label);
});


test('stock Chrome113 italic evidence retains a visual capability limit and requires same-document verified faces',()=>{
  const origin='http://localhost:43210',document={epoch:5,frameId:'main',loaderId:'reader-loader',url:origin+'/read?book=gutenberg-alice'};
  const value={label:'actual very',text:'very',style:'italic',fonts:[{familyName:'Newsreader 16pt',isCustomFont:true,glyphCount:4}],document,documentFontFaces:{stylesheetCount:1,declared:[{family:'Leafhour Serif',style:'italic',weight:'200 800',stretch:'normal',src:'url("/fonts/newsreader/newsreader-italic-var.woff2")'}],loaded:[{family:'Leafhour Serif',style:'italic',weight:'200 800',stretch:'normal',status:'loaded'}]}};
  const face={observedDuringDocument:document,fontFamily:'"Leafhour Serif"',fontStyle:'italic',platformFontFamily:'Newsreader 16pt',src:'url("/fonts/newsreader/newsreader-italic-var.woff2") format("woff2")'};
  const response={document,type:'Font',status:200,url:origin+'/fonts/newsreader/newsreader-italic-var.woff2',sha256:'verified-fixture-sha',bytes:239360};
  const config={browserProduct:'Chrome/113.0.5672.136',fontFaces:[face],fontResponses:[response],origin,expectedSha256:response.sha256};
  const actualProtocolProof=italicFontEvidence(value,{...config,fontFaces:[{...face,src:response.url}]});
  assert.equal(actualProtocolProof.method,'css-matching-and-visual','Chrome113 reports a bare source URL');
  const proof=italicFontEvidence(value,config);
  assert.equal(proof.method,'css-matching-and-visual');assert.equal(proof.perNodePostScriptIdentity,false);assert.equal(proof.requiresVisualReview,true);
  assert.equal(proof.document.loaderId,'reader-loader');assert.equal(proof.response.sha256,response.sha256);
  for(const change of [
    {browserProduct:'Chrome/153.0.0.0'},
    {fontFaces:[]},
    {fontFaces:[{...face,fontStyle:'normal'}]},
    {fontFaces:[{...face,src:'url("/fonts/newsreader/newsreader-var.woff2")'}]},
    {fontFaces:[{...face,src:'url("https://other.invalid/fonts/newsreader/newsreader-italic-var.woff2")'}]},
    {fontFaces:[{...face,observedDuringDocument:{...document,epoch:4}}]},
    {fontResponses:[{...response,document:{...document,loaderId:'previous-reader'}}]},
    {fontResponses:[{...response,sha256:'different-bytes'}]},
    {fontResponses:[{...response,status:404}]},
  ])assert.throws(()=>italicFontEvidence(value,{...config,...change}));
  for(const changed of [
    {...value,style:'normal'},
    {...value,documentFontFaces:{...value.documentFontFaces,loaded:[]}},
    {...value,documentFontFaces:{...value.documentFontFaces,declared:[]}},
    {...value,documentFontFaces:{...value.documentFontFaces,declared:[...value.documentFontFaces.declared,...value.documentFontFaces.declared]}},
    {...value,fonts:[{...value.fonts[0],glyphCount:3}]},
    {...value,fonts:[{...value.fonts[0],isCustomFont:false}]},
    {...value,fonts:[{...value.fonts[0],postScriptName:'NewsreaderRoman-Regular'}]},
  ])assert.throws(()=>italicFontEvidence(changed,config),'normal or ambiguous glyph evidence must fail');
  const modern=italicFontEvidence({...value,fonts:[{...value.fonts[0],postScriptName:'NewsreaderItalic-Italic'}]},{browserProduct:'Chrome/153.0.0.0'});
  assert.equal(modern.method,'postscript-name');assert.equal(modern.requiresVisualReview,true);
});

test('font observation binds actual frame and loader epochs rather than mutable page labels',async()=>{
  const handlers=new Map(),receipt={fonts:[],checks:[],screenshots:[],errors:[]},failures=[];
  const session=createEvidenceSession({cdp:{on:(event,handler)=>{handlers.set(event,handler);return ()=>handlers.delete(event);},send:async()=>({}),close:async()=>{}},receipt,failures});
  session.observeResponses();session.setPageLabel('reader');
  handlers.get('Page.frameNavigated')({frame:{id:'main',loaderId:'old-loader',url:'http://localhost:43210/read'}});
  const font={fontFamily:'Leafhour Serif',fontStyle:'italic',platformFontFamily:'Newsreader 16pt',src:'url("/fonts/newsreader/newsreader-italic-var.woff2")'};
  handlers.get('CSS.fontsUpdated')({font});
  handlers.get('Page.frameNavigated')({frame:{id:'subframe',parentId:'main',loaderId:'sub-loader',url:'http://localhost:43210/other'}});
  handlers.get('Page.frameNavigated')({frame:{id:'main',loaderId:'new-loader',url:'http://localhost:43210/read'}});
  handlers.get('CSS.fontsUpdated')({font});
  assert.deepEqual(receipt.fontFaces.map(f=>[f.observedDuringDocument.epoch,f.observedDuringDocument.loaderId]),[[1,'old-loader'],[2,'new-loader']]);
  assert.equal(receipt.fontFaces[0].document,undefined,'the frame-less event must never claim its source document');
  for(let i=0;i<40;i++)handlers.get('CSS.fontsUpdated')({font});
  assert.equal(receipt.fontFaces.length,32);assert.ok(failures.some(x=>/Bounded/.test(x)));
  await session.close();assert.equal(handlers.size,0,'frame/face observers also release on finalization');
});


test('the serialized main-document font observation reads its own CSS declarations and loaded FontFaceSet',()=>{
  const previous={document:globalThis.document,location:globalThis.location};
  try{
    const style={getPropertyValue:name=>({'font-family':'"Leafhour Serif"','font-style':'italic','font-weight':'200 800',src:'url("/fonts/newsreader/newsreader-italic-var.woff2")'}[name]||'')};
    globalThis.location={origin:'http://localhost:43210'};
    globalThis.document={styleSheets:[{href:'http://localhost:43210/typography.css',cssRules:[{type:5,style}]}],fonts:[{family:'Leafhour Serif',style:'italic',weight:'200 800',stretch:'normal',status:'loaded'},{family:'Leafhour Serif',style:'normal',weight:'200 800',stretch:'normal',status:'loading'}]};
    const evidence=vm.runInNewContext('('+observeDocumentFontFaces.toString()+')()',{document:globalThis.document,location:globalThis.location,URL});
    assert.equal(evidence.stylesheetCount,1);assert.equal(evidence.declared.length,1);assert.equal(evidence.loaded.length,1);
    assert.equal(evidence.declared[0].stretch,evidence.loaded[0].stretch);
    globalThis.document.fonts=[];
    assert.deepEqual(observeDocumentFontFaces().loaded,[],'an unrelated protocol event cannot invent a loaded main-document FontFace');
  }finally{for(const [key,value] of Object.entries(previous)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}
});
