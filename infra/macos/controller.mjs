import http from 'node:http';
import net from 'node:net';
import {readFile, writeFile, mkdir, cp, rename, chmod, chown, statfs, lstat, realpath, rm} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {command, privateWrite, readPrivateJson, verifyArtifact, inventory, validId, validSlot, label, launchdPlist, serviceEnvironment, cutover, withLock} from './operations.mjs';

function requestJson(options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({...options, timeout: 5000}, res => {
      let data = ''; res.on('data', chunk => { data += chunk; if (data.length > 65536) req.destroy(Error('Oversized operation response')); });
      res.on('end', () => { try { if (res.statusCode !== 200) throw Error('Operation rejected'); resolve(JSON.parse(data)); } catch { reject(Error('Invalid operation response')); } });
    });
    req.on('timeout', () => req.destroy(Error('Operation timeout'))); req.on('error', reject);
    if (body !== undefined) req.end(JSON.stringify(body)); else req.end();
  });
}

export async function control({socket, tokenFile}, paused) {
  const info = await lstat(tokenFile); if (!info.isFile() || (info.mode & 0o027)) throw Error('Unsafe token file permissions');
  const token = (await readFile(tokenFile, 'utf8')).trim(); if (!token || /[\r\n]/.test(token)) throw Error('Invalid token file');
  const result = await requestJson({socketPath: socket, path: '/internal/v1/control', method: 'POST', headers: {'Content-Type': 'application/json', Authorization: `Bearer ${token}`}}, paused === undefined ? {} : {paused});
  if (typeof result.paused !== 'boolean' || !Number.isInteger(result.inflight) || result.inflight < 0) throw Error('Invalid control response'); return result;
}

export async function waitDrained(connection, {timeoutMs = 75000, intervalMs = 500, query = control} = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) { const state = await query(connection); if (state.paused === true && state.inflight === 0) return state; await delay(intervalMs); }
  throw Error('Agent drain timed out; preserve running services and task receipts');
}

export async function checkVersion(origin, module, sourceCommit) {
  const url = new URL('/version', origin);
  if (url.hostname !== '127.0.0.1' || url.protocol !== 'http:') throw Error('Health checks must use loopback');
  const result = await requestJson({hostname: url.hostname, port: url.port, path: url.pathname, method: 'GET'});
  if (result.module !== module || result.sourceCommit !== sourceCommit || result.protocol !== 1) throw Error('Unexpected service version'); return result;
}

export async function resources(root) {
  const disk = await statfs(root); const freeGiB = disk.bavail * disk.bsize / 1024 ** 3;
  const report = {freeGiB: Math.round(freeGiB * 100) / 100, pauseHeavyTasks: freeGiB < 15, stopUploadsRequired: freeGiB < 8, thresholdsAreInitial: true};
  const state = await readPrivateJson(path.join(root, 'state', 'deployment.json')).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (state?.candidate) {
    const config = await instance(root);
    const rows = (await command('/bin/ps', ['-axo', 'pid=,ppid=,rss='])).trim().split('\n').map(line => line.trim().split(/\s+/).map(Number));
    report.rssMiB = {};
    for (const role of ['api', 'agent', 'web']) {
      const target = `${domain(config)}/${label(role, role === 'web' ? 'frontdoor' : state.candidate.id)}`;
      let text; try { text = await command('/bin/launchctl', ['print', target]); } catch { report.rssMiB[role] = null; continue; }
      const pid = Number(text.match(/\bpid = (\d+)/)?.[1]);
      if (!Number.isInteger(pid) || pid < 1) { report.rssMiB[role] = null; continue; }
      const pids = new Set([pid]);
      let changed = true; while (changed) { changed = false; for (const [child, parent] of rows) if (pids.has(parent) && !pids.has(child)) { pids.add(child); changed = true; } }
      report.rssMiB[role] = Math.round(rows.filter(([child]) => pids.has(child)).reduce((total, row) => total + row[2], 0) / 1024);
    }
    if (report.rssMiB.agent >= 3072) report.pauseHeavyTasks = true;
  }
  return report;
}

