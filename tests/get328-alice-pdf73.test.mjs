import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { PDFDocument, PDFName, decodePDFRawStream } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
  generateAlicePDF73,
  verifyAlicePDF73,
} from '../tools/generate-get328-alice-pdf73.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(root, 'catalog/alice.txt');
const filename = 'Alice-complete-GET328-20261107.pdf';
const manifestFilename = 'Alice-complete-GET328-20261107.manifest.json';
const expectedSourceSHA = '01b38ea4c710a84bc18d0bd41271a5a1a92b94e97b2812f4dece97d4a694725e';
const expectedCanonicalSHA = 'fab10098897c657bbd45a4c647c01c5819068270613c8574800aaf08508419aa';
const normalize = text => text.replace(/\s+/g, ' ').trim();
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

async function independentSource() {
  const bytes = await readFile(sourcePath);
  assert.equal(sha256(bytes), expectedSourceSHA);
  const text = bytes.toString('utf8').replace(/\r\n/g, '\n');
  const start = text.indexOf('\nCHAPTER I.\nDown the Rabbit-Hole\n');
  const end = text.indexOf('\n*** END OF THE PROJECT GUTENBERG EBOOK');
  assert.ok(start > 0 && end > start);
  const narrative = text.slice(start + 1, end).trim();
  const canonical = normalize(narrative);
  assert.equal(sha256(canonical), expectedCanonicalSHA);
  assert.equal(canonical.split(' ').length, 26441);
  assert.equal(narrative.split(/\n\s*\n/).filter(p => p.trim()).length, 811);
  return { bytes, narrative, canonical };
}

async function independentPages(bytes) {
  const loadingTask = getDocument({
    data: Uint8Array.from(bytes),
    useSystemFonts: true,
    disableFontFace: true,
    useWorkerFetch: false,
    isEvalSupported: false,
  });
  const doc = await loadingTask.promise;
  try {
    const pages = [];
    for (let n = 1; n <= doc.numPages; n += 1) {
      const page = await doc.getPage(n);
      const { items } = await page.getTextContent({ disableNormalization: true });
      const body = items.filter(item => typeof item.str === 'string'
        && item.transform[5] > 65 && item.transform[5] < 595);
      pages.push({
        body: normalize(body.map(item => item.str).join(' ')),
        items: body,
        allText: items.map(item => item.str || '').join(' '),
      });
      page.cleanup();
    }
    return pages;
  } finally {
    await loadingTask.destroy();
  }
}

