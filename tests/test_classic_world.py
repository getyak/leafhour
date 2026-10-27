"""Fixture tests for faithful public-domain source extraction (no network)."""
from pathlib import Path
import importlib.util
import re
import unittest

from bs4 import BeautifulSoup

MODULE = Path(__file__).resolve().parents[1] / 'tools' / 'classic_world.py'


def document(content):
    return ('<html><head><title>site title</title></head><body>'
            '<header id="pg-header"><p>PG header</p></header>'
            + content + '<footer id="pg-footer"><p>PG footer</p></footer>'
            '</body></html>').encode('utf-8')


def norm(value):
    return re.sub(r'\s+', '', value)


class ClassicWorldTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue(MODULE.exists(), 'source extractor is not implemented')
        spec = importlib.util.spec_from_file_location('classic_world', MODULE)
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)

    def assert_conserved(self, pg_id, raw, result):
        source = BeautifulSoup(self.module.source_scope(pg_id, raw), 'html.parser')
        original = source.get_text('')
        compiled = ''.join(''.join(c['sourceHeadings']) + ''.join(c['paragraphs'])
                           for c in result['chapters'])
        self.assertEqual(norm(original), norm(compiled))
        for c in result['chapters']:
            self.assertIn(c['kind'], ('body', 'frontmatter', 'appendix'))
            if c.get('titleAttribution') == 'editorial':
                self.assertIsInstance(c['title'], str)

    def test_rejects_wrong_ids_and_undeclared_parts(self):
        raw = document('<h1>A source</h1><p>Text.</p>')
        for pg_id in [714, 1228, 0]:
            with self.subTest(pg_id=pg_id):
                with self.assertRaises(ValueError):
                    self.module.extract(pg_id, raw)
                with self.assertRaises(ValueError):
                    self.module.source_scope(pg_id, raw)
        with self.assertRaises(ValueError):
            self.module.extract(3300, raw, part='invented-volume')

    def test_scope_excludes_navigation_and_notices_without_losing_cast(self):
        raw = document('<div>before-title furniture</div><h1>HAMLET</h1>'
                       '<h2>by William Shakespeare</h2><div class="chapter">'
                       '<h2>Contents</h2><table><tr><td>navigation only</td></tr></table>'
                       '<h3>Dramatis Personæ</h3><p>HAMLET, Prince of Denmark</p></div>'
                       '<div class="chapter"><h2>ACT I</h2><h3>SCENE I.</h3>'
                       '<p>Who’s there?</p></div>'
                       '<div><h3>Transcriber’s Notes</h3><p>cover notice</p></div>')
        result = self.module.extract(1524, raw)
        scope = self.module.source_scope(1524, raw)
        self.assertNotIn('navigation only', scope)
        self.assertNotIn('before-title furniture', scope)
        self.assertNotIn('cover notice', scope)
        self.assertIn('HAMLET, Prince of Denmark', scope)
        self.assertEqual(result['notices'], 'PG header\n\nPG footer')
        self.assert_conserved(1524, raw, result)

    def test_hamlet_keeps_speakers_stage_directions_and_explicit_verse_lines(self):
        raw = document('<h1>HAMLET</h1><div class="chapter"><h2>ACT I</h2>'
                       '<h3>SCENE I. A platform.</h3>'
                       '<p class="scenedesc">Enter <span>Francisco</span> and Barnardo.</p>'
                       '<p class="drama">BARNARDO.<br>Who’s there?<br><br>Stand.</p>'
                       '<p class="right">[Exit <i>Francisco</i>.]</p>'
                       '<h3>SCENE II. A room.</h3><p class="drama">KING.<br>Attend.<br></p>'
                       '</div>')
        result = self.module.extract(1524, raw)
        body = [c for c in result['chapters'] if c['kind'] == 'body']
        self.assertEqual(len(body), 2)
        self.assertEqual(body[0]['sourceHeadings'], ['ACT I', 'SCENE I. A platform.'])
        self.assertEqual(body[0]['paragraphs'], ['Enter Francisco and Barnardo.',
                         'BARNARDO.\nWho’s there?\n\nStand.', '[Exit Francisco.]'])
        self.assertNotIn('ACT I', body[1]['sourceHeadings'])
        self.assertEqual(body[1]['paragraphs'], ['KING.\nAttend.\n'])
        self.assert_conserved(1524, raw, result)

    def test_odyssey_keeps_dedication_signed_prefaces_and_all_note_paragraphs(self):
        raw = document('<h1>The Odyssey</h1><h2>by Homer</h2>'
                       '<div class="chapter"><p>AL PROFESSORE<br>L’AUTORE.</p></div>'
                       '<div class="chapter"><h2>PREFACE TO FIRST EDITION</h2>'
                       '<p>Preface one.</p><p>S. BUTLER.</p></div>'
                       '<div class="chapter"><h2>PREFACE TO SECOND EDITION</h2>'
                       '<p>Preface two.</p><p>HENRY FESTING JONES.</p></div>'
                       '<div class="chapter"><h2>THE ODYSSEY</h2></div>'
                       '<div class="chapter"><h2>BOOK I</h2><p>Tell me, O Muse.<sup>[1]</sup></p></div>'
                       '<div class="chapter"><h2>BOOK XXIV</h2><p>A covenant of peace.</p></div>'
                       '<div class="chapter"><h2>FOOTNOTES:</h2><p><a id="linknote-1"></a></p>'
                       '<p class="footnote"><a href="#ref1">[1]</a><br>[ A complete note.</p>'
                       '<p class="footnote">Its second paragraph. ]</p></div>')
        result = self.module.extract(1727, raw)
        body = [c for c in result['chapters'] if c['kind'] == 'body']
        self.assertEqual(len(body), 2)
        self.assertEqual(body[0]['sourceHeadings'], ['THE ODYSSEY', 'BOOK I'])
        self.assertEqual(result['chapters'][-1]['kind'], 'appendix')
        self.assertEqual(result['chapters'][-1]['paragraphs'],
                         ['[1]\n[ A complete note.', 'Its second paragraph. ]'])
        self.assertIn('HENRY FESTING JONES.', [p for c in result['chapters'] for p in c['paragraphs']])
        self.assert_conserved(1727, raw, result)

    def test_crime_skips_flat_link_toc_but_keeps_preface_epilogue_and_translator_note(self):
        raw = document('<h1>CRIME AND PUNISHMENT</h1><div class="h3">Translated By Constance Garnett</div>'
                       '<div>CONTENTS</div><p><a href="#p">navigation preface</a></p>'
                       '<div class="chapter"><h2>TRANSLATOR’S PREFACE</h2><p>A few words.</p></div>'
                       '<div class="chapter"><h2>CRIME AND PUNISHMENT</h2></div>'
                       '<div class="chapter"><h2>PART I</h2></div>'
                       '<div class="chapter"><h2>CHAPTER I</h2><p>On a hot evening.</p>'
                       '<p class="footnote">[*] Note.—TRANSLATOR’S NOTE.</p></div>'
                       '<div class="chapter"><h2>EPILOGUE</h2><h3>I</h3><p>Siberia.</p>'
                       '<h3>II</h3><p>Our present story is ended.</p></div><div>.</div>')
        result = self.module.extract(2554, raw)
        body = [c for c in result['chapters'] if c['kind'] == 'body']
        self.assertEqual(len(body), 3)
        self.assertEqual(body[0]['sourceHeadings'], ['CRIME AND PUNISHMENT', 'PART I', 'CHAPTER I'])
        self.assertEqual(body[-2]['sourceHeadings'], ['EPILOGUE', 'I'])
        self.assertEqual(body[-1]['sourceHeadings'], ['II'])
        self.assertIn('TRANSLATOR’S NOTE.', body[0]['paragraphs'][-1])
        self.assertNotIn('navigation preface', self.module.source_scope(2554, raw))
        self.assert_conserved(2554, raw, result)

    def test_wealth_keeps_book_introductions_and_exact_preformatted_whitespace(self):
        table = '\n Year\t £   s   d\n\n 1202\t 0  12   0\n \n'
        raw = document('<h1>Wealth of Nations</h1>'
                       '<div class="chapter"><h2>INTRODUCTION AND PLAN OF THE WORK.</h2><p>Annual labour.</p></div>'
                       '<div class="chapter"><h2>BOOK I. LABOUR.</h2></div>'
                       '<div class="chapter"><h2>CHAPTER I. DIVISION.</h2><p>Division of labour.</p>'
                       '<div class="pre">'+table+'</div></div>'
                       '<div class="chapter"><h2>BOOK II. STOCK.</h2><h3>INTRODUCTION.</h3><p>Book two intro.</p></div>'
                       '<div class="chapter"><h2>CHAPTER I. STOCK.</h2><p>Stock text.</p></div>'
                       '<div class="chapter"><h2>BOOK IV. SYSTEMS.</h2><p>Book four intro.</p></div>')
        result = self.module.extract(3300, raw)
        all_text = [p for c in result['chapters'] for p in c['paragraphs']]
        self.assertIn('Book two intro.', all_text)
        self.assertIn('Book four intro.', all_text)
        self.assertIn(table, all_text)
        positions = [(ci, pi) for ci, c in enumerate(result['chapters']) for pi, p in enumerate(c['paragraphs']) if p == table]
        ci, pi = positions[0]
        self.assertEqual(result['layouts'][f'{ci}:{pi}']['presentation'], 'preformatted')
        self.assert_conserved(3300, raw, result)

    def test_darwin_keeps_epigraphs_nested_text_subheadings_table_and_figure_anchor(self):
        raw = document('<p>edition furniture</p><h1>Origin of Species</h1>'
                       '<div class="h3">Sixth London Edition.</div><p>Epigraph.</p><p>WHEWELL.</p>'
                       '<div class="chapter"><h2>AN HISTORICAL SKETCH</h2><p>History.</p></div>'
                       '<div class="chapter"><h2>DETAILED CONTENTS.</h2><p>Chapter synopsis.</p></div>'
                       '<div class="chapter"><h2>ORIGIN OF SPECIES.</h2></div>'
                       '<div class="chapter"><h2>INTRODUCTION.</h2><p>When on board.</p></div>'
                       '<div class="chapter"><h2>CHAPTER IV. NATURAL SELECTION.</h2>'
                       '<p>The accompanying diagram.</p><div class="fig"><a href="images/diagram.jpg">'
                       '<img src="images/diagram.jpg" alt="[Illustration]"></a>'
                       '<p class="caption">A source caption.</p></div>'
                       '<div class="h4">Divergence of Character.</div><section>Rare <em>nested</em> text.</section>'
                       '<table><tr><td>Feet</td><td>57,154.</td></tr></table></div>'
                       '<div class="chapter"><h2>GLOSSARY OF TERMS</h2><p>Mr. W.S. Dallas.</p></div>'
                       '<div class="chapter"><h2>INDEX.</h2><p>Aberrant, 379.<br>Zebra, 128.</p></div>')
        result = self.module.extract(2009, raw)
        text = [p for c in result['chapters'] for p in c['paragraphs']]
        self.assertIn('Epigraph.', text)
        self.assertIn('Rare nested text.', text)
        self.assertIn('A source caption.', text)
        self.assertIn('Divergence of Character.', text)
        self.assertEqual(len(result['resources']), 1)
        resource = result['resources'][0]
        self.assertEqual(resource['originalUrl'], 'https://www.gutenberg.org/cache/epub/2009/images/diagram.jpg')
        self.assertEqual(resource['sha256'], '38f7f352d9b6e801f28ad6c56278cf8dffa105e72533b183a5a3f6d785635038')
        self.assertEqual((resource['bytes'], resource['width'], resource['height']), (257348, 1650, 969))
        self.assertEqual(result['chapters'][resource['chapterIndex']]['paragraphs'][resource['paragraphIndex']], 'The accompanying diagram.')
        self.assert_conserved(2009, raw, result)

    def test_thucydides_keeps_dedication_poem_and_unfinished_ending(self):
        raw = document('<h1>PELOPONNESIAN WAR</h1><h3>Translated by Richard Crawley</h3>'
                       '<p>Respectfully inscribed to Connop Thirlwall.</p>'
                       '<div class="chapter"><h2>BOOK I</h2></div>'
                       '<div class="chapter"><h2>CHAPTER I</h2><p>The State of Greece.</p>'
                       '<p class="poem">The Mede defeated,<br>This monument.</p></div>'
                       '<div class="chapter"><h2>BOOK VIII</h2></div>'
                       '<div class="chapter"><h2>CHAPTER XXVI</h2><p>Offered sacrifice to Artemis....</p>'
                       '<p>[When the winter is over.]</p><p>THE END</p></div>')
        result = self.module.extract(7142, raw)
        body = [c for c in result['chapters'] if c['kind'] == 'body']
        self.assertEqual(len(body), 2)
        self.assertEqual(body[-1]['sourceHeadings'], ['BOOK VIII', 'CHAPTER XXVI'])
        self.assertIn('The Mede defeated,\nThis monument.', body[0]['paragraphs'])
        self.assertEqual(body[-1]['paragraphs'][-2:], ['[When the winter is over.]', 'THE END'])
        self.assert_conserved(7142, raw, result)

    def test_darwin_index_splits_only_at_source_blank_lines_below_passage_limit(self):
        first = '\n  Aberrant ' + 'a' * 13000 + '.\n    —, related forms.\n\n'
        second = '\tZebra ' + 'z' * 13000 + '.\n\n'
        last = '  Zeuglodon, 302.\n'
        index = first + second + last
        # Both the actual p/BR source shape and a preformatted source retain
        # their own entry text. No contemporary description enters paragraphs.
        for source_tag, expected in [
                ('<pre>' + index + '</pre>', [first, second, last]),
                ('<p class="noindent">' + index.replace('\n', '<br>') + '</p>',
                 ['\nAberrant ' + 'a' * 13000 + '.\n—, related forms.\n\n',
                  'Zebra ' + 'z' * 13000 + '.\n\n', 'Zeuglodon, 302.\n'])]:
            with self.subTest(source_tag=source_tag[:5]):
                raw = document('<h1>Origin of Species</h1>'
                               '<div class="chapter"><h2>CHAPTER IV. NATURAL SELECTION.</h2>'
                               '<p>The accompanying diagram.</p><div class="fig">'
                               '<img src="images/diagram.jpg" alt="[Illustration]"></div></div>'
                               '<div class="chapter"><h2>INDEX.</h2>' + source_tag + '</div>')
                result = self.module.extract(2009, raw)
                chapter = result['chapters'][-1]
                self.assertEqual(chapter['paragraphs'], expected)
                self.assertLess(max(map(len, chapter['paragraphs'])), 24000)
                self.assertEqual(''.join(chapter['paragraphs']), ''.join(expected))
                self.assertIn('sourceSegmentation', chapter)
                self.assertEqual((result['resources'][0]['chapterIndex'],
                                  result['resources'][0]['paragraphIndex']), (1, 0))
                self.assert_conserved(2009, raw, result)


if __name__ == '__main__':
    unittest.main()
