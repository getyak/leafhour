import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, mkdir, stat, symlink, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const temporary = async t => { const dir = await mkdtemp(path.join(os.tmpdir(), 'leafhour-ops-')); t.after(() => rm(dir, {recursive: true, force: true})); return dir; };
const load = () => import('../operations.mjs');

test('Serve addition preserves every unrelated port, Funnel and unknown future setting', async t => {
  const {tailscaleAdd, tailscaleRemove} = await load();
  const dir = await temporary(t);
  const original = {TCP: {'443': {HTTPS: true}}, Web: {'host:443': {Handlers: {'/': {Proxy: 'http://127.0.0.1:9000'}}}}, AllowFunnel: {'host:443': true}, Future: {keep: [1, 2]}};
  let current = structuredClone(original); const calls = [];
  const run = async (_, args) => { calls.push(args); if (args[1] === 'status') return JSON.stringify(current); if (args.at(-1) === 'off') { delete current.TCP['19443']; delete current.Web['host:19443']; } else { current.TCP['19443'] = {HTTPS: true}; current.Web['host:19443'] = {Handlers: {'/': {Proxy: 'http://127.0.0.1:18330'}}}; } return ''; };
  const receipt = path.join(dir, 'serve.json');
  await tailscaleAdd({receipt, hostname: 'host', run});
  assert.deepEqual(current.AllowFunnel, original.AllowFunnel);
  assert.equal((await stat(receipt)).mode & 0o777, 0o600);
  current.Future.concurrent = true;
  await tailscaleRemove({receipt, run});
  assert.deepEqual(current, {...original, Future: {...original.Future, concurrent: true}});
  assert.ok(!calls.flat().some(x => ['reset', 'set-config', 'funnel'].includes(x)));
});

test('Serve fails closed on an occupied port and changed owned entry', async t => {
  const {tailscaleAdd, tailscaleRemove} = await load(); const dir = await temporary(t);
  let current = {TCP: {'19443': {HTTPS: true}}, Web: {'host:19443': {Handlers: {'/': {Proxy: 'http://other'}}}}};
  const run = async (_, args) => args[1] === 'status' ? JSON.stringify(current) : assert.fail('must not mutate');
  await assert.rejects(tailscaleAdd({receipt: path.join(dir, 'occupied.json'), hostname: 'host', run}), /occupied/);
  await writeFile(path.join(dir, 'changed.json'), JSON.stringify({hostname: 'host', added: {TCP: {HTTPS: true}, Web: {Handlers: {'/': {Proxy: 'http://127.0.0.1:18330'}}}}}), {mode: 0o600});
  await assert.rejects(tailscaleRemove({receipt: path.join(dir, 'changed.json'), run}), /changed/);
});

test('artifact verifier detects tampering, extra files and unsafe symlinks', async t => {
  const {writeManifest, verifyArtifact} = await load(); const dir = await temporary(t);
  await mkdir(path.join(dir, 'app')); await writeFile(path.join(dir, 'app', 'server.mjs'), 'export {};');
  await writeManifest(dir, {sourceCommit: 'a'.repeat(40), target: 'darwin-arm64', protocol: 1});
  assert.equal((await verifyArtifact(dir)).sourceCommit, 'a'.repeat(40));
  await writeFile(path.join(dir, 'app', 'server.mjs'), 'changed');
  await assert.rejects(verifyArtifact(dir), /digest/);
  await writeFile(path.join(dir, 'app', 'server.mjs'), 'export {};'); await writeFile(path.join(dir, '.env'), 'private');
  await assert.rejects(verifyArtifact(dir), /unlisted|secret/);
  await rm(path.join(dir, '.env')); await symlink('/etc/hosts', path.join(dir, 'escape'));
  await assert.rejects(verifyArtifact(dir), /symlink/);
});

