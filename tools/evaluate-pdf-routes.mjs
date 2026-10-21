// Offline GET-209 experiment. There is deliberately no real-provider adapter,
// credential lookup, private-file input, or persistent library implementation.
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import {PDFDocument, StandardFonts} from 'pdf-lib';
import {createCanvas} from '@napi-rs/canvas';
import {inspectNativePdf} from '../server/pdf-native.mjs';
import {createBookIngestion} from '../server/book-ingestion.mjs';
import {digest} from '../server/document-import.mjs';

const fixedDate = new Date('2026-10-21T00:00:00Z');
const user = Object.freeze({id: 'synthetic-get209-offline-only'});

async function createFixtures() {
  const fixtures = [];
  for (const id of ['single-column', 'scan', 'columns-footnote']) {
    // pdf-lib's documented create/embedFont/drawText/save API:
    // https://pdf-lib.js.org/docs/api/classes/pdfdocument
    const doc = await PDFDocument.create();
    doc.setCreationDate(fixedDate);
    doc.setModificationDate(fixedDate);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([600, 800]);
    const draw = (text, x, y, size = 12) => page.drawText(text, {font, x, y, size});
    let expectedReadingMarkers = [];
    if (id === 'single-column') {
      draw('S1 A reader opens a quiet book.', 40, 720);
      draw('S2 A second paragraph follows the first.', 40, 680);
    } else if (id === 'scan') {
      const canvas = createCanvas(600, 800), ctx = canvas.getContext('2d');
      ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 600, 800);
      ctx.fillStyle = 'black'; ctx.font = '18px sans-serif';
      ctx.fillText('Image only: a quiet book has two short lines.', 35, 75);
      ctx.fillText('There is no hidden PDF text layer.', 35, 115);
      const image = await doc.embedPng(canvas.toBuffer('image/png'));
      page.drawImage(image, {x: 0, y: 0, width: 600, height: 800});
    } else {
      // Drawing order is row-wise; intended reading order is column-wise.
      // The footnote is physically at the bottom but appears mid-stream.
      draw('L1 Left column begins here.', 40, 720);
      draw('R1 Right column begins here.', 320, 720);
      draw('F1 Footnote belongs after both columns.', 40, 65, 9);
      draw('L2 Left column continues here.', 40, 680);
      draw('R2 Right column continues here.', 320, 680);
      expectedReadingMarkers = ['L1', 'L2', 'R1', 'R2', 'F1'];
    }
    fixtures.push({id, bytes: Buffer.from(await doc.save()), expectedReadingMarkers});
  }
  return fixtures;
}

function memoryStore() {
  const rows = new Map(), blobs = new Map();
  return {
    blobs,
    read: async (key, fallback) => structuredClone(rows.get(key) ?? fallback),
    mutate: async (key, fallback, fn) => {
      const row = structuredClone(rows.get(key) ?? fallback), result = await fn(row);
      rows.set(key, structuredClone(row));
      return result;
    },
    putBlob: async (key, bytes) => { blobs.set(key, Buffer.from(bytes)); },
    blob: async key => Buffer.from(blobs.get(key)),
  };
}

