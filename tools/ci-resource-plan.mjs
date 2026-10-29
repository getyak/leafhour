import {execFileSync} from 'node:child_process';
import {appendFile, readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

export const areas = ['web', 'native', 'catalog', 'ios_release'];
const full = () => Object.fromEntries(areas.map(area => [area, true]));

// Only known independent inputs may omit a job. New directories and shared
// manifests deliberately run everything until their consumers are understood.
export function planChanges(files) {
  if (!files.length) return full();
  const plan = Object.fromEntries(areas.map(area => [area, false]));
  for (const file of files) {
    if (file.startsWith('docs/copy/')) { plan.web = true; continue; }
    if (/^(?:README(?:\.[\w-]+)?|SECURITY(?:\.[\w-]+)?|AGENTS|architecture)\.md$/.test(file)
        || /^(?:docs|_briefs)\/.*\.md$/.test(file)) continue;
    if (file.startsWith('apps/ios/') || file === 'tools/verify-ios-vendor.mjs') {
      plan.native = plan.ios_release = true; continue;
    }
    if (/^(?:tests\/ios-.*\.test\.mjs|tests\/test_ios_.*\.py|scripts\/ios\/)/.test(file)) {
      plan.ios_release = true; continue;
    }
    if (/^(?:catalog\/|tools\/classic_.*\.py$|tools\/catalog-requirements\.txt$|tests\/test_classic_.*\.py$)/.test(file)) {
      plan.web = plan.catalog = true; continue;
    }
    if (/^(?:app|api|server|harness)\//.test(file) || /^tests\/.*\.test\.mjs$/.test(file)) {
      plan.web = true; continue;
    }
    return full();
  }
  return plan;
}

export function changedPaths(base, head, cwd = process.cwd()) {
  if (![base, head].every(sha => /^[a-f0-9]{40}$/.test(sha) && !/^0+$/.test(sha))) throw Error('Expected full commit IDs');
  // NUL output preserves spaces and newlines. Disabling rename detection keeps
  // both the deleted input and its replacement in the impact calculation.
  return execFileSync('git', ['diff', '--no-renames', '--name-only', '-z', base, head, '--'], {cwd, encoding:'utf8'}).split('\0').filter(Boolean);
}

async function main() {
  const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
  let plan;
  try {
    const base = process.env.GITHUB_EVENT_NAME === 'pull_request' ? event.pull_request.base.sha : event.before;
    // checkout uses the PR merge commit, whose first parent is this event's
    // target SHA. Thus the diff excludes unrelated target-branch changes.
    if (process.env.GITHUB_EVENT_NAME === 'pull_request') {
      const parents = execFileSync('git', ['show', '-s', '--format=%P', process.env.GITHUB_SHA], {encoding:'utf8'}).trim().split(' ');
      if (parents[0] !== base) throw Error('PR merge base is unavailable');
    }
    plan = planChanges(changedPaths(base, process.env.GITHUB_SHA));
  } catch {
    console.warn('Change comparison unavailable; running every CI area.');
    plan = full();
  }
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, areas.map(area => `${area}=${plan[area]}\n`).join(''));
  console.log(JSON.stringify(plan));
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, '### CI impact plan\n\n' + areas.map(area => `- ${area}: ${plan[area] ? 'required' : 'unaffected (skipped)'}`).join('\n') + '\n');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
