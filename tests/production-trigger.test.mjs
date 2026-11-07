import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {shouldVerify} from '../tools/production-trigger.mjs';

const legacy = {git:{deploymentEnabled:{'**':false,main:true}}};
const hourly = {git:{deploymentEnabled:{'**':false,production:true}}};
const run = {workflow_run:{event:'push',conclusion:'success',head_branch:'main',head_repository:{full_name:'getyak/leafhour'}}};
test('legacy mode verifies successful main CI and ignores other event sources', () => {
  assert.equal(shouldVerify('workflow_run', run, 'refs/heads/main', legacy), true);
  assert.equal(shouldVerify('push', {}, 'refs/heads/production', legacy), false);
  assert.equal(shouldVerify('workflow_run', {...run,workflow_run:{...run.workflow_run,event:'pull_request'}}, 'refs/heads/main', legacy), false);
});
test('hourly mode verifies only production ref updates, not every intermediate main CI', () => {
  assert.equal(shouldVerify('workflow_run', run, 'refs/heads/main', hourly), false);
  assert.equal(shouldVerify('push', {}, 'refs/heads/production', hourly), true);
  assert.equal(shouldVerify('push', {}, 'refs/heads/feature', hourly), false);
});
test('a mixed or unknown deployment policy cannot silently verify the wrong chain', () => {
  for (const enabled of [true, {'**':false,main:true,production:true}, {'production':true}, {'**':false,production:true,'preview-*':true}]) {
    assert.throws(() => shouldVerify('workflow_run', run, 'refs/heads/main', {git:{deploymentEnabled:enabled}}), /single publication chain/);
  }
});

test('the actual cutover config leaves main and PR branches disabled', () => {
  const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url)));
  assert.deepEqual(config.git.deploymentEnabled, {'**':false,production:true});
  assert.equal(shouldVerify('workflow_run', run, 'refs/heads/main', config), false);
  assert.equal(shouldVerify('push', {}, 'refs/heads/production', legacy), false);
});
