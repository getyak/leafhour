"""Offline extraction of the pinned Schopenhauer/Samuel English editions.

Only these curator-selected source IDs are supported. No network or model calls.
Chapter display grouping is separate from source headings used by the audit.
"""
from copy import deepcopy
from html import escape
import re
from bs4 import BeautifulSoup,NavigableString,Comment,Tag

IDS={10741,10715,38427,40097,40868,52319}
BLOCKS=set('p pre h1 h2 h3 h4 h5 h6 div section article main aside blockquote li ul ol dt dd table tr td th tbody thead tfoot figcaption'.split())
LEAVES=set('p h1 h2 h3 h4 h5 h6 li dt dd blockquote figcaption td th'.split())
def norm(value):return re.sub(r'\s+',' ',value).strip()

def _check(pg_id,part):
 if type(pg_id) is not int or pg_id not in IDS or part is not None:raise ValueError('Unsupported nineteenth-century source or partition')

def _start(pg_id,node):
 if not isinstance(node,Tag) or not re.fullmatch(r'h[1-6]',node.name):return False
 t=norm(node.get_text(''))
 if pg_id in {10741,10715}:return t=='INTRODUCTION.'
 if pg_id==38427:return t=="Translators' Preface."
 if pg_id==40097:return t.startswith('Appendix: Criticism of the Kantian')
 if pg_id==40868:return t.startswith('Supplements To The Second')
 return t=='PREFACE.'

def _soup(pg_id,raw,part=None):
 _check(pg_id,part);s=BeautifulSoup(raw,'html.parser')
 notices='\n\n'.join(x.get_text('\n',strip=True) for x in s.select('#pg-header,#pg-footer'))
 for x in s.select('#pg-header,#pg-footer,script,style,nav,.pagenum,.pageno'):x.decompose()
 start=s.find(lambda n:_start(pg_id,n))
 if start is None:raise ValueError('Declared source beginning is missing: '+str(pg_id))
 current=start
 while current and current is not s.body:
  for previous in list(current.previous_siblings):previous.extract()
  current=current.parent
 return s,notices

def source_scope(pg_id,raw,part=None):
 s,_=_soup(pg_id,raw,part);return str(s.body or s)

def _text(node,preserve=False):
 copy=deepcopy(node)
 for br in copy.find_all('br'):br.replace_with('\n')
 value=copy.get_text('')
 if preserve:return value.replace('\r\n','\n').replace('\r','\n').strip()
 if node.find('br'):
  return '\n'.join(norm(line) for line in value.splitlines()).strip()
 return norm(value)

def _blocks(root):
 """Emit every meaningful leaf or bare inline run, including malformed headings."""
 result=[]
 def add(tag,text,pre=False):
  if text.strip():result.append({'tag':tag,'text':text,'preformatted':pre})
 def walk(node):
  if not isinstance(node,Tag):return
  pre=node.name=='pre' or 'pre' in node.get('class',[])
  if pre:add(node.name,_text(node,True),True);return
  if node.name=='table':
   rows=[]
   for tr in node.find_all('tr'):
    if tr.find_parent('table') is node:rows.append([norm(' '.join(b['text'] for b in _blocks(cell))) for cell in tr.find_all(['td','th'],recursive=False)])
   if rows:
    columns=max(map(len,rows));widths=[max((len(row[i]) if i<len(row) else 0) for row in rows) for i in range(columns)]
    value='\n'.join('  '.join((row[i] if i<len(row) else '').ljust(widths[i]) for i in range(columns)).rstrip() for row in rows)
    if value.strip():result.append({'tag':'table','text':value,'preformatted':True,'layout':True})
   return
  nested=any(x.name in BLOCKS for x in node.find_all(True))
  if node.name in LEAVES and not nested:add(node.name,_text(node));return
  inline=[]
  def flush():
   if inline:
    fragment=BeautifulSoup(''.join(escape(str(x),quote=False) if isinstance(x,NavigableString) else str(x) for x in inline),'html.parser')
    add(node.name if re.fullmatch(r'h[1-6]',node.name) else 'div',_text(fragment));inline.clear()
  for child in node.children:
   if isinstance(child,Comment):continue
   if isinstance(child,Tag) and child.name in BLOCKS:flush();walk(child)
   else:inline.append(child)
  flush()
 walk(root);return result

def _kind(pg_id,tag,t):
 if not re.fullmatch(r'h[1-6]',tag):return None
 if pg_id in {10741,10715}:
  if t=='INTRODUCTION.':return 'frontmatter'
  if re.match(r'^CHAPTER [IVX]+\.',t):return 'body'
 elif pg_id==38427:
  if t=="Translators' Preface." or t.startswith('Preface To The '):return 'frontmatter'
  if re.match(r'^(First|Second|Third|Fourth) Book\.',t):return 'body'
  if t=='Footnotes':return 'appendix'
 elif pg_id==40097:
  if t.startswith('Appendix: Criticism'):return 'body'
  if re.match(r'^Chapter [IVXLCDM]+\.',t):return 'body'
  if t=='Footnotes':return 'appendix'
 elif pg_id==40868:
  if t.startswith(('Index.','Corrigenda And Addenda','Footnotes')):return 'appendix'
  if re.match(r'^Chapter [IVXLCDM]+\.',t):return 'body'
  if tag=='h1' and not t.startswith('Supplements '):return 'appendix'
 elif pg_id==52319:
  if t=='PREFACE.':return 'frontmatter'
  if t.startswith(('"GOOD AND EVIL,"','"GUILT,"')) or t=='WHAT IS THE MEANING OF ASCETIC IDEALS?':return 'body'
  if t=='PEOPLES AND COUNTRIES.' or t.upper().startswith('FOOTNOTES'):return 'appendix'
 return None

def extract(pg_id,raw,part=None):
 s,notices=_soup(pg_id,raw,part);chapters=[];pending=[];current=None;appendix=False;layouts={}
 for block in _blocks(s.body or s):
  t=block['text'];heading=re.fullmatch(r'h[1-6]',block['tag']);k=_kind(pg_id,block['tag'],norm(t))
  structural=heading and (t.startswith('Supplements ') or t.startswith(('First Half.','Second Half.')) or norm(t) in ['FIRST ESSAY.','SECOND ESSAY.','THIRD ESSAY.'])
  if structural:pending.append(t);continue
  if k:
   if pg_id==40868 and k=='appendix':appendix=True
   if pg_id==40868 and appendix:k='appendix'
   current={'title':' · '.join(pending+[t]),'kind':k,'sourceHeadings':pending+[t],'paragraphs':[]};pending=[];chapters.append(current);continue
  if current is None:pending.append(t);continue
  if pending:
   # A structural marker with its own prose is a real source section.
   current={'title':' · '.join(pending),'kind':'body' if not appendix else 'appendix','sourceHeadings':pending,'paragraphs':[]};pending=[];chapters.append(current)
  if current['paragraphs'] and re.fullmatch(r'\d+\.?',current['paragraphs'][-1]) and not block['preformatted']:
   current['paragraphs'][-1]+=' '+t
  else:
   if block.get('layout'):layouts[str(len(chapters)-1)+':'+str(len(current['paragraphs']))]={'presentation':'preformatted'}
   current['paragraphs'].append(t)
 if pending:raise ValueError('Unattached terminal source heading: '+repr(pending))
 if not chapters or any(not c['paragraphs'] for c in chapters):raise ValueError('Empty or missing declared source section: '+str(pg_id))
 return {'chapters':chapters,'notices':notices,**({'layouts':layouts} if layouts else {})}