async function portFree(port) {
  if (!Number.isInteger(port) || port < 18331 || port > 18499 || port === 18330) throw Error('Invalid candidate port');
  await new Promise((resolve, reject) => { const server = net.createServer(); server.once('error', () => reject(Error('Candidate port occupied'))); server.listen(port, '127.0.0.1', () => server.close(resolve)); });
}

export async function instance(root) {
  if (!path.isAbsolute(root)) throw Error('Absolute Leafhour root required');
  const config = JSON.parse(await readFile(path.join(root, 'config', 'instance.json'), 'utf8'));
  if (!['user-trial', 'system-service'].includes(config.mode)) throw Error('Explicit mode required');
  if (config.mode === 'system-service' && process.getuid() !== 0) throw Error('System service operations require an elevated operator terminal');
  if (config.mode === 'user-trial' && process.getuid() === 0) throw Error('Do not run a user-session trial as root');
  return {...config, root};
}

async function roleWrite(config, role, name, value) {
  const file = path.join(config.root, 'config', role, name);
  await privateWrite(file, value);
  if (config.mode === 'system-service') {
    const gid = Number((await command('/usr/bin/dscl', ['.', '-read', `/Groups/_leafhour_${role}`, 'PrimaryGroupID'])).trim().split(/\s+/).at(-1));
    if (!Number.isInteger(gid)) throw Error('Missing service group'); await chown(file, 0, gid); await chmod(file, 0o640);
  }
  return file;
}

const domain = config => config.mode === 'system-service' ? 'system' : `gui/${process.getuid()}`;
const plistDirectory = config => config.mode === 'system-service' ? '/Library/LaunchDaemons' : path.join(config.home, 'Library', 'LaunchAgents');
export async function service(config, role, slot, action, run = command) {
  const target = `${domain(config)}/${label(role, slot)}`;
  const file = path.join(plistDirectory(config), `${label(role, slot)}.plist`);
  let present = false; try { await run('/bin/launchctl', ['print', target]); present = true; } catch {}
  if (action === 'start') {
    if (present) return;
    await writeFile(file, launchdPlist(config, role, slot), {mode: 0o644});
    await run('/bin/launchctl', ['bootstrap', domain(config), file]);
  } else if (action === 'stop') {
    if (present) await run('/bin/launchctl', ['bootout', target]);
    // A booted-out plist must not respawn an obsolete Agent at the next login/boot.
    await rm(file, {force: true});
  } else throw Error('Unknown service action');
}

