#!/usr/bin/env node
import path from 'node:path';
import {readPrivateJson, tailscaleAdd, tailscaleRemove, verifyArtifact} from './operations.mjs';
import {initialize, publishArtifact, prepare, activate, status, resources, control, instance} from './controller.mjs';
import {bundle} from './bundle.mjs';

function argumentsFor(args) {
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const key = args[index]; if (!/^--[a-z-]+$/.test(key)) throw Error('Use named options only');
    const camel = key.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    if (['apply', 'dryRun'].includes(camel)) options[camel] = true;
    else { if (!args[index + 1] || args[index + 1].startsWith('--')) throw Error(`Missing ${key}`); options[camel] = args[++index]; }
  }
  if (options.apply && options.dryRun) throw Error('Choose apply or dry-run');
  options.dryRun = !options.apply; return options;
}

const usage = `Leafhour macOS operator tool (mutations default to dry-run)
  build --repo PATH --source-commit SHA --out NEW_DIR --node-archive PATH --node-sha256 SHA --node-version VERSION --caddy PATH --caddy-sha256 SHA --apply
  verify --artifact PATH --expected-commit SHA --manifest-sha256 SHA
  init --root PATH --mode user-trial|system-service --runtime-id ID [--apply]
  publish --root PATH --artifact PATH --expected-commit SHA --manifest-sha256 SHA [--apply]
  prepare --root PATH --release-id ID --slot-id ID --api-port 18341 --agent-port 18342 [--apply]
  activate --root PATH --slot-id ID [--apply]
  rollback --root PATH [--apply]
  pause --root PATH [--apply]
  status|resources --root PATH
  tailscale-add --hostname DNS_NAME --receipt PRIVATE_FILE [--apply]
  tailscale-remove --receipt PRIVATE_FILE [--apply]
No command changes DNS, Funnel, FileVault, the firewall or another application's services.
`;

async function main() {
  const [action, ...args] = process.argv.slice(2); if (!action || action === 'help' || action === '--help') { console.log(usage); return; }
  const options = argumentsFor(args); let result;
  if (action === 'build') result = options.dryRun ? {action: 'build', sourceCommit: options.sourceCommit, out: options.out, execution: 'requires --apply'} : await bundle(options);
  else if (action === 'verify') { const manifest = await verifyArtifact(options.artifact, options.expectedCommit, options.manifestSha256); result = {verified: true, sourceCommit: manifest.sourceCommit, buildId: manifest.buildId}; }
  else if (action === 'init') result = await initialize(options);
  else if (action === 'publish') result = await publishArtifact(options);
  else if (action === 'prepare') result = await prepare({...options, apiPort: Number(options.apiPort ?? 18341), agentPort: Number(options.agentPort ?? 18342)});
  else if (action === 'activate') result = await activate(options);
  else if (action === 'rollback') {
    const state = await readPrivateJson(path.join(options.root, 'state', 'deployment.json'));
    if (!state.previous?.id) throw Error('No previous compatible release recorded');
    result = await activate({...options, slotId: state.previous.id, rollback: true});
  } else if (action === 'status') result = await status(options.root);
  else if (action === 'resources') result = await resources(options.root);
  else if (action === 'pause') {
    const config = await instance(options.root); const state = await readPrivateJson(path.join(options.root, 'state', 'deployment.json'));
    result = options.dryRun ? {action: 'pause-current-agent', slot: state.candidate.id} : await control({socket: state.candidate.socket, tokenFile: path.join(config.root, 'config', 'ipc', 'agent-token')}, true);
  } else if (action === 'tailscale-add') result = await tailscaleAdd(options);
  else if (action === 'tailscale-remove') result = await tailscaleRemove(options);
  else throw Error('Unknown action; run help');
  console.log(JSON.stringify(result, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
