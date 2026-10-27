"""Source-faithful extraction of a fixed set of historical English editions.

No downloads, translation, summaries or private paths belong in this module.
``source_scope`` selects original HTML byte-decoded ranges independently of the
paragraph renderer. Its output is suitable for a separate recursive text audit.
"""
from functools import lru_cache
from html.parser import HTMLParser
import re

from bs4 import BeautifulSoup, Comment, NavigableString, Tag

SUPPORTED_IDS = frozenset((1497, 8438, 10661, 3296, 1232, 59, 3800, 9662, 3600, 45988))
_HEADINGS = frozenset(("h1", "h2", "h3", "h4", "h5", "h6"))
_BLOCKS = frozenset(("html", "body", "div", "section", "article", "main", "p",
                     "blockquote", "pre", "table", "ul", "ol", "li", "dl", "dt",
                     "dd", "figure", "figcaption", "address", "hr")) | _HEADINGS
_VOID = frozenset(("area", "base", "br", "col", "embed", "hr", "img", "input",
                   "link", "meta", "param", "source", "track", "wbr"))


def _plain(value):
    return re.sub(r"\s+", " ", value).strip()


def _check(pg_id, part):
    if type(pg_id) is not int or pg_id not in SUPPORTED_IDS:
        raise ValueError("Unsupported source edition (Pascal 18269 is held)")
    if pg_id == 3600:
        if type(part) is not int or part not in (1, 2, 3):
            raise ValueError("Montaigne requires original Book part 1, 2 or 3")
    elif part is not None:
        raise ValueError("This source edition does not accept a part")


class _ClosingTags(HTMLParser):
    """Index source offsets without serializing or rewriting source HTML."""
    def __init__(self, text, lines):
        super().__init__(convert_charrefs=False)
        self.text = text
        self.lines = lines
        self.stack = []
        self.ends = {}
        self.feed(text)

    def source_offset(self):
        line, col = self.getpos()
        return self.lines[line - 1] + col

    def handle_starttag(self, tag, attrs):
        start = self.source_offset()
        if tag in _VOID:
            self.ends[start] = start + len(self.get_starttag_text())
        else:
            self.stack.append((tag, start))

    def handle_startendtag(self, tag, attrs):
        start = self.source_offset()
        self.ends[start] = start + len(self.get_starttag_text())

    def handle_endtag(self, tag):
        end = self.text.find(">", self.source_offset()) + 1
        for index in range(len(self.stack) - 1, -1, -1):
            if self.stack[index][0] == tag:
                for _, start in self.stack[index:]:
                    self.ends[start] = end
                del self.stack[index:]
                break


class _Source:
    def __init__(self, raw):
        if not isinstance(raw, bytes):
            raise ValueError("Source must be UTF-8 bytes")
        self.text = raw.decode("utf-8-sig")
        self.soup = BeautifulSoup(self.text, "html.parser")
        self.lines = [0]
        self.lines.extend(match.end() for match in re.finditer("\n", self.text))
        self.ends = _ClosingTags(self.text, self.lines).ends

    def start(self, tag):
        if tag is None or tag.sourceline is None:
            raise ValueError("Required source boundary is absent")
        return self.lines[tag.sourceline - 1] + tag.sourcepos

    def end(self, tag):
        try:
            return self.ends[self.start(tag)]
        except KeyError as error:
            raise ValueError("Unclosed source exclusion boundary") from error

    def anchor(self, identity):
        node = self.soup.find(id=identity)
        if node is None:
            raise ValueError("Required source marker is absent: " + identity)
        # Retain the author's heading, not only the anchor within it.
        if node.parent and node.parent.name in _HEADINGS:
            return node.parent
        return node

    def heading(self, text):
        for node in self.soup.find_all(tuple(_HEADINGS)):
            if _plain(node.get_text()) == text:
                return node
        raise ValueError("Required source heading is absent: " + text)

    def after(self, tag, predicate):
        start = self.start(tag)
        return next((node for node in self.soup.find_all(True)
                     if self.start(node) > start and predicate(node)), None)


def _prince_end(source):
    # The original /files HTML has no machine-readable footer wrapper.
    for node in source.soup.find_all("div"):
        if node.find("b", string=re.compile(r"Transcriber[’']s Notes")):
            return node
    return source.soup.find(id="pg-footer")


