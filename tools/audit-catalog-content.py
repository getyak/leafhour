#!/usr/bin/env python3
"""Independently compare all published prose against pinned primary-source text.
This intentionally does not import the extraction builder. Every retained passage
must occur in source order, and every source gap must have an explicit reason.
Usage: python3 tools/audit-catalog-content.py SOURCE_CACHE [--report FILE]
This verifies selected main-text scope, not missing prefatory material or the
correctness of historical translation/OCR. See per-book scopeNote.
"""
import argparse,json,re,unicodedata,hashlib,sys,subprocess
from pathlib import Path
from bs4 import BeautifulSoup,NavigableString,Tag,Comment
root=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('source_cache');parser.add_argument('--report');parser.add_argument('--only',nargs='+')
args=parser.parse_args();cache=Path(args.source_cache)
entries=json.loads((root/'catalog/manifest.json').read_text())
if args.only and not set(args.only)<={e['id'] for e in entries}:parser.error('--only contains an unknown catalog ID')
entries=[e for e in entries if not args.only or e['id'] in args.only]
code="import {createLibraryService} from './server/library-service.mjs';const l=await createLibraryService({dataDir:'/tmp/catalog-content-audit-readonly',translator:null});const books=[];for(const b of await l.list(null))books.push(await l.getBook(null,b.bookId));console.log(JSON.stringify(books));"
books={b['bookId']:b for b in json.loads(subprocess.check_output(['node','--input-type=module','-e',code],cwd=root))}
block=set('html body div p section article pre blockquote li ul ol table tr td th h1 h2 h3 h4 h5 h6'.split())
def flat(el):
 if isinstance(el,Comment):return ''
 if isinstance(el,NavigableString):return str(el)
 if not isinstance(el,Tag):return ''
 if el.name=='br':return ' '
 t=''.join(flat(c) for c in el.children)
 return (' '+t+' ') if el.name in block else t
norm=lambda t:re.sub(r'\s+',' ',unicodedata.normalize('NFC',t)).strip()
def tokens(t):return re.findall(r"\w+(?:[’']\w+)*|[^\w\s]",unicodedata.normalize('NFC',t))
results=[]
for e in entries:
 if e.get('format')!='structured':
  raw=(root/'catalog'/e['file']).read_text();m=re.search(r'\*\*\* START OF THE PROJECT GUTENBERG EBOOK[^\n]*\*\*\*([\s\S]*?)\*\*\* END OF THE PROJECT GUTENBERG EBOOK',raw);body=norm(m[1]);target=norm(' '.join(p['original'] for sec in books[e['id']]['sections'] for p in sec['paragraphs']));
  if body!=target:raise ValueError('Legacy source sequence mismatch: '+e['id'])
  results.append({'id':e['id'],'sourceUrl':e['sourceUrl'],'sourceSha256':hashlib.sha256((root/'catalog'/e['file']).read_bytes()).hexdigest(),'sourceChars':len(body),'matchedChars':len(target),'scopeNote':e['scopeNote'],'differences':[],'status':'pass'});print(e['id'],'PASS',len(body),flush=True);continue
 d=json.loads((root/'catalog'/e['file']).read_text());u=d['downloadUrl'];n=re.search(r'/epub/(\d+)/',u)
 key=n[1] if n else 'room' if 'gutenberg.net.au' in u else 'ivan'
 raw=(cache/(key+('.xml' if key=='ivan' else '.html'))).read_bytes()
 if hashlib.sha256(raw).hexdigest()!=d['downloadSha256']:raise ValueError('Pinned source hash mismatch: '+e['id'])
 s=BeautifulSoup(raw,'xml' if key=='ivan' else 'html.parser')
 if key=='ivan':
  divs=[x for x in s.select('div1') if x.get('title','').startswith('Chapter ')];html='<audit>'+''.join(str(x) for x in divs)+'</audit>';s=BeautifulSoup(html,'xml')
 # Exclude navigation, source headings, page numbers and illustration captions, not any body prose.
 for x in s.select('#pg-header,#pg-footer,script,style,table,.pagenum,.caption'):x.decompose()
 original_paragraphs={norm(p) for c in d['chapters'] for p in c['paragraphs']}
 for x in s.select('h1,h2,h3,h4,h5,h6'):
  if norm(flat(x)).startswith(('Transcriber', 'Typographical errors corrected')):x.name='span';x.string='AUDIT_DIGITIZER_END'
  elif key=='1998' and norm(flat(x))=='APPENDIX.':x.name='span';x.string='AUDIT_READING_SCOPE_END'
  elif key=='room' and norm(flat(x))=='THE END':x.name='span';x.string='AUDIT_DIGITIZER_END'
  elif norm(flat(x)) in original_paragraphs:x.name='span'
  else:x.decompose()
 for x in s.select('p.chapter'):x.decompose()
 source=norm(flat(s.body or s))
 start=norm(d['chapters'][0]['paragraphs'][0]);pos=source.find(start)
 if pos<0: print('START NOT FOUND',key);continue
 source=source[pos:]
 # Remove explicit source/digitizer end markers; no per-book final sentence cutoff.
 stops=[r'\*\*\*\s*END OF',r'End of (?:the |this )?Project Gutenberg',r'THE FULL PROJECT GUTENBERG',r'Transcriber[’\']s Note',r'Typographical errors corrected',r'CHISWICK PRESS',r'London: Printed by',r'The Home and the World by Rabindranath Tagore\. Translated']
 stops+=['AUDIT_DIGITIZER_END','AUDIT_READING_SCOPE_END']
 for st in stops:
  m=re.search(st,source,re.I)
  if m:source=source[:m.start()]
 target=norm(' '.join(p for c in d['chapters'] for p in c['paragraphs']))
 diffs=[];offset=0;matched=0
 for chapter in books[e['id']]['sections']:
  for paragraph in chapter['paragraphs']:
   p=norm(' '.join([paragraph.get('source',{}).get('labelBefore',''),paragraph['original']]));at=source.find(p,offset)
   if at<0:
    diffs.append({'op':'target_not_found','target':p,'nearSource':source[offset:offset+150]});continue
   gap=source[offset:at].strip()
   if gap:diffs.append({'op':'missing_source','source':gap,'after':p[:80]})
   matched+=len(p);offset=at+len(p)
 tail=source[offset:].strip()
 if tail:diffs.append({'op':'missing_tail','source':tail})
 ignored=[];failures=[]
 for diff in diffs:
  value=diff.get('source','')
  if diff['op']=='missing_source' and (re.fullmatch(r'[\s*—.]+',value) or key=='35' and value=='>' or key=='room' and value=='One Two. Three. Four. Five. Six.'):
   ignored.append({'text':value,'reason':'source decoration or duplicated contents, not prose'})
  else:failures.append(diff)
 row={'id':e['id'],'sourceUrl':u,'sourceSha256':hashlib.sha256(raw).hexdigest(),'sourceChars':len(source),'matchedChars':matched,'scopeNote':e['scopeNote'],'differences':failures,'excludedGaps':ignored,'status':'pass' if not failures else 'fail'};results.append(row)
 print(e['id'],row['status'].upper(),len(source),'source characters',len(failures),'unexplained differences',flush=True)
report={'kind':'catalog-source-sequence-audit','books':results,'passed':sum(x['status']=='pass' for x in results),'total':len(results)}
if args.report:Path(args.report).write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
if report['passed']!=len(entries) or report['total']!=len(entries):raise SystemExit('Source coverage audit failed; inspect report differences')
