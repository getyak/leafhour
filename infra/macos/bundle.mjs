import {mkdtemp, mkdir, readFile, cp, rm, chmod} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {command, writeManifest, validId} from './operations.mjs';

const digest = data => createHash('sha256').update(data).digest('hex');
export async function verifiedInput(file, sha256) {
  if (!/^[a-f0-9]{64}$/.test(sha256 ?? '') || digest(await readFile(file)) !== sha256) throw Error('Pinned input SHA-256 mismatch');
}

// Build only trusted, committed mainline code in a fresh directory. SSH/CI secrets are not inherited.
export async function bundle({repo, sourceCommit, out, nodeArchive, nodeSha256, nodeVersion, caddy, caddySha256}) {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw Error('Build on isolated macOS arm64 builder');
  if (!/^[a-f0-9]{40}$/.test(sourceCommit ?? '') || !/^22\.\d+\.\d+$/.test(nodeVersion ?? '')) throw Error('Pin source commit and Node 22 version');
  await verifiedInput(nodeArchive, nodeSha256); await verifiedInput(caddy, caddySha256);
  await command('/usr/bin/git', ['-C', repo, 'merge-base', '--is-ancestor', sourceCommit, 'origin/main']);
  if ((await command('/usr/bin/git', ['-C', repo, 'status', '--porcelain'])).trim()) throw Error('Use a clean source checkout');
  const buildRoot = await mkdtemp(path.join(os.tmpdir(), 'leafhour-build-'));
  const source = path.join(buildRoot, 'source'); const runtime = path.join(buildRoot, 'runtime'); const home = path.join(buildRoot, 'home');
  await mkdir(source); await mkdir(runtime); await mkdir(home);
  try {
    const archive = path.join(buildRoot, 'source.tar');
    await command('/usr/bin/git', ['-C', repo, 'archive', '--format=tar', `--output=${archive}`, sourceCommit]);
    await command('/usr/bin/tar', ['-xf', archive, '-C', source]);
    const prefix = `node-v${nodeVersion}-darwin-arm64`;
    const contents = (await command('/usr/bin/tar', ['-tzf', nodeArchive])).trim().split('\n');
    if (!contents.length || contents.some(name => !name.startsWith(prefix + '/') || name.split('/').includes('..') || name.startsWith('/'))) throw Error('Unexpected Node archive layout');
    await command('/usr/bin/tar', ['-xzf', nodeArchive, '--strip-components=1', '-C', runtime]);
    await cp(caddy, path.join(runtime, 'bin', 'caddy')); await chmod(path.join(runtime, 'bin', 'caddy'), 0o755);
    if (!(await command('/usr/bin/file', [path.join(runtime, 'bin', 'caddy')])).includes('arm64')) throw Error('Caddy must include native arm64 code');
    const node = path.join(runtime, 'bin', 'node');
    const env = {PATH: `${path.join(runtime, 'bin')}:/usr/bin:/bin:/usr/sbin:/sbin`, HOME: home, TMPDIR: buildRoot, NPM_CONFIG_USERCONFIG: '/dev/null', NPM_CONFIG_CACHE: path.join(buildRoot, 'npm-cache'), LEAFHOUR_SOURCE_COMMIT: sourceCommit, GITHUB_SHA: sourceCommit};
    if ((await command(node, ['-p', 'process.platform+"-"+process.arch'], {env})).trim() !== 'darwin-arm64' || (await command(node, ['--version'], {env})).trim() !== `v${nodeVersion}`) throw Error('Unexpected Node runtime version/architecture');
    const npm = [path.join(runtime, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')];
    await command(node, [...npm, 'ci'], {cwd: source, env, timeout: 600000});
    await command(node, [...npm, 'run', 'build:modules', '--', '--out', source], {cwd: source, env, timeout: 600000});
    await command(node, [...npm, 'prune', '--omit=dev'], {cwd: source, env, timeout: 600000});
    // The clean public source is retained for AGPL and compatibility imports; no working copy is copied.
    await cp(path.join(source, 'manifest.json'), path.join(source, 'module-manifest.json'));
    await cp(path.join(source, 'apps', 'web', 'Caddyfile'), path.join(source, 'web', 'Caddyfile'));
    // Build output/cache paths are not production inputs and may contain host-specific binaries.
    for (const name of ['.vercel', '.reader-runtime', 'build', '.ui-entry']) await rm(path.join(source, name), {recursive: true, force: true});
    await cp(runtime, path.join(source, 'runtime'), {recursive: true});
    const runtimeId = validId(`node-${nodeVersion}-${nodeSha256.slice(0, 8)}-${caddySha256.slice(0, 8)}`);
    const manifest = await writeManifest(source, {sourceCommit, target: 'darwin-arm64', protocol: 1, buildId: `${sourceCommit}-${nodeSha256.slice(0, 8)}-${caddySha256.slice(0, 8)}`, runtime: {id: runtimeId, nodeVersion, nodeArchiveSha256: nodeSha256, caddySha256}});
    await mkdir(path.dirname(out), {recursive: true});
    // Exclusive publication: never overwrite an artifact bearing the same name.
    await mkdir(out, {recursive: false}); await cp(source, out, {recursive: true, force: false, errorOnExist: true});
    return {buildId: manifest.buildId, sourceCommit, runtimeId, manifestSha256: digest(await readFile(path.join(out, 'manifest.json')))};
  } finally { await rm(buildRoot, {recursive: true, force: true}); }
}