export async function initialize({root, mode, runtimeId, home = osHome(), dryRun = true}) {
  if (!path.isAbsolute(root) || !['user-trial', 'system-service'].includes(mode)) throw Error('Absolute root and explicit mode required');
  validId(runtimeId);
  if (mode === 'system-service' && root !== '/Library/Application Support/Leafhour') throw Error('System root must be /Library/Application Support/Leafhour');
  if (mode === 'user-trial' && (!root.startsWith(path.join(home, 'Services') + path.sep) || process.getuid() === 0)) throw Error('User trial must be below the current user Services directory');
  if (mode === 'system-service' && process.getuid() !== 0 && !dryRun) throw Error('System initialization needs an elevated operator terminal');
  if (dryRun) return {action: 'initialize', root, mode, runtimeId, unattended: mode === 'system-service'};
  const config = {mode, runtimeId, home};
  await mkdir(root, {recursive: true, mode: 0o755});
  if (await realpath(root) !== path.resolve(root)) throw Error('Root cannot use symlinked parents');
  const existing = await lstat(path.join(root, 'config', 'instance.json')).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (existing) throw Error('Instance already initialized; refusing overwrite');
  for (const directory of ['runtime', 'releases', 'ops', 'config', 'state', 'run', 'run/ipc', 'run/web', 'data', 'data/api', 'data/agent', 'logs', ...['api', 'agent', 'web'].flatMap(role => [`config/${role}`, `logs/${role}`]), 'config/ipc']) await mkdir(path.join(root, directory), {recursive: true, mode: mode === 'system-service' ? 0o755 : 0o700});
  await writeFile(path.join(root, 'config', 'instance.json'), JSON.stringify(config, null, 2) + '\n', {mode: 0o644, flag: 'wx'});
  for (const role of ['api', 'agent', 'web']) await roleWrite({...config, root}, role, 'env.json', {});
  for (const role of ['api', 'agent', 'web']) for (const directory of ['home', 'tmp']) await mkdir(path.join(root, 'data', role, directory), {recursive: true, mode: 0o700});
  await privateWrite(path.join(root, 'config', 'ipc', 'agent-token'), randomBytes(32).toString('hex') + '\n');
  if (mode === 'system-service') {
    const gid = Number((await command('/usr/bin/dscl', ['.', '-read', '/Groups/_leafhour_ipc', 'PrimaryGroupID'])).trim().split(/\s+/).at(-1));
    if (!Number.isInteger(gid)) throw Error('Run reviewed system-install.sh first');
    await chown(path.join(root, 'config', 'ipc', 'agent-token'), 0, gid); await chmod(path.join(root, 'config', 'ipc', 'agent-token'), 0o640);
    // Reapply the reviewed skeleton permissions after creating files.
    await command('/bin/sh', [path.join(path.dirname(fileURLToPath(import.meta.url)), 'system-install.sh'), '--prepare']);
  }
  const operations = path.dirname(fileURLToPath(import.meta.url));
  for (const file of ['operations.mjs', 'controller.mjs', 'service.mjs', 'leafhourctl.mjs', 'bundle.mjs', 'system-install.sh']) await cp(path.join(operations, file), path.join(root, 'ops', file), {force: false, errorOnExist: true});
  if (mode === 'user-trial') await mkdir(plistDirectory(config), {recursive: true});
  return {action: 'initialized', root, mode, runtimeId, credentialsPrinted: false};
}
function osHome() { if (!process.env.HOME || !path.isAbsolute(process.env.HOME)) throw Error('Explicit home required'); return process.env.HOME; }

export async function publishArtifact({root, artifact, expectedCommit, manifestSha256, dryRun = true}) {
  if (!/^[a-f0-9]{40}$/.test(expectedCommit ?? '')) throw Error('Expected mainline source commit required');
  if (!/^[a-f0-9]{64}$/.test(manifestSha256 ?? '')) throw Error('Trusted manifest SHA-256 required');
  const config = await instance(root); const manifest = await verifyArtifact(artifact, expectedCommit, manifestSha256);
  if (manifest.target !== 'darwin-arm64' || process.platform !== 'darwin' || process.arch !== 'arm64') throw Error('Target must be macOS arm64');
  const id = validId(manifest.buildId ?? manifest.sourceCommit); const destination = path.join(root, 'releases', id);
  if (dryRun) return {action: 'publish-verified-artifact', id, sourceCommit: manifest.sourceCommit, mode: config.mode};
  if ((await resources(root)).pauseHeavyTasks) throw Error('Less than 15 GiB free; publish paused');
  return withLock(root, async () => {
    const staged = `${destination}.partial`; await mkdir(staged, {recursive: false});
    await cp(artifact, staged, {recursive: true, force: false, errorOnExist: true});
    await verifyArtifact(staged, manifest.sourceCommit);
    const runtime = path.join(root, 'runtime', config.runtimeId);
    if (manifest.runtime?.id !== config.runtimeId) throw Error('Configured runtime does not match artifact');
    try { await lstat(runtime); } catch (error) { if (error.code !== 'ENOENT') throw error; await cp(path.join(staged, 'runtime'), runtime, {recursive: true, force: false, errorOnExist: true}); }
    // An existing independent runtime must match this immutable artifact exactly.
    const runtimeInventory = await inventory(runtime); const bundledInventory = await inventory(path.join(staged, 'runtime'));
    if (JSON.stringify(runtimeInventory) !== JSON.stringify(bundledInventory)) throw Error('Installed runtime digest mismatch');
    for (const [file, record] of Object.entries(runtimeInventory)) if (!record.link) await chmod(path.join(runtime, file), record.executable ? 0o555 : 0o444);
    // All release content is read-only, including bundled runtime. Never mutate a published version.
    for (const [file, record] of Object.entries(await inventory(staged))) if (!record.link) await chmod(path.join(staged, file), record.executable ? 0o555 : 0o444);
    await chmod(path.join(staged, 'manifest.json'), 0o444); await rename(staged, destination);
    return {id, sourceCommit: manifest.sourceCommit, release: destination};
  });
}

