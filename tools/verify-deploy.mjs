import {spawnSync} from 'node:child_process';
import {readdir} from 'node:fs/promises';

// Production runtime credentials must never reach test servers or model adapters.
const environment=Object.fromEntries(['PATH','HOME','TMPDIR','TMP','TEMP','SystemRoot','CI','VERCEL_GIT_COMMIT_SHA','GITHUB_SHA'].filter(key=>process.env[key]!==undefined).map(key=>[key,process.env[key]]));
const tests=(await readdir('tests')).filter(file=>file.endsWith('.test.mjs')).sort().map(file=>'tests/'+file);
// Vercel filters source files through .vercelignore before starting its build.
// Full deployment snapshot validation runs in Actions before production verification.
// Bound concurrent full-catalog fixtures so shared editions do not multiply memory use by host CPU count.
const stages=[['tools/build-ui-first-paint-script.mjs','--check'],['tools/check-pricing.mjs'],['--test','--max-old-space-size=1536','--test-concurrency=1',...tests],['tools/build-reader-runtime.mjs'],['tools/build-vercel.mjs'],['tools/check-public-build.mjs','dist'],...(process.argv.includes('--hosted')?[]:[['tools/release-policy.mjs']]),['tools/verify-release.mjs']];
for(const args of stages){
  const stageEnvironment={...environment};
  // These are executable paths, not credentials. Only the test stage needs
  // them; runtime builders retain the original restricted environment.
  if(args[0]==='--test')for(const key of ['LEAFHOUR_VALE_BIN','LEAFHOUR_TEXTLINT_BIN']){
    if(process.env[key]!==undefined)stageEnvironment[key]=process.env[key];
  }
  // Native PostgreSQL is mandatory in the preceding GitHub CI gate. Vercel
  // repeats portable tests without an installed database engine.
  if(args[0]==='--test'&&process.argv.includes('--hosted')&&process.env.VERCEL==='1')stageEnvironment.LEAFHOUR_HOSTED_BUILD_TESTS='1';
  if(args[0]==='tools/build-reader-runtime.mjs'&&process.env.VERCEL==='1')stageEnvironment.VERCEL='1';
  const result=spawnSync(process.execPath,args,{env:stageEnvironment,stdio:'inherit'});
  if(result.error)throw result.error;if(result.status!==0)process.exit(result.status||1);
}