test('new 73-page Alice PDF reconstructs every narrative word in order, including its actual ending', async t => {
  const artifactDir = await mkdtemp(path.join(tmpdir(), 'get328-pdf73-test-'));
  t.after(() => rm(artifactDir, { recursive: true, force: true }));
  const { bytes: sourceBytes, narrative, canonical } = await independentSource();
  const generated = await generateAlicePDF73({ artifactDir });
  assert.equal(generated.pdfPath, path.join(await realpath(artifactDir), filename));
  const pdfBytes = await readFile(generated.pdfPath);
  const pages = await independentPages(pdfBytes);
  assert.equal(pages.length, 73);
  assert.equal(normalize(pages.map(page => page.body).join(' ')), canonical);
  assert.equal(sha256(normalize(pages.map(page => page.body).join(' '))), expectedCanonicalSHA);

  const manifest = JSON.parse(await readFile(path.join(artifactDir, manifestFilename), 'utf8'));
  assert.equal(manifest.provenance.identity, 'NEW source / NEW hash');
  assert.equal(manifest.provenance.reproducesHistoricalOriginal, false);
  assert.equal(manifest.source.path, 'catalog/alice.txt');
  assert.equal(manifest.source.sha256, expectedSourceSHA);
  assert.equal(manifest.pdf.sha256, sha256(pdfBytes));
  assert.equal(manifest.pdf.pageCount, 73);
  assert.equal(manifest.coverage.expectedWords, 26441);
  assert.equal(manifest.coverage.parsedWords, 26441);
  assert.equal(manifest.coverage.expectedParagraphs, 811);
  assert.equal(manifest.coverage.complete, true);
  assert.equal(manifest.coverage.parsedCanonicalSHA256, expectedCanonicalSHA);
  assert.equal(manifest.coverage.paragraphOrderPreserved, true);
  assert.equal(manifest.coverage.paragraphGeometryVerified, true);
  assert.equal(manifest.pages.length, 73);

  let cursor = 0;
  for (const [i, receipt] of manifest.pages.entries()) {
    const words = pages[i].body.split(' ');
    assert.ok(words.length >= 250, `page ${i + 1} must have substantive narrative, got ${words.length} words`);
    assert.ok(pages[i].items.length >= 20, `page ${i + 1} must have real typeset lines`);
    assert.equal(receipt.page, i + 1);
    assert.equal(receipt.wordStart, cursor);
    assert.equal(receipt.wordEndExclusive, cursor + words.length);
    assert.equal(receipt.canonicalSHA256, sha256(pages[i].body));
    assert.ok(pages[i].body.includes(receipt.uniqueNarrativeWitness));
    assert.equal(canonical.split(receipt.uniqueNarrativeWitness).length - 1, 1);
    assert.ok(pages[i].allText.includes(receipt.pageWitness));
    assert.ok(pages[i].allText.includes(`GET328_PUBLIC_ALICE_PAGE_${i + 1}_OF_73`));
    assert.equal(receipt.lastNarrativeText, words.slice(-16).join(' '));
    for (const item of pages[i].items) {
      assert.ok(item.transform[4] >= 44 && item.transform[4] + item.width <= 389,
        `page ${i + 1}: line is inside horizontal paper margins`);
      assert.ok(item.transform[5] >= 72 && item.transform[5] <= 588,
        `page ${i + 1}: line is inside vertical paper margins`);
    }
    cursor += words.length;
  }
  assert.equal(cursor, 26441);
  assert.equal(new Set(manifest.pages.map(p => p.pageWitness)).size, 73);
  assert.match(pages[72].body, /remembering her own child-life, and the happy summer days\. THE END$/);
  assert.equal(manifest.page73.lastNarrativeText, manifest.pages[72].lastNarrativeText);
  assert.equal(manifest.page73.endingParagraph, normalize(narrative.split(/\n\s*\n/).filter(p => p.trim()).at(-2)));
  assert.equal(manifest.page73.endingMarker, 'THE END');
  await verifyAlicePDF73({ sourceBytes, pdfBytes });

  // No wall-clock metadata or random trailer identity is allowed in fixture bytes.
  const document = await PDFDocument.load(pdfBytes, { updateMetadata: false });
  assert.equal(document.getCreationDate(), undefined);
  assert.equal(document.getModificationDate(), undefined);
  assert.equal(document.context.trailerInfo.ID, undefined);
  const before = await readFile(generated.manifestPath);
  const repeated = await generateAlicePDF73({ artifactDir });
  assert.deepEqual(await readFile(repeated.pdfPath), pdfBytes);
  assert.deepEqual(await readFile(repeated.manifestPath), before);
});

