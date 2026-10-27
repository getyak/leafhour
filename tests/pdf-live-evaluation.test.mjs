import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, readFile, rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {PDFDocument} from 'pdf-lib';
import {run, layoutTextPage, pageMetrics} from '../tools/evaluate-pdf-routes-live.mjs';
import {createLiveIntent} from '../tools/pdf-live-guard.mjs';

async function fixtureRun(t, {lostResponse = false} = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'get209-live-offline-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const doc = await PDFDocument.create(); doc.addPage(); doc.addPage();
  const bytes = Buffer.from(await doc.save());
  const built = ['zh-single', 'zh-scan', 'zh-columns-footnote'].map((id, i) => ({bytes,
    sample: {id, kind: i === 1 ? 'scan' : 'text', layout: ['single-column', 'raster-only', 'two-columns-footnote'][i],
      pages: [[{id: 'A', kind: 'body', text: '甲乙'}], [{id: 'B', kind: 'body', text: '丙丁'}]]}}));
  await writeFile(path.join(dir, 'intent.json'), JSON.stringify(await createLiveIntent(built)));
  const font = path.join(dir, 'synthetic-font'); await writeFile(font, 'offline-build-does-not-use-font');
  const effects = {tokenReads: 0, factories: 0, probes: 0, submissions: 0};
  const deps = {
    build: async () => built,
    readToken: () => { effects.tokenReads++; return 'synthetic-never-sent'; },
    makeProvider: () => {
      effects.factories++;
      return {
        recover: async () => { effects.probes++; return null; },
        submit: async (_bytes, {batchId}) => {
          const claim = JSON.parse(await readFile(path.join(dir, 'attempt.json'), 'utf8'));
          const mode = batchId.endsWith('-auto') ? 'auto' : 'ocr', id = batchId.slice(0, -(mode.length + 1));
          const reservation = JSON.parse(await readFile(path.join(dir, `submission-${id}-${mode}.json`), 'utf8'));
          // Removing the durable-before-submit ordering must fail here, before
          // the synthetic side effect happens. No provider/network is invoked.
          assert.equal(reservation.runId, claim.runId);
          assert.equal(reservation.requestId, batchId);
          assert.equal(reservation.pages, 2);
          assert.equal(reservation.outcome, 'unknown');
          effects.submissions++;
          if (lostResponse) throw Error('synthetic accepted response lost');
          return {jobId: 'synthetic-job-' + batchId};
        },
      };
    },
    inspect: async () => ({pages: [1, 2].map(page => ({page, text: 'synthetic', needsRecognition: false}))}),
    route: async (fixture, mode, provider) => {
      try {
        if (mode === 'ocr' || fixture.sample.id === 'zh-scan') {
          await provider.submit(bytes, {batchId: fixture.sample.id + '-' + mode});
        }
        return {mode, state: 'done', providerStats: provider.stats, extractedPages: [
          {page: 1, text: '甲乙', blank: false}, {page: 2, text: '丙丁', blank: false}]};
      } catch {
        return {mode, state: 'needs_review', providerStats: provider.stats, extractedPages: null};
      }
    },
  };
  return {dir, font, deps, effects};
}

test('existing report blocks the real runner before token loading or provider construction', async t => {
  const c = await fixtureRun(t);
  await writeFile(path.join(c.dir, 'report.json'), 'original');
  await assert.rejects(run(c.dir, c.font, c.deps), /EEXIST/);
  assert.deepEqual(c.effects, {tokenReads: 0, factories: 0, probes: 0, submissions: 0});
  assert.equal(await readFile(path.join(c.dir, 'report.json'), 'utf8'), 'original');
});