export async function prepare({root, releaseId, slotId, apiPort = 18341, agentPort = 18342, dryRun = true}) {
  const config = await instance(root); validId(releaseId); validSlot(slotId);
  const release = path.join(root, 'releases', releaseId); const manifest = await verifyArtifact(release);
  const socket = path.join(root, 'run', 'ipc', `${slotId}.sock`);
  if (Buffer.byteLength(socket) > 100) throw Error('Unix socket path too long');
  const slot = {id: slotId, release, sourceCommit: manifest.sourceCommit, apiPort, agentPort, socket, agentPaused: true};
  if (apiPort === agentPort) throw Error('Candidate ports must differ');
  await Promise.all([portFree(apiPort), portFree(agentPort)]);
  if (dryRun) return {action: 'prepare-candidate', ...slot, mode: config.mode};
  if ((await resources(root)).pauseHeavyTasks) throw Error('Less than 15 GiB free; candidate start paused');
  return withLock(root, async () => {
    for (const role of ['api', 'agent']) await roleWrite(config, role, `${slotId}.json`, slot);
    await mkdir(path.join(root, 'data', 'api', slotId), {recursive: true, mode: 0o700});
    if (config.mode === 'system-service') {
      const uid = Number((await command('/usr/bin/id', ['-u', '_leafhour_api'])).trim()); const gid = Number((await command('/usr/bin/id', ['-g', '_leafhour_api'])).trim());
      await chown(path.join(root, 'data', 'api', slotId), uid, gid);
    }
    await privateWrite(path.join(root, 'state', `slot-${slotId}.json`), slot);
    await service(config, 'api', slotId, 'start'); await service(config, 'agent', slotId, 'start');
    return slot;
  });
}

const connection = (config, slot) => ({socket: slot.socket, tokenFile: path.join(config.root, 'config', 'ipc', 'agent-token')});
const caddyBinary = config => path.join(config.root, 'runtime', config.runtimeId, 'bin', 'caddy');
const caddyAddress = config => `unix/${path.join(config.root, 'run', 'web', 'caddy-admin.sock')}`;

async function proxyConfig(config, slot) {
  const file = path.join(config.root, 'config', 'web', `${slot.id}.json`);
  const text = await command(caddyBinary(config), ['adapt', '--config', path.join(slot.release, 'web', 'Caddyfile'), '--adapter', 'caddyfile'], {env: serviceEnvironment(config, 'web', slot), cwd: slot.release});
  await roleWrite(config, 'web', `${slot.id}.json`, JSON.parse(text));
  await command(caddyBinary(config), ['validate', '--config', file], {env: serviceEnvironment(config, 'web', slot)});
  return file;
}

async function reload(config, slot) {
  const file = path.join(config.root, 'config', 'web', `${slot.id}.json`);
  await command(caddyBinary(config), ['reload', '--config', file, '--address', caddyAddress(config)]);
  await roleWrite(config, 'web', 'active.json', JSON.parse(await readFile(file, 'utf8')));
  await roleWrite(config, 'web', 'frontdoor.json', slot);
}

