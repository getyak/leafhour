import {spawn} from 'node:child_process';
import {appendFile, lstat, rename, rm, readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readPrivateJson, serviceEnvironment, validId} from './operations.mjs';

export function operationalLine(line) {
  let input; try { input = JSON.parse(line); } catch { return null; }
  const output = {};
  for (const key of ['event', 'status', 'code', 'module', 'sourceCommit', 'durationMs']) {
    const value = input[key];
    if (typeof value === 'number' && Number.isFinite(value)) output[key] = value;
    else if (typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,80}$/.test(value)) output[key] = value;
  }
  return Object.keys(output).length ? JSON.stringify(output) + '\n' : null;
}

export async function appendRotating(file, line, {maxBytes = 8 * 1024 * 1024, retain = 4} = {}) {
  const info = await lstat(file).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
  if (info?.isSymbolicLink() || (info && !info.isFile())) throw Error('Log path is a symlink or non-file');
  if ((info?.size ?? 0) + Buffer.byteLength(line) > maxBytes) {
    for (let index = retain; index >= 1; index--) {
      const from = index === 1 ? file : `${file}.${index - 1}`; const to = `${file}.${index}`;
      await rm(to, {force: true}); await rename(from, to).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
  }
  await appendFile(file, line, {mode: 0o640});
}

export async function runService(root, role, slotId) {
  validId(slotId); if (!['web', 'api', 'agent'].includes(role)) throw Error('Invalid role');
  // Shared instance metadata is secret-free; credentials remain in role-readable files.
  const instance = JSON.parse(await readFile(path.join(root, 'config', 'instance.json'), 'utf8'));
  const slot = await readPrivateJson(path.join(root, 'config', role, `${slotId}.json`));
  const roleEnv = await readPrivateJson(path.join(root, 'config', role, 'env.json'));
  const config = {...instance, root, [`${role}Env`]: roleEnv}; const env = serviceEnvironment(config, role, slot);
  const runtimeRoot = path.join(root, 'runtime', instance.runtimeId);
  const binary = path.join(runtimeRoot, 'bin', role === 'web' ? 'caddy' : 'node');
  const args = role === 'web' ? ['run', '--config', path.join(root, 'config', 'web', 'active.json')] : [`--max-old-space-size=${role === 'api' ? 1024 : 2048}`, path.join(slot.release, 'apps', role, 'server.mjs')];
  // Parent environment is deliberately not inherited (SSH/CI may carry unrelated secrets).
  const child = spawn(binary, args, {cwd: slot.release, env, stdio: ['ignore', 'pipe', 'pipe']});
  let writes = Promise.resolve(); const file = path.join(root, 'logs', role, `${slotId}.log`);
  const log = data => { writes = writes.then(() => appendRotating(file, JSON.stringify(data) + '\n')); };
  log({event: 'service_started', role, sourceCommit: slot.sourceCommit});
  for (const stream of [child.stdout, child.stderr]) {
    // Bounded input buffering; raw runtime output is never copied to the operational log.
    let pending = '';
    stream.on('data', chunk => {
      pending += chunk.toString(); if (pending.length > 65536) pending = '';
      const lines = pending.split('\n'); pending = lines.pop();
      for (const line of lines) { const safe = operationalLine(line); if (safe) writes = writes.then(() => appendRotating(file, safe)); }
    });
  }
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { log({event: 'service_stopping', role}); child.kill(signal); });
  child.on('error', () => { log({event: 'service_spawn_failed', role}); process.exitCode = 1; });
  await new Promise(resolve => child.on('close', (code, signal) => { log({event: 'service_stopped', role, code, signal}); process.exitCode = code ?? 1; resolve(); }));
  await writes;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runService(...process.argv.slice(2)).catch(async () => {
    const [root, role, slot] = process.argv.slice(2); process.exitCode = 1;
    if (root && ['web', 'api', 'agent'].includes(role) && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(slot ?? '')) await appendRotating(path.join(root, 'logs', role, `${slot}.log`), '{"event":"service_startup_failed"}\n').catch(() => {});
  });
}
