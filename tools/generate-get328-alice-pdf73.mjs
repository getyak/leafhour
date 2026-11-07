#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(root, 'catalog/alice.txt');
const sourceSHA = '01b38ea4c710a84bc18d0bd41271a5a1a92b94e97b2812f4dece97d4a694725e';
const canonicalSHA = 'fab10098897c657bbd45a4c647c01c5819068270613c8574800aaf08508419aa';
const filename = 'Alice-complete-GET328-20261107.pdf';
const manifestFilename = 'Alice-complete-GET328-20261107.manifest.json';
const pageCount = 73;
const paper = Object.freeze({ width: 432, height: 648, left: 44, right: 388, top: 588, bottom: 72 });
const footer = 'NEW public-domain source / NEW PDF hash - GET-328';
const normalize = text => text.replace(/\s+/g, ' ').trim();
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const pageWitness = n => `GET328_PUBLIC_ALICE_PAGE_${n}_OF_73`;

function checkedSource(sourceBytes) {
  if (sha256(sourceBytes) !== sourceSHA) throw new Error('Alice source SHA-256 differs from the pinned public catalog source');
  const text = Buffer.from(sourceBytes).toString('utf8').replace(/\r\n/g, '\n');
  const startMarker = '\nCHAPTER I.\nDown the Rabbit-Hole\n';
  const endMarker = '\n*** END OF THE PROJECT GUTENBERG EBOOK';
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker);
  if (start < 0 || end <= start || text.indexOf(startMarker, start + 1) !== -1) {
    throw new Error('Alice narrative boundaries are missing or ambiguous');
  }
  const narrative = text.slice(start + 1, end).trim();
  const canonical = normalize(narrative);
  const paragraphs = narrative.split(/\n\s*\n/).map(normalize).filter(Boolean);
  if (sha256(canonical) !== canonicalSHA || canonical.split(' ').length !== 26441 || paragraphs.length !== 811
    || !canonical.endsWith('remembering her own child-life, and the happy summer days. THE END')) {
    throw new Error('Alice source is not the complete pinned twelve-chapter narrative and ending');
  }
  return { narrative, canonical, paragraphs };
}

