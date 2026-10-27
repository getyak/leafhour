"""Offline, source-faithful extraction for six reviewed Gutenberg Chinese texts.

This module is build tooling, not reader runtime code. ``source_scope`` returns
an unchanged slice of upstream HTML so a separate auditor can read it without
reusing the extraction algorithm. The source IDs below declare where author
content starts, excluding production credits and (for 24178) uploader metadata.

Only layout whitespace changes: HTML text-node boundaries, hard line wrapping,
and explicit indentation can become paragraph boundaries or single spaces.
Every non-whitespace character inside the declared scope is retained, including
printed divider lines, mixed character forms, source errors, and missing-glyph
boxes. Raw heading blocks include adjacent printed dividers when needed to
preserve their exact position before body paragraphs. ``title`` is the concise
navigation label; ``sourceHeadings`` is provenance for ordered text auditing.
"""

from __future__ import annotations

import re

from bs4 import BeautifulSoup


_FIRST_ELEMENT = {
    23839: "id00002",  # Analects: omit producer credit and English typo note.
    24178: "id00003",  # Mencius: omit production and uploader assignment data.
    23913: "id00001",  # PG catalog title differs; actual text is Zhuangzi.
    23864: "id00001",  # Sunzi: omit producer credit.
    24264: "id00000",  # Red Chamber, all 120 chapters.
    7337: "id00002",   # Omit producer and obsolete "first to forty" range label.
}
_NUM = "[一二三四五六七八九十百〇零0-9０-９]+"
_RED_MARKER = re.compile(r"(?m)^[ \t\u3000]*(?P<heading>第(?P<number>" + _NUM + r")回)(?=\s|$)")
_PATTERNS = {
    23839: r"(?:學而|為政|八佾|里仁|公冶長|雍也|述而|泰伯|子罕|鄉黨|先進|顏淵|子路|憲問|衛靈公|季氏|陽貨|微子|子張|堯曰)第" + _NUM,
    24178: r"卷之" + _NUM + r"(?:梁惠王|公孫丑|滕文公|離婁|萬章|告子|盡心)[上下]",
    23913: r"(?:逍遙遊|齊物論|養生主|人間世|德充符|大宗師|應帝王|駢拇|馬蹄|胠篋|在宥|天地|天道|天運|刻意|繕性|秋水|至樂|達生|山木|田子方|知北游|知北遊|庚桑楚|徐無鬼|則陽|外物|寓言|讓王|盜跖|說劍|漁父|列禦寇|列御寇|天下)第" + _NUM,
    23864: r"(?:始計|作戰|謀攻|軍形|兵勢|虛實|軍爭|九變|行軍|地形|九地|火攻|用間)第" + _NUM,
    7337: r"(?:老子[道德]經\s+)?第" + _NUM + r"章",
}


def _document(pg_id: int, raw: bytes, part: int | None) -> str:
    if type(pg_id) is not int or pg_id not in _FIRST_ELEMENT:
        raise ValueError("Unsupported Gutenberg Chinese source ID")
    if part is not None and (pg_id != 24264 or type(part) is not int or part not in (1, 2, 3)):
        raise ValueError("Only Red Chamber parts 1, 2, and 3 are supported")
    if not isinstance(raw, bytes):
        raise TypeError("Source must be original UTF-8 bytes")
    return raw.decode("utf-8")


def _scope_bounds(pg_id: int, html: str, part: int | None) -> tuple[int, int]:
    first = re.search(
        r"<p\b(?=[^>]*\sid=[\"']" + _FIRST_ELEMENT[pg_id] + r"[\"'])[^>]*>",
        html, re.I,
    )
    footer = re.search(r"<footer\b(?=[^>]*\sid=[\"']pg-footer[\"'])[^>]*>", html, re.I)
    if first is None or footer is None or first.start() >= footer.start():
        raise ValueError("Reviewed author-text HTML boundaries are missing or out of order")
    start, end = first.start(), footer.start()
    if part is not None:
        # The chapter text can begin *inside* a p. Do not serialize or rebuild it.
        scope = html[start:end]
        boundaries = {}
        for ordinal, token in [(41, "第四十一回"), (81, "第八十一回")]:
            match = re.search(r"(?:^|\n|>)[ \t\u3000]*(" + token + r")(?=\s|<)", scope)
            if match is None:
                raise ValueError("Red Chamber volume boundary is missing: " + token)
            boundaries[ordinal] = start + match.start(1)
        if boundaries[41] >= boundaries[81]:
            raise ValueError("Red Chamber volume boundaries are out of order")
        start, end = {
            1: (start, boundaries[41]),
            2: (boundaries[41], boundaries[81]),
            3: (boundaries[81], end),
        }[part]
    return start, end


def source_scope(pg_id: int, raw: bytes, part: int | None = None) -> str:
    """Select the declared original HTML range, without reconstructing its text."""
    html = _document(pg_id, raw, part)
    start, end = _scope_bounds(pg_id, html, part)
    return html[start:end]


