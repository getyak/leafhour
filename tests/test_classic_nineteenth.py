import sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from classic_nineteenth import extract,source_scope

class NineteenthSourceTests(unittest.TestCase):
 def test_source_headings_bare_text_and_verse_are_retained_in_order(self):
  raw=b'''<html><body><header id="pg-header">PROJECT GUTENBERG credit</header><p>Publisher preliminaries</p><h2>INTRODUCTION.</h2><p>Author introduction.</p><h2>THE WISDOM OF LIFE.</h2><h2>CHAPTER I. DIVISION</h2><p>First <i>complete</i> paragraph.</p><div>Bare source prose.</div><pre>First line\n\nSecond line</pre><h2>CHAPTER II. PERSONALITY</h2><p>Second.</p><h2>CHAPTER III. PROPERTY</h2><p>Third.</p><h2>CHAPTER IV. POSITION</h2><p>Fourth.</p><footer id="pg-footer">Full source licence.</footer></body></html>'''
  result=extract(10741,raw)
  self.assertEqual([c['kind'] for c in result['chapters']],['frontmatter','body','body','body','body'])
  paragraphs=[p for c in result['chapters'] for p in c['paragraphs']]
  self.assertIn('Bare source prose.',paragraphs)
  self.assertIn('First line\n\nSecond line',paragraphs)
  self.assertNotIn('Publisher preliminaries',' '.join(paragraphs))
  self.assertIn('Full source licence.',result['notices'])
  self.assertIn('THE WISDOM OF LIFE.',source_scope(10741,raw))

 def test_numbered_heading_that_contains_prose_is_not_discarded(self):
  raw=b'''<html><body><h2>INTRODUCTION.</h2><p>Translator's introduction.</p><h2>CHAPTER I. GENERAL RULES</h2><h2>SECTION 1. A source sentence in a heading.</h2><p>The rest of its argument.</p><h2>CHAPTER V. THE AGES OF LIFE.</h2><p>Last author paragraph.</p></body></html>'''
  result=extract(10715,raw)
  self.assertIn('SECTION 1. A source sentence in a heading.',result['chapters'][1]['paragraphs'])

 def test_heading_container_does_not_swallow_nested_argument(self):
  raw=b'''<html><body><h1>Appendix: Criticism of the Kantian Philosophy.</h1><p>Opening argument.</p><h1>Supplements to the First Book.</h1><h2>Chapter I. Idealism.<p>Argument inside malformed heading.</p></h2><p>Argument after heading.</p><h1>Footnotes</h1><div>1. A source note.</div></body></html>'''
  result=extract(40097,raw)
  text=' '.join(p for c in result['chapters'] for p in c['paragraphs'])
  self.assertIn('Argument inside malformed heading.',text)
  self.assertIn('1. A source note.',text)

 def test_unknown_source_or_partition_is_rejected(self):
  with self.assertRaises(ValueError):extract(1,b'<p>Untrusted unrelated source.</p>')
  with self.assertRaises(ValueError):extract(10741,b'<p>Source.</p>',part=2)

 def test_bare_literal_angle_brackets_remain_author_text(self):
  raw=b'<h2>INTRODUCTION.</h2><p>Source introduction.</p><h2>CHAPTER I. SOURCE</h2><div>Keep x &lt; y and literal &lt;proof&gt; notation.</div>'
  result=extract(10741,raw)
  self.assertIn('Keep x < y and literal <proof> notation.',result['chapters'][1]['paragraphs'])

 def test_table_emphasis_does_not_insert_spaces_before_punctuation(self):
  raw=b'<h2>INTRODUCTION.</h2><p>Source.</p><h2>CHAPTER I. SOURCE</h2><table><tr><td>Called <i>Substance</i>.</td><td>Second cell.</td></tr></table>'
  result=extract(10741,raw);self.assertIn('Called Substance.',result['chapters'][1]['paragraphs'][0]);self.assertEqual(result['layouts']['1:0']['presentation'],'preformatted')

if __name__=='__main__':unittest.main()
