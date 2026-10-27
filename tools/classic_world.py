"""Extract six pinned Gutenberg works without account access or network calls.

``source_scope`` returns the declared source HTML after selecting its original
reading range. It does not rebuild that range from compiled paragraphs. Only
Gutenberg notices/furniture, navigation TOCs, and cover-transcription notices
are outside the range; printed title matter, notes and appendices stay inside.
"""
from __future__ import annotations

import re
from typing import Iterator

from bs4 import BeautifulSoup, Comment, NavigableString, Tag

SUPPORTED = frozenset({1524, 1727, 2554, 3300, 2009, 7142})
DARWIN_DIAGRAM = {
    'originalUrl': 'https://www.gutenberg.org/cache/epub/2009/images/diagram.jpg',
    'sha256': '38f7f352d9b6e801f28ad6c56278cf8dffa105e72533b183a5a3f6d785635038',
    'bytes': 257348,
    'width': 1650,
    'height': 969,
    'mediaType': 'image/jpeg',
    'label': 'Divergence diagram',
    'labelAttribution': 'editorial',
}
_HEADINGS = frozenset({'h1', 'h2', 'h3', 'h4', 'h5', 'h6'})


def _validate(pg_id: int, part) -> None:
    if type(pg_id) is not int or pg_id not in SUPPORTED:
        raise ValueError(f'Unsupported source edition: {pg_id!r}')
    if part is not None:
        raise ValueError('These six source editions do not declare reading volumes')


def _compact(value: str) -> str:
    return re.sub(r'\s+', ' ', value).strip()


def _inline(node) -> str:
    """Keep text-node adjacency; only actual br tags introduce line breaks."""
    if isinstance(node, Comment):
        return ''
    if isinstance(node, NavigableString):
        return str(node)
    if node.name == 'br':
        return '\uE000'
    if node.name == 'img':
        return ''
    return ''.join(_inline(child) for child in node.children)


def _text(node) -> str:
    return '\n'.join(_compact(line) for line in _inline(node).split('\uE000'))


def _scope(pg_id: int, raw: bytes, part=None):
    _validate(pg_id, part)
    if not isinstance(raw, bytes):
        raise TypeError('raw must contain the source HTML bytes')
    soup = BeautifulSoup(raw.decode('utf-8'), 'html.parser')
    notices = '\n\n'.join(el.get_text('\n', strip=True)
                           for el in soup.select('#pg-header, #pg-footer'))
    body = soup.body
    if body is None:
        raise ValueError('Source has no HTML body')
    for element in soup.select('#pg-header, #pg-footer, script, style'):
        element.decompose()
    title = body.find('h1', recursive=False)
    if title is None:
        raise ValueError('Source has no top-level title page')
    # All six verified sources put cover/edition-selector furniture before h1.
    for node in list(title.previous_siblings):
        node.extract()
    # These are source-transcription notices, not the author’s final paragraph.
    for element in list(body.find_all(recursive=False)):
        if _compact(element.get_text(' ', strip=True)).startswith(
                ('Transcriber’s Notes', "Transcriber's Notes")):
            for node in list(element.next_siblings):
                node.extract()
            element.extract()
            break
    if pg_id == 2554:
        # PG2554 has a flat, link-based TOC instead of a table/container.
        first_chapter = body.select_one('div.chapter')
        if first_chapter is not None:
            toc = next((el for el in body.find_all(recursive=False)
                        if _compact(el.get_text(' ', strip=True)) == 'CONTENTS'), None)
            if toc is not None:
                for node in list(toc.next_siblings):
                    if node is first_chapter:
                        break
                    node.extract()
                toc.extract()
        for element in list(body.find_all('div', recursive=False)):
            if element.get_text(strip=True) == '.':
                element.extract()
    # Remove only the navigation heading and its actual table. Hamlet’s cast
    # follows the table inside the same div.chapter and must remain in scope.
    for heading in list(body.find_all(['h2', 'h3'])):
        if _compact(heading.get_text(' ', strip=True)).upper() != 'CONTENTS':
            continue
        table = heading.find_next_sibling()
        if table is None or table.name != 'table':
            raise ValueError('Unrecognized navigation table boundary')
        table.extract()
        heading.extract()
    return body, notices