test('two real runner invocations share one experiment and retain complete hypotheses', async t => {
  const c = await fixtureRun(t);
  const previousFetch = globalThis.fetch;
  globalThis.fetch = () => { throw Error('Network forbidden'); };
  try {
    const outcomes = await Promise.allSettled([run(c.dir, c.font, c.deps), run(c.dir, c.font, c.deps)]);
    assert.equal(outcomes.filter(r => r.status === 'fulfilled').length, 1);
    assert.match(outcomes.find(r => r.status === 'rejected').reason.message, /EEXIST/);
    assert.deepEqual(c.effects, {tokenReads: 1, factories: 7, probes: 1, submissions: 4});
    const report = JSON.parse(await readFile(path.join(c.dir, 'report.json'), 'utf8'));
    assert.equal(report.status, 'executed');
    assert.equal(report.totals.reservedPages, 8);
    assert.equal(report.totals.unknownOutcomePages, 0);
    assert.equal(report.totals.actualCost, null);
    assert.equal(report.totals.billingVerified, false);
    const saved = JSON.parse(await readFile(path.join(c.dir, 'route-zh-single-ocr.json'), 'utf8'));
    assert.equal(saved.extractedPages[0].text, '甲乙');
    assert.equal(pageMetrics([{id: 'A', text: '甲乙'}], saved.extractedPages[0].text).cerStripped, 0);
  } finally { globalThis.fetch = previousFetch; }
});

test('unknown acceptance stops new routes and preserves nonzero attempts through a second invocation', async t => {
  const c = await fixtureRun(t, {lostResponse: true});
  const report = await run(c.dir, c.font, c.deps);
  assert.equal(report.status, 'blocked-unknown-submission');
  assert.equal(report.totals.attempts, 1);
  assert.equal(report.totals.reservedPages, 2);
  assert.equal(report.totals.unknownOutcomePages, 2);
  assert.equal(report.totals.acknowledgedSubmissions, 0);
  assert.equal(report.totals.recognizedPages, null);
  assert.equal(c.effects.submissions, 1);
  assert.equal(report.samples[0].runs[1].providerStats.attemptedPages, 2);
  const before = structuredClone(c.effects);
  await assert.rejects(run(c.dir, c.font, c.deps), /EEXIST/);
  assert.deepEqual(c.effects, before);
});

test('legacy intent or changed budget fails before token/probe access', async t => {
  const c = await fixtureRun(t);
  const intent = JSON.parse(await readFile(path.join(c.dir, 'intent.json'), 'utf8'));
  intent.hardCapRecognizedPages = 100;
  await writeFile(path.join(c.dir, 'intent.json'), JSON.stringify(intent));
  await assert.rejects(run(c.dir, c.font, c.deps), /Intent drift/);
  assert.deepEqual(c.effects, {tokenReads: 0, factories: 0, probes: 0, submissions: 0});
});

test('real ingestion with a local fake provider saves normalized and raw text without transport URLs', async t => {
  const c = await fixtureRun(t);
  delete c.deps.route; // Exercise production prepare/consent/advance/normalize.
  let constructed = 0, submissions = 0;
  const ids = ['zh-single', 'zh-scan', 'zh-columns-footnote'];
  c.deps.makeProvider = () => {
    const index = constructed++ - 1;
    return {
      recover: async () => null,
      submit: async (_bytes, {batchId}) => {
        const id = ids[Math.floor(index / 2)], mode = index % 2 ? 'ocr' : 'auto';
        const reservation = JSON.parse(await readFile(path.join(c.dir, `submission-${id}-${mode}.json`), 'utf8'));
        assert.equal(reservation.requestId, batchId);
        submissions++;
        return {jobId: 'synthetic-' + index};
      },
      status: async () => ({state: 'done'}),
      result: async () => ({downloadUrl: 'https://provider.invalid/signed?token=must-not-persist',
        pages: ['甲乙', '丙丁'].map(text => ({prunedResult: {width: 600, height: 800,
          parsing_res_list: [{block_content: text, block_label: 'text', block_bbox: [0, 0, 50, 20], block_order: 1}]}}))}),
    };
  };
  const previousFetch = globalThis.fetch;
  globalThis.fetch = () => { throw Error('Network forbidden'); };
  try {
    const report = await run(c.dir, c.font, c.deps);
    assert.equal(report.status, 'executed');
    assert.equal(submissions, 6); // Blank synthetic PDFs need OCR in both modes.
    assert.equal(report.totals.reservedPages, 12);
    for (const sample of report.samples) for (const route of sample.runs) {
      assert.deepEqual(route.extractedPages.map(p => p.text), ['甲乙', '丙丁']);
      assert.deepEqual(route.rawContentProjection[0].pages.map(p => p.blocks[0].text), ['甲乙', '丙丁']);
      assert.equal(route.rawResultDigests.length, 1);
    }
    const text = await readFile(path.join(c.dir, 'report.json'), 'utf8');
    assert.doesNotMatch(text, /provider\.invalid|must-not-persist|downloadUrl/);
  } finally { globalThis.fetch = previousFetch; }
});

