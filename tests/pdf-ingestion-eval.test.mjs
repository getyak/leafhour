import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, readFile, rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {evaluatePdfRoutes} from '../tools/evaluate-pdf-routes.mjs';

// A real provider call or using the same source store for both modes must fail
// this experiment: it would spend quota or silently reuse the first job.
test('offline PDF evaluation uses three bounded synthetic sources without network or live library writes', async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async () => { throw Error('Network is forbidden in this evaluation'); };
  try {
    const {report, fixtures} = await evaluatePdfRoutes();
    assert.equal(report.evidenceKind, 'offline-routing-with-mock-provider');
    assert.equal(fixtures.length, 3);
    assert.deepEqual(report.samples.map(s => s.totalPages), [1, 1, 1]);
    assert.equal(report.realOcrPages, 0);
    assert.equal(report.liveLibraryWrites, 0);
    assert.equal(report.realAbStatus, 'blocked-quota-and-cost-unverified');
    for (const sample of report.samples) {
      assert.deepEqual(sample.runs.map(r => r.mode), ['auto', 'ocr']);
      assert.ok(sample.runs.every(r => r.state === 'done' && r.sourceHash === sample.sha256));
      assert.ok(sample.runs.every(r => r.review === 'extracted_unreviewed'));
      assert.ok(sample.runs.every(r => r.sourceBytesVerified && r.pageCoverageComplete));
      assert.equal(sample.runs[1].mockRecognitionPages, 1);
      assert.equal(sample.runs[1].quality, null);
      assert.equal(sample.runs[1].rawMockResults, 1);
    }
  } finally { globalThis.fetch = previous; }
});

test('native screening passes a synthetic two-column page whose reading order and footnote position are wrong', async () => {
  const {report} = await evaluatePdfRoutes();
  const single = report.samples.find(s => s.id === 'single-column');
  const scan = report.samples.find(s => s.id === 'scan');
  const complex = report.samples.find(s => s.id === 'columns-footnote');
  assert.equal(single.runs[0].mockRecognitionPages, 0);
  assert.equal(scan.runs[0].mockRecognitionPages, 1);
  assert.equal(complex.runs[0].mockRecognitionPages, 0);
  assert.deepEqual(complex.nativeObservedMarkers, ['L1', 'R1', 'F1', 'L2', 'R2']);
  assert.deepEqual(complex.expectedReadingMarkers, ['L1', 'L2', 'R1', 'R2', 'F1']);
  assert.equal(complex.nativeOrderMatchesReference, false);
  assert.equal(complex.nativeNeedsRecognition, false);
});

test('evaluation CLI rejects private-input flags and refuses to overwrite existing evidence', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'get209-cli-'));
  try {
    const script = fileURLToPath(new URL('../tools/evaluate-pdf-routes.mjs', import.meta.url));
    await writeFile(path.join(dir, 'report.json'), 'original evidence');
    const existing = spawnSync(process.execPath, [script, '--out', dir], {encoding: 'utf8'});
    assert.notEqual(existing.status, 0);
    assert.match(existing.stderr, /EEXIST/);
    assert.equal(await readFile(path.join(dir, 'report.json'), 'utf8'), 'original evidence');
    const input = spawnSync(process.execPath, [script, '--input', 'private.pdf'], {encoding: 'utf8'});
    assert.notEqual(input.status, 0);
    assert.match(input.stderr, /Usage:/);
  } finally { await rm(dir, {recursive: true, force: true}); }
});
