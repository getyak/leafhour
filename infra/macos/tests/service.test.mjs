import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rm, symlink, realpath} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import os from 'node:os';
import path from 'node:path';

test('runtime logs allow operational fields only and rotate within Leafhour directory', async t => {
  const {operationalLine, appendRotating} = await import('../service.mjs');
  assert.equal(operationalLine('private book or question'), null);
  assert.equal(operationalLine(JSON.stringify({event: 'request_complete', status: 200, token: 'secret', message: 'private question', durationMs: 14})), '{"event":"request_complete","status":200,"durationMs":14}\n');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'leafhour-logs-')); t.after(() => rm(dir, {recursive: true, force: true}));
  const log = path.join(dir, 'run.log'); await writeFile(log, 'old-entry'); await appendRotating(log, 'new-entry\n', {maxBytes: 10});
  assert.equal(await readFile(log + '.1', 'utf8'), 'old-entry'); assert.equal(await readFile(log, 'utf8'), 'new-entry\n');
  const other = path.join(dir, 'outside'); await writeFile(other, 'retain'); await symlink(other, path.join(dir, 'link'));
  await assert.rejects(appendRotating(path.join(dir, 'link'), 'data'), /symlink/);
  assert.equal(await readFile(other, 'utf8'), 'retain');
});

test('service wrapper forwards graceful stop and drops inherited credentials and raw output', async t => {
  if (process.getuid() === 0) t.mock.method(process, 'getuid', () => 1);
  const {initialize} = await import('../controller.mjs');
  const home = await realpath(await mkdtemp(path.join(os.tmpdir(), 'leafhour-launch-'))); t.after(() => rm(home, {recursive: true, force: true}));
  const root = path.join(home, 'Services', 'Leafhour'); await initialize({root, home, mode: 'user-trial', runtimeId: 'test', dryRun: false});
  const release = path.join(root, 'releases', 'test'); await mkdir(path.join(release, 'apps', 'api'), {recursive: true});
  await mkdir(path.join(root, 'runtime', 'test', 'bin'), {recursive: true}); await symlink(process.execPath, path.join(root, 'runtime', 'test', 'bin', 'node'));
  const ready = path.join(root, 'data', 'api', 'ready.json'); const stopped = path.join(root, 'data', 'api', 'stopped');
  // Publishing readiness permits an immediate stop, so install its handler first.
  await writeFile(path.join(release, 'apps', 'api', 'server.mjs'), `import {writeFile} from 'node:fs/promises';
process.on('SIGTERM',async()=>{await writeFile(${JSON.stringify(stopped)},'graceful');process.exit(0)});setInterval(()=>{},1000);
console.log('synthetic-private-book-text');console.log(JSON.stringify({event:'ready',token:'synthetic-private-token'}));
await writeFile(${JSON.stringify(ready)},JSON.stringify({inherited:!!process.env.DEEPSEEK_API_KEY,home:process.env.HOME}));`);
  await writeFile(path.join(root, 'config', 'api', 'test.json'), JSON.stringify({id: 'test', release, sourceCommit: 'a'.repeat(40), apiPort: 18331, agentPort: 18332, socket: path.join(root, 'run', 'ipc', 'test.sock')}), {mode: 0o600});
  const child = spawn(process.execPath, [fileURLToPath(new URL('../service.mjs', import.meta.url)), root, 'api', 'test'], {env: {...process.env, DEEPSEEK_API_KEY: 'synthetic-inherited-key'}, stdio: 'ignore'});
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  let readyState;
  for (let attempt = 0; attempt < 100; attempt++) { try { readyState = JSON.parse(await readFile(ready, 'utf8')); break; } catch { await delay(50); } }
  assert.equal(readyState?.inherited, false); assert.equal(readyState.home, path.join(root, 'data', 'api', 'home'));
  const exit = new Promise(resolve => child.once('exit', code => resolve(code))); child.kill('SIGTERM'); assert.equal(await exit, 0);
  assert.equal(await readFile(stopped, 'utf8'), 'graceful');
  const log = await readFile(path.join(root, 'logs', 'api', 'test.log'), 'utf8');
  assert.ok(log.trim().split('\n').map(line => JSON.parse(line)).some(event => event.event === 'ready'));
  assert.ok(!log.includes('synthetic-private')); assert.match(log, /service_stopped/);
});
