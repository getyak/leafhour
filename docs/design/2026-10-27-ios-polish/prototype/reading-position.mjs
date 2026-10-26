const layers = new Set(['source', 'literal', 'interpretive']);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function textOffset(text, value) {
  let offset = clamp(Math.trunc(value), 0, Math.max(0, text.length - 1));
  const code = text.charCodeAt(offset);
  if (offset > 0 && code >= 0xdc00 && code <= 0xdfff) offset--;
  return offset;
}

export function normalizeReadingPosition(raw, identity, text) {
  if (!raw || Array.isArray(raw) || raw.schema !== 1 || raw.bookId !== identity.bookId || raw.sourceVersion !== identity.sourceVersion || !layers.has(raw.layer) || typeof raw.passageId !== 'string' || !raw.passageId || !text) return null;
  if (![raw.offsetUtf16, raw.fraction, raw.viewportOffsetPx].every(Number.isFinite)) return null;
  const sameLayer = raw.layer === identity.layer;
  return {
    sameLayer,
    position: {
      schema: 1, bookId: identity.bookId, sourceVersion: identity.sourceVersion,
      layer: raw.layer, passageId: raw.passageId,
      offsetUtf16: sameLayer ? textOffset(text, raw.offsetUtf16) : Math.max(0, Math.trunc(raw.offsetUtf16)),
      fraction: clamp(raw.fraction, 0, 1), viewportOffsetPx: raw.viewportOffsetPx,
    },
  };
}

function textGeometry(span) {
  const text = span.textContent;
  if (!text) return null;
  const nodes = [], walker = span.ownerDocument.createTreeWalker(span, 4);
  let node, start = 0;
  while ((node = walker.nextNode())) {
    nodes.push({node, start, end: start + node.data.length}); start += node.data.length;
  }
  if (!nodes.length) return null;
  function boundary(offset) {
    const part = nodes.find(p => offset <= p.end) || nodes.at(-1);
    return [part.node, clamp(offset - part.start, 0, part.node.data.length)];
  }
  return {
    text,
    rectAt(value) {
      const offset = textOffset(text, value);
      const length = text.codePointAt(offset) > 0xffff ? 2 : 1;
      const range = span.ownerDocument.createRange();
      range.setStart(...boundary(offset)); range.setEnd(...boundary(Math.min(text.length, offset + length)));
      return range.getBoundingClientRect();
    },
  };
}

function offsetAtTop(geometry, top) {
  let low = 0, high = geometry.text.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (geometry.rectAt(middle).bottom <= top) low = middle + 1;
    else high = middle;
  }
  return textOffset(geometry.text, low);
}

export function captureReadingPosition(scroller, identity, passageId = null) {
  const top = scroller.getBoundingClientRect().top + 20;
  const passages = [...scroller.querySelectorAll('[data-passage]')];
  const passage = passageId == null
    ? passages.find(p => p.querySelector('.passage-text')?.getBoundingClientRect().bottom > top) || passages.at(-1)
    : passages.find(p => p.dataset.passage === passageId);
  const span = passage?.querySelector('.passage-text'), geometry = span && textGeometry(span);
  if (!geometry) return null;
  const offset = offsetAtTop(geometry, top), rect = geometry.rectAt(offset), block = span.getBoundingClientRect();
  return {
    schema: 1, bookId: identity.bookId, sourceVersion: identity.sourceVersion,
    layer: identity.layer, passageId: passage.dataset.passage, offsetUtf16: offset,
    fraction: clamp((rect.top - block.top) / Math.max(1, block.height), 0, 1),
    viewportOffsetPx: Math.round((rect.top - top) * 1000) / 1000,
  };
}

export function restoreReadingPosition(scroller, raw, identity) {
  const passage = [...scroller.querySelectorAll('[data-passage]')].find(p => p.dataset.passage === raw?.passageId);
  const span = passage?.querySelector('.passage-text'), geometry = span && textGeometry(span);
  if (!geometry) return null;
  const normalized = normalizeReadingPosition(raw, identity, geometry.text);
  if (!normalized) return null;
  const position = normalized.position;
  const offset = clamp(position.viewportOffsetPx, -scroller.clientHeight, scroller.clientHeight);
  const top = scroller.getBoundingClientRect().top + 20;
  const rect = span.getBoundingClientRect();
  const character = normalized.sameLayer ? position.offsetUtf16 : offsetAtTop(geometry, rect.top + rect.height * position.fraction);
  const line = geometry.rectAt(character);
  const delta = line.top - top - offset;
  if (Math.abs(delta) >= 0.5) scroller.scrollTop += delta;
  return {
    ...position, layer: identity.layer, offsetUtf16: character,
    fraction: clamp((line.top - rect.top) / Math.max(1, rect.height), 0, 1),
    viewportOffsetPx: offset,
  };
}
