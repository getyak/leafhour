import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile, writeFile, mkdir, rename, readdir, lstat, readlink, realpath, open, rm} from 'node:fs/promises';
import path from 'node:path';

const exec = promisify(execFile);
const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const hash = value => createHash('sha256').update(value).digest('hex');
export const validId = id => { if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(id)) throw Error('Invalid release/slot id'); return id; };
export const validSlot = id => { validId(id); if (['env', 'active', 'frontdoor', 'instance'].includes(id)) throw Error('Slot name is reserved'); return id; };
export const beneath = (root, target) => target === root || target.startsWith(root + path.sep);

// No shell, no command output in exceptions: subprocess diagnostics may contain credentials.
export async function command(binary, args, options = {}) {
  try { const result = await exec(binary, args, {maxBuffer: 16 * 1024 * 1024, timeout: 120000, ...options}); return result.stdout; }
  catch (error) { throw Error(`${path.basename(binary)} failed (exit ${error.code ?? 'unknown'})`); }
}

export async function privateWrite(file, value) {
  await mkdir(path.dirname(file), {recursive: true, mode: 0o700});
  const temp = `${file}.${process.pid}.tmp`;
  const handle = await open(temp, 'wx', 0o600);
  try { await handle.writeFile(typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n'); await handle.sync(); }
  finally { await handle.close(); }
  await rename(temp, file);
}

export async function readPrivateJson(file) {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o027) || ![0, process.getuid?.()].includes(info.uid)) throw Error('Unsafe private configuration permissions');
  return JSON.parse(await readFile(file, 'utf8'));
}

const forbiddenPath = file => /^(\.git|local|content|\.reader-runtime)(\/|$)/.test(file) || /(^|\/)(\.env(?:\..*)?|secrets?|\.DS_Store)(\/|$)/i.test(file) && !/\.env\.example$/.test(file);

export async function inventory(root) {
  const files = {};
  async function visit(relative) {
    for (const name of (await readdir(path.join(root, relative))).sort()) {
      const file = path.posix.join(relative, name);
      if (file === 'manifest.json') continue;
      if (forbiddenPath(file)) throw Error(`Artifact contains secret/runtime path: ${file}`);
      const absolute = path.join(root, file); const info = await lstat(absolute);
      if (info.isSymbolicLink()) {
        const link = await readlink(absolute);
        if (path.isAbsolute(link) || !beneath(root, path.resolve(path.dirname(absolute), link)) || !beneath(root, await realpath(absolute))) throw Error('Unsafe artifact symlink');
        files[file] = {link};
      } else if (info.isDirectory()) await visit(file);
      else if (info.isFile()) files[file] = {sha256: hash(await readFile(absolute)), size: info.size, executable: !!(info.mode & 0o111)};
      else throw Error('Unsupported artifact file type');
    }
  }
  await visit(''); return files;
}

export async function writeManifest(root, metadata) {
  if (!/^[a-f0-9]{40}$/.test(metadata.sourceCommit)) throw Error('Missing immutable source commit');
  const manifest = {schema: 1, sourceCommit: metadata.sourceCommit, target: metadata.target, protocol: metadata.protocol, buildId: metadata.buildId, runtime: metadata.runtime, files: await inventory(root)};
  await writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n'); return manifest;
}

export async function verifyArtifact(root, expectedCommit, expectedManifestSha256) {
  const raw = await readFile(path.join(root, 'manifest.json'));
  if (expectedManifestSha256 && hash(raw) !== expectedManifestSha256) throw Error('Manifest digest mismatch');
  const manifest = JSON.parse(raw);
  if (manifest.schema !== 1 || !/^[a-f0-9]{40}$/.test(manifest.sourceCommit) || (expectedCommit && manifest.sourceCommit !== expectedCommit)) throw Error('Artifact source mismatch');
  const actual = await inventory(root);
  if (!equal(Object.keys(actual).sort(), Object.keys(manifest.files).sort())) throw Error('Artifact has unlisted or missing files');
  for (const [file, record] of Object.entries(actual)) if (!equal(record, manifest.files[file])) throw Error(`Artifact digest mismatch: ${file}`);
  return manifest;
}

