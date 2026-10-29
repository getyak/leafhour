import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {planChanges, changedPaths} from '../tools/ci-resource-plan.mjs';
import {checkJobs} from '../tools/ci-resource-gate.mjs';

const none = {web:false, native:false, catalog:false, ios_release:false};
const all = {web:true, native:true, catalog:true, ios_release:true};
test('documentation avoids heavy jobs, while unknown and shared inputs fail safe to all jobs', () => {
  assert.deepEqual(planChanges(['README.md', 'AGENTS.md', 'docs/ci-resource-budget.md', '_briefs/product-brief.md']), none);
  for (const file of ['package-lock.json', 'release-files.json', '.github/workflows/ci.yml', 'tools/ci-resource-plan.mjs', 'new-platform/source.rs', 'docs/fixture.json']) {
    assert.deepEqual(planChanges([file]), all, file);
  }
  assert.deepEqual(planChanges([]), all);
});
test('native, web, catalog and copy changes select their actual consumers', () => {
  assert.deepEqual(planChanges(['apps/ios/Leafhour/ReaderView.swift']), {...none, native:true, ios_release:true});
  assert.deepEqual(planChanges(['tests/ios-release.test.mjs', 'scripts/ios/upload.sh']), {...none, ios_release:true});
  assert.deepEqual(planChanges(['app/reader.css', 'server/server.mjs']), {...none, web:true});
  assert.deepEqual(planChanges(['docs/copy/copy-inventory.json']), {...none, web:true});
  assert.deepEqual(planChanges(['tools/classic_chinese.py', 'catalog/manifest.json']), {...none, web:true, catalog:true});
  assert.deepEqual(planChanges(['tests/test_classic_world.py']), {...none, web:true, catalog:true});
  assert.deepEqual(planChanges(['app/reader.css', 'apps/ios/Leafhour/ReaderView.swift']), {...none, web:true, native:true, ios_release:true});
});
test('diff includes both sides of renames, deletions and unusual file names without shell interpretation', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'leafhour-ci-plan-'));
  t.after(() => rm(root, {recursive:true, force:true}));
  const git = (...args) => execFileSync('git', args, {cwd:root, encoding:'utf8'}).trim();
  git('init', '-q'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
  await writeFile(path.join(root, 'native.swift'), 'fixture');
  git('add', '.'); git('commit', '-qm', 'base'); const base = git('rev-parse', 'HEAD');
  git('mv', 'native.swift', 'name\n$(false).md'); git('commit', '-qm', 'rename'); const head = git('rev-parse', 'HEAD');
  assert.deepEqual(changedPaths(base, head, root).sort(), ['native.swift', 'name\n$(false).md'].sort());
  assert.throws(() => changedPaths('--output=/tmp/unsafe', head, root), /full commit/);
  const eventPath = path.join(root, 'event.json'), outputPath = path.join(root, 'outputs');
  await writeFile(eventPath, JSON.stringify({before:base}));
  const env = {PATH:process.env.PATH, GITHUB_EVENT_PATH:eventPath, GITHUB_EVENT_NAME:'push', GITHUB_SHA:head, GITHUB_OUTPUT:outputPath};
  const script = new URL('../tools/ci-resource-plan.mjs', import.meta.url);
  const invoke = (changes={}, cwd=root) => JSON.parse(execFileSync(process.execPath, [script.pathname], {cwd, env:{...env, ...changes}, encoding:'utf8'}));
  assert.deepEqual(invoke({}), all, 'a renamed unknown input must not disappear from the plan');
  await writeFile(eventPath, JSON.stringify({before:'0'.repeat(40)}));
  assert.deepEqual(invoke({}), all, 'new branch or unavailable comparison runs everything');
  await writeFile(eventPath, JSON.stringify({pull_request:{base:{sha:base}}}));
  assert.deepEqual(invoke({GITHUB_EVENT_NAME:'pull_request'}), all, 'an unexpected PR checkout runs everything');
  await writeFile(path.join(root, 'README.md'), 'documentation only');
  git('add', 'README.md'); git('commit', '-qm', 'docs'); const docs = git('rev-parse', 'HEAD');
  await writeFile(eventPath, JSON.stringify({before:head}));
  assert.deepEqual(invoke({GITHUB_SHA:docs}), none, 'the real CLI skips heavy jobs for a docs push');
  git('branch', '-M', 'main'); git('checkout', '-qb', 'feature');
  await mkdir(path.join(root, 'app')); await writeFile(path.join(root, 'app/reader.css'), 'body{}');
  git('add', 'app'); git('commit', '-qm', 'web'); git('checkout', '-q', 'main');
  await writeFile(path.join(root, 'README.md'), 'target branch documentation');
  git('add', 'README.md'); git('commit', '-qm', 'target'); const target = git('rev-parse', 'HEAD');
  git('merge', '--no-ff', '-qm', 'PR merge', 'feature'); const merged = git('rev-parse', 'HEAD');
  const shallow = path.join(root, 'shallow');
  execFileSync('git', ['clone', '-q', '--depth=2', 'file://' + root, shallow]);
  await writeFile(eventPath, JSON.stringify({pull_request:{base:{sha:target}}}));
  assert.deepEqual(invoke({GITHUB_EVENT_NAME:'pull_request', GITHUB_SHA:merged}, shallow), {...none, web:true}, 'depth-2 PR merge checkout excludes target-only changes');
});
const jobs = (plan, overrides={}) => ({
  changes:{result:'success', outputs:Object.fromEntries(Object.entries(plan).map(([key,value]) => [key,String(value)]))},
  test:{result:plan.web ? 'success' : 'skipped'},
  'native-ios':{result:plan.native ? 'success' : 'skipped'},
  'catalog-sources':{result:plan.catalog ? 'success' : 'skipped'},
  'ios-release-contracts':{result:plan.ios_release ? 'success' : 'skipped'},
  ...overrides,
});
test('the final gate accepts only the required successes and deliberate skips', () => {
  assert.doesNotThrow(() => checkJobs(jobs(none)));
  assert.doesNotThrow(() => checkJobs(jobs(all)));
  for (const result of ['failure', 'cancelled', 'skipped', undefined]) {
    assert.throws(() => checkJobs(jobs(all, {test:{result}})), /test/);
  }
  assert.throws(() => checkJobs(jobs(none, {changes:{result:'failure'}})), /planner/);
  assert.throws(() => checkJobs(jobs(none, {changes:{result:'success', outputs:{}}})), /plan/);
  assert.throws(() => checkJobs(jobs(none, {'native-ios':{result:'failure'}})), /native-ios/);
});
