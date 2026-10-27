// Live GET-209 A/B experiment: production ingestion orchestration with the
// REAL PaddleOCR official provider, on synthetic Chinese samples (CC0-1.0,
// composed in this file). Counterpart of tools/evaluate-pdf-routes.mjs, which
// deliberately stays offline/mock-only.
//
// Safety contract (from docs/pdf-paddleocr-evaluation.md, real A/B rules):
// - Two phases. `--generate` builds samples, freezes human references and a
//   hashed intent (sources + code/config + page budget) into a NEW --out dir.
//   `--run` durably claims it before token access/provider probes, then reserves
//   each sample x mode before submit. Existing/partial/unknown runs never replay.
// - Each sample x mode is submitted at most once. Total recognized pages are
//   capped at 12 by construction (3 samples x 2 pages x 2 modes worst case).
// - The access token is read from the repo .env (or process env) and is never
//   printed, logged, or written to the evidence directory.
// - Requires GET209_LIVE_CONFIRM=1 for both phases.
import {mkdir, writeFile, readFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {PDFDocument} from 'pdf-lib';
import {createCanvas} from '@napi-rs/canvas';
import {inspectNativePdf} from '../server/pdf-native.mjs';
import {createBookIngestion} from '../server/book-ingestion.mjs';
import {createPaddleProvider} from '../server/paddleocr.mjs';
import {digest} from '../server/document-import.mjs';
import {createLiveIntent, assertFreshLiveRun, claimLiveRun, writeExclusiveEvidence} from './pdf-live-guard.mjs';

const fontkit = createRequire(import.meta.url)('fontkit');
const fixedDate = new Date('2026-10-27T00:00:00Z');
const user = Object.freeze({id: 'synthetic-get209-live-ab'});
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const stripWs = s => s.replace(/\s+/g, '');

// ---------------------------------------------------------------- samples
// Reference blocks are authored here, before any provider output exists.
// kind: heading | body | line | footnote. footnote blocks carry belongsTo.
const SAMPLES = [
  {
    id: 'zh-single', kind: 'text', layout: 'single-column',
    pages: [
      [
        {id: 'H1', kind: 'heading', text: '第一章 清晨的图书馆'},
        {id: 'P1', kind: 'body', text: '清晨六点，图书馆的木门准时打开。守馆人林伯把昨夜归还的书一本本放回书架，动作又轻又慢，生怕惊动了满室的安静。'},
        {id: 'P2', kind: 'body', text: '靠窗的位置最先有人坐下。读语言学的姑娘摊开笔记，先把昨天没有读完的章节读完，才去碰那杯已经凉了的茶。'},
        {id: 'P3', kind: 'body', text: '这里的规矩不多：书可以借走，座位不能久占；可以小声讨论，不能高声喧哗。几十年下来，人人都自觉遵守。'},
        {id: 'P4', kind: 'body', text: '林伯常说，图书馆最要紧的不是藏书多少，而是每天有人来，把书翻开。书只有被人读，才算真正活着。'},
      ],
      [
        {id: 'P5', kind: 'body', text: '午后下起小雨，屋檐的水线连成一片。几个孩子躲在门廊下背课文，声音压得低低的，像是怕被雨听见。'},
        {id: 'P6', kind: 'body', text: '雨停的时候，夕阳把湿漉漉的石板路照得发亮。林伯锁好大门，把钥匙放回口袋，沿着河边慢慢走回家。'},
        {id: 'P7', kind: 'body', text: '他想起年轻时第一次走进这间图书馆的情形：也是这样的雨天，也是这样的安静，连翻页的声音都清清楚楚。'},
        {id: 'P8', kind: 'body', text: '明天还会有人来。书还在架上等着，茶还会有人泡好又忘记喝。这就是这间小图书馆普通的一天。'},
      ],
    ],
  },
  {
    id: 'zh-scan', kind: 'scan', layout: 'raster-only',
    pages: [
      [
        {id: 'S1', kind: 'line', text: '扫描样本第一页。这一页没有文字层，只有纸张的影像。'},
        {id: 'S2', kind: 'line', text: '老陈把借书证放在柜台上，说这本书他年轻时读过三遍。'},
        {id: 'S3', kind: 'line', text: '纸页已经发黄，边角微微卷起，可是字迹依然清楚可辨。'},
      ],
      [
        {id: 'S4', kind: 'line', text: '扫描样本第二页。雨水顺着窗玻璃往下淌，像没写完的字。'},
        {id: 'S5', kind: 'line', text: '管理员把登记簿推过来，让他在最后一栏签上名字和日期。'},
        {id: 'S6', kind: 'line', text: '他写得很慢，一笔一画，像是在完成一件郑重的事情。'},
      ],
    ],
  },
  {
    id: 'zh-columns-footnote', kind: 'text', layout: 'two-columns-footnote',
    pages: [
      [
        {id: 'L1', kind: 'line', text: '左栏一：河流从山间来，先经过松林，再经过村庄。'},
        {id: 'L2', kind: 'line', text: '左栏二：村民在河边洗衣，也在河边交换一天的新闻。'},
        {id: 'L3', kind: 'line', text: '左栏三：桥是去年新修的，桥头刻着捐资人的名字。①'},
        {id: 'L4', kind: 'line', text: '左栏四：孩子们放学后爱在桥上看船，直到天色变暗。'},
        {id: 'R1', kind: 'line', text: '右栏一：镇上的集市逢三逢八，卖菜的摊位排到巷口。'},
        {id: 'R2', kind: 'line', text: '右栏二：老中医的铺子在集市尽头，门口挂着晒干的草药。'},
        {id: 'R3', kind: 'line', text: '右栏三：逢集的日子，铺子里总有人排队，号脉免费。'},
        {id: 'R4', kind: 'line', text: '右栏四：散集之后，街道恢复安静，只剩下落叶和尘土。'},
        {id: 'F1', kind: 'footnote', belongsTo: 'L3', text: '① 注：桥头碑文记为旧桥重修，与正文所说去年新修，指同一座桥的两次修缮。'},
      ],
      [
        {id: 'L1', kind: 'line', text: '左栏一：茶园在山坡上，一层一层，像绿色的台阶。'},
        {id: 'L2', kind: 'line', text: '左栏二：采茶人天不亮就上山，竹篓里先装满了露水。①'},
        {id: 'L3', kind: 'line', text: '左栏三：新茶要在清明前采完，迟了，香气就淡了。'},
        {id: 'L4', kind: 'line', text: '左栏四：炒茶的手艺传了四代，铁锅的温度全凭手感。'},
        {id: 'R1', kind: 'line', text: '右栏一：山脚下有个小邮局，负责十里八村的信件。'},
        {id: 'R2', kind: 'line', text: '右栏二：邮递员老周骑车三十年，闭着眼也认得每条路。'},
        {id: 'R3', kind: 'line', text: '右栏三：谁家孩子考上大学，报喜的信总是他先送到。'},
        {id: 'R4', kind: 'line', text: '右栏四：如今写信的人少了，邮包却比从前多了三倍。'},
        {id: 'F1', kind: 'footnote', belongsTo: 'L2', text: '① 注：采茶人所说的露水，指清晨凝在芽尖的水珠；炒茶前需阴干，不可暴晒。'},
      ],
    ],
  },
];
const expectedOrder = page => page.map(b => b.id);
const referenceText = page => page.map(b => b.text).join('\n\n');

export function sampleCharset() {
  const chars = new Set([' ']);
  for (const s of SAMPLES) for (const p of s.pages) for (const b of p) for (const ch of b.text) chars.add(ch);
  return [...chars].join('');
}

// ---------------------------------------------------------------- drawing
export function wrapLines(text, font, size, maxWidth) {
  const lines = [];
  let line = '';
  for (const ch of text) {
    if (font.widthOfTextAtSize(ch, size) > maxWidth) throw Error('Glyph exceeds sample text width');
    const candidate = line + ch;
    if (line && font.widthOfTextAtSize(candidate, size) > maxWidth) { lines.push(line); line = ch; }
    else line = candidate;
  }
  if (line) lines.push(line);
  return lines;
}

// Return the actual drawing commands so tests can measure the same geometry
// used for the PDF. Reading reference order remains left column, then right.
export function layoutTextPage(blocks, layout, font) {
  const draws = [];
  const draw = (text, x, y, size) => {
    const width = font.widthOfTextAtSize(text, size);
    if (x < 40 || x + width > 560.001 || y < 30 || y + size > 770) throw Error('Sample text outside visible bounds');
    draws.push({text, x, y, size, width});
  };
  if (layout === 'single-column') {
    let y = 736;
    for (const block of blocks) {
      const size = block.kind === 'heading' ? 16 : 12.5;
      for (const line of wrapLines(block.text, font, size, 512)) {
        draw(line, 44, y, size); y -= size * 1.85;
      }
      y -= 10;
    }
  } else if (layout === 'two-columns-footnote') {
    const left = blocks.filter(b => b.id.startsWith('L')), right = blocks.filter(b => b.id.startsWith('R'));
    const foot = blocks.find(b => b.kind === 'footnote');
    if (left.length !== 4 || right.length !== 4 || !foot) throw Error('Incomplete two-column reference');
    let y = 730;
    for (let i = 0; i < 4; i++) {
      const l = wrapLines(left[i].text, font, 11.5, 238), r = wrapLines(right[i].text, font, 11.5, 238);
      // Keep row-wise PDF insertion deliberately different from reading order.
      l.forEach((text, n) => draw(text, 40, y - n * 19.55, 11.5));
      r.forEach((text, n) => draw(text, 322, y - n * 19.55, 11.5));
      y -= Math.max(l.length, r.length) * 19.55 + 14;
    }
    if (y < 130) throw Error('Columns overlap the footnote area');
    let footY = 84;
    for (const line of wrapLines(foot.text, font, 9, 512)) {
      draw(line, 44, footY, 9); footY -= 14.4;
    }
  } else throw Error('Unsupported synthetic text layout');
  return draws;
}

async function buildTextSample(sample, fontBytes) {
  const doc = await PDFDocument.create();
  doc.setCreationDate(fixedDate); doc.setModificationDate(fixedDate);
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(fontBytes, {subset: false});
  for (const blocks of sample.pages) {
    const page = doc.addPage([600, 800]);
    for (const {text, width: _width, ...position} of layoutTextPage(blocks, sample.layout, font)) page.drawText(text, {font, ...position});
  }
  return Buffer.from(await doc.save());
}

async function buildScanSample(sample) {
  const doc = await PDFDocument.create();
  doc.setCreationDate(fixedDate); doc.setModificationDate(fixedDate);
  const proofs = [];
  for (const blocks of sample.pages) {
    const canvas = createCanvas(1240, 1654), ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 1240, 1654);
    ctx.fillStyle = 'black'; ctx.font = '36px "PingFang SC", "Heiti SC", "STHeiti", sans-serif';
    let y = 150;
    for (const block of blocks) {
      const font = {widthOfTextAtSize: text => ctx.measureText(text).width};
      for (const line of wrapLines(block.text, font, 36, 1096)) { ctx.fillText(line, 72, y); y += 54; }
      y += 38;
    }
    if (y > 1582) throw Error('Scan sample text exceeds visible height');
    const png = canvas.toBuffer('image/png');
    proofs.push(png);
    const image = await doc.embedPng(png);
    const page = doc.addPage([600, 800]);
    page.drawImage(image, {x: 0, y: 0, width: 600, height: 800});
  }
  return {bytes: Buffer.from(await doc.save()), proofs};
}