test('real ingestion recovery cannot replay or issue provider queries after a lost submit response', async t => {
  const c = await fixtureRun(t);
  delete c.deps.route;
  let submissions = 0, recoverQueries = 0;
  c.deps.makeProvider = () => ({
    recover: async () => { recoverQueries++; return null; },
    submit: async (_bytes, {batchId}) => {
      const reservation = JSON.parse(await readFile(path.join(c.dir, 'submission-zh-single-auto.json'), 'utf8'));
      assert.equal(reservation.requestId, batchId);
      submissions++;
      throw Error('synthetic accepted but response lost');
    },
  });
  const report = await run(c.dir, c.font, c.deps);
  assert.equal(report.status, 'blocked-unknown-submission');
  assert.equal(submissions, 1);
  assert.equal(recoverQueries, 1); // Initial token probe only; no automatic recovery.
  assert.equal(report.totals.reservedPages, 2);
  assert.equal(report.totals.unknownOutcomePages, 2);
  assert.equal(report.totals.recognizedPages, null);
});

test('correct blocks in wrong order contribute to whole-sequence CER and inversion count', () => {
  const result = pageMetrics([{id: 'A', text: '甲乙'}, {id: 'B', text: '丙丁'}], '丙丁\n\n甲乙');
  assert.equal(result.orderInversions, 1);
  assert.equal(result.cerStripped, 1);
});

test('all historical reference text fits revised columns, while long footnotes get distinct baselines', async () => {
  const intent = JSON.parse(await readFile(new URL('../docs/verification/fixtures/get209-live-ab-2026-10-27/intent.json', import.meta.url)));
  // Deliberately wide glyphs expose the old unwrapped column/page overflow.
  const font = {widthOfTextAtSize: (text, size) => [...text].length * size};
  for (const sample of intent.samples.filter(s => s.kind === 'text')) for (const page of sample.pages) {
    const draws = layoutTextPage(page.referenceBlocks, sample.layout, font);
    assert.ok(draws.every(d => d.x >= 40 && d.x + d.width <= 560.001 && d.y >= 30));
    if (sample.layout === 'two-columns-footnote') {
      assert.ok(draws.filter(d => d.x === 40).every(d => d.x + d.width <= 278.001));
      assert.equal(draws.filter(d => d.x === 40).map(d => d.text).join(''), page.referenceBlocks.filter(b => b.id.startsWith('L')).map(b => b.text).join(''));
      assert.equal(draws.filter(d => d.x === 322).map(d => d.text).join(''), page.referenceBlocks.filter(b => b.id.startsWith('R')).map(b => b.text).join(''));
    }
  }
  const blocks = [1, 2, 3, 4].flatMap(i => [
    {id: 'L' + i, text: '左'.repeat(40)}, {id: 'R' + i, text: '右'.repeat(40)}]);
  blocks.push({id: 'F1', kind: 'footnote', text: '注'.repeat(130)});
  const foot = layoutTextPage(blocks, 'two-columns-footnote', font).filter(d => d.x === 44);
  assert.equal(foot.length, 3);
  assert.equal(new Set(foot.map(d => d.y)).size, 3);
  assert.ok(foot.every(d => d.width <= 512 && d.y >= 30));
  assert.throws(() => layoutTextPage(blocks, 'two-columns-footnote', {widthOfTextAtSize: () => 600}), /Glyph/);
});
