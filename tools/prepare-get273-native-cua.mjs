// Offline packaging only: reuse the prior immutable synthetic build, no build,
// server, native addon, Simulator query, lease or UI. No mirror inputs copied.
import {readFile,writeFile,mkdir,realpath,stat} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import path from 'node:path';
const SOURCE='d302393d4ed01a82af6828d7200969be3b8addc9',PRIOR='8dcc8e01bc4c797fe1f4b972ecf4846c485e8a7947d5a2ad7893758773ca979a';
const sha=x=>createHash('sha256').update(x).digest('hex'),repo=fileURLToPath(new URL('..',import.meta.url)),args=process.argv.slice(2);
if(args.length!==4||args[0]!=='--artifact'||args[2]!=='--fixture-inputs'){
 process.stderr.write('Usage: node tools/prepare-get273-native-cua.mjs --artifact <own-artifact> --fixture-inputs <immutable-v3-pack>\n');process.exitCode=64;
}else{
 const root=await realpath(args[1]),prior=await realpath(args[3]);
 if(await stat(path.join(root,'execution-freeze.json')).then(()=>true,()=>false))throw Error('Freeze already exists');
 if(execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim()!==SOURCE)throw Error('Product baseline changed');
 execFileSync('git',['diff','--exit-code','HEAD','--','app','server','package.json','package-lock.json'],{cwd:repo,stdio:'pipe'});
 const bytes=await readFile(path.join(prior,'execution-freeze.json'));if(sha(bytes)!==PRIOR)throw Error('Unknown fixture source freeze');
 const old=JSON.parse(bytes),files={};let copiedBytes=0;
 async function put(relative,bytes){
  if(!/^(?:tools|tests|docs|app|server|build)\/[A-Za-z0-9_./-]+$/.test(relative)||relative.split('/').includes('..'))throw Error('Pack path');
  const to=path.join(root,relative);await mkdir(path.dirname(to),{recursive:true});await writeFile(to,bytes,{flag:'wx',mode:0o600});files[relative]=sha(bytes);copiedBytes+=bytes.length;
 }
 for(const [relative,expected]of Object.entries(old.files)){
  const file=await realpath(path.join(prior,relative));if(!file.startsWith(prior+path.sep))throw Error('Prior source escaped');
  const value=await readFile(file);if(sha(value)!==expected)throw Error('Prior immutable input changed');
  if(/^(app|server|build)\//.test(relative))await put(relative,value);
 }
 for(const name of ['get273-safari-fixture.mjs','get273-safari-observer.js']){
  const value=await readFile(path.join(repo,'tools',name));if(sha(value)!==old.files['frozen-inputs/'+name])throw Error('Existing fixture changed');await put('tools/'+name,value);
 }
 for(const relative of ['tools/get273-native-cua.mjs','tools/get273-native-cua-control.mjs','tools/get273-native-cua-route.js','tools/prepare-get273-native-cua.mjs',
  'tests/get273-native-cua-control.test.mjs','tests/get273-native-cua-route.test.mjs','tests/get273-native-cua-entry.test.mjs','tests/get273-native-cua-freeze.test.mjs',
  'docs/verification/2026-11-07-get-273-native-cua-execution.md','docs/verification/2026-11-07-get-273-native-cua-probe-plan.md'])await put(relative,await readFile(path.join(repo,relative)));
 await mkdir(path.join(root,'screenshots'),{recursive:true});
 const f={kind:'GET-273-native-CUA-single-hold',sourceCommit:SOURCE,sourceTree:execFileSync('git',['rev-parse','HEAD^{tree}'],{cwd:repo,encoding:'utf8'}).trim(),nodeVersion:process.version,
  priorFixtureFreezeSHA256:PRIOR,externalToolHashes:{'dev-ios-session':sha(await readFile('/Users/cubxxw/.local/bin/dev-ios-session'))},files,
  scope:'source/offdevice preparation only; root scheduling and genuine lease still required; one 700ms hold, no drag or mirror',nativeAcceptance:'unrun',deviceActions:0,
  limitations:['Operator ACKs require the actual fulfilled CUA tool transcript.','OS input release unknown.','10min deadline holds and does not cancel/release the wrapper.','External wrapper signals may escalate to SIGKILL after 10s; never cancel pending native input.']};
 const output=Buffer.from(JSON.stringify(f,null,2)+'\n');await writeFile(path.join(root,'execution-freeze.json'),output,{flag:'wx',mode:0o600});
 console.log(JSON.stringify({freezeSHA256:sha(output),files:Object.keys(files).length,copiedBytes,nativeAcceptance:'unrun',deviceActions:0}));
}
