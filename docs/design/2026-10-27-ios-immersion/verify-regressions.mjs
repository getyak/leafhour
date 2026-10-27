import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';import {spawnSync} from 'node:child_process';
const here=path.dirname(fileURLToPath(import.meta.url)),source=path.resolve(here,'../2026-10-27-ios-polish');
const sandbox=await fs.mkdtemp(path.join(os.tmpdir(),'leafhour-immersion-')),mirror=path.join(sandbox,'2026-10-27-ios-polish'),out=path.join(here,'evidence','prior-regressions');
await fs.mkdir(mirror,{recursive:true});await fs.mkdir(out,{recursive:true});for(const folder of ['captures','exports','evidence'])await fs.mkdir(path.join(mirror,folder));
await fs.cp(path.join(source,'prototype'),path.join(mirror,'prototype'),{recursive:true});
for(const name of (await fs.readdir(source)).filter(n=>n.endsWith('.mjs')))await fs.copyFile(path.join(source,name),path.join(mirror,name));
const original=path.join(sandbox,'2026-10-26-ios-half-sheet');await fs.mkdir(original);await fs.copyFile(path.resolve(here,'../2026-10-26-ios-half-sheet/capture-dom.mjs'),path.join(original,'capture-dom.mjs'));
const scripts={'verify-polish.mjs':'evidence/polish-verification.json','verify-reading-position.mjs':'evidence/reading-position-verification.json','verify-companion-context.mjs':'evidence/companion-context-verification.json','verify-note-recovery.mjs':'evidence/note-recovery-verification.json','verify-prototype.mjs':'verification.json'};
try{for(const [script,report] of Object.entries(scripts)){
 if(process.argv.length>2&&!process.argv.slice(2).includes(script))continue;
 const r=spawnSync(process.execPath,[path.join(mirror,script)],{env:process.env,encoding:'utf8',maxBuffer:10*1024*1024});await fs.writeFile(path.join(out,script+'.log'),r.stdout+'\n'+r.stderr);
 try{await fs.copyFile(path.join(mirror,report),path.join(out,script.replace('.mjs','.json')));}catch{}
 process.stdout.write(r.stdout);if(r.status!==0)throw Error(script+' failed; exact output retained under evidence/prior-regressions');
}}finally{await fs.rm(sandbox,{recursive:true,force:true});}
