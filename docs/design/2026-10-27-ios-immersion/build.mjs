import {spawnSync} from 'node:child_process';import path from 'node:path';import {fileURLToPath} from 'node:url';import fs from 'node:fs/promises';
const root=path.dirname(fileURLToPath(import.meta.url)),old=path.resolve(root,'../2026-10-27-ios-polish');
for(const file of ['build-diagram.mjs','verify-immersion.mjs','verify-regressions.mjs','../2026-10-27-ios-polish/build-vectors.mjs','render-artifacts.mjs']){
 const r=spawnSync(process.execPath,[path.resolve(root,file)],{stdio:'inherit',env:{...process.env,LEAFHOUR_DESIGN_OUTPUT:root}});if(r.status!==0)throw Error(file+' failed');
}
await fs.copyFile(root+'/Leafhour-iOS-prototype.html',old+'/Leafhour-iOS-prototype.html');
