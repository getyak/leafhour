import {spawnSync} from 'node:child_process';
import {readdir} from 'node:fs/promises';

// Production runtime credentials must never reach test servers or model adapters.
const environment=Object.fromEntries(['PATH','HOME','TMPDIR','TMP','TEMP','SystemRoot','CI'].filter(key=>process.env[key]!==undefined).map(key=>[key,process.env[key]]));
const tests=(await readdir('tests')).filter(file=>file.endsWith('.test.mjs')).sort().map(file=>'tests/'+file);
for(const args of [['--test',...tests],['tools/build-vercel.mjs'],['tools/release-policy.mjs'],['tools/verify-release.mjs']]){
  const result=spawnSync(process.execPath,args,{env:environment,stdio:'inherit'});
  if(result.error)throw result.error;if(result.status!==0)process.exit(result.status||1);
}
