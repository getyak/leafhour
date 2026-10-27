"""Fixture tests for source-faithful philosophy extraction.

These cases catch loss of nested prose, verse, non-paragraph notes and source
order. Real cached editions are verified separately without network access.
"""
from html.parser import HTMLParser
import importlib.util
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / "tools" / "classic_philosophy.py"
if MODULE.exists():
    spec = importlib.util.spec_from_file_location("classic_philosophy", MODULE)
    subject = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(subject)
else:
    subject = None


def document(body):
    return ("<!doctype html><html><body>"
            '<header id="pg-header"><h2>Gutenberg edition</h2>'
            '<p>Translator credit.</p></header>' + body +
            '<footer id="pg-footer"><p>END OF EBOOK</p>'
            '<h2>FULL LICENSE</h2><p>Permission and conditions.</p></footer>'
            '</body></html>').encode()


class VisibleText(HTMLParser):
    """Independent audit: no extraction helpers or output paragraphs are used."""
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.pieces = []
        self.hidden = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self.hidden += 1

    def handle_endtag(self, tag):
        if tag in ("script", "style"):
            self.hidden -= 1

    def handle_data(self, data):
        if not self.hidden:
            self.pieces.append(data)


def norm_scope(scope):
    parser = VisibleText()
    parser.feed(scope)
    return re.sub(r"\s+", "", "".join(parser.pieces))


def norm_result(result):
    values = []
    for chapter in result["chapters"]:
        values.extend(chapter["sourceHeadings"])
        values.extend(chapter["paragraphs"])
    return re.sub(r"\s+", "", "".join(values))


class ClassicPhilosophyTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(subject, "The source-faithful extractor is not implemented")

    def check_coverage(self, pg_id, raw, part=None):
        result = subject.extract(pg_id, raw, part)
        self.assertEqual(norm_scope(subject.source_scope(pg_id, raw, part)),
                         norm_result(result))
        return result

    def test_rejects_unknown_books_held_pascal_and_unexpected_parts(self):
        raw = document("<p>Never imported.</p>")
        for pg_id, part in [(9999, None), (18269, None), (1497, 1),
                            (3600, None), (3600, 0), (3600, 4), (3600, True)]:
            for api in (subject.extract, subject.source_scope):
                with self.subTest(pg_id=pg_id, part=part, api=api.__name__):
                    with self.assertRaises(ValueError):
                        api(pg_id, raw, part)

    def test_nested_chapter_prose_bare_text_and_inline_words_are_preserved(self):
        raw = document('<h2>Contents</h2><p>Navigation only.</p>'
                       '<div class="chapter"><h2><a id="link2H_4_0003"></a>'
                       'PERSONS OF THE DIALOGUE.</h2><div>Socrates.</div></div>'
                       '<div class="chapter"><h2><a id="link2H_4_0004"></a>'
                       'BOOK I.</h2><div>Bare opening. <p>The s<em>oul</em> ' 
                       'is questioned.</p><div>Nested conclusion.</div></div></div>')
        result = self.check_coverage(1497, raw)
        text = "\n".join(p for c in result["chapters"] for p in c["paragraphs"])
        self.assertIn("The soul is questioned.", text)
        self.assertIn("Bare opening.", text)
        self.assertIn("Nested conclusion.", text)
        self.assertNotIn("Navigation only.", text)
        self.assertEqual(result["chapters"][0]["kind"], "frontmatter")
        self.assertEqual(result["chapters"][-1]["sourceHeadings"], ["BOOK I."])

    def test_heading_container_does_not_swallow_nested_body_paragraph(self):
        raw = document('<h2><a id="note"></a>AUTHOR PREFACE</h2><p>Opening.</p>'
                       '<h2><a id="part1"></a>PART I<div><p>Nested body sentence.</p>'
                       '</div></h2>')
        result = self.check_coverage(59, raw)
        self.assertEqual(result["chapters"][-1]["sourceHeadings"], ["PART I"])
        self.assertEqual(result["chapters"][-1]["paragraphs"], ["Nested body sentence."])

    def test_republic_digitizer_cover_notice_is_retained_outside_author_body(self):
        raw = document('<h2><a id="link2H_4_0003"></a>PERSONS OF THE DIALOGUE.</h2>'
                       '<p>Socrates.</p><h2>BOOK X.</h2><p>Author final words.</p>'
                       '<div><div><b>Transcriber’s Notes</b></div><ul>'
                       '<li>New original cover art is public domain.</li></ul></div>')
        result = self.check_coverage(1497, raw)
        self.assertEqual(result["chapters"][-1]["paragraphs"], ["Author final words."])
        self.assertNotIn("Transcriber", subject.source_scope(1497, raw))
        self.assertIn("Transcriber’s Notes", result["notices"])
        self.assertIn("New original cover art is public domain.", result["notices"])

    def test_preformatted_verse_keeps_internal_blank_lines(self):
        raw = document('<h2><a id="chap02"></a>DISCOURSES.</h2>'
                       '<p>OF CHOICE.—Choose carefully.</p><p>TO NASO.—A shorter heading.</p>'
                       '<h2><a id="chap03"></a>THE MANUAL.</h2><h3>LII.</h3>'
                       '<pre>First line\n\nSecond line\n  An indented note.</pre>')
        result = self.check_coverage(10661, raw)
        poems = [p for c in result["chapters"] for p in c["paragraphs"]
                 if "First line" in p]
        self.assertEqual(poems, ["First line\n\nSecond line\n  An indented note."])
        self.assertEqual(sum(c.get("titleAttribution") == "editorial"
                             for c in result["chapters"]), 2)
        self.assertTrue(any(c["title"] == "TO NASO" for c in result["chapters"]))

    def test_source_notes_remain_distinct_from_aristotle_body(self):
        raw = document('<h2><a id="pref01"></a>Modern editor intro.</h2>'
                       '<p>Do not import this introduction.</p>'
                       '<div><h2><a id="chap01"></a>BOOK I</h2>'
                       '<h3>Chapter I.</h3><p>Every art has an aim.</p></div>'
                       '<div><h2><a id="chap11"></a>NOTES</h2>'
                       '<h3>BOOK I</h3><p class="footnote">[1] Edition note.</p></div>')
        result = self.check_coverage(8438, raw)
        self.assertEqual([c["kind"] for c in result["chapters"]], ["body", "appendix"])
        self.assertIn("[1] Edition note.", result["chapters"][1]["paragraphs"])
        self.assertNotIn("Do not import", str(result))

    def test_author_prefatory_note_is_retained_and_notices_are_full_plain_text(self):
        raw = document('<h2>Contents</h2><p>Skip navigation.</p>'
                       '<div><h2><a id="note"></a>PREFATORY NOTE BY THE AUTHOR</h2>'
                       '<p>My intended order.</p></div><div><h2><a id="part1"></a>'
                       'PART I</h2><p>Good sense.</p></div>')
        result = self.check_coverage(59, raw)
        self.assertEqual(result["chapters"][0]["kind"], "frontmatter")
        self.assertEqual(result["chapters"][0]["paragraphs"], ["My intended order."])
        self.assertIsInstance(result["notices"], str)
        self.assertIn("Translator credit.", result["notices"])
        self.assertIn("FULL LICENSE", result["notices"])
        self.assertIn("Permission and conditions.", result["notices"])
        self.assertNotIn("<p>", result["notices"])

    def test_spinoza_retains_long_endnote_and_declares_inline_copy_selection(self):
        raw = document('<a id="chap01"></a><h2>PART I.</h2><h3>DEFINITIONS.</h3>'
                       '<p>A definition.</p><p class="footnote">[16] Short copy.</p>'
                       '<a id="chap05"></a><h4>PART V:</h4><p>Author conclusion.</p>'
                       '<p class="finis">End of the Ethics</p>'
                       '<p class="footnote">[16] Short copy. Additional original words.</p>')
        result = self.check_coverage(3800, raw)
        text = " ".join(p for c in result["chapters"] for p in c["paragraphs"])
        self.assertEqual(text.count("Short copy."), 1)
        self.assertIn("Additional original words.", text)
        self.assertEqual(result["chapters"][-1]["kind"], "appendix")
        self.assertTrue(result["scopeNotes"])
        self.assertIn("Additional original words.", subject.source_scope(3800, raw))

    def test_spinoza_refuses_to_remove_inline_words_without_complete_appended_copy(self):
        for appended in ["", '<p class="footnote">[16] A shorter replacement.</p>']:
            raw = document('<a id="chap01"></a><h2>PART I</h2><p>Author text.</p>'
                           '<p class="footnote">[16] Original note words.</p>'
                           '<p class="finis">End of the Ethics</p>' + appended)
            with self.subTest(appended=appended):
                with self.assertRaises(ValueError):
                    subject.source_scope(3800, raw)

    def test_hume_keeps_nonparagraph_note_labels_and_nested_note_text(self):
        raw = document('<h2>CONTENTS</h2><p>Table only.</p>'
                       '<h2><a id="section1"></a>SECTION I.</h2><h3>OF IDEAS.</h3>'
                       '<p>Experience.</p><h2><a id="footnotes"></a>FOOTNOTES.</h2>'
                       '<blockquote class="footnote"><div><b>Footnote 1</b>: '
                       '<a href="#footnotetag1">(return)</a>'
                       '<p>Substantive author note.</p><div>More note text.</div></div>'
                       '</blockquote><h2><a id="index"></a>INDEX</h2><p>Index only.</p>')
        result = self.check_coverage(9662, raw)
        self.assertEqual(result["chapters"][-1]["kind"], "appendix")
        text = str(result["chapters"])
        self.assertIn("Footnote 1:", text)
        self.assertIn("Substantive author note.", text)
        self.assertIn("More note text.", text)
        self.assertNotIn("Index only", text)
        self.assertNotIn("(return)", text)

    def test_montaigne_partitions_keep_letters_reader_preface_and_source_pre_notes(self):
        raw = document('<h2>CONTENTS</h2><p>Navigation.</p><h2>PREFACE</h2>'
                       '<p>Later editorial introduction.</p>'
                       '<a id="link2H_4_0003"></a><h2>I.—To my father.</h2><p>Letter.</p>'
                       '<pre>THE AUTHOR TO THE READER.</pre><p>Reader, this book.</p>'
                       '<h2>ESSAYS OF MONTAIGNE</h2><h3>Edited by Hazlitt</h3>'
                       '<a id="link2HCH0001"></a><h2>CHAPTER I—EXPERIENCE</h2>'
                       '<div>Body one.<pre>Latin line.\n\n[Old source note.]</pre></div>'
                       '<a id="link2H_4_0077"></a><h2>BOOK THE SECOND</h2>'
                       '<h2>CHAPTER I—CHANGE</h2><p>Body two.</p>'
                       '<a id="link2H_4_0114"></a><h2>BOOK THE THIRD</h2>'
                       '<h2>CHAPTER I—LIFE</h2><p>Body three.</p>'
                       '<a id="link2H_4_0128"></a><h2>APOLOGY:</h2><p>Later duplication.</p>')
        first = self.check_coverage(3600, raw, 1)
        self.assertIn("Letter.", str(first["chapters"]))
        self.assertIn("Reader, this book.", str(first["chapters"]))
        self.assertIn("Latin line.\\n\\n[Old source note.]", str(first["chapters"]))
        self.assertNotIn("Later editorial introduction.", str(first))
        self.assertEqual(sum(c["kind"] == "body" for c in first["chapters"]), 1)
        for part, expected in [(2, "Body two."), (3, "Body three.")]:
            result = self.check_coverage(3600, raw, part)
            self.assertIn(expected, str(result["chapters"]))
            self.assertNotIn("Letter.", str(result["chapters"]))
            self.assertNotIn("Later duplication.", str(result["chapters"]))

    def test_bacon_includes_non_p_poems_tables_notes_and_removes_only_toc(self):
        raw = document('<h2><a id="Preface">PREFACE</a></h2><p>Author preface.</p>'
                       '<h3>FOOTNOTE</h3><p class="footnote"><a id="Footnote-1"></a>'
                       '[1] Old editor note.</p><h2><a id="Contents">CONTENTS</a></h2>'
                       '<div class="contents">Navigation is not body.</div>'
                       '<h2><a id="Book-I">APHORISMS—BOOK I</a></h2>'
                       '<p>I. First aphorism.</p><div class="poem"><div class="stanza">'
                       '<span>A Latin line.</span><br><br><span>Another line.</span>'
                       '</div></div><p>II. Second aphorism.</p><h3>FOOTNOTES</h3>'
                       '<div class="label-left"><a id="Footnote-83"></a>[83]</div>'
                       '<table><tr><td>Rarefaction.</td><td>Condensation.</td></tr></table>'
                       '<h2><a id="Book-II">APHORISMS—BOOK II</a></h2>'
                       '<p>I. Third aphorism.</p><div>Bare continuation.</div>'
                       '<h3>FOOTNOTES</h3><div class="label-left">'
                       '<a id="Footnote-138"></a>[138]</div><div class="poem">'
                       '<span>Verse in note.</span></div>'
                       '<div class="transnote"><p>Modern transcription note.</p></div>')
        result = self.check_coverage(45988, raw)
        text = "\n".join(p for c in result["chapters"] for p in c["paragraphs"])
        for expected in ["Author preface.", "[83]", "Rarefaction.", "Condensation.",
                         "[138]", "Verse in note.", "Bare continuation."]:
            self.assertIn(expected, text)
        self.assertIn("A Latin line.\n\nAnother line.", text)
        self.assertNotIn("Navigation is not body.", text)
        self.assertNotIn("Modern transcription note.", text)
        self.assertTrue(any(c.get("titleAttribution") == "editorial"
                            for c in result["chapters"]))

    def test_augustine_source_title_is_not_duplicated_into_paragraphs(self):
        raw = document('<p>CONTENTS</p><p>BOOK I</p><h2>BOOK I</h2>'
                       '<div><p>Great art Thou.</p></div><h2>BOOK XIII</h2>'
                       '<p>Amen.</p>')
        result = self.check_coverage(3296, raw)
        self.assertEqual(result["chapters"][0]["sourceHeadings"], ["BOOK I"])
        self.assertEqual(result["chapters"][0]["paragraphs"], ["Great art Thou."])

    def test_prince_dedication_and_appended_author_works_have_distinct_kinds(self):
        raw = document('<h2>Contents</h2><p>Navigation.</p><h2><a id="pref06"></a>'
                       'DEDICATION</h2><p>To Lorenzo.</p><h2><a id="chap00"></a>'
                       'THE PRINCE</h2><h2><a id="chap01"></a>CHAPTER I</h2>'
                       '<p>Principalities.</p><h2><a id="chap27"></a>DUKE VALENTINO</h2>'
                       '<p>First appendix.</p><h2><a id="chap28"></a>CASTRUCCIO</h2>'
                       '<p>Second appendix.</p><div><div><b>Transcriber’s Notes</b></div>'
                       '<ul><li>New cover art.</li></ul></div>')
        result = self.check_coverage(1232, raw)
        self.assertEqual([c["kind"] for c in result["chapters"]],
                         ["frontmatter", "body", "appendix", "appendix"])
        self.assertNotIn("New cover art.", str(result["chapters"]))

    def test_scope_is_selected_html_not_rebuilt_paragraph_output(self):
        raw = document('<h2><a id="note"></a>PREFATORY NOTE BY THE AUTHOR</h2>'
                       '<p data-evidence="exact">A <i>visible</i> phrase.'
                       '<span class="pagenum">[44]</span></p>'
                       '<h2><a id="part1"></a>PART I</h2><p>Continue.</p>')
        scope = subject.source_scope(59, raw)
        self.assertIn('data-evidence="exact"', scope)
        self.assertIn('<i>visible</i>', scope)
        self.assertNotIn('[44]', scope)
        self.check_coverage(59, raw)


if __name__ == "__main__":
    unittest.main()
