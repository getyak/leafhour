import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp, mkdir, writeFile, readFile, stat, realpath, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('control uses a private socket and file token, waits for real inflight zero', async t => {
  const {control, waitDrained} = await import('../controller.mjs');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'leafhour-ipc-')); t.after(() => rm(dir, {recursive: true, force: true}));
  const tokenFile = path.join(dir, 'token'); await writeFile(tokenFile, 'synthetic-token', {mode: 0o600});
  let polls = 0; const socket = path.join(dir, 'api.sock');
  const server = http.createServer(async (req, res) => {
    assert.equal(req.url, '/internal/v1/control'); assert.equal(req.method, 'POST'); assert.equal(req.headers.authorization, 'Bearer synthetic-token');
    let body = ''; for await (const chunk of req) body += chunk; const data = JSON.parse(body);
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({paused: data.paused ?? true, inflight: ++polls < 3 ? 1 : 0, queued: 2, needsReconciliation: 0}));
  });
  await new Promise(resolve => server.listen(socket, resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  assert.equal((await control({socket, tokenFile}, true)).paused, true);
  await waitDrained({socket, tokenFile}, {timeoutMs: 1000, intervalMs: 1}); assert.equal(polls, 3);
});

test('version checker rejects a healthy wrong source and drain rejects unconfirmed work', async () => {
  const {checkVersion, waitDrained} = await import('../controller.mjs');
  const server = http.createServer((_, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({module: 'api', sourceCommit: 'b'.repeat(40), protocol: 1})); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await assert.rejects(checkVersion(`http://127.0.0.1:${server.address().port}`, 'api', 'a'.repeat(40)), /version/); } finally { await new Promise(resolve => server.close(resolve)); }
  await assert.rejects(waitDrained({}, {timeoutMs: 5, intervalMs: 1, query: async () => ({paused: true, inflight: 1})}), /drain/);
});

test('trial initialization stays in a fresh private layout and never overwrites credentials', async t => {
  const {initialize} = await import('../controller.mjs');
  const home = await realpath(await mkdtemp(path.join(os.tmpdir(), 'leafhour-trial-'))); t.after(() => rm(home, {recursive: true, force: true}));
  const root = path.join(home, 'Services', 'Leafhour');
  const result = await initialize({root, mode: 'user-trial', runtimeId: 'node-test', home, dryRun: false});
  assert.equal(result.mode, 'user-trial'); assert.equal((await stat(path.join(root, 'config', 'ipc', 'agent-token'))).mode & 0o777, 0o600);
  assert.equal((await readFile(path.join(root, 'config', 'ipc', 'agent-token'), 'utf8')).trim().length, 64);
  await assert.rejects(initialize({root, mode: 'user-trial', runtimeId: 'different', home, dryRun: false}), /already initialized/);
  await assert.rejects(initialize({root: path.join(home, 'outside'), mode: 'user-trial', runtimeId: 'node-test', home}), /Services/);
});

test('stopping a slot removes only its own launchd registration file so it cannot return on reboot', async t => {
  const {service} = await import('../controller.mjs'); const home = await mkdtemp(path.join(os.tmpdir(), 'leafhour-launchctl-')); t.after(() => rm(home, {recursive: true, force: true}));
  const directory = path.join(home, 'Library', 'LaunchAgents'); await mkdir(directory, {recursive: true});
  const other = path.join(directory, 'com.example.other.plist'); await writeFile(other, 'retain'); let present = false;
  const run = async (_, args) => { if (args[0] === 'print' && !present) throw Error('not registered'); if (args[0] === 'bootstrap') present = true; if (args[0] === 'bootout') present = false; return ''; };
  const config = {mode: 'user-trial', root: path.join(home, 'Services', 'Leafhour'), home, runtimeId: 'test'};
  const file = path.join(directory, 'com.getyak.leafhour.agent.slot-a.plist');
  await service(config, 'agent', 'slot-a', 'start', run); assert.equal(present, true); assert.match(await readFile(file, 'utf8'), /slot-a/);
  await service(config, 'agent', 'slot-a', 'stop', run); assert.equal(present, false); await assert.rejects(stat(file), {code: 'ENOENT'});
  assert.equal(await readFile(other, 'utf8'), 'retain'); await service(config, 'agent', 'slot-a', 'start', run); assert.equal(present, true);
});