test('PDF validation rejects real truncated, blank, reordered and duplicated-page bytes', async t => {
  const artifactDir = await mkdtemp(path.join(tmpdir(), 'get328-pdf73-corrupt-'));
  t.after(() => rm(artifactDir, { recursive: true, force: true }));
  const { bytes: sourceBytes } = await independentSource();
  const generated = await generateAlicePDF73({ artifactDir });
  const bytes = await readFile(generated.pdfPath);

  const truncated = await PDFDocument.load(bytes, { updateMetadata: false });
  truncated.removePage(72);
  await assert.rejects(verifyAlicePDF73({ sourceBytes, pdfBytes: await truncated.save() }), /73 pages/);

  // Preserve all 73 pages, markers and line positions, but remove the last word
  // from the real page-73 text stream. Page-count-only checks cannot catch this.
  const missingEnding = await PDFDocument.load(bytes, { updateMetadata: false });
  const lastPage = missingEnding.getPage(72);
  const stream = missingEnding.context.lookup(lastPage.node.Contents().get(0));
  const decoded = Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1');
  assert.ok(decoded.includes('<54484520454E44> Tj')); // THE END
  lastPage.node.set(PDFName.of('Contents'), missingEnding.context.flateStream(decoded.replace('<54484520454E44> Tj', '<544845> Tj')));
  const missingEndingBytes = await missingEnding.save();
  const missingEndingPages = await independentPages(missingEndingBytes);
  assert.equal(missingEndingPages.length, 73);
  assert.ok(missingEndingPages[72].allText.includes('GET328_PUBLIC_ALICE_PAGE_73_OF_73'));
  assert.match(missingEndingPages[72].body, /happy summer days\. THE$/);
  await assert.rejects(verifyAlicePDF73({ sourceBytes, pdfBytes: missingEndingBytes }), /(coverage|ending)/i);

  const blank = await PDFDocument.load(bytes, { updateMetadata: false });
  blank.removePage(38);
  blank.insertPage(38, [432, 648]);
  await assert.rejects(verifyAlicePDF73({ sourceBytes, pdfBytes: await blank.save() }), /page 39.*(blank|substantive)/i);

  const reordered = await PDFDocument.create({ updateMetadata: false });
  const order = Array.from({ length: 73 }, (_, i) => i);
  [order[30], order[31]] = [order[31], order[30]];
  for (const page of await reordered.copyPages(await PDFDocument.load(bytes), order)) reordered.addPage(page);
  await assert.rejects(verifyAlicePDF73({ sourceBytes, pdfBytes: await reordered.save() }), /(order|coverage|witness)/i);

  const duplicate = await PDFDocument.create({ updateMetadata: false });
  const repeatedOrder = Array.from({ length: 73 }, (_, i) => i === 72 ? 71 : i);
  for (const page of await duplicate.copyPages(await PDFDocument.load(bytes), repeatedOrder)) duplicate.addPage(page);
  await assert.rejects(verifyAlicePDF73({ sourceBytes, pdfBytes: await duplicate.save() }), /(order|coverage|witness|ending)/i);
});

test('generator requires an explicit directory and preserves preexisting different artifacts and changed sources', async t => {
  const artifactDir = await mkdtemp(path.join(tmpdir(), 'get328-pdf73-no-clobber-'));
  t.after(() => rm(artifactDir, { recursive: true, force: true }));
  await assert.rejects(generateAlicePDF73({}), /artifact directory/i);
  const sentinel = Buffer.from('DO NOT OVERWRITE EXISTING EVIDENCE');
  await writeFile(path.join(artifactDir, filename), sentinel);
  await assert.rejects(generateAlicePDF73({ artifactDir }), /preexisting.*differs/i);
  assert.deepEqual(await readFile(path.join(artifactDir, filename)), sentinel);

  const manifestConflict = path.join(artifactDir, 'manifest-conflict');
  await mkdir(manifestConflict);
  await writeFile(path.join(manifestConflict, manifestFilename), sentinel);
  await assert.rejects(generateAlicePDF73({ artifactDir: manifestConflict }), /preexisting.*differs/i);
  assert.deepEqual(await readFile(path.join(manifestConflict, manifestFilename)), sentinel);
  await assert.rejects(readFile(path.join(manifestConflict, filename)), { code: 'ENOENT' });

  const { bytes: sourceBytes } = await independentSource();
  const altered = Buffer.from(sourceBytes.toString('utf8').replace('happy summer', 'incomplete summer'));
  await assert.rejects(verifyAlicePDF73({ sourceBytes: altered, pdfBytes: sentinel }), /source.*(hash|SHA)/i);
});

test('CLI fails closed without an explicit artifact directory', () => {
  const child = spawnSync(process.execPath, [path.join(root, 'tools/generate-get328-alice-pdf73.mjs')], {
    cwd: tmpdir(), encoding: 'utf8', timeout: 10000,
  });
  assert.notEqual(child.status, 0);
  assert.match(child.stderr, /--artifact-dir/);
});
