"""Reproduce curator-owned classic editions; no network, model or account access."""
import hashlib,re
from pathlib import Path
from html.parser import HTMLParser
from classic_chinese import extract as chinese,source_scope as chinese_scope
from classic_philosophy import extract as philosophy,source_scope as philosophy_scope
from classic_world import extract as world,source_scope as world_scope
from classic_nineteenth import extract as nineteenth,source_scope as nineteenth_scope

FAMILIES={'chinese':(chinese,chinese_scope),'philosophy':(philosophy,philosophy_scope),'world':(world,world_scope),'nineteenth':(nineteenth,nineteenth_scope)}
def recipe(document):
 r=document.get('extraction')
 if not isinstance(r,dict) or r.get('family') not in FAMILIES or type(r.get('sourceId')) is not int or r.get('part') is not None and type(r['part']) is not int:raise ValueError('Invalid classic extraction recipe')
 return r
def source_bytes(document,cache):
 r=recipe(document);raw=(Path(cache)/(str(r['sourceId'])+'.html')).read_bytes()
 if hashlib.sha256(raw).hexdigest()!=document['downloadSha256']:raise ValueError('Pinned classic source changed')
 return raw
def compile_document(document,cache):
 r=recipe(document);raw=source_bytes(document,cache);compiled=FAMILIES[r['family']][0](r['sourceId'],raw,r.get('part'))
 if not isinstance(compiled.get('notices'),str):raise ValueError('Classic source notices must be text')
 result={**document,'chapters':compiled['chapters'],'notices':compiled['notices']}
 if compiled.get('layouts'):result['layouts']=compiled['layouts']
 else:result.pop('layouts',None)
 supplement=document.get('noticeSupplement')
 if supplement:
  if not isinstance(supplement.get('text'),str) or not supplement['text'].strip() or not str(supplement.get('sourceUrl','')).startswith('https://www.gutenberg.org/'):raise ValueError('Invalid source-licence supplement')
  result['notices']+='\n\n'+supplement['text']
 for resource in document.get('resources',[]):
  try:paragraph=result['chapters'][resource['chapterIndex']]['paragraphs'][resource['paragraphIndex']]
  except (KeyError,IndexError,TypeError):raise ValueError('Source resource binding is missing')
  if hashlib.sha256(paragraph.encode()).hexdigest()!=resource.get('anchorSha256'):raise ValueError('Source resource paragraph binding changed')
 return result

class SourceText(HTMLParser):
 """Independent source text traversal, not the paragraph extraction algorithm."""
 blocks=set('html body div p section article main header footer aside blockquote pre h1 h2 h3 h4 h5 h6 table tr td th li ul ol dl dt dd figure figcaption address hr'.split())
 def __init__(self):super().__init__(convert_charrefs=True);self.parts=[];self.skip=0
 def handle_starttag(self,tag,attrs):
  if tag in ('script','style'):self.skip+=1
  if tag in self.blocks or tag=='br':self.parts.append(' ')
 def handle_endtag(self,tag):
  if tag in ('script','style'):self.skip=max(0,self.skip-1)
  if tag in self.blocks:self.parts.append(' ')
 def handle_data(self,data):
  if not self.skip:self.parts.append(data)
def audited_text(document,raw):
 r=recipe(document);parser=SourceText();parser.feed(FAMILIES[r['family']][1](r['sourceId'],raw,r.get('part')));return ''.join(parser.parts)
def audit_document(document,raw,language='en'):
 source=audited_text(document,raw);target=' '.join(t for c in document['chapters'] for t in [*c.get('sourceHeadings',[]),*c['paragraphs']])
 normalize=(lambda x:re.sub(r'\s+','',x)) if language=='zh' else (lambda x:re.sub(r'\s+',' ',x).strip())
 a,b=normalize(source),normalize(target)
 if a==b:return {'status':'pass','sourceChars':len(a),'targetChars':len(b),'normalization':'non-whitespace characters' if language=='zh' else 'collapsed layout whitespace'}
 at=next((i for i,(x,y) in enumerate(zip(a,b)) if x!=y),min(len(a),len(b)))
 return {'status':'fail','sourceChars':len(a),'targetChars':len(b),'firstDifference':at,'sourceContext':a[max(0,at-80):at+160],'targetContext':b[max(0,at-80):at+160]}
