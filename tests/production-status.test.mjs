import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {assertDeploymentNotRejected} from '../tools/production-status.mjs';

const options = {repository:'getyak/leafhour', commit:'a'.repeat(40), token:'synthetic-token'};
test('a rejected exact-source Vercel deployment ends the production wait immediately', async () => {
  for (const state of ['failure', 'error']) {
    let calls = 0;
    await assert.rejects(assertDeploymentNotRejected({...options, fetchImpl:async (url, init) => {
      calls++;
      assert.equal(url, 'https://api.github.com/repos/getyak/leafhour/commits/' + options.commit + '/status?per_page=100');
      assert.equal(init.redirect, 'error');
      return Response.json({statuses:[{context:'Vercel', state}]});
    }}), /Vercel rejected deployment/);
    assert.equal(calls, 1);
  }
});
test('only the latest status for the Vercel context can stop a wait', async () => {
  for (const statuses of [[], [{context:'Vercel', state:'pending'}], [{context:'Vercel', state:'success'}], [{context:'CI', state:'failure'}], [{context:'Vercel', state:'pending'}, {context:'Vercel', state:'failure'}]]) {
    await assertDeploymentNotRejected({...options, fetchImpl:async () => Response.json({statuses})});
  }
});
test('missing local credentials avoid API access, and malformed sources or unreadable statuses fail clearly', async () => {
  await assertDeploymentNotRejected({fetchImpl:async () => { throw Error('unexpected network'); }});
  for (const change of [{repository:'other/repo'}, {commit:'short'}]) {
    await assert.rejects(assertDeploymentNotRejected({...options, ...change}), /Invalid production/);
  }
  await assert.rejects(assertDeploymentNotRejected({...options, fetchImpl:async () => new Response('', {status:403})}), /status lookup returned 403/);
  await assert.rejects(assertDeploymentNotRejected({...options, fetchImpl:async () => Response.json({})}), /Invalid deployment statuses/);
});
test('the actual smoke entry does not swallow provider failure inside the retry loop', () => {
  const source = `let calls=0;globalThis.fetch=async url=>{calls++;if(new URL(url).origin!=='https://api.github.com')throw Error('unexpected application request');return Response.json({statuses:[{context:'Vercel',state:'failure'}]});};
  try{await import(${JSON.stringify(new URL('../tools/smoke-release.mjs',import.meta.url).href)});throw Error('unexpected success');}catch(error){console.log(JSON.stringify({calls,message:error.message}));}`;
  const result = JSON.parse(execFileSync(process.execPath, ['--input-type=module','-e',source], {
    env:{PATH:process.env.PATH, EXPECTED_SOURCE_COMMIT:options.commit, GITHUB_REPOSITORY:options.repository, GH_STATUS_TOKEN:options.token},
    encoding:'utf8', timeout:5000,
  }));
  assert.equal(result.calls, 1);
  assert.match(result.message, /Vercel rejected deployment/);
});