async function buildSamples(fontBytes) {
  const built = [];
  for (const sample of SAMPLES) {
    if (sample.kind === 'scan') {
      const {bytes, proofs} = await buildScanSample(sample);
      built.push({sample, bytes, proofs});
    } else {
      built.push({sample, bytes: await buildTextSample(sample, fontBytes), proofs: []});
    }
  }
  return built;
}

// ---------------------------------------------------------------- metrics
function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({length: b.length + 1}, (_, i) => i), curr = new Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

export function pageMetrics(refBlocks, hypText) {
  const refText = referenceText(refBlocks);
  const hypStripped = stripWs(hypText ?? '');
  const found = [], missing = [], duplicates = [];
  for (const block of refBlocks) {
    const needle = stripWs(block.text);
    const first = hypStripped.indexOf(needle);
    if (first < 0) { missing.push(block.id); continue; }
    found.push({id: block.id, at: first});
    if (hypStripped.indexOf(needle, first + 1) >= 0) duplicates.push(block.id);
  }
  const expected = expectedOrder(refBlocks);
  const byPosition = [...found].sort((a, b) => a.at - b.at).map(f => f.id);
  let inversions = 0;
  for (let i = 0; i < byPosition.length; i++) for (let j = i + 1; j < byPosition.length; j++) {
    if (expected.indexOf(byPosition[i]) > expected.indexOf(byPosition[j])) inversions++;
  }
  const footBlock = refBlocks.find(b => b.kind === 'footnote');
  let footnote = null;
  if (footBlock) {
    const rank = byPosition.indexOf(footBlock.id);
    footnote = {
      block: footBlock.id, expectedBelongsTo: footBlock.belongsTo, semanticOwnershipVerified: false, found: rank >= 0,
      isLastInReadingOrder: rank >= 0 && rank === byPosition.length - 1,
      ownerRank: byPosition.indexOf(footBlock.belongsTo), footnoteRank: rank,
    };
  }
  const cer = (hyp, ref) => ref.length ? Number((levenshtein(hyp, ref) / ref.length).toFixed(4)) : null;
  return {
    refCharsRaw: refText.length, cerRaw: cer(hypText ?? '', refText),
    refCharsStripped: stripWs(refText).length, cerStripped: cer(hypStripped, stripWs(refText)),
    foundBlocks: byPosition, missingBlocks: missing, duplicateBlocks: duplicates,
    orderInversions: inversions, footnote,
  };
}

