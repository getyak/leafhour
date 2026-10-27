// Append-only local evidence for the explicitly invoked, synthetic GET-209 run.
// No token, provider, network, or account access belongs in this module.
import {open, lstat} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {createHash, randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import path from 'node:path';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const modes = ['auto', 'ocr'];
const sampleIds = ['zh-single', 'zh-scan', 'zh-columns-footnote'];

// Only content and finite geometry belong in retained OCR evidence. Provider
// metadata can contain arbitrary objects (including signed transport URLs).
// Never copy those objects into the durable content projection.
export function projectRawPageContent(result) {
  const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
  return {
    width: positive(result?.width), height: positive(result?.height),
    blocks: Array.isArray(result?.parsing_res_list) ? result.parsing_res_list.map(block => ({
      text: typeof block?.block_content === 'string' ? block.block_content : null,
      label: typeof block?.block_label === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(block.block_label)
        ? block.block_label : null,
      bbox: Array.isArray(block?.block_bbox) && block.block_bbox.length === 4
        && Array.from(block.block_bbox).every(value => typeof value === 'number' && Number.isFinite(value))
        ? [...block.block_bbox] : null,
      order: Number.isSafeInteger(block?.block_order) && block.block_order >= 0 ? block.block_order : null,
    })) : null,
  };
}

const provider = {
  model: 'PaddleOCR-VL-1.6', sdkPackage: '@paddleocr/api-sdk@0.2.3',
  providerOptionsFrozenFromRepo: {useDocOrientationClassify: false, useDocUnwarping: false,
    markdownIgnoreLabels: ['header', 'footer', 'number', 'header_image', 'footer_image']},
  batchPages: 2, hardCapRecognizedPages: 12,
};
const codeFiles = ['tools/evaluate-pdf-routes-live.mjs', 'tools/pdf-live-guard.mjs',
  'server/book-ingestion.mjs', 'server/pdf-native.mjs', 'server/paddleocr.mjs',
  'server/document-import.mjs', 'package.json', 'package-lock.json'];
const execution = () => ({layoutVersion: 2, files: codeFiles.map(file => ({file,
  sha256: hash(readFileSync(new URL('../' + file, import.meta.url)))}))});
const referenceText = blocks => blocks.map(b => b.text).join('\n\n');
const planSamples = built => built.map(({sample, bytes}) => ({
  id: sample.id, kind: sample.kind, layout: sample.layout, sha256: hash(bytes), bytes: bytes.length,
  totalPages: sample.pages.length,
  rights: {kind: 'synthetic', license: 'CC0-1.0', source: 'composed-in-tools/evaluate-pdf-routes-live.mjs', privateInputs: false},
  pages: sample.pages.map((blocks, i) => ({page: i + 1, referenceBlocks: blocks,
    expectedOrder: blocks.map(b => b.id), referenceText: referenceText(blocks)})),
}));

export async function createLiveIntent(built) {
  if (!isDeepStrictEqual(built.map(f => f.sample.id), sampleIds)
      || built.some(f => f.sample.pages.length !== 2)) throw Error('Invalid synthetic intent samples');
  const samples = planSamples(built);
  return {schemaVersion: 2, evidenceKind: 'live-ab-real-provider', phase: 'intent-frozen-before-any-provider-call',
    frozenAt: new Date().toISOString(), ...structuredClone(provider), execution: execution(),
    worstCaseRecognizedPages: samples.reduce((n, s) => n + s.totalPages, 0) * modes.length, samples};
}

export async function assertFreshLiveRun(outDir) {
  const dir = await lstat(outDir);
  if (!dir.isDirectory() || dir.isSymbolicLink()) throw Error('Run evidence must be a real directory');
  for (const file of ['report.json', 'attempt.json']) {
    try { await lstat(path.join(outDir, file)); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    throw Object.assign(Error('EEXIST: evidence already started or completed; retain it and do not replay: ' + file), {code: 'EEXIST'});
  }
}

// wx prevents concurrent ownership, file+directory fsync makes the decision
// durable before the caller can perform any external operation. A partial file
// or failed fsync also blocks every later invocation; it is never auto-removed.
export async function writeExclusiveEvidence(filename, value) {
  const file = await open(filename, 'wx', 0o600);
  try { await file.writeFile(JSON.stringify(value, null, 2) + '\n'); await file.sync(); }
  finally { await file.close(); }
  const parent = await open(path.dirname(filename), 'r');
  try { await parent.sync(); } finally { await parent.close(); }
}

export async function claimLiveRun(outDir, {intentText, built}) {
  await assertFreshLiveRun(outDir);
  const intent = JSON.parse(intentText), expected = await createLiveIntent(built);
  // frozenAt is provenance, not permission to change the code/source/options.
  if (typeof intent.frozenAt !== 'string' || !Number.isFinite(Date.parse(intent.frozenAt))) throw Error('Invalid intent time');
  expected.frozenAt = intent.frozenAt;
  if (!isDeepStrictEqual(intent, expected)) throw Error('Intent drift or legacy intent: generate a new, separately authorized experiment; never rewrite old evidence');
  const attempt = {schemaVersion: 2, runId: randomUUID(), claimedAt: new Date().toISOString(),
    intentSha256: hash(intentText), outcome: 'started-no-automatic-replay', plan: intent};
  await writeExclusiveEvidence(path.join(outDir, 'attempt.json'), attempt);
  const reservations = new Map(), acknowledged = new Set();
  let queue = Promise.resolve();
  const summary = () => {
    const rows = [...reservations.values()];
    return {attempts: rows.length, reservedPages: rows.reduce((n, r) => n + r.pages, 0),
      acknowledgedSubmissions: acknowledged.size,
      acknowledgedPages: rows.filter(r => acknowledged.has(r.route)).reduce((n, r) => n + r.pages, 0),
      unknownOutcomePages: rows.filter(r => !acknowledged.has(r.route)).reduce((n, r) => n + r.pages, 0)};
  };
  return {
    runId: attempt.runId, intentSha256: attempt.intentSha256, summary,
    reserve(input) {
      const pending = queue.then(async () => {
        const {sampleId, mode, requestId, pages, batchSha256} = input;
        const source = intent.samples.find(s => s.id === sampleId), route = sampleId + '-' + mode;
        if (!source || !modes.includes(mode)) throw Error('Unplanned submission route');
        if (reservations.has(route)) throw Error('Route already reserved; outcome may be unknown, do not replay');
        if (summary().unknownOutcomePages) throw Error('Prior submission outcome unknown; no further submissions allowed');
        if (!Number.isInteger(pages) || pages < 1 || pages > source.totalPages) throw Error('Invalid submission pages');
        if (!/^[A-Za-z0-9_-]{1,100}$/.test(requestId ?? '') || !/^[a-f0-9]{64}$/.test(batchSha256 ?? '')) throw Error('Invalid request identity');
        if ([...reservations.values()].some(r => r.requestId === requestId)) throw Error('Request identity already reserved');
        if (summary().reservedPages + pages > Math.min(intent.hardCapRecognizedPages, intent.worstCaseRecognizedPages)) throw Error('Reserved page budget exceeded');
        const reservation = {schemaVersion: 2, runId: attempt.runId, intentSha256: attempt.intentSha256,
          route, sampleId, mode, sourceSha256: source.sha256, batchSha256, requestId, pages,
          reservedAt: new Date().toISOString(), outcome: 'unknown'};
        await writeExclusiveEvidence(path.join(outDir, 'submission-' + route + '.json'), reservation);
        reservations.set(route, reservation);
        return reservation;
      });
      queue = pending.catch(() => {});
      return pending;
    },
    async acknowledge(reservation, handle) {
      if (reservations.get(reservation.route) !== reservation || acknowledged.has(reservation.route)) throw Error('Unknown or already acknowledged reservation');
      if (typeof handle?.jobId !== 'string' || !handle.jobId.trim() || handle.jobId.length > 256) throw Error('No usable provider job identity; submission outcome remains unknown');
      // Only a digest of the provider handle is retained. The original batchId
      // remains in the reservation for a separately authorized reconciliation.
      await writeExclusiveEvidence(path.join(outDir, 'acknowledged-' + reservation.route + '.json'), {
        runId: attempt.runId, requestId: reservation.requestId, acknowledgedAt: new Date().toISOString(),
        handleDigest: hash(String(handle?.jobId ?? '')), outcome: 'submission-acknowledged-result-not-yet-proven',
      });
      acknowledged.add(reservation.route);
    },
  };
}