function withoutOwned(config, hostname) {
  const copy = structuredClone(config);
  if (copy.TCP) { delete copy.TCP['19443']; if (!Object.keys(copy.TCP).length) delete copy.TCP; }
  if (copy.Web) { delete copy.Web[`${hostname}:19443`]; if (!Object.keys(copy.Web).length) delete copy.Web; }
  return copy;
}
function owned(config, hostname) { return {TCP: config.TCP?.['19443'], Web: config.Web?.[`${hostname}:19443`]}; }
function assertOwn(config, hostname) {
  const entry = owned(config, hostname);
  if (!equal(entry, {TCP: {HTTPS: true}, Web: {Handlers: {'/': {Proxy: 'http://127.0.0.1:18330'}}}}) || config.AllowFunnel?.[`${hostname}:19443`]) throw Error('Unexpected Leafhour Serve/Funnel entry');
}

export async function tailscaleAdd({receipt, hostname, binary = '/usr/local/bin/tailscale', run = command, dryRun = false}) {
  if (!/^[a-zA-Z0-9.-]+$/.test(hostname)) throw Error('Invalid Tailscale hostname');
  const before = JSON.parse(await run(binary, ['serve', 'status', '--json']));
  if (before.TCP?.['19443'] || Object.keys(before.Web ?? {}).some(key => key.endsWith(':19443')) || Object.keys(before.AllowFunnel ?? {}).some(key => key.endsWith(':19443'))) throw Error('Serve 19443 is occupied');
  if (dryRun) return {action: 'add-private-https', port: 19443, untouched: hash(JSON.stringify(canonical(before)))};
  // Persist backup before mutation; never restore the full document over concurrent changes.
  await privateWrite(receipt, {schema: 1, hostname, phase: 'prepared', before});
  await run(binary, ['serve', '--bg', '--yes', '--https=19443', 'http://127.0.0.1:18330']);
  const after = JSON.parse(await run(binary, ['serve', 'status', '--json']));
  if (!equal(withoutOwned(after, hostname), withoutOwned(before, hostname))) throw Error('Unrelated Serve settings changed; retained backup, manual review required');
  assertOwn(after, hostname);
  await privateWrite(receipt, {schema: 1, hostname, phase: 'active', before, added: owned(after, hostname), afterDigest: hash(JSON.stringify(canonical(after)))});
  return {action: 'added-private-https', port: 19443, unrelatedUnchanged: true};
}

export async function tailscaleRemove({receipt, binary = '/usr/local/bin/tailscale', run = command, dryRun = false}) {
  const saved = await readPrivateJson(receipt); const before = JSON.parse(await run(binary, ['serve', 'status', '--json']));
  if (!saved.added || !equal(owned(before, saved.hostname), saved.added) || before.AllowFunnel?.[`${saved.hostname}:19443`]) throw Error('Owned Serve entry changed; refusing rollback');
  if (dryRun) return {action: 'remove-owned-https', port: 19443};
  await run(binary, ['serve', '--bg', '--yes', '--https=19443', 'off']);
  const after = JSON.parse(await run(binary, ['serve', 'status', '--json']));
  if (!equal(withoutOwned(before, saved.hostname), withoutOwned(after, saved.hostname)) || after.TCP?.['19443'] || after.Web?.[`${saved.hostname}:19443`]) throw Error('Serve rollback verification failed');
  await privateWrite(receipt, {...saved, phase: 'removed'});
  return {action: 'removed-owned-https', unrelatedUnchanged: true};
}

const roles = ['web', 'api', 'agent'];
const provider = /(?:_API_KEY$|^(?:DEEPSEEK|GEMINI|ARK|PADDLEOCR|OPENAI|ELEVENLABS|ANTHROPIC).*(?:KEY|TOKEN))/;
export function serviceEnvironment(config, role, slot) {
  if (!roles.includes(role)) throw Error('Unknown service');
  const env = {...config[`${role}Env`]};
  if (role === 'web' && Object.keys(env).some(key => key !== 'TZ')) throw Error('Web cannot receive service credentials');
  if (role !== 'agent' && Object.keys(env).some(key => provider.test(key))) throw Error('Model provider credentials belong to Agent only');
  if (role === 'agent' && Object.keys(env).some(key => /SUPABASE.*(SERVICE|SECRET)|DATABASE_URL|POSTGRES/i.test(key))) throw Error('Database administration credentials cannot enter Agent');
  const runtime = path.join(config.root, 'runtime', config.runtimeId, 'bin');
  return {...env, PATH: `${runtime}:/usr/bin:/bin:/usr/sbin:/sbin`, HOME: path.join(config.root, 'data', role, 'home'), TMPDIR: path.join(config.root, 'data', role, 'tmp'),
    NODE_ENV: 'production', LEAFHOUR_SOURCE_COMMIT: slot.sourceCommit,
    LEAFHOUR_API_HOST: '127.0.0.1', LEAFHOUR_API_PORT: String(slot.apiPort), LEAFHOUR_AGENT_PORT: String(slot.agentPort),
    ...(role !== 'web' ? {LEAFHOUR_INTERNAL_SOCKET: slot.socket, LEAFHOUR_AGENT_TOKEN_FILE: path.join(config.root, 'config', 'ipc', 'agent-token')} : {}),
    ...(role === 'api' ? {LEAFHOUR_DATA_DIR: path.join(config.root, 'data', 'api', slot.id), LEAFHOUR_WEB_ROOT: path.join(slot.release, 'web', 'public'), LEAFHOUR_TEMPLATE_ROOT: path.join(slot.release, 'web', 'templates')} : {}),
    ...(role === 'agent' ? {LEAFHOUR_AGENT_PAUSED: slot.agentPaused === false ? '0' : '1'} : {}),
    ...(role === 'web' ? {LEAFHOUR_WEB_PORT: '18330', LEAFHOUR_API_UPSTREAM: `127.0.0.1:${slot.apiPort}`, LEAFHOUR_WEB_ROOT: path.join(slot.release, 'web', 'public'), LEAFHOUR_CADDY_ADMIN: `unix/${path.join(config.root, 'run', 'web', 'caddy-admin.sock')}`} : {})};
}

