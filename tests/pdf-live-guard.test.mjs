import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, rm, readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createLiveIntent, claimLiveRun} from '../tools/pdf-live-guard.mjs';

// These tests keep the real filesystem/exclusive claim/budget writes. Only the
// external submit is synthetic; removing a guard must expose a duplicate or
// unreserved side effect, rather than merely changing a mock's return value.
const fixtures = () => ['zh-single', 'zh-scan', 'zh-columns-footnote'].map((id, i) => ({
  sample: {id, kind: i === 1 ? 'scan' : 'text', layout: ['single-column', 'raster-only', 'two-columns-footnote'][i],
    pages: [[{id: 'A', kind: 'body', text: '甲乙'}], [{id: 'B', kind: 'body', text: '丙丁'}]]},
  bytes: Buffer.from('synthetic-pdf-' + id),
}));
async function setup(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'get209-guard-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const built = fixtures(), intent = await createLiveIntent(built);
  const intentText = JSON.stringify(intent);
  await writeFile(path.join(dir, 'intent.json'), intentText);
  return {dir, built, intent, intentText};
}

test('existing report rejects a claim before token/probe/submit work', async t => {
  const c = await setup(t);
  await writeFile(path.join(c.dir, 'report.json'), 'historical evidence');
  let external = 0;
  await assert.rejects(async () => { await claimLiveRun(c.dir, c); external++; }, /EEXIST/);
  assert.equal(external, 0);
  assert.equal(await readFile(path.join(c.dir, 'report.json'), 'utf8'), 'historical evidence');
});

test('concurrent same-directory callers produce one durable claim and one reservation', async t => {
  const c = await setup(t);
  const claims = await Promise.allSettled([claimLiveRun(c.dir, c), claimLiveRun(c.dir, c)]);
  assert.equal(claims.filter(x => x.status === 'fulfilled').length, 1);
  assert.match(claims.find(x => x.status === 'rejected').reason.message, /EEXIST/);
  const claim = claims.find(x => x.status === 'fulfilled').value;
  await claim.reserve({sampleId: 'zh-scan', mode: 'auto', requestId: 'req-one', pages: 2, batchSha256: 'a'.repeat(64)});
  assert.deepEqual(claim.summary(), {attempts: 1, reservedPages: 2, acknowledgedSubmissions: 0, acknowledgedPages: 0, unknownOutcomePages: 2});
  const recorded = JSON.parse(await readFile(path.join(c.dir, 'attempt.json'), 'utf8'));
  assert.equal(recorded.intentSha256.length, 64);
  assert.equal(recorded.plan.hardCapRecognizedPages, 12);
});

test('independent processes cannot acquire or submit the same experiment twice', async t => {
  const c = await setup(t);
  const script = `import {readFile} from 'node:fs/promises';
    import {claimLiveRun} from ${JSON.stringify(new URL('../tools/pdf-live-guard.mjs', import.meta.url).href)};
    const built = (${fixtures.toString()})();
    try {
      const claim = await claimLiveRun(process.argv[1], {built, intentText: await readFile(process.argv[1]+'/intent.json','utf8')});
      await claim.reserve({sampleId:'zh-scan',mode:'auto',requestId:'process-one',pages:2,batchSha256:'a'.repeat(64)});
      process.exitCode=0;
    } catch(e) { process.exitCode=e.code==='EEXIST'?2:3; }`;
  const start = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script, c.dir], {stdio: 'ignore'});
    child.on('error', reject); child.on('exit', code => resolve(code));
  });
  assert.deepEqual((await Promise.all([start(), start()])).sort(), [0, 2]);
  const reservation = JSON.parse(await readFile(path.join(c.dir, 'submission-zh-scan-auto.json'), 'utf8'));
  assert.equal(reservation.pages, 2);
});

test('lost response leaves a durable unknown reservation and blocks the route and whole-run replay', async t => {
  const c = await setup(t), claim = await claimLiveRun(c.dir, c);
  await claim.reserve({sampleId: 'zh-scan', mode: 'ocr', requestId: 'accepted-but-lost', pages: 2, batchSha256: 'b'.repeat(64)});
  // Simulates process death after a provider accepted; no fabricated receipt.
  await assert.rejects(claim.reserve({sampleId: 'zh-scan', mode: 'ocr', requestId: 'new-id', pages: 2, batchSha256: 'b'.repeat(64)}), /already reserved/);
  await assert.rejects(claimLiveRun(c.dir, c), /EEXIST/);
  const reservation = JSON.parse(await readFile(path.join(c.dir, 'submission-zh-scan-ocr.json'), 'utf8'));
  assert.equal(reservation.requestId, 'accepted-but-lost');
  assert.equal(reservation.outcome, 'unknown');
  assert.equal(claim.summary().unknownOutcomePages, 2);
  await assert.rejects(claim.reserve({sampleId: 'zh-single', mode: 'auto', requestId: 'another-route', pages: 2, batchSha256: 'b'.repeat(64)}), /outcome unknown/);
});

