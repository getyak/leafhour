#!/usr/bin/env python3
"""Reproduce the pinned public catalog from cached primary-source HTML/XML.
Requires beautifulsoup4 and lxml. No network, model calls or account writes.
Usage: python3 tools/import-world-catalog.py /path/to/cached/sources [--write]
Raw cache filenames are PG_ID.html, room.html and ivan.xml.
"""
import json,re,hashlib,sys
from pathlib import Path
from bs4 import BeautifulSoup
root=Path(__file__).resolve().parents[1]
source_dir=Path(sys.argv[1])
def text(el):
 # Preserve word adjacency across inline emphasis and deliberately retain verse line breaks.
 for br in el.find_all('br'):br.replace_with('\n')
 value=el.get_text('')
 if el.name=='pre' or 'poem' in el.get('class',[]) or 'stanza' in el.get('class',[]):
  lines=[re.sub(r'[ \t\r\f\v]+',' ',line).strip() for line in value.strip().split('\n')]
  return '\n'.join(lines if el.name=='pre' else [line for line in lines if line])
 return re.sub(r'\s+',' ',value).strip()
def build(n):
 raw=(source_dir/(str(n)+'.html' if n!='ivan' else 'ivan.xml')).read_bytes()
 s=BeautifulSoup(raw,'xml' if n=='ivan' else 'html.parser')
 notices='\n\n'.join(x.get_text('\n',strip=True) for x in s.select('#pg-header,#pg-footer'))
 if n=='room':notices='Project Gutenberg Australia eBook 0200791. Virginia Woolf, A Room of One’s Own (1929). Source header and licence: https://gutenberg.net.au/ebooks02/0200791.txt and https://gutenberg.net.au/licence.html. Body and author notes retained; website navigation omitted.'
 if n=='ivan':notices='Leo Tolstoy, The Death of Ivan Ilych (1886). Translated by Louise and Aylmer Maude. Distributed by the Tolstoy Library. Digitized by Christian Classics Ethereal Library. Only the public-domain translated story is included; CCEL staff summary, XML styling and generated indexes are omitted.'
 for e in s.select('#pg-header,#pg-footer,script,style,table,.pagenum,.caption'):e.decompose()
 prophetTitles=[a.get_text(' ',strip=True) for a in BeautifulSoup(raw,'html.parser').select('a[href^="#link"]')][:28] if n==58585 else []
 chapters=[]
 def add(title,kind='body'):chapters.append({'title':title,'kind':kind,'paragraphs':[]})
 def put(value):
  if chapters and value and not re.fullmatch(r'[\d\s{}\[\]*._—-]+',value):chapters[-1]['paragraphs'].append(value)
 if n=='ivan':
  for div in s.find_all('div1'):
   if not div.get('title','').startswith('Chapter '):continue
   add(div['title']);chapters[-1]['paragraphs']=[text(p) for p in div.find_all('p') if text(p)]
 elif n==58585:
  titles=prophetTitles
  divs=s.select('div.chapter');assert len(titles)==len(divs)==28
  for title,div in zip(titles,divs):add(title);chapters[-1]['paragraphs']=[text(p) for p in div.find_all('p') if text(p)]
 else:
  if n=='room':
   note=next(h for h in s.select('h3') if text(h).startswith('[* This essay'))
   add('Author’s introductory note','frontmatter');put(text(note))
  started=False;part='';tao=1;work='The Awakening'
  # Select outermost paragraph/verse blocks, avoiding duplicate nested text.
  elements=s.select('h1,h2,h3,h4,h5,p,pre,div.stanza')
  selected={id(e) for e in elements}
  for el in elements:
   if any(id(a) in selected for a in el.parents):continue
   value=text(el)
   if not value:continue
   if started and (value.startswith("Transcriber's Note") or value.startswith('Typographical errors corrected') or value.startswith('CHISWICK PRESS') or value.startswith('London: Printed by')):break
   if value.startswith('The Home and the World by Rabindranath Tagore. Translated'):break
   if re.search(r'END OF (?:THE |THIS )?PROJECT GUTENBERG',value,re.I) or value.startswith('THE FULL PROJECT GUTENBERG'):break
   heading=el.name.startswith('h');title=None;kind='body';skip=False
   if n==201:
    if heading and re.match(r'Section \d+\.',value):title=value
    elif heading and value.startswith('PART '):part=value;skip=True
   elif n==84:
    if el.name=='h2' and re.match(r'(Letter|Chapter) \d+',value):title=value
   elif n==1906:
    if el.name=='h2' and value.startswith('CHAPTER '):title=value
    elif el.name=='h2' and value=='Footnotes':title=value;kind='appendix'
   elif n==35:
    if el.name=='h2' and (re.match(r'^[IVX]+\.',value) or value.lower()=='epilogue'):title=value
   elif n=='room':
    if el.name=='h2' and value in ['ONE','TWO','THREE','FOUR','FIVE','SIX']:title=value
    elif value=='THE END':break
   elif n==34901:
    if el.name=='h2' and value.startswith('CHAPTER '):title=value
   elif n==160:
    if el.name=='h3' and re.fullmatch('[IVXL]+',value):title=work+' · '+value
    elif el.name=='h2' and started:
     if value=='SELECTED SHORT STORIES':skip=True
     else:work=value;title=value
   elif n==7166:
    if heading and re.match(r'^Chapter (One|Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten|Eleven|Twelve)',value):title=value
   elif n==21040:
    if 'chapter' in el.get('class',[]):title=value;kind='frontmatter' if value.startswith('SOME INFORMAL') else 'body'
   elif n==769:
    if el.name=='h2' and re.match('^[IVX]+\\.',value):title=value
   elif n==216:
    if el.name=='p' and re.match(r'^(?:Ch\.\s*)?'+str(tao)+(r'\.(?:\s+1\.|$)' if tao<11 else r'\.'),value):title='Chapter '+str(tao);tao+=1
    elif heading:skip=True
   elif n==2017:
    if el.name=='h2' and value.startswith('Chapter '):title=value
   elif n==2388:
    if el.name=='h3' and value.startswith('CHAPTER '):title=value
    elif started and value.startswith('[FN#1]'):title='Translator’s notes';kind='appendix'
   elif n==246:
    if el.name=='h2' and value in ['First Edition','Fifth Edition']:title=value
    elif el.name=='h2' and value=='Notes:':title=value;kind='appendix'
   elif n==600:
    if el.name=='h2' and value.startswith('PART '):part=value;skip=True
    elif el.name=='h2' and re.fullmatch('[IVX]+',value):title=part+' · '+value
   elif n==2527:
    if el.name=='h2' and value.startswith('BOOK I'):title=value
   elif n==1342:
    if el.name=='h2' and (m:=re.search(r'CHAPTER\s*[IVXLCDM]+\.?',value,re.I)):title=m[0]
   elif n==996:
    if value=='Volume II':part='Volume II';title='Volume II · Front matter';kind='frontmatter'
    elif heading and started and value in ['DEDICATION OF VOLUME II.','THE AUTHOR’S PREFACE']:title=part+' · '+value;kind='frontmatter'
    elif heading and re.match(r'^CHAPTER [IVXLCDM]+\.',value):
     if value.startswith('CHAPTER I.') and chapters:part='Volume II'
     if not part:part='Volume I'
     title=part+' · '+value
   elif n==19942:
    if el.name=='h2' and re.fullmatch('[IVX]+',value):title='Chapter '+value
    elif el.name=='h2' and value=='FOOTNOTES:':title=value;kind='appendix'
   elif n==128:
    if el.name=='h3' and value=='Preface':title=value;kind='frontmatter'
    elif el.name=='h3' and started:title=value
   elif n==549:
    if el.name=='h2' and value.startswith('PART '):part=value;skip=True
    elif el.name=='h3' and re.fullmatch('[IVX]+',value):title=part+' · '+value
   elif n==15399:
    if el.name=='h2' and re.match(r'^CHAP(?:TER)?\.? +[IVX]+\.?',value):title=value
   elif n==1441:
    if el.name=='h2' and value.startswith('Chapter '):title=value
   elif n==23:
    if el.name=='h2' and value.startswith('CHAPTER '):title=value
    elif el.name=='h2' and value=='APPENDIX':title=value;kind='appendix'
   elif n==23031:
    if value=='CONCLUSION.':title=value
    elif el.name=='h2' and value.startswith('CHAPTER '):title=value
   if title:
    # Merge title-only markers with following source body without manufacturing prose.
    add(title,kind);started=True
    if n==216 or (n==2388 and value.startswith('[FN#1]')):put(value)
   elif started and not skip:put(value)
 chapters=[c for c in chapters if c['paragraphs']]
 return raw,chapters,notices
for entry in json.loads((root/'catalog/manifest.json').read_text()):
 if entry.get('format')!='structured':continue
 target=root/'catalog'/entry['file'];prior=json.loads(target.read_text())
 url=prior['downloadUrl']
 n=int(re.search(r'/epub/(\d+)/',url)[1]) if '/epub/' in url else 'room' if 'gutenberg.net.au' in url else 'ivan'
 raw,chapters,notices=build(n)
 if hashlib.sha256(raw).hexdigest()!=prior['downloadSha256']:raise ValueError('Source edition changed: '+entry['id'])
 result={**prior,'chapters':chapters,'notices':notices}
 if sum(c['kind']=='body' for c in chapters)!=entry['bodyChapters']:raise ValueError('Chapter boundary mismatch: '+entry['id'])
 encoded=json.dumps(result,ensure_ascii=False,indent=2)+'\n'
 if '--write' in sys.argv:target.write_text(encoded)
 elif encoded!=target.read_text():raise ValueError('Reproduction mismatch: '+entry['id'])
 print(entry['id'],len(chapters),'chapters verified')