// ---------------------------------------------------------------- routing
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

export function instrumentedProvider(real, {claim, sampleId, mode}) {
  const stats = {attemptedSubmissions: 0, attemptedPages: 0, unknownOutcomePages: 0,
    submissions: 0, submittedPages: 0, submitMs: 0, resultMs: 0, statusPolls: 0, handleDigests: []};
  const provider = {
    stats,
    async submit(bytes, opts) {
      const pages = (await PDFDocument.load(bytes)).getPageCount();
      if (opts?.fileUrl) throw Error('Synthetic A/B cannot submit an external file URL');
      const reservation = await claim.reserve({sampleId, mode, requestId: opts?.batchId, pages, batchSha256: digest(bytes)});
      stats.attemptedSubmissions++; stats.attemptedPages += pages; stats.unknownOutcomePages += pages;
      const t = performance.now();
      let handle;
      try { handle = await real.submit(bytes, opts); await claim.acknowledge(reservation, handle); }
      finally { stats.submitMs += performance.now() - t; }
      stats.unknownOutcomePages -= pages;
      stats.submissions++; stats.submittedPages += pages;
      stats.handleDigests.push(sha256(String(handle?.jobId ?? '')).slice(0, 16));
      return handle;
    },
    async status(handle) { stats.statusPolls++; return real.status(handle); },
    async result(handle) {
      const t = performance.now();
      const r = await real.result(handle);
      stats.resultMs += performance.now() - t;
      return r;
    },
  };
  if (real.recover) provider.recover = batchId => {
    if (stats.unknownOutcomePages) throw Error('Unknown submission retained; reconcile original request separately, never replay');
    return real.recover(batchId);
  };
  return provider;
}