function wrapParagraph(text, font, size) {
  const lines = [];
  let line = '';
  let lineWidth = 0;
  const spaceWidth = font.widthOfTextAtSize(' ', size);
  for (const word of text.split(' ')) {
    // drawText emits a Tj string without kerning adjustments. Sum individual
    // glyph advances rather than pdf-lib's kerned whole-string measurement.
    const wordWidth = [...word].reduce((width, glyph) => width + font.widthOfTextAtSize(glyph, size), 0);
    if (wordWidth > paper.right - paper.left) throw new Error('A source word exceeds the paper width');
    const candidate = line ? `${line} ${word}` : word;
    const candidateWidth = line ? lineWidth + spaceWidth + wordWidth : wordWidth;
    if (line && candidateWidth > paper.right - paper.left) {
      lines.push(line);
      line = word;
      lineWidth = wordWidth;
    } else {
      line = candidate;
      lineWidth = candidateWidth;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// Whole paragraphs remain intact. Dynamic programming balances real prose across
// exactly 73 sheets; it cannot create an empty, padded or repeated content page.
function paginate(paragraphs, regular, bold) {
  const blocks = paragraphs.map(text => {
    const heading = /^CHAPTER [IVX]+\. /.test(text);
    const font = heading ? bold : regular;
    const size = heading ? 12 : 11;
    const lineHeight = heading ? 14.4 : 13.2;
    const gap = heading ? 7 : 5;
    const lines = wrapParagraph(text, font, size);
    return { text, font, size, lineHeight, gap, lines, heading, words: text.split(' ').length,
      height: lines.length * lineHeight + gap };
  });
  const heights = [0], words = [0];
  for (const block of blocks) {
    heights.push(heights.at(-1) + block.height);
    words.push(words.at(-1) + block.words);
  }
  const targetHeight = heights.at(-1) / pageCount;
  const targetWords = words.at(-1) / pageCount;
  const predecessors = Array.from({ length: pageCount + 1 }, () => new Int16Array(blocks.length + 1).fill(-1));
  let previous = new Float64Array(blocks.length + 1).fill(Infinity);
  previous[0] = 0;
  for (let n = 1; n <= pageCount; n += 1) {
    const current = new Float64Array(blocks.length + 1).fill(Infinity);
    for (let end = n; end <= blocks.length; end += 1) {
      if (blocks[end - 1].heading) continue;
      for (let start = end - 1; start >= n - 1; start -= 1) {
        const height = heights[end] - heights[start] - blocks[end - 1].gap;
        if (height > paper.top - paper.bottom) break;
        const count = words[end] - words[start];
        if (count < 250 || !Number.isFinite(previous[start])) continue;
        const cost = previous[start] + (height - targetHeight) ** 2 + 0.08 * (count - targetWords) ** 2;
        if (cost < current[end]) {
          current[end] = cost;
          predecessors[n][end] = start;
        }
      }
    }
    previous = current;
  }
  if (!Number.isFinite(previous[blocks.length])) throw new Error('Complete narrative cannot fit 73 substantive pages with intact paragraphs');
  const pages = [];
  let end = blocks.length;
  for (let n = pageCount; n > 0; n -= 1) {
    const start = predecessors[n][end];
    if (start < 0) throw new Error('Incomplete pagination');
    pages.unshift(blocks.slice(start, end));
    end = start;
  }
  if (end !== 0) throw new Error('Pagination omitted source paragraphs');
  return pages;
}

async function typeset(source) {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setTitle("Alice's Adventures in Wonderland - NEW GET-328 73-page fixture");
  doc.setAuthor('Lewis Carroll');
  doc.setCreator('Leafhour deterministic public-domain fixture v1');
  doc.setProducer('Leafhour / pdf-lib 1.17.1');
  doc.setSubject(`NEW source catalog/alice.txt SHA-256 ${sourceSHA}; not the historical Alice-complete.pdf`);
  const regular = await doc.embedFont(StandardFonts.TimesRoman);
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const sans = await doc.embedFont(StandardFonts.Helvetica);
  const pages = paginate(source.paragraphs, regular, bold);
  for (const [index, blocks] of pages.entries()) {
    const page = doc.addPage([paper.width, paper.height]);
    page.drawText(pageWitness(index + 1), { x: paper.left, y: 620, size: 8, font: sans, color: rgb(0.2, 0.2, 0.2) });
    page.drawText("Alice's Adventures in Wonderland - Lewis Carroll", {
      x: paper.left, y: 604, size: 8, font: sans, color: rgb(0.3, 0.3, 0.3),
    });
    let y = paper.top;
    for (const block of blocks) {
      for (const line of block.lines) {
        if (y < paper.bottom) throw new Error(`Typeset narrative clips on page ${index + 1}`);
        page.drawText(line, { x: paper.left, y, size: block.size, font: block.font, color: rgb(0.08, 0.08, 0.08) });
        y -= block.lineHeight;
      }
      y -= block.gap;
    }
    page.drawText(footer, { x: paper.left, y: 39, size: 7.5, font: sans, color: rgb(0.3, 0.3, 0.3) });
  }
  // updateMetadata:false prevents wall-clock dates; StandardFonts and pdf-lib's
  // per-document seeded resource names introduce no random or trailer IDs.
  return Buffer.from(await doc.save({ useObjectStreams: false, addDefaultPage: false }));
}

function uniqueWitness(pageText, sourceText) {
  const words = pageText.split(' ');
  for (let length = 16; length <= 32; length += 4) {
    for (let offset = 0; offset + length <= words.length; offset += 1) {
      const quote = words.slice(offset, offset + length).join(' ');
      const position = sourceText.indexOf(quote);
      if (position !== -1 && sourceText.indexOf(quote, position + 1) === -1) return quote;
    }
  }
  throw new Error('Page has no unique narrative witness');
}

/** Parse real PDF bytes independently of the layout plan and fail closed. */
export async function verifyAlicePDF73({ sourceBytes, pdfBytes }) {
  const source = checkedSource(sourceBytes);
  const metadata = await PDFDocument.load(pdfBytes, { updateMetadata: false });
  if (metadata.getCreationDate() || metadata.getModificationDate() || metadata.context.trailerInfo.ID) {
    throw new Error('PDF fixture contains nondeterministic date or trailer identity metadata');
  }
  const loadingTask = getDocument({ data: Uint8Array.from(pdfBytes), useSystemFonts: true,
    disableFontFace: true, useWorkerFetch: false, isEvalSupported: false });
  const doc = await loadingTask.promise;
  try {
    if (doc.numPages !== pageCount) throw new Error(`Expected exactly 73 pages, parsed ${doc.numPages}`);
    const pages = [], parsedParagraphs = [];
    let wordCursor = 0;
    let paragraphCursor = 0;
    for (let n = 1; n <= pageCount; n += 1) {
      const page = await doc.getPage(n);
      const { items } = await page.getTextContent({ disableNormalization: true });
      const textItems = items.filter(item => typeof item.str === 'string' && item.str.trim());
      const bodyItems = textItems.filter(item => item.transform[5] > 65 && item.transform[5] < 595);
      const canonical = normalize(bodyItems.map(item => item.str).join(' '));
      const words = canonical ? canonical.split(' ') : [];
      if (words.length < 250 || bodyItems.length < 20) throw new Error(`Page ${n} is blank or lacks substantive typeset narrative`);
      const marker = pageWitness(n);
      if (textItems.filter(item => item.str === marker && item.transform[5] === 620).length !== 1) {
        throw new Error(`Page ${n} witness is missing, duplicated or out of order`);
      }
      const paragraphs = [];
      let paragraph = '', priorY;
      for (const item of bodyItems) {
        const [,,,, x, y] = item.transform;
        if (x < paper.left - 0.1 || x + item.width > paper.right + 0.1 || y < paper.bottom || y > paper.top) {
          throw new Error(`Page ${n} narrative falls outside paper margins: x=${x}, y=${y}, width=${item.width}`);
        }
        if (priorY !== undefined) {
          if (y >= priorY) throw new Error(`Page ${n} narrative line order is not descending`);
          if (priorY - y > 15.5) {
            paragraphs.push(normalize(paragraph));
            paragraph = '';
          }
        }
        paragraph += ` ${item.str}`;
        priorY = y;
      }
      if (paragraph) paragraphs.push(normalize(paragraph));
      parsedParagraphs.push(...paragraphs);
      pages.push({ page: n, pageWitness: marker, wordStart: wordCursor, wordEndExclusive: wordCursor + words.length,
        wordCount: words.length, paragraphStart: paragraphCursor, paragraphEndExclusive: paragraphCursor + paragraphs.length,
        typesetLines: bodyItems.length, canonicalSHA256: sha256(canonical),
        uniqueNarrativeWitness: uniqueWitness(canonical, source.canonical), lastNarrativeText: words.slice(-16).join(' ') });
      wordCursor += words.length;
      paragraphCursor += paragraphs.length;
      page.cleanup();
    }
    if (parsedParagraphs.length !== source.paragraphs.length
      || parsedParagraphs.some((paragraph, i) => paragraph !== source.paragraphs[i])) {
      throw new Error('PDF narrative paragraph order or complete-text coverage differs from the source');
    }
    const canonical = normalize(parsedParagraphs.join(' '));
    if (canonical !== source.canonical || sha256(canonical) !== canonicalSHA) {
      throw new Error('PDF narrative full-text coverage differs from the source');
    }
    if (pages[72].paragraphEndExclusive !== 811 || !pages[72].lastNarrativeText.endsWith('happy summer days. THE END')) {
      throw new Error('Page 73 is missing the complete narrative ending');
    }
    return {
      schema: 'leafhour.get328.public-alice-pdf73.v1',
      provenance: { identity: 'NEW source / NEW hash', reproducesHistoricalOriginal: false,
        historicalOriginal: 'Alice-complete.pdf was unavailable; this fixture is newly typeset, not a recovered original.' },
      source: { path: 'catalog/alice.txt', sha256: sourceSHA, bytes: sourceBytes.length,
        narrativeScope: 'All twelve chapters from CHAPTER I through THE END; Gutenberg front matter, contents and license wrapper excluded.',
        narrativeSHA256: sha256(source.narrative), canonicalSHA256: canonicalSHA,
        sourceNewlineNormalization: 'CRLF to LF', canonicalNormalization: 'Whitespace runs to one ASCII space; punctuation and word order unchanged.' },
      pdf: { filename, sha256: sha256(pdfBytes), bytes: pdfBytes.length, pageCount,
        pageSizePoints: [paper.width, paper.height], bodyFont: 'Times-Roman 11pt; chapter headings Times-Bold 12pt',
        creationDate: null, modificationDate: null, randomTrailerID: null },
      coverage: { expectedWords: 26441, parsedWords: wordCursor, expectedParagraphs: 811,
        parsedParagraphs: paragraphCursor, expectedCanonicalSHA256: canonicalSHA, parsedCanonicalSHA256: sha256(canonical),
        complete: true, paragraphOrderPreserved: true, paragraphGeometryVerified: true,
        check: 'pdfjs-dist actual-byte extraction; exact complete canonical text and every paragraph in reading order' },
      pages,
      page73: { ...pages[72], endingParagraph: source.paragraphs.at(-2), endingMarker: 'THE END' },
    };
  } finally {
    await loadingTask.destroy();
  }
}

async function existingBytes(target) {
  try { return await readFile(target); } catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
}

/** Only catalog/alice.txt is accepted; an explicit external artifact directory is mandatory. */
export async function generateAlicePDF73({ artifactDir } = {}) {
  if (typeof artifactDir !== 'string' || !artifactDir.trim() || !path.isAbsolute(artifactDir)) {
    throw new Error('An explicit absolute artifact directory is required (--artifact-dir)');
  }
  await mkdir(artifactDir, { recursive: true });
  artifactDir = await realpath(artifactDir);
  const relative = path.relative(root, artifactDir);
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    throw new Error('Artifact directory must be outside the repository; generated PDF bytes are not source files');
  }
  const sourceBytes = await readFile(sourcePath);
  const pdfBytes = await typeset(checkedSource(sourceBytes));
  const manifest = await verifyAlicePDF73({ sourceBytes, pdfBytes });
  const pdfPath = path.join(artifactDir, filename);
  const manifestPath = path.join(artifactDir, manifestFilename);
  const outputs = [[pdfPath, pdfBytes], [manifestPath, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`)]];
  // Check the entire output pair before writing either file. Existing evidence
  // must compare byte for byte, including manifests; there is no overwrite flag.
  for (const [target, bytes] of outputs) {
    const existing = await existingBytes(target);
    if (existing && !existing.equals(bytes)) throw new Error(`Preexisting artifact differs: ${target}`);
  }
  for (const [target, bytes] of outputs) {
    try { await writeFile(target, bytes, { flag: 'wx' }); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const existing = await readFile(target);
      if (!existing.equals(bytes)) throw new Error(`Preexisting artifact differs: ${target}`);
    }
  }
  return { pdfPath, manifestPath, manifest };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--artifact-dir') {
    console.error('Usage: node tools/generate-get328-alice-pdf73.mjs --artifact-dir /absolute/external/artifact-directory');
    process.exitCode = 2;
  } else {
    try {
      const { pdfPath, manifestPath, manifest } = await generateAlicePDF73({ artifactDir: args[1] });
      console.log(JSON.stringify({ pdfPath, manifestPath, sourceSHA256: manifest.source.sha256,
        pdfSHA256: manifest.pdf.sha256, pageCount: manifest.pdf.pageCount, coverage: manifest.coverage }));
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