def _republic_digitizer_notice(soup):
    marker = soup.find("b", string=re.compile(r"^Transcriber[’']s Notes$"))
    if marker is None:
        return None
    heading = marker.find_parent("div")
    if heading is None or heading.parent.name != "div" or heading.parent.find("ul") is None:
        raise ValueError("Unrecognized Republic digitizer-notice boundary")
    return heading.parent


@lru_cache(maxsize=16)
def _selection(pg_id, raw, part):
    _check(pg_id, part)
    source = _Source(raw)
    soup = source.soup
    footer = soup.find(id="pg-footer")
    end = source.start(footer) if footer else len(source.text)
    spans = []
    notes = []
    if pg_id == 1497:
        digitizer = _republic_digitizer_notice(soup)
        spans = [(source.start(source.anchor("link2H_4_0003")),
                  source.start(digitizer) if digitizer else end)]
        notes.append("Trailing digitizer cover notice is preserved in source notices, not author prose.")
    elif pg_id == 8438:
        spans = [(source.start(source.anchor("chap01")), end)]
    elif pg_id == 10661:
        spans = [(source.start(source.anchor("chap02")), end)]
        notes.append("Selected Discourses and Encheiridion; not complete Discourses.")
    elif pg_id == 3296:
        spans = [(source.start(source.heading("BOOK I")), end)]
    elif pg_id == 1232:
        boundary = _prince_end(source)
        if boundary is None:
            raise ValueError("Prince transcriber/footer boundary is absent")
        spans = [(source.start(source.anchor("pref06")), source.start(boundary))]
        notes.append("Dedication and Prince I–XXVI, followed by the two source author appendices.")
    elif pg_id == 59:
        spans = [(source.start(source.anchor("note")), end)]
    elif pg_id == 3800:
        spans = [(source.start(source.anchor("chap01")), end)]
        notes.append("Inline numbered footnote copies before p.finis are excluded; the complete "
                     "17 appended source notes are selected once. Appended note 16 retains "
                     "the additional sentence absent from its inline copy. Author scholia "
                     "beginning Note.— are not excluded.")
    elif pg_id == 9662:
        spans = [(source.start(source.anchor("section1")),
                  source.start(source.anchor("index")))]
    elif pg_id == 3600:
        markers = ("link2H_4_0003", "link2H_4_0077", "link2H_4_0114", "link2H_4_0128")
        spans = [(source.start(source.anchor(markers[part - 1])),
                  source.start(source.anchor(markers[part])))]
        notes.append("Original Essays Book %d reading partition; not a physical print volume." % part)
        if part == 1:
            notes.append("Includes sixteen supplemental author letters and To the Reader, "
                         "with source edition headings/notes retained as frontmatter.")
    elif pg_id == 45988:
        boundary = source.after(source.anchor("Book-II"),
                                lambda tag: tag.name == "div" and "transnote" in tag.get("class", []))
        if boundary is None:
            raise ValueError("Bacon trailing transcriber boundary is absent")
        spans = [(source.start(source.anchor("Preface")), source.start(source.anchor("Contents"))),
                 (source.start(source.anchor("Book-I")), source.start(boundary))]
        notes.append("Author Preface, Books I/II and all 164 source notes; only the intervening "
                     "Contents navigation is excluded. Wood old translation, Devey edition.")
    exclusions = []
    for node in soup.select(".pagenum, script, style"):
        exclusions.append((source.start(node), source.end(node), "layout page number or nonvisible code"))
    if pg_id == 3800:
        finis = soup.find("p", class_="finis")
        if finis is None:
            raise ValueError("Spinoza finis boundary is absent")
        finis_start = source.start(finis)
        exclusions.append((finis_start, source.end(finis), "printed finis decoration"))
        appended = [_plain(node.get_text()) for node in soup.find_all("p", class_="footnote")
                    if source.start(node) > finis_start]
        for node in soup.find_all("p", class_="footnote"):
            if source.start(node) < finis_start:
                inline = _plain(node.get_text())
                if not any(complete.startswith(inline) for complete in appended):
                    raise ValueError("Spinoza inline note lacks its complete appended source copy")
                exclusions.append((source.start(node), source.end(node),
                                   "numbered inline note copy; complete appended note selected"))
    if pg_id == 9662:
        for node in soup.find_all("a", href=re.compile(r"^#footnotetag")):
            if _plain(node.get_text()) == "(return)":
                exclusions.append((source.start(node), source.end(node), "return navigation"))
    if pg_id == 45988:
        for node in soup.find_all("p"):
            if re.fullmatch(r"END OF\s*[“\"]?\s*NOVUM ORGANUM\s*[”\"]?", _plain(node.get_text())):
                exclusions.append((source.start(node), source.end(node), "printed finis decoration"))
    selected = []
    selected_exclusions = []
    for first, last in spans:
        cuts = sorted((max(first, a), min(last, b), why) for a, b, why in exclusions
                      if a < last and b > first)
        position = first
        for a, b, why in cuts:
            if a > position:
                selected.append(source.text[position:a])
            position = max(position, b)
            selected_exclusions.append({"start": a, "end": b, "reason": why})
        if position < last:
            selected.append(source.text[position:last])
    return {"html": "\n".join(selected), "ranges": [{"start": a, "end": b} for a, b in spans],
            "exclusions": selected_exclusions, "scopeNotes": notes}