export async function activate({root, slotId, dryRun = true, rollback = false}) {
  const config = await instance(root); validSlot(slotId);
  const candidate = await readPrivateJson(path.join(root, 'state', `slot-${slotId}.json`));
  const state = await readPrivateJson(path.join(root, 'state', 'deployment.json')).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (state && state.phase !== 'active' && !rollback) throw Error('Interrupted deployment requires status and explicit rollback review');
  const previous = state?.candidate;
  if (!rollback && state?.activeAt && Date.now() - Date.parse(state.activeAt) < 3600000) throw Error('Publish limit: one activation per hour');
  if (dryRun) return {action: rollback ? 'rollback' : 'activate', candidate, previous, mode: config.mode};
  if (rollback) {
    await roleWrite(config, 'api', `${slotId}.json`, candidate); await roleWrite(config, 'agent', `${slotId}.json`, {...candidate, agentPaused: true});
    await service(config, 'api', slotId, 'start'); await service(config, 'agent', slotId, 'start');
  }
  const candidateConnection = connection(config, candidate);
  const hooks = {
    verifyCandidate: async () => {
      await verifyArtifact(candidate.release, candidate.sourceCommit); await waitHealthy(candidate);
      let last;
      for (let attempt = 0; attempt < 30; attempt++) { try { await checkVersion(`http://127.0.0.1:${candidate.agentPort}`, 'agent', candidate.sourceCommit); last = null; break; } catch (error) { last = error; await delay(500); } }
      if (last) throw last;
      if ((await control(candidateConnection)).paused !== true) throw Error('Candidate Agent must be paused before activation');
    },
    pauseOldAgent: () => control(connection(config, previous), true),
    waitOldAgentDrained: async () => { await waitDrained(connection(config, previous)); await service(config, 'agent', previous.id, 'stop'); },
    validateProxy: () => proxyConfig(config, candidate),
    reloadProxy: async () => {
      if (previous) await reload(config, candidate);
      else {
        await roleWrite(config, 'web', 'active.json', JSON.parse(await readFile(path.join(root, 'config', 'web', `${candidate.id}.json`), 'utf8')));
        await roleWrite(config, 'web', 'frontdoor.json', candidate); await service(config, 'web', 'frontdoor', 'start');
      }
    },
    verifyProxy: async () => {
      let last; for (let attempt = 0; attempt < 20; attempt++) { try { await checkVersion('http://127.0.0.1:18330', 'api', candidate.sourceCommit); return; } catch (error) { last = error; await delay(250); } } throw last;
    },
    startNewAgent: async () => {
      candidate.agentPaused = false;
      await roleWrite(config, 'agent', `${candidate.id}.json`, candidate);
      await control(candidateConnection, false);
    },
    stopOldApi: () => service(config, 'api', previous.id, 'stop'),
    freezeCandidate: async () => { await control(candidateConnection, true); await waitDrained(candidateConnection); await service(config, 'agent', candidate.id, 'stop'); },
    rollbackProxy: async () => { await service(config, 'api', previous.id, 'start'); await waitHealthy(previous); await reload(config, previous); },
    resumeOldAgent: async () => { await control(connection(config, previous), false); await service(config, 'agent', previous.id, 'start'); },
  };
  return cutover({root, candidate, previous, hooks});
}

async function waitHealthy(slot) {
  let last;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      await checkVersion(`http://127.0.0.1:${slot.apiPort}`, 'api', slot.sourceCommit);
      const health = await requestJson({hostname: '127.0.0.1', port: slot.apiPort, path: '/healthz', method: 'GET'});
      if (health.readable !== true || health.sourceCommit !== slot.sourceCommit) throw Error('API not readable'); return;
    } catch (error) { last = error; await delay(500); }
  }
  throw last;
}

export async function status(root) {
  const config = await instance(root);
  const state = await readPrivateJson(path.join(root, 'state', 'deployment.json')).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  const report = {mode: config.mode, state, resources: await resources(root), services: {}};
  for (const slot of [state?.candidate, state?.previous].filter(Boolean)) {
    for (const role of ['api', 'agent']) {
      try { report.services[`${slot.id}:${role}`] = await checkVersion(`http://127.0.0.1:${role === 'api' ? slot.apiPort : slot.agentPort}`, role, slot.sourceCommit); }
      catch { report.services[`${slot.id}:${role}`] = {healthy: false}; }
    }
  }
  try { report.proxy = await requestJson({hostname: '127.0.0.1', port: 18330, path: '/version', method: 'GET'}); } catch { report.proxy = {healthy: false}; }
  // Read actual Caddy config to distinguish persisted intent from the running upstream.
  try { const actual = await requestJson({socketPath: path.join(root, 'run', 'web', 'caddy-admin.sock'), path: '/config/', method: 'GET'}); report.proxyConfigMatchesCandidate = JSON.stringify(actual) === await readFile(path.join(root, 'config', 'web', 'active.json'), 'utf8').then(text => JSON.stringify(JSON.parse(text))); } catch { report.proxyConfigMatchesCandidate = false; }
  return report;
}