async function runRoute(fixture, mode, provider) {
  const store = memoryStore();
  let extracted = null;
  const ingestion = createBookIngestion({store, provider, batchPages: 2, library: {
    async importExtracted(_user, input) { extracted = input.extracted; return {bookId: 'captured-live-ab'}; },
  }});
  const start = performance.now();
  let job = await ingestion.prepare(user, {filename: fixture.sample.id + '.pdf', bytes: fixture.bytes, mode, consent: mode === 'ocr'});
  let resumes = 0, lastError = null;
  for (let step = 0; step < 60 && job.state !== 'done'; step++) {
    try {
      job = job.state === 'awaiting_consent'
        ? await ingestion.consent(user, job.id, {confirm: true, sourceHash: job.sourceHash})
        : await ingestion.advance(user, job.id);
    } catch (error) {
      const status = error?.status ?? error?.statusCode;
      lastError = {name: /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(error?.name ?? '') ? error.name : 'Error',
        status: Number.isInteger(status) ? status : null};
      const view = await ingestion.view(user, job.id).catch(() => null);
      if (view?.state === 'needs_review' && resumes < 2) { resumes++; job = await ingestion.resume(user, job.id); continue; }
      job = view ?? job;
      break;
    }
  }
  const totalMs = Number((performance.now() - start).toFixed(1));
  const rawDigests = [...store.blobs.entries()].filter(([k]) => /\/raw-/.test(k))
    .map(([k, v]) => ({key: k.split('/').pop(), sha256: digest(v), bytes: v.length}));
  const original = [...store.blobs.entries()].find(([k]) => k.endsWith('/source'))?.[1];
  // Preserve text/geometry needed for offline inspection, excluding transport
  // metadata and result/download URLs. This is a projection, not the raw blob.
  const rawContentProjection = [...store.blobs.entries()].filter(([k]) => /\/raw-/.test(k)).map(([k, v]) => ({
    key: k.split('/').pop(), rawSha256: digest(v), pages: JSON.parse(v).pages.map(p => ({
      width: p.prunedResult?.width, height: p.prunedResult?.height,
      blocks: p.prunedResult?.parsing_res_list?.map(b => ({text: b.block_content, label: b.block_label,
        bbox: b.block_bbox, order: b.block_order})),
    })),
  }));
  return {
    mode, state: job.state, error: lastError, resumes,
    totalMs, recognitionPages: job.recognitionPages ?? null,
    providerStats: provider.stats,
    rawResultDigests: rawDigests,
    rawContentProjection,
    sourceBytesVerified: !!original && original.equals(fixture.bytes),
    extractedPages: extracted ? extracted.pages.map(p => ({page: p.page, text: p.text, blank: !!p.blank})) : null,
    pageCoverageComplete: !!extracted && extracted.pages.length === fixture.sample.pages.length
      && extracted.pages.every((p, i) => p.page === i + 1),
  };
}