def source_scope(pg_id: int, raw: bytes, part=None) -> str:
    """Select declared original HTML ranges, never rendered paragraph output."""
    return _selection(pg_id, raw, part)["html"]


def _inline(node, verse=False):
    if isinstance(node, Comment):
        return ""
    if isinstance(node, NavigableString):
        return re.sub(r"\s+", " ", str(node)) if verse else str(node)
    if node.name in ("script", "style"):
        return ""
    if node.name == "br":
        return "\n"
    content = "".join(_inline(child, verse) for child in node.children)
    if verse and "stanza" in node.get("class", []):
        return content + "\n\n"
    if node.name in ("td", "th", "tr", "caption"):
        return content + " "
    return content


def _poem(node):
    return "poem" in node.get("class", [])


def _flow(container, as_heading=False):
    """Flatten visible flow once, including bare strings and nested containers."""
    buffer = []

    def flush():
        value = _plain("".join(buffer))
        buffer.clear()
        return ("heading" if as_heading else "text", value, container) if value else None

    for child in container.children:
        if isinstance(child, Comment):
            continue
        if isinstance(child, NavigableString):
            buffer.append(str(child))
            continue
        if not isinstance(child, Tag) or child.name in ("script", "style"):
            continue
        is_block = child.name in _BLOCKS or _poem(child)
        if not is_block:
            buffer.append(_inline(child))
            continue
        event = flush()
        if event:
            yield event
        if child.name in _HEADINGS:
            yield from _flow(child, as_heading=True)
        elif child.name == "pre":
            value = child.get_text().replace("\r\n", "\n").replace("\r", "\n").strip("\n")
            if value.strip():
                yield "text", value, child
        elif _poem(child):
            value = "\n".join(line.strip() for line in _inline(child, verse=True).splitlines()).strip("\n")
            if value.strip():
                yield "text", value, child
        elif child.name == "table":
            value = _plain(_inline(child))
            if value:
                yield "text", value, child
        else:
            yield from _flow(child)
    event = flush()
    if event:
        yield event


def _ids(node):
    return {tag.get("id") for tag in [node] + list(node.find_all(id=True)) if tag.get("id")}


def _heading_kind(pg_id, title, node, previous):
    ids = _ids(node)
    if pg_id == 1497:
        return "frontmatter" if "PERSONS OF THE DIALOGUE" in title else "body"
    if pg_id == 8438:
        if "chap11" in ids:
            return "appendix"
        if any(re.fullmatch(r"chap(?:0[1-9]|10)", identity) for identity in ids):
            return "body"
    elif pg_id == 1232:
        if "pref06" in ids:
            return "frontmatter"
        if ids & {"chap27", "chap28"}:
            return "appendix"
        if any(re.fullmatch(r"chap\d+", identity) for identity in ids):
            return "body"
    elif pg_id == 59:
        if "note" in ids:
            return "frontmatter"
        if any(identity.startswith("part") for identity in ids):
            return "body"
    elif pg_id == 3800:
        if title.startswith("PART "):
            return "body"
        if title.startswith("APPENDIX"):
            return "appendix"
    elif pg_id == 9662:
        if "footnotes" in ids:
            return "appendix"
        if any(re.fullmatch(r"section\d+", identity) for identity in ids):
            return "body"
    elif pg_id == 3600:
        if title.startswith(("CHAPTER ", "BOOK THE ")):
            return "body"
        return "frontmatter" if previous == "frontmatter" else previous
    elif pg_id == 45988:
        if "Preface" in ids:
            return "frontmatter"
        if ids & {"Book-I", "Book-II"}:
            return "body"
        if title in ("FOOTNOTE", "FOOTNOTES"):
            return "appendix"
    return previous