async function runRoute(fixture, mode) {
  // A new store per route is essential: production deduplicates by owner/hash,
  // so sequential real-library uploads would reuse the first result.
  const store = memoryStore();
  let mockRecognitionPages = 0, extracted = null, mockSubmissions = 0;
  const provider = {
    async submit(bytes) {
      const pages = (await PDFDocument.load(bytes)).getPageCount();
      mockRecognitionPages += pages; mockSubmissions++;
      return {jobId: 'mock-' + mockSubmissions, count: pages};
    },
    async status() { return {state: 'done'}; },
    async result(handle) {
      return {pages: Array.from({length: handle.count}, () => ({
        prunedResult: {width: 600, height: 800, parsing_res_list: [{
          block_label: 'text', block_bbox: [40, 40, 560, 100],
          block_content: 'MOCK OUTPUT ONLY. No OCR was performed.',
        }]},
      }))};
    },
  };
  const ingestion = createBookIngestion({store, provider, batchPages: 1, library: {
    async importExtracted(_user, input) {
      extracted = input.extracted;
      return {bookId: 'captured-offline-result'};
    },
  }});
  const start = performance.now();
  let job = await ingestion.prepare(user, {filename: fixture.id + '.pdf', bytes: fixture.bytes, mode, consent: mode === 'ocr'});
  for (let step = 0; step < 20 && job.state !== 'done'; step++) {
    job = job.state === 'awaiting_consent'
      ? await ingestion.consent(user, job.id, {confirm: true, sourceHash: job.sourceHash})
      : await ingestion.advance(user, job.id);
  }
  if (job.state !== 'done' || !extracted) throw Error('Offline routing experiment did not finish');
  const original = [...store.blobs.entries()].find(([key]) => key.endsWith('/source'))?.[1];
  return {
    mode, state: job.state, sourceHash: job.sourceHash,
    localOrchestrationMs: Number((performance.now() - start).toFixed(3)),
    mockRecognitionPages, mockSubmissions,
    rawMockResults: [...store.blobs.keys()].filter(key => /\/raw-/.test(key)).length,
    sourceBytesVerified: !!original && original.equals(fixture.bytes),
    pageCoverageComplete: extracted.pages.length === job.totalPages && extracted.pages.every((p, i) => p.page === i + 1),
    review: extracted.review,
    quality: null,
  };
}

export async function evaluatePdfRoutes() {
  const fixtures = await createFixtures(), samples = [];
  for (const fixture of fixtures) {
    const inspected = await inspectNativePdf(fixture.bytes);
    const nativeObservedMarkers = inspected.pages.flatMap(p => p.text.match(/\b(?:L1|L2|R1|R2|F1)\b/g) || []);
    samples.push({
      id: fixture.id, sha256: digest(fixture.bytes), bytes: fixture.bytes.length,
      totalPages: inspected.pages.length,
      rights: {kind: 'synthetic', license: 'CC0-1.0', source: 'generated-by-this-tool', privateInputs: false},
      nativeNeedsRecognition: inspected.pages.some(p => p.needsRecognition),
      nativeObservedText: inspected.pages.map(p => p.text),
      expectedReadingMarkers: fixture.expectedReadingMarkers,
      nativeObservedMarkers,
      nativeOrderMatchesReference: fixture.expectedReadingMarkers.length
        ? JSON.stringify(nativeObservedMarkers) === JSON.stringify(fixture.expectedReadingMarkers) : null,
      runs: [await runRoute(fixture, 'auto'), await runRoute(fixture, 'ocr')],
    });
  }
  return {fixtures, report: {
    schemaVersion: 1, evidenceKind: 'offline-routing-with-mock-provider',
    generatedAt: new Date().toISOString(),
    environment: {node: process.version, platform: process.platform, arch: process.arch},
    realAbStatus: 'blocked-quota-and-cost-unverified',
    realOcrPages: 0, liveLibraryWrites: 0,
    qualityMetrics: null, providerElapsedMs: null, accountQuota: null, providerBilling: null,
    limitations: [
      'Only native PDF extraction and local routing are measured.',
      'Mock output is not OCR quality evidence. Local duration is not provider latency.',
      'No private source, provider credentials, network request, or live library is used.',
      'Synthetic English pages do not establish real-book or Chinese OCR quality.',
    ],
    samples,
  }};
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.length !== 4 || process.argv[2] !== '--out') {
    throw Error('Usage: node tools/evaluate-pdf-routes.mjs --out <new-output-directory>');
  }
  const {fixtures, report} = await evaluatePdfRoutes();
  const destination = path.resolve(process.argv[3]);
  // Refuse existing directories; never overwrite an earlier experiment.
  await mkdir(destination);
  for (const fixture of fixtures) await writeFile(path.join(destination, fixture.id + '.pdf'), fixture.bytes, {flag: 'wx'});
  await writeFile(path.join(destination, 'report.json'), JSON.stringify(report, null, 2) + '\n', {flag: 'wx'});
  console.log('Offline routing evidence saved; real OCR A/B remains blocked.');
}