// ---------------------------------------------------------------- phases
function loadToken() {
  if (process.env.PADDLEOCR_ACCESS_TOKEN) return process.env.PADDLEOCR_ACCESS_TOKEN;
  try {
    const txt = readFileSync(path.join(process.cwd(), '.env'), 'utf8');
    const m = txt.match(/^PADDLEOCR_ACCESS_TOKEN=(.+)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  } catch {}
  return null;
}

async function generate(outDir, fontPath) {
  const fontBytes = readFileSync(fontPath);
  const built = await buildSamples(fontBytes);
  await mkdir(outDir, {mode: 0o700});
  for (const fixture of built) {
    await writeFile(path.join(outDir, fixture.sample.id + '.pdf'), fixture.bytes, {flag: 'wx', mode: 0o600});
    for (let i = 0; i < fixture.proofs.length; i++) {
      await writeFile(path.join(outDir, `${fixture.sample.id}-page${i + 1}.png`), fixture.proofs[i], {flag: 'wx', mode: 0o600});
    }
  }
  const intent = await createLiveIntent(built);
  await writeExclusiveEvidence(path.join(outDir, 'intent.json'), intent);
  console.log('Synthetic samples + frozen intent saved to', outDir, '| worst-case pages:', intent.worstCaseRecognizedPages);
}

// Explicit dependency boundaries allow offline integration tests to execute the
// real run/claim/ledger without loading tokens, submitting OCR, or writing a library.
export async function run(outDir, fontPath, {
  build = buildSamples, readToken = loadToken, makeProvider = createPaddleProvider,
  inspect = inspectNativePdf, route = runRoute,
} = {}) {
  await assertFreshLiveRun(outDir);
  const intentText = await readFile(path.join(outDir, 'intent.json'), 'utf8');
  const built = await build(readFileSync(fontPath));
  const claim = await claimLiveRun(outDir, {intentText, built});
  const token = readToken();
  if (!token) throw Error('PADDLEOCR_ACCESS_TOKEN not configured; claim retained, do not replay.');
  const providerEnv = {...process.env, PADDLEOCR_ACCESS_TOKEN: token};
  await writeExclusiveEvidence(path.join(outDir, 'probe-started.json'), {runId: claim.runId, startedAt: new Date().toISOString()});
  const probeProvider = makeProvider({env: providerEnv});
  let tokenProbe;
  try {
    const recovered = await probeProvider.recover('get209-probe-nonexistent-batch');
    tokenProbe = {ok: recovered === null, detail: recovered === null ? 'batch lookup answered; token accepted, quota/cost not verified' : 'unexpected handle returned'};
  } catch {
    tokenProbe = {ok: false, detail: 'batch lookup failed; no error payload retained'};
  }
  await writeExclusiveEvidence(path.join(outDir, 'probe-result.json'), {runId: claim.runId, tokenProbe});
  const samples = [];
  let status = tokenProbe.ok ? 'executed' : 'blocked-token-probe-failed';
  if (tokenProbe.ok) {
    routes: for (const fixture of built) {
      const inspected = await inspect(fixture.bytes);
      const runs = [];
      samples.push({id: fixture.sample.id, layout: fixture.sample.layout,
        nativeInspection: inspected.pages.map(p => ({page: p.page, needsRecognition: p.needsRecognition, chars: p.text.length})), runs});
      for (const mode of ['auto', 'ocr']) {
        const provider = instrumentedProvider(makeProvider({env: providerEnv}), {claim, sampleId: fixture.sample.id, mode});
        const result = await route(fixture, mode, provider);
        const metrics = result.extractedPages
          ? result.extractedPages.map((p, i) => ({page: p.page, ...pageMetrics(fixture.sample.pages[i], p.text)})) : null;
        const saved = {...result, metrics,
          normalizedDigest: result.extractedPages ? digest(JSON.stringify(result.extractedPages.map(p => p.text))) : null};
        // Save the complete synthetic hypothesis after each route, not only at
        // final report creation; a later crash must not discard earlier text.
        await writeExclusiveEvidence(path.join(outDir, `route-${fixture.sample.id}-${mode}.json`), saved);
        runs.push(saved);
        if (claim.summary().unknownOutcomePages) { status = 'blocked-unknown-submission'; break routes; }
        if (result.state !== 'done') { status = 'incomplete'; break routes; }
      }
    }
  }
  const totals = claim.summary();
  const report = {
    schemaVersion: 2, evidenceKind: 'live-ab-real-provider', generatedAt: new Date().toISOString(),
    status, runId: claim.runId, intentSha256: claim.intentSha256, tokenProbe,
    environment: {node: process.version, platform: process.platform, arch: process.arch},
    totals: {...totals, recognizedPages: status === 'executed' ? totals.acknowledgedPages : null,
      billingVerified: false, actualCost: null}, samples,
  };
  await writeExclusiveEvidence(path.join(outDir, 'report.json'), report);
  console.log('A/B evidence saved:', status, '| reserved pages:', totals.reservedPages, '| unknown outcome pages:', totals.unknownOutcomePages);
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.env.GET209_LIVE_CONFIRM !== '1') throw Error('Set GET209_LIVE_CONFIRM=1 to acknowledge the live A/B guard.');
  const [phase, outDir, fontPath] = [process.argv[2], process.argv[3], process.argv[4]];
  if (!outDir || !fontPath || !['--generate', '--run'].includes(phase)) {
    throw Error('Usage: GET209_LIVE_CONFIRM=1 node tools/evaluate-pdf-routes-live.mjs --generate|--run <out-dir> <subset-font.ttf>');
  }
  if (phase === '--generate') await generate(path.resolve(outDir), path.resolve(fontPath));
  else await run(path.resolve(outDir), path.resolve(fontPath));
}