const xml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
export function label(role, slot) { if (!roles.includes(role)) throw Error('Unknown service'); return `com.getyak.leafhour.${role}.${validId(slot)}`; }
export function launchdPlist(config, role, slotId) {
  if (!['user-trial', 'system-service'].includes(config.mode)) throw Error('Explicit service mode required');
  validId(slotId); const root = config.root; const service = label(role, slotId);
  const args = [path.join(root, 'runtime', config.runtimeId ?? 'node', 'bin', 'node'), path.join(root, 'ops', 'service.mjs'), root, role, slotId];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>
<key>Label</key><string>${service}</string>
<key>ProgramArguments</key><array>${args.map(arg => `<string>${xml(arg)}</string>`).join('')}</array>
${config.mode === 'system-service' ? `<key>UserName</key><string>_leafhour_${role}</string><key>GroupName</key><string>_leafhour_${role}</string>` : ''}
<key>WorkingDirectory</key><string>${xml(root)}</string>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>15</integer><key>ExitTimeOut</key><integer>90</integer>
<key>ProcessType</key><string>Background</string><key>Nice</key><integer>10</integer>
<key>Umask</key><integer>23</integer>
<key>StandardOutPath</key><string>/dev/null</string>
<key>StandardErrorPath</key><string>/dev/null</string>
</dict></plist>\n`;
}

export async function withLock(root, action) {
  const lock = path.join(root, 'state', 'deploy.lock'); await mkdir(path.dirname(lock), {recursive: true, mode: 0o700});
  try { await mkdir(lock, {mode: 0o700}); } catch { throw Error('Deployment lock exists; inspect process and persisted state before manual recovery'); }
  try { await privateWrite(path.join(lock, 'owner.json'), {pid: process.pid, startedAt: new Date().toISOString()}); return await action(); }
  finally { await rm(lock, {recursive: true}); }
}

// Hooks are concrete runtime/launchd operations in controller.mjs. Persist intent before each side effect.
export async function cutover({root, candidate, previous, hooks}) {
  return withLock(root, async () => {
    const file = path.join(root, 'state', 'deployment.json');
    let state = {phase: 'prepared', candidate, previous, step: 'verifyCandidate', updatedAt: new Date().toISOString()};
    const step = async name => { state.step = name; state.updatedAt = new Date().toISOString(); await privateWrite(file, state); await hooks[name](); };
    let paused = false; let switched = false;
    try {
      await step('verifyCandidate');
      if (previous) { await step('pauseOldAgent'); paused = true; await step('waitOldAgentDrained'); }
      await step('validateProxy'); state.phase = 'switching'; switched = true; await step('reloadProxy'); await step('verifyProxy');
      // New Agent is started only after the proxy and API version agree.
      state.phase = 'draining'; await step('startNewAgent');
      if (previous) await step('stopOldApi');
      state.phase = 'active'; state.activeAt = new Date().toISOString(); await privateWrite(file, state); return state;
    } catch (error) {
      state.phase = 'rollback'; state.failedStep = state.step;
      await privateWrite(file, state);
      if (switched && hooks.freezeCandidate) await step('freezeCandidate');
      if (switched && previous) { await step('rollbackProxy'); if (paused) await step('resumeOldAgent'); }
      else if (paused) await step('resumeOldAgent');
      throw error;
    }
  });
}
