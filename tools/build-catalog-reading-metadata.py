#!/usr/bin/env python3
"""Compile hash-pinned visual lineation from primary HTML/XML, never TXT hardwrap.
Usage: python3 tools/build-catalog-reading-metadata.py SOURCE_CACHE [--write]
Requires beautifulsoup4; source cache is never downloaded or executed.
"""
import argparse,json,re,hashlib,sys,subprocess,unicodedata
from pathlib import Path
from bs4 import BeautifulSoup
root=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('source_cache');parser.add_argument('--write',action='store_true');parser.add_argument('--only',nargs='+')
args=parser.parse_args();cache=Path(args.source_cache)
if args.only and not set(args.only)<={e['id'] for e in json.loads((root/'catalog/manifest.json').read_text())}:parser.error('--only contains an unknown catalog ID')
# Read the actual public domain service; it does not need account credentials.
code="import {createLibraryService} from './server/library-service.mjs';const l=await createLibraryService({dataDir:'/tmp/catalog-layout-compiler',translator:null});const books=[];for(const b of await l.list(null))books.push(await l.getBook(null,b.bookId));console.log(JSON.stringify(books));"
books=json.loads(subprocess.check_output(['node','--input-type=module','-e',code],cwd=root))
norm=lambda s:re.sub(r'\s+',' ',unicodedata.normalize('NFC',s)).strip()
canonical=lambda s:re.sub(r'[\s_]','',unicodedata.normalize('NFC',s))
hashof=lambda s:hashlib.sha256(s.encode()).hexdigest()
target=root/'catalog/reading-metadata.json'
result=json.loads(target.read_text()) if args.only else {}
for book in books:
 if args.only and book['bookId'] not in args.only:continue
 source=book['source'];entry={'contentVersion':book['contentVersion'],'passages':{}}
 url=source.get('downloadUrl') or source['url'];match=re.search(r'(?:/epub/|/ebooks/)(\d+)',url);key=match[1] if match else 'room' if 'gutenberg.net.au' in url else 'ivan'
 raw=(cache/(key+('.xml' if key=='ivan' else '.html'))).read_bytes()
 if source.get('downloadSha256') and hashlib.sha256(raw).hexdigest()!=source['downloadSha256']:raise ValueError('Changed source '+book['bookId'])
 entry['layoutSourceUrl']=source.get('downloadUrl') or f'https://www.gutenberg.org/cache/epub/{key}/pg{key}-images.html'
 entry['layoutSourceSha256']=hashlib.sha256(raw).hexdigest()
 soup=BeautifulSoup(raw,'xml' if key=='ivan' else 'html.parser')
 for el in soup.select('#pg-header,#pg-footer,script,style,table'):el.decompose()
 paragraphs=[p for s in book['sections'] for p in s['paragraphs']];bytext={}
 for p in paragraphs:bytext.setdefault(canonical(p['original']),[]).append(p)
 for el in soup.select('p,pre,div.stanza'):
  # All explicit HTML BRs are intentional. PRE preserves original verse/diagram lines.
  if not el.find('br') and el.name!='pre':continue
  copy=BeautifulSoup(str(el),'html.parser').find(el.name)
  for br in copy.find_all('br'):br.replace_with('\u241e')
  value=copy.get_text('');lines=value.split('\u241e') if '\u241e' in value else value.splitlines()
  lines=[canonical(line) for line in lines if canonical(line)]
  keytext=''.join(lines)
  for p in bytext.get(keytext,[]):
   if '\n' in p['original']:continue # Existing literal lineation already renders with pre-line.
   if unicodedata.normalize('NFC',p['original'])!=p['original']:raise ValueError('Non-NFC source needs explicit offset mapping')
   positions=[i for i,c in enumerate(p['original']) if not c.isspace() and c!='_'];counts=[];total=0
   for line in lines[:-1]:
    total+=len(line);offset=positions[total-1]+1;counts.append(len(p['original'][:offset].encode('utf-16-le'))//2)
   if counts:entry['passages'][p['id']]={'sha256':hashof(p['original']),'lineBreaks':sorted(set(counts))}
 if book['bookId']=='gutenberg-tao-te-ching':
  pending=[]
  for el in soup.select('p,pre'):
   value=norm(el.get_text(''))
   if re.fullmatch(r'[\d.\s]+',value or 'x'):pending.append(value);continue
   matches=bytext.get(canonical(value),[])
   if pending and matches:
    if len(matches)!=1:raise ValueError('Ambiguous Tao label anchor')
    p=matches[0];layout=entry['passages'].setdefault(p['id'],{'sha256':hashof(p['original'])});layout['labelBefore']=' '.join(pending);pending=[]
 if book['bookId']=='gutenberg-equiano':
  labels=[('END OF THE FIRST VOLUME.','They ran the ship aground:'),('VOLUME II',"The author's disgust at the West Indies"),('MISCELLANEOUS VERSES, or','Reflections on the State of my mind')]
  for label,prefix in labels:
   matches=[p for p in paragraphs if p['original'].startswith(prefix)]
   if len(matches)!=1:raise ValueError('Ambiguous Equiano heading anchor')
   p=matches[0];entry['passages'].setdefault(p['id'],{'sha256':hashof(p['original'])})['labelBefore']=label
  # The final footnote block has the same title as an earlier volume's notes.
  p=[p for p in paragraphs if p['original']=='FOOTNOTES:'][-1]
  entry['passages'].setdefault(p['id'],{'sha256':hashof(p['original'])})['labelBefore']='THE END.'
 if book['bookId'] in ['gutenberg-alice','gutenberg-meditations','gutenberg-walden']:
  rawtext=(root/'catalog'/source['filename']).read_text();m=re.search(r'\*\*\* START OF THE PROJECT GUTENBERG EBOOK[^\n]*\*\*\*([\s\S]*?)\*\*\* END OF THE PROJECT GUTENBERG EBOOK',rawtext)
  entry['notices']=rawtext[:m.start(1)]+rawtext[m.end(1):]
 if book['bookId']=='gutenberg-au-room-of-ones-own':entry['notices']='Electronic edition produced by Col Choat. Project Gutenberg Australia 0200791, Edition 1; updated April 2020. First publication of the work: 1929; the electronic header does not identify one print edition.'
 result[book['bookId']]=entry
encoded=json.dumps(result,ensure_ascii=False,indent=2)+'\n';target=root/'catalog/reading-metadata.json'
if args.write:target.write_text(encoded)
elif target.read_text()!=encoded:raise ValueError('Reading metadata reproduction mismatch')
print(json.dumps({k:len(v['passages']) for k,v in result.items()},ensure_ascii=False))
