// Offline only: copy/hash the actual bounded parent, source dependency closure,
// already-built public assets and the reviewed native inputs. Never listen,
// acquire a lease, load native code, spawn a helper or run a build.
import {readFile,writeFile,mkdir,realpath,stat} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {parse} from 'acorn';

const SOURCE='d302393d4ed01a82af6828d7200969be3b8addc9';
const MIRROR_FREEZE='465d10133543a177fb6b5d40368e654d07310abe5bf3b60562eae247064dcd16';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const repo=fileURLToPath(new URL('..',import.meta.url)),args=process.argv.slice(2);
if(args.length!==4||args[0]!=='--artifact'||args[2]!=='--mirror-inputs'){
 process.stderr.write('Usage: node tools/prepare-get273-safari-parent.mjs --artifact <existing-own-artifact> --mirror-inputs <reviewed-mirror-artifact>\n');process.exitCode=64;
}else{
 const root=await realpath(args[1]),mirror=await realpath(args[3]);
 if(await stat(path.join(root,'execution-freeze.json')).then(()=>true,()=>false))throw Error('Execution freeze already exists');
 if(execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim()!==SOURCE)throw Error('Source changed');
 execFileSync('git',['diff','--exit-code','HEAD','--','app','server','package.json','package-lock.json','release-files.json','tools/build-vercel.mjs'],{cwd:repo,stdio:'pipe'});
 const mirrorBytes=await readFile(path.join(mirror,'execution-freeze.json'));if(sha(mirrorBytes)!==MIRROR_FREEZE)throw Error('Unreviewed mirror freeze');
 const mirrorFreeze=JSON.parse(mirrorBytes),files={};let copiedBytes=0;
 async function put(relative,bytes){
  if(!/^(?:frozen-inputs|app|server|native|build)\/[A-Za-z0-9_./-]+$/.test(relative)||relative.split('/').includes('..'))throw Error('Pack path');
  const target=path.join(root,relative);await mkdir(path.dirname(target),{recursive:true});
  const hash=sha(bytes),old=await readFile(target).catch(()=>null);if(old&&!old.equals(bytes))throw Error('Existing input differs');
  if(!old){await writeFile(target,bytes,{flag:'wx',mode:relative.startsWith('native/')?0o700:0o600});copiedBytes+=bytes.length;}
  files[relative]=hash;
 }
 for(const [relative,expected]of Object.entries(mirrorFreeze.files)){
  const file=await realpath(path.join(mirror,relative));if(!file.startsWith(mirror+path.sep))throw Error('Mirror path');
  const bytes=await readFile(file);if(sha(bytes)!==expected)throw Error('Mirror input changed');await put(relative,bytes);
 }
 const queue=['tools/get273-safari-parent.mjs','tools/get273-safari-parent-control.mjs','tools/get273-safari-fixture.mjs','tools/get273-safari-observer.js',
  'tools/get273-mirror-adapter.mjs','tools/get273-mirror-runtime.mjs','tools/get273-mirror-control.mjs'];
 const seen=new Set();
 while(queue.length){
  const relative=queue.shift();if(seen.has(relative))continue;seen.add(relative);
  if(!/^(?:tools|server|app)\/[A-Za-z0-9_./-]+$/.test(relative)||relative.split('/').includes('..'))throw Error('Source path');
  const file=await realpath(path.join(repo,relative));if(!file.startsWith(repo))throw Error('Source realpath');
  const bytes=await readFile(file),target=relative.startsWith('tools/')?'frozen-inputs/'+path.basename(relative):relative;
  await put(target,bytes);
  const ast=parse(bytes.toString('utf8'),{ecmaVersion:'latest',sourceType:'module'});
  const visit=node=>{if(!node||typeof node!=='object')return;
   if(['ImportDeclaration','ExportNamedDeclaration','ExportAllDeclaration','ImportExpression'].includes(node.type)&&node.source){
    const specifier=node.source.value;if(typeof specifier!=='string')throw Error('Nonliteral source import');
    if(specifier.startsWith('.'))queue.push(path.posix.normalize(path.posix.join(path.posix.dirname(relative),specifier)));
    else if(!specifier.startsWith('node:'))throw Error('External runtime import');
   }
   for(const value of Object.values(node))if(value&&typeof value==='object'){if(Array.isArray(value))value.forEach(visit);else visit(value);}
  };visit(ast);
 }
 for(const relative of ['tests/get273-safari-parent.test.mjs','tests/get273-safari-parent-io.test.mjs','tests/get273-safari-parent-freeze.test.mjs','tools/prepare-get273-safari-parent.mjs',
   'docs/verification/2026-11-07-get-273-safari-parent.md','docs/verification/2026-11-07-get-273-mirror-contract.md','docs/verification/2026-11-07-get-273-mobile-safari-plan.md'])await put('frozen-inputs/'+path.basename(relative),await readFile(path.join(repo,relative)));
 const provenance={
  'release.json':'2013128a2a3c865ffbfc0d0be7dc543e2df03e309a38f60a65a256d01b0cdc92',
  'offline-resources.json':'0d77f45d83e006e3625437e04268eef6f33947c3480a7b8abf70b844113c74ca',
  'read-template.html':'a0001c19bc11356dc33e11c8086a1c4b8321c79136ee8a39aa8ade24cdf06ce2',
 };
 for(const [name,hash]of Object.entries(provenance)){
  const bytes=await readFile(path.join(repo,name==='read-template.html'?'.ui-entry/read.html':'dist/'+name));if(sha(bytes)!==hash)throw Error('Frozen build provenance changed');await put('build/'+name,bytes);
 }
 const manifest=JSON.parse(await readFile(path.join(root,'build/offline-resources.json')));
 for(const asset of manifest.resources??[]){
  if(!/\.(?:js|mjs|css|svg|png|webp|woff2?|ttf|otf|ogg|mp3)$/.test(asset.url)||asset.url==='/reading-worker.js')continue;
  if(!/^\/[A-Za-z0-9_./-]+$/.test(asset.url)||asset.url.split('/').includes('..'))throw Error('Asset path');
  const file=await realpath(path.join(repo,'dist',asset.url.slice(1)));if(!file.startsWith(path.join(repo,'dist')+path.sep))throw Error('Asset realpath');
  const bytes=await readFile(file);if(bytes.length!==asset.bytes||sha(bytes)!==asset.sha256)throw Error('Asset provenance changed');await put('build'+asset.url,bytes);
 }
 const freeze={kind:'GET-273-Safari-parent-execution',sourceCommit:SOURCE,sourceTree:execFileSync('git',['rev-parse','HEAD^{tree}'],{cwd:repo,encoding:'utf8'}).trim(),nodeVersion:process.version,
  upstreamMirrorFreezeSHA256:MIRROR_FREEZE,externalToolHashes:{'dev-ios-session':sha(await readFile('/Users/cubxxw/.local/bin/dev-ios-session'))},files,
  scope:'offline parent preparation; no native/addon/lease/UI/build executed',nativeAcceptance:'unrun',deviceActions:0,
  outerWrapperSignalBoundary:'existing owner SIGTERM escalates to SIGKILL after 10 seconds; use parent stdin stop, retain wrapper during blocked state',
 };
 const bytes=Buffer.from(JSON.stringify(freeze,null,2)+'\n');await writeFile(path.join(root,'execution-freeze.json'),bytes,{flag:'wx',mode:0o600});
 console.log(JSON.stringify({freezeSHA256:sha(bytes),files:Object.keys(files).length,copiedBytes,nativeAcceptance:'unrun',deviceActions:0}));
}
