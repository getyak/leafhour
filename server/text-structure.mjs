import {Parser} from 'commonmark';

// Structure is derived locally. Raw source bytes stay in the original store;
// offsets refer to the decoded text with CR/CRLF normalized to LF.
const normalize = text => text.replace(/\r\n?/g, '\n');
const numberWords = 'one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|and|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|thirtieth|fortieth|fiftieth|sixtieth|seventieth|eightieth|ninetieth|hundredth';
const englishNumber = new RegExp('^(?:chapter|part|book)\\s+(?:the\\s+)?(?:[0-9０-９]+|[ivxlcdm]+|(?:' + numberWords + ')(?:[ -](?:' + numberWords + '))*)(?=$|[\\s.:：—–-])(.*)$', 'iu');
const chineseNumber = /^第\s*[〇零一二三四五六七八九十百千万兩两壹贰貳叁參肆伍陆陸柒捌玖拾佰仟\d０-９]{1,16}\s*[章节節回卷部篇集](.*)$/u;
const named = /^(?:序章|序言|前言|楔子|引子|后记|後記|尾声|尾聲|终章|終章|附录|附錄|引言|prologue|epilogue|preface|foreword|afterword|introduction|appendix)(?=$|[\s:：—–-])(.*)$/iu;
export function textHeading(line) {
  const title = line.trim();
  if (!title || title.length > 100 || /[。！？!?;；]|\.{2,}|…|[·．]{2,}/u.test(title)) return null;
  let marker = title;
  for (const [open, close] of [['【', '】'], ['[', ']'], ['（', '）'], ['(', ')']]) {
    if (marker.startsWith(open) && marker.endsWith(close)) { marker = marker.slice(1, -1).trim(); break; }
  }
  for (const pattern of [chineseNumber, englishNumber, named]) {
    const match = pattern.exec(marker);
    if (!match) continue;
    const suffix = match[1], content = suffix.trim().replace(/^[.．:：—–-]+\s*/u, '');
    if (/[.。！？!?;；]/u.test(content)) return null;
    if (pattern === englishNumber && /^[a-z]/u.test(content)) return null;
    if (pattern === chineseNumber && /^(?:介绍|介紹|讨论|討論|讲述|講述|主要|说明|說明|提到|解释|解釋|探讨|探討|阐述|闡述|描述)/u.test(suffix)) return null;
    if (/\S\s{2,}[0-9０-９ivxlcdm]+$/iu.test(suffix)) return null;
    return title;
  }
  return null;
}

function markdownHeadings(lines) {
  const document = new Parser().parse(lines.join('\n')), headings = new Map();
  for (let node = document.firstChild; node; node = node.next) {
    if (node.type !== 'heading') continue;
    let title = '', event;
    const walker = node.walker();
    while ((event = walker.next())) {
      if (!event.entering) continue;
      if (['text', 'code'].includes(event.node.type)) title += event.node.literal;
      else if (['softbreak', 'linebreak'].includes(event.node.type)) title += ' ';
    }
    if (title.trim()) headings.set(node.sourcepos[0][0] - 1, {title: title.trim(), level: node.level});
  }
  return headings;
}

export function textSourceBlocks(input, {markdown = false} = {}) {
  const text = normalize(input), lines = text.split('\n'), starts = []; let offset = 0;
  for (const line of lines) { starts.push(offset); offset += line.length + 1; }
  const headings = markdown ? markdownHeadings(lines) : new Map(lines.flatMap((line, i) => { const title = textHeading(line); return title ? [[i, {title, level: 1}]] : []; }));
  if (!markdown) {
    // A printed front TOC often repeats exact body headings. Suppress only the
    // earlier contiguous list; the source list itself remains readable.
    const entries = [...headings], last = new Map(entries.map(([i, h]) => [h.title, i]));
    for (let n = 0; n < entries.length; n++) {
      const [i, h] = entries[n], next = entries[n + 1]?.[0];
      if (last.get(h.title) > i && next !== undefined && lines.slice(i + 1, next).every(line => !line.trim())) headings.delete(i);
      else break;
    }
  }
  const blocks = [];
  function add(start, end, heading) {
    const raw = text.slice(start, end), leading = raw.search(/\S/);
    if (leading < 0) return;
    // Keep indentation (Markdown code) and internal blank lines verbatim.
    const value = raw.replace(/^\n+|\n+$/g, '');
    const removed = raw.length - raw.replace(/^\n+/, '').length;
    blocks.push({text: value, textOffset: start + removed, type: heading ? 'text_heading' : 'paragraph', ...(heading ? {headingTitle: heading.title.length>120?Array.from(heading.title).slice(0,59).join('')+'…':heading.title, headingLevel: heading.level} : {})});
  }
  if (markdown) {
    // One source block per heading region preserves multiline Markdown
    // containers, including blank lines inside lists and fenced code.
    const entries = [...headings]; let cursor = 0;
    for (let n = 0; n < entries.length; n++) {
      const [i, h] = entries[n], start = starts[i];
      if (!n && start > 0) add(0, start);
      add(start, entries[n + 1] ? starts[entries[n + 1][0]] : text.length, h); cursor = text.length;
    }
    if (!cursor) add(0, text.length);
  } else {
    let begin = null;
    const flush = end => { if (begin !== null) add(starts[begin], end); begin = null; };
    for (let i = 0; i < lines.length; i++) {
      if (headings.has(i)) { flush(starts[i]); add(starts[i], starts[i] + lines[i].length, headings.get(i)); }
      else if (!lines[i].trim()) flush(starts[i]);
      else if (begin === null) begin = i;
    }
    flush(text.length);
  }
  return blocks;
}