def _normalize_space(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def _paragraphs(value: str) -> list[str]:
    # Blank lines retain upstream p separation; full-width indentation marks
    # explicit paragraphs inside the source's unusually large p elements.
    return [
        normalized
        for block in re.split(r"\n[ \t\r\u3000]*\n|\n(?=[ \t]*\u3000)", value)
        if (normalized := _normalize_space(block))
    ]


def _number(value: str) -> int:
    digits = {c: n for n, c in enumerate("零一二三四五六七八九")}
    digits["〇"] = 0
    if "十" not in value and "百" not in value:
        return int("".join(str(digits.get(c, c)) for c in value))
    total = digit = 0
    for char in value:
        if char in digits:
            digit = digits[char]
        else:
            total += (digit or 1) * {"十": 10, "百": 100}[char]
            digit = 0
    return total + digit


def _divider(line: str) -> bool:
    return bool(re.fullmatch(r"[—_\-]+", line.strip()))


def _red_heading(text: str, match: re.Match) -> tuple[str, int]:
    """Return a navigation title and the end of its untouched heading block."""
    start = match.start("heading")
    line_end = text.find("\n", start)
    if line_end < 0:
        line_end = len(text)
    suffix = text[match.end("heading"):line_end]
    narration = suffix.find("話說")
    if narration >= 0:
        end = match.end("heading") + narration
        return _normalize_space(text[start:end]), end
    end = line_end
    title = text[start:line_end]
    if not suffix.strip():
        # Source chapters 3–11 put the subtitle after printed divider lines.
        cursor = line_end
        while cursor < len(text):
            cursor += 1
            stop = text.find("\n", cursor)
            if stop < 0:
                stop = len(text)
            line = text[cursor:stop]
            if line.strip() and not _divider(line):
                if line.lstrip().startswith(("話說", "卻說")) or len(line.strip()) > 70:
                    raise ValueError("A separate Red Chamber subtitle is missing")
                title += " " + line
                end = stop
                break
            cursor = stop
        else:
            raise ValueError("A separate Red Chamber subtitle is missing")
    # A repeated chapter-45 heading has a divider between its two occurrences.
    # Keep each divider in its original heading block, before all body prose.
    cursor = end
    while cursor < len(text) and text[cursor] == "\n":
        stop = text.find("\n", cursor + 1)
        if stop < 0:
            stop = len(text)
        line = text[cursor + 1:stop]
        if line.strip() and not _divider(line):
            break
        end = stop
        cursor = stop
    return _normalize_space(title), end


def extract(pg_id: int, raw: bytes, part: int | None = None) -> dict:
    """Extract source chapters; do not translate, repair, or modernize prose."""
    html = _document(pg_id, raw, part)
    start, end = _scope_bounds(pg_id, html, part)
    scope = BeautifulSoup(html[start:end], "html.parser")
    if scope.find(["script", "style"]):
        raise ValueError("Unexpected executable/style content inside reviewed author scope")
    for paragraph in scope.find_all("p"):
        paragraph.insert_before("\n\n")
        paragraph.insert_after("\n\n")
    text = scope.get_text("\n")
    if pg_id == 24264:
        matches = list(_RED_MARKER.finditer(text))
    else:
        pattern = re.compile(r"(?m)^[ \t\u3000]*(?P<heading>" + _PATTERNS[pg_id] + r")(?=\s|$)")
        matches = list(pattern.finditer(text))
    if not matches or text[:matches[0].start("heading")].strip():
        raise ValueError("Reviewed chapter headings are missing or preceded by unexpected text")
    chapters = []
    previous_number = None
    for index, match in enumerate(matches):
        heading_start = match.start("heading")
        next_start = matches[index + 1].start("heading") if index + 1 < len(matches) else len(text)
        if pg_id == 24264:
            title, heading_end = _red_heading(text, match)
            ordinal = _number(match.group("number"))
        else:
            heading_end = match.end("heading")
            title = _normalize_space(match.group("heading"))
            if pg_id == 7337:
                title = re.search(r"第" + _NUM + r"章$", title).group()
            ordinal = None
        if heading_end > next_start:
            raise ValueError("A source heading overlaps the next chapter")
        source_heading = text[heading_start:heading_end]
        paragraphs = _paragraphs(text[heading_end:next_start])
        if pg_id == 24264 and ordinal == previous_number:
            if ordinal != 45 or chapters[-1]["paragraphs"]:
                raise ValueError("Unexpected repeated Red Chamber chapter heading")
            chapters[-1]["sourceHeadings"].append(source_heading)
            chapters[-1]["paragraphs"].extend(paragraphs)
        else:
            chapters.append({"title": title, "kind": "body", "sourceHeadings": [source_heading], "paragraphs": paragraphs})
        previous_number = ordinal
    original = BeautifulSoup(html, "html.parser")
    notices = "\n\n".join(element.get_text("\n", strip=True) for element in original.select("#pg-header,#pg-footer"))
    return {
        "chapters": chapters,
        "notices": notices,
        "normalization": [
            "Only whitespace and paragraph layout are normalized; all non-whitespace source characters remain in sequence.",
            "sourceHeadings retains original heading blocks, including printed dividers; title is only the navigation label.",
            "No character conversion, missing-glyph replacement, spelling repair, translation, or source collation is performed.",
        ],
    }