test('acknowledgement never releases the page budget or permits re-submission', async t => {
  const c = await setup(t), claim = await claimLiveRun(c.dir, c);
  const r = await claim.reserve({sampleId: 'zh-single', mode: 'ocr', requestId: 'req-one', pages: 2, batchSha256: 'c'.repeat(64)});
  await claim.acknowledge(r, {jobId: 'job-one'});
  assert.equal(claim.summary().reservedPages, 2);
  assert.equal(claim.summary().unknownOutcomePages, 0);
  await assert.rejects(claim.reserve({sampleId: 'zh-single', mode: 'ocr', requestId: 'req-two', pages: 2, batchSha256: 'c'.repeat(64)}), /already reserved/);
});

test('an unusable acceptance handle remains unknown and a request identity cannot be reused', async t => {
  const c = await setup(t), claim = await claimLiveRun(c.dir, c);
  const r = await claim.reserve({sampleId: 'zh-single', mode: 'ocr', requestId: 'req-one', pages: 2, batchSha256: 'c'.repeat(64)});
  await assert.rejects(claim.acknowledge(r, {}), /outcome remains unknown/);
  assert.equal(claim.summary().unknownOutcomePages, 2);
  await claim.acknowledge(r, {jobId: 'job-one'});
  await assert.rejects(claim.reserve({sampleId: 'zh-scan', mode: 'ocr', requestId: 'req-one', pages: 2, batchSha256: 'c'.repeat(64)}), /identity already reserved/);
});

test('invalid or drifted intent fails closed without creating a run claim', async t => {
  for (const mutate of [
    x => { x.schemaVersion = 1; },
    x => { x.hardCapRecognizedPages = 100; },
    x => { x.worstCaseRecognizedPages = 2; },
    x => { x.batchPages = 30; },
    x => { x.model = 'another-model'; },
    x => { x.samples[0].totalPages = 3; },
    x => { x.samples[0].pages[0].referenceText = 'different reference'; },
    x => { x.execution.files[0].sha256 = '0'.repeat(64); },
    x => { x.samples.push(x.samples[0]); },
  ]) {
    const c = await setup(t), altered = structuredClone(c.intent); mutate(altered);
    await assert.rejects(claimLiveRun(c.dir, {...c, intentText: JSON.stringify(altered)}), /intent|Intent/);
    assert.equal((await readdir(c.dir)).includes('attempt.json'), false);
  }
});

test('page reservations stop at twelve and reject over-page or foreign submissions', async t => {
  const c = await setup(t), claim = await claimLiveRun(c.dir, c);
  await assert.rejects(claim.reserve({sampleId: 'zh-single', mode: 'ocr', requestId: 'over-pages', pages: 3, batchSha256: 'd'.repeat(64)}), /pages/);
  await assert.rejects(claim.reserve({sampleId: 'private-book', mode: 'ocr', requestId: 'foreign', pages: 1, batchSha256: 'd'.repeat(64)}), /route/);
  for (const sample of c.built) for (const mode of ['auto', 'ocr']) {
    const r = await claim.reserve({sampleId: sample.sample.id, mode, requestId: sample.sample.id + '-' + mode, pages: 2, batchSha256: 'd'.repeat(64)});
    await claim.acknowledge(r, {jobId: 'job-' + sample.sample.id + '-' + mode});
  }
  assert.equal(claim.summary().reservedPages, 12);
  assert.equal(claim.summary().acknowledgedPages, 12);
  await assert.rejects(claim.reserve({sampleId: 'zh-single', mode: 'ocr', requestId: 'seventh', pages: 1, batchSha256: 'd'.repeat(64)}), /already reserved/);
  assert.equal(claim.summary().reservedPages, 12);
});

test('partial claim from a crash is retained and never silently reclaimed', async t => {
  const c = await setup(t);
  await writeFile(path.join(c.dir, 'attempt.json'), '{partial');
  await assert.rejects(claimLiveRun(c.dir, c), /EEXIST/);
  assert.equal(await readFile(path.join(c.dir, 'attempt.json'), 'utf8'), '{partial');
});
