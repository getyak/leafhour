import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

test('deployment tests receive only the explicit copy tool paths; runtime stages and provider credentials stay isolated',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'copy-ci-environment-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(path.join(root,'tools'));
  await mkdir(path.join(root,'tests'));
  await writeFile(path.join(root,'tools/verify-deploy.mjs'),await readFile(new URL('../tools/verify-deploy.mjs',import.meta.url)));
  const assertions=`
    import assert from 'node:assert/strict';
    import {appendFileSync} from 'node:fs';
    for(const name of ['DEEPSEEK_API_KEY','OPENAI_API_KEY','MIMO_TOKEN_PLAN_KEY','LEAFHOUR_UNRELATED_SECRET'])assert.equal(process.env[name],undefined,name+' must not reach child stages');
  `;
  const record=`appendFileSync('stages.jsonl',JSON.stringify({stage:process.argv[1].split('/').at(-1)})+'\\n');`;
  await writeFile(path.join(root,'tests/probe.test.mjs'),assertions+`
    assert.equal(process.env.LEAFHOUR_VALE_BIN,'/fixture/vale');
    assert.equal(process.env.LEAFHOUR_TEXTLINT_BIN,'/fixture/textlint');
    ${record}
  `);
  const runtime=assertions+`
    assert.equal(process.env.LEAFHOUR_VALE_BIN,undefined);
    assert.equal(process.env.LEAFHOUR_TEXTLINT_BIN,undefined);
    ${record}
  `;
  for(const file of ['build-reader-runtime.mjs','build-vercel.mjs','check-public-build.mjs','release-policy.mjs','verify-release.mjs'])await writeFile(path.join(root,'tools',file),runtime);
  const result=spawnSync(process.execPath,['tools/verify-deploy.mjs'],{
    cwd:root,encoding:'utf8',env:{
      PATH:process.env.PATH,HOME:root,TMPDIR:root,
      LEAFHOUR_VALE_BIN:'/fixture/vale',LEAFHOUR_TEXTLINT_BIN:'/fixture/textlint',
      DEEPSEEK_API_KEY:'synthetic-placeholder',OPENAI_API_KEY:'synthetic-placeholder',
      MIMO_TOKEN_PLAN_KEY:'synthetic-placeholder',LEAFHOUR_UNRELATED_SECRET:'synthetic-placeholder'
    }
  });
  assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
  const stages=(await readFile(path.join(root,'stages.jsonl'),'utf8')).trim().split('\n').map(row=>JSON.parse(row));
  assert.deepEqual(stages.map(row=>row.stage),['probe.test.mjs','build-reader-runtime.mjs','build-vercel.mjs','check-public-build.mjs','release-policy.mjs','verify-release.mjs']);
});
