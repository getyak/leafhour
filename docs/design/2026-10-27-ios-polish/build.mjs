import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
for(const file of ['verify-prototype.mjs','build-vectors.mjs','render-artifacts.mjs']){
  const result=spawnSync(process.execPath,[path.join(root,file)],{stdio:'inherit',env:process.env});
  if(result.status!==0) throw Error(file+' failed: '+(result.signal||result.status));
}