test('failed post-activation cleanup freezes candidate before restoring previous execution', async t => {
  const {cutover} = await load(); const dir = await temporary(t); const calls = [];
  const hooks = Object.fromEntries(['verifyCandidate', 'pauseOldAgent', 'waitOldAgentDrained', 'validateProxy', 'reloadProxy', 'verifyProxy', 'startNewAgent', 'freezeCandidate', 'rollbackProxy', 'resumeOldAgent'].map(name => [name, async () => calls.push(name)]));
  hooks.stopOldApi = async () => { throw Error('cleanup failed'); };
  await assert.rejects(cutover({root: dir, candidate: {id: 'new'}, previous: {id: 'old'}, hooks}), /cleanup failed/);
  assert.ok(calls.indexOf('freezeCandidate') > calls.indexOf('startNewAgent'));
  assert.ok(calls.indexOf('freezeCandidate') < calls.indexOf('rollbackProxy'));
  assert.ok(calls.indexOf('rollbackProxy') < calls.indexOf('resumeOldAgent'));
});

test('private configuration rejects permissive files and provider keys on API', async t => {
  const {readPrivateJson, serviceEnvironment} = await load(); const dir = await temporary(t); const file = path.join(dir, 'config.json');
  await writeFile(file, '{}', {mode: 0o644}); await assert.rejects(readPrivateJson(file), /permissions/);
  const config = {root: dir, mode: 'user-trial', apiEnv: {DEEPSEEK_API_KEY: 'synthetic-test-only'}};
  assert.throws(() => serviceEnvironment(config, 'api', {release: dir, apiPort: 18331, socket: path.join(dir, 'ipc.sock')}), /provider/);
});

test('launchd specifications separate system identities and keep secrets outside arguments', async () => {
  const {launchdPlist} = await load(); const config = {root: '/Library/Application Support/Leafhour', mode: 'system-service'};
  const plist = launchdPlist(config, 'api', 'candidate');
  assert.match(plist, /_leafhour_api/); assert.match(plist, /ExitTimeOut/); assert.match(plist, /candidate/);
  assert.ok(!plist.includes('API_KEY')); assert.ok(!plist.includes('<key>EnvironmentVariables</key>'));
  assert.throws(() => launchdPlist({...config, mode: 'guessed'}, 'api', 'candidate'), /mode/);
});

test('candidate slot names cannot overwrite environment or active proxy configuration', async () => {
  const {validSlot} = await load();
  for (const id of ['env', 'active', 'frontdoor', 'instance']) assert.throws(() => validSlot(id), /reserved/);
  assert.equal(validSlot('slot-a'), 'slot-a');
});

test('cutover persists recovery state, drains before route change and verifies before resuming', async t => {
  const {cutover} = await load(); const dir = await temporary(t); const calls = [];
  const hooks = Object.fromEntries(['verifyCandidate', 'pauseOldAgent', 'waitOldAgentDrained', 'validateProxy', 'reloadProxy', 'verifyProxy', 'startNewAgent', 'stopOldApi'].map(name => [name, async () => calls.push(name)]));
  await cutover({root: dir, candidate: {id: 'new'}, previous: {id: 'old'}, hooks});
  assert.deepEqual(calls, ['verifyCandidate', 'pauseOldAgent', 'waitOldAgentDrained', 'validateProxy', 'reloadProxy', 'verifyProxy', 'startNewAgent', 'stopOldApi']);
  assert.equal(JSON.parse(await readFile(path.join(dir, 'state', 'deployment.json'))).phase, 'active');
});

test('cutover failure after reload rolls proxy back and never starts new Agent', async t => {
  const {cutover} = await load(); const dir = await temporary(t); const calls = [];
  const hooks = Object.fromEntries(['verifyCandidate', 'pauseOldAgent', 'waitOldAgentDrained', 'validateProxy', 'reloadProxy', 'startNewAgent', 'stopOldApi', 'rollbackProxy', 'resumeOldAgent'].map(name => [name, async () => calls.push(name)]));
  hooks.verifyProxy = async () => { throw Error('synthetic failure'); };
  await assert.rejects(cutover({root: dir, candidate: {id: 'new'}, previous: {id: 'old'}, hooks}), /synthetic failure/);
  assert.ok(calls.includes('rollbackProxy')); assert.ok(calls.includes('resumeOldAgent')); assert.ok(!calls.includes('startNewAgent'));
  assert.equal(JSON.parse(await readFile(path.join(dir, 'state', 'deployment.json'))).phase, 'rollback');
});