def source_scope(pg_id: int, raw: bytes, part=None) -> str:
    """Return selected original HTML, independent of the paragraph compiler.

    Range: the top-level printed h1 through the original ending, excluding PG
    header/footer, preceding cover/edition furniture, navigation TOCs, a final
    PG2554 decorative dot, and the final cover-art Transcriber’s Notes block.
    The detailed author contents in Darwin remain in this reading range.
    """
    body, _ = _scope(pg_id, raw, part)
    return body.decode_contents()


def _is_heading(node: Tag) -> bool:
    return node.name in _HEADINGS or (
        node.name == 'div' and any(re.fullmatch(r'h[1-6]', c)
                                  for c in node.get('class', [])))


def _atoms(node) -> Iterator[tuple]:
    """Visit every descendant once, including text outside conventional p tags."""
    pending = []

    def flush():
        value = '\n'.join(_compact(line) for line in ''.join(pending).split('\uE000'))
        pending.clear()
        return value

    for child in node.children:
        if isinstance(child, Comment):
            continue
        if isinstance(child, NavigableString):
            pending.append(str(child))
            continue
        classes = child.get('class', [])
        atom = (_is_heading(child) or child.name in {'p', 'pre', 'table', 'img'}
                or child.name == 'div' and 'pre' in classes)
        if child.name == 'br':
            pending.append('\uE000')
        elif atom:
            value = flush()
            if value:
                yield ('text', value, False, child)
            if _is_heading(child):
                yield ('heading', _text(child), False, child)
            elif child.name == 'img':
                yield ('image', '', False, child)
            elif child.name == 'pre' or child.name == 'div' and 'pre' in classes:
                # No strip/whitespace normalization: numeric columns and blank
                # lines are source content, including leading/trailing blanks.
                yield ('text', child.get_text(''), True, child)
            elif child.name == 'table':
                rows = ['\t'.join(_text(cell) for cell in row.find_all(['td', 'th'], recursive=False))
                        for row in child.find_all('tr')]
                yield ('text', '\n'.join(rows), True, child)
            else:
                value = _text(child)
                if value:
                    yield ('text', value, False, child)
                for image in child.find_all('img'):
                    yield ('image', '', False, image)
        else:
            if child.name not in {'div', 'section', 'blockquote', 'article',
                                   'main', 'ul', 'ol', 'li', 'dl', 'dt', 'dd',
                                   'figure', 'figcaption'} and not child.find('img'):
                pending.append(_inline(child))
                continue
            # A wrapper can contain both bare text and blocks. Flush around it
            # so no non-p text vanishes, without duplicating nested paragraphs.
            value = flush()
            if value:
                yield ('text', value, False, child)
            yield from _atoms(child)
    value = flush()
    if value:
        yield ('text', value, False, node)