def _roman(number):
    result = ""
    for value, digits in ((100, "C"), (90, "XC"), (50, "L"), (40, "XL"),
                          (10, "X"), (9, "IX"), (5, "V"), (4, "IV"), (1, "I")):
        while number >= value:
            result += digits
            number -= value
    return result


def extract(pg_id: int, raw: bytes, part=None) -> dict:
    """Return source headings and paragraphs in strictly original text order."""
    selected = _selection(pg_id, raw, part)
    soup = BeautifulSoup(selected["html"], "html.parser")
    chapters = []
    current = None
    kind = "frontmatter" if pg_id in (1497, 3600, 45988, 59, 1232) else "body"
    discourse = pg_id == 10661
    bacon_book = None
    next_aphorism = 1

    def finish():
        nonlocal current
        if current and (current["paragraphs"] or current["sourceHeadings"]):
            # A title/credit block has visible source text but no prose. Keep it
            # as frontmatter paragraphs, rather than an empty reading chapter.
            if not current["paragraphs"]:
                current["paragraphs"] = current["sourceHeadings"]
                current["sourceHeadings"] = []
            chapters.append(current)
        current = None

    def begin(title, chapter_kind, editorial=False):
        nonlocal current
        current = {"title": title, "kind": chapter_kind,
                   "sourceHeadings": [], "paragraphs": []}
        if editorial:
            current["titleAttribution"] = "editorial"

    def group(title, chapter_kind):
        if current and not current["paragraphs"] and current["kind"] == chapter_kind:
            current["title"] = title
            current["titleAttribution"] = "editorial"
        else:
            finish()
            begin(title, chapter_kind, True)

    for event, value, node in _flow(soup):
        if event == "heading":
            ids = _ids(node)
            kind = _heading_kind(pg_id, value, node, kind)
            if pg_id == 10661 and "chap03" in ids:
                discourse = False
            if pg_id == 45988 and ids & {"Book-I", "Book-II"}:
                bacon_book = "I" if "Book-I" in ids else "II"
                next_aphorism = 1
            if current and (current["paragraphs"] or current["kind"] != kind):
                finish()
            if current is None:
                begin(value, kind)
            current["title"] = value
            current["sourceHeadings"].append(value)
            continue
        if pg_id == 3600 and node.name == "pre" and _plain(value) == "THE AUTHOR TO THE READER.":
            kind = "frontmatter"
            group("To the Reader", kind)
        elif pg_id == 10661 and discourse and node.name == "p":
            match = re.match(r"^([A-Z][A-Z\s,?;()'’ÆŒÀÉ.—-]{7,219}?)\.?(?:—)", value)
            if match:
                group(match.group(1).rstrip(". "), kind)
        elif pg_id == 45988 and kind == "body" and bacon_book and node.name == "p":
            if re.match(r"^" + _roman(next_aphorism) + r"\.", value):
                group("Book %s — %s" % (bacon_book, _roman(next_aphorism)), kind)
                next_aphorism += 1
        elif pg_id == 3800 and node.name == "p" and "footnote" in node.get("class", []):
            if kind != "appendix" or not current or current.get("title") != "Source notes":
                kind = "appendix"
                group("Source notes", kind)
        if current is None:
            begin("Source text", kind, True)
        current["paragraphs"].append(value)
    finish()
    original = BeautifulSoup(raw.decode("utf-8-sig"), "html.parser")
    notices = []
    for marker in ("pg-header", "pg-footer"):
        wrapper = original.find(id=marker)
        if wrapper:
            notices.append(wrapper.get_text("\n", strip=True))
    if pg_id == 1497:
        digitizer = _republic_digitizer_notice(original)
        if digitizer:
            notices.append(digitizer.get_text("\n", strip=True))
    # A legacy /files source may have only the end marker rather than a full
    # license wrapper. Do not invent a missing license or translator credit.
    if not notices:
        for text in original.find_all(string=re.compile(r"\*\*\* (?:START|END) OF THE PROJECT GUTENBERG")):
            notices.append(str(text).strip())
    return {"chapters": chapters, "notices": "\n\n".join(notices),
            "sourceRanges": selected["ranges"],
            "sourceOffsetUnit": "Unicode code points in UTF-8-sig-decoded HTML",
            "sourceExclusions": selected["exclusions"],
            "scopeNotes": selected["scopeNotes"]}