class _Compiler:
    def __init__(self, pg_id):
        self.pg_id = pg_id
        self.chapters = []
        self.current = None
        self.group = ''
        self.pending = []
        self.layouts = {}
        self.resources = []

    def _start(self, title, kind, heading, *, editorial=False):
        headers = self.pending + ([heading] if heading is not None else [])
        self.pending = []
        self.current = {'title': title, 'kind': kind, 'sourceHeadings': headers, 'paragraphs': []}
        if editorial:
            self.current['titleAttribution'] = 'editorial'
        self.chapters.append(self.current)

    def _put(self, value, preformatted=False):
        if self.pending:
            self._start(_compact(self.group or self.pending[0]), 'body', None, editorial=True)
        if self.current is None:
            self._start('Front matter', 'frontmatter', None, editorial=True)
        index = len(self.current['paragraphs'])
        self.current['paragraphs'].append(value)
        if preformatted:
            self.layouts[f'{len(self.chapters)-1}:{index}'] = {'presentation': 'preformatted'}

    def _group(self, heading):
        self.group = _compact(heading)
        self.pending.append(heading)

    def _grouped(self, value):
        return (self.group + ' · ' if self.group else '') + _compact(value)

    def heading(self, value, element):
        title = _compact(value)
        pg_id = self.pg_id
        if pg_id == 1524:
            if element.name == 'h2' and title.startswith('ACT '):
                self._group(value)
                return
            if element.name == 'h3' and title.startswith('SCENE '):
                self._start(self._grouped(value), 'body', value, editorial=True)
                return
            if title == 'Dramatis Personæ':
                self._start(title, 'frontmatter', value)
                return
        elif pg_id == 1727 and element.name == 'h2':
            if title.startswith('PREFACE TO '):
                self._start(title, 'frontmatter', value)
                return
            if title == 'THE ODYSSEY':
                self.pending.append(value)
                return
            if title.startswith('BOOK '):
                self._start(title, 'body', value)
                return
            if title == 'FOOTNOTES:':
                self._start(title, 'appendix', value)
                return
        elif pg_id == 2554:
            if element.name == 'h2' and title == 'TRANSLATOR’S PREFACE':
                self._start(title, 'frontmatter', value)
                return
            if element.name == 'h2' and title == 'CRIME AND PUNISHMENT' and self.chapters:
                self.pending.append(value)
                return
            if element.name == 'h2' and (title.startswith('PART ') or title == 'EPILOGUE'):
                self._group(value)
                return
            if element.name == 'h2' and title.startswith('CHAPTER ') or (
                    element.name == 'h3' and self.group == 'EPILOGUE' and title in {'I', 'II'}):
                self._start(self._grouped(value), 'body', value, editorial=True)
                return
        elif pg_id == 3300 and element.name == 'h2':
            if title.startswith('BOOK '):
                self.group = title
                container = element.parent
                if container.select('p,pre,div.pre,table'):
                    self._start(title + ' · Introduction', 'body', value, editorial=True)
                else:
                    self.pending.append(value)
                return
            if title.startswith('CHAPTER '):
                self._start(self._grouped(value), 'body', value, editorial=True)
                return
            if title == 'INTRODUCTION AND PLAN OF THE WORK.':
                self._start(title, 'frontmatter', value)
                return
        elif pg_id == 2009 and element.name == 'h2':
            if title == 'ORIGIN OF SPECIES.':
                self.pending.append(value)
                return
            if title.startswith('CHAPTER '):
                self._start(title, 'body', value)
                return
            if title.startswith(('AN HISTORICAL SKETCH', 'DETAILED CONTENTS', 'INTRODUCTION.')):
                self._start(title, 'frontmatter', value)
                return
            if title.startswith(('GLOSSARY', 'INDEX.')):
                self._start(title, 'appendix', value)
                return
        elif pg_id == 7142 and element.name == 'h2':
            if title.startswith('BOOK '):
                self._group(value)
                return
            if title.startswith('CHAPTER '):
                self._start(self._grouped(value), 'body', value, editorial=True)
                return
        # Internal subheadings and printed title matter remain visible source
        # paragraphs. They are not duplicated in sourceHeadings.
        self._put(value)

    def image(self, element):
        if self.pg_id != 2009 or element.get('src') != 'images/diagram.jpg':
            raise ValueError(f'Unverified source image: {element.get("src")!r}')
        if self.current is None:
            raise ValueError('Figure precedes all reading text')
        count = len(self.current['paragraphs'])
        self.resources.append({
            **DARWIN_DIAGRAM,
            'chapterIndex': len(self.chapters)-1,
            'paragraphIndex': max(0, count-1),
            'placement': 'after' if count else 'before',
            'sourceLabel': element.get('alt', ''),
        })


def extract(pg_id: int, raw: bytes, part=None) -> dict:
    """Compile source text; chapter and paragraph/resource indices are 0-based."""
    body, notices = _scope(pg_id, raw, part)
    compiler = _Compiler(pg_id)
    for kind, value, preformatted, element in _atoms(body):
        if kind == 'heading':
            compiler.heading(value, element)
        elif kind == 'image':
            compiler.image(element)
        else:
            compiler._put(value, preformatted)
    # A changed source that ends with heading-only matter still retains it.
    if compiler.pending:
        pending = compiler.pending
        compiler.pending = []
        for value in pending:
            compiler._put(value)
    if not compiler.chapters:
        raise ValueError('Source reading range is empty')
    return {'chapters': compiler.chapters, 'notices': notices,
            'layouts': compiler.layouts, 'resources': compiler.resources}
