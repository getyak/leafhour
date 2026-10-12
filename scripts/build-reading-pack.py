"""Assemble user-supplied local content. Never generates translations."""
import argparse, copy, datetime, json, re, zipfile
from pathlib import Path

REPO=Path(__file__).resolve().parents[1]
ROOT=REPO/'local'/'finite-infinite-games'

def read(path):return json.loads(path.read_text())

def evidence_file(value):
    if not value.startswith(('local/','evidence/','/')):
        match=re.search(r'(?:local/finite-infinite-games/)?evidence/[A-Za-z0-9_./-]+\.(?:png|jpg)',value)
        if match:value=match.group(0)
    path=Path(value)
    if path.is_absolute():return path
    for candidate in [REPO/path,ROOT/path]:
        if candidate.is_file():return candidate
    return REPO/path

def assemble():
    manifest=read(ROOT/'source-manifest.json')
    book={'schemaVersion':2,'bookId':manifest['bookId'],'contentVersion':'full-book-draft-1','title':manifest['title'],'author':manifest['author'],'isSample':False,'sourceSha256':manifest['sourceSha256'],'translationReview':'draft','chapters':[],'sections':[],'glossary':[],'annotations':[],'qualityIssues':[],'sourceCorrections':[],'provenance':{'generatedBy':'Codex parallel agents','humanReviewed':False,'date':'2026-10-12'}}
    glossary={}
    for cm in manifest['chapters']:
        source=read(ROOT/'source'/f'{cm["id"]}.json')
        target_path=ROOT/'translated'/f'{cm["id"]}.json'
        if not target_path.exists():raise ValueError(f'Missing chapter: {cm["id"]}')
        target=read(target_path)
        assert target['chapterId']==cm['id'],f'Wrong chapter: {cm["id"]}'
        ids={p['id'] for s in source['sections'] for p in s['paragraphs']}
        records=target['translations']
        assert len(records)==len(ids),f'{cm["id"]}: expected {len(ids)} translations, got {len(records)}'
        trans={p['passageId']:p for p in records}
        assert set(trans)==ids,f'{cm["id"]}: missing or unexpected passage IDs'
        notes={n['sectionNumber']:n for n in target['sectionNotes']}
        assert set(notes)=={s['number'] for s in source['sections']},f'{cm["id"]}: section notes coverage mismatch'
        chapter=copy.deepcopy(cm);chapter['title']['zh']=target.get('titleZh') or cm['title']['zh'];chapter['overview']=target.get('overview','');book['chapters'].append(chapter)
        for term in target['glossary']:
            assert term['en'] and term['zh'] and term['definition']
            assert set(term.get('anchorIds',[]))<=ids,f'Invalid term anchor: {term["id"]}'
            if term['id'] in glossary:
                previous=glossary[term['id']]
                if previous['zh']!=term['zh']:
                    book['qualityIssues'].append({'kind':'glossary_variant','termId':term['id'],'chapterId':cm['id'],'variants':[previous['zh'],term['zh']]})
                previous['anchorIds']=list(dict.fromkeys(previous.get('anchorIds',[])+term.get('anchorIds',[])))
            else:glossary[term['id']]=copy.deepcopy(term)
        corrections={}
        for c in target.get('corrections',[]):
            assert c['passageId'] in ids,f'Invalid correction anchor: {c}'
            assert isinstance(c.get('before'),str) and isinstance(c.get('after'),str) and c['before'],f'Invalid correction: {c}'
            evidence=c.get('evidence') or c.get('evidencePath')
            assert isinstance(evidence,str) and evidence_file(evidence).is_file(),f'Missing correction evidence: {c}'
            c=copy.deepcopy(c);c['evidence']=str(evidence_file(evidence).resolve().relative_to(REPO))
            corrections.setdefault(c['passageId'],[]).append(c)
        for section in source['sections']:
            s=copy.deepcopy(section);s['title']=notes[s['number']]['title'];s['titleAttribution']='editorial'
            annotations_by_anchor={}
            for ni,n in enumerate(notes[s['number']]['notes']):
                assert n.get('attribution')=='editorial'
                assert n['kind'] in {'difficulty','paradox','example','context','term','cross_reference'}
                assert n['title'] and n['text'] and n['anchorIds']
                assert set(n['anchorIds'])<={p['id'] for p in s['paragraphs']},f'Invalid section note: {n}'
                note=copy.deepcopy(n);note['id']=f'note-s{s["number"]:03d}-{ni+1:02d}';note.setdefault('references',[]);book['annotations'].append(note)
                for pid in note['anchorIds']:annotations_by_anchor.setdefault(pid,[]).append(note['id'])
            for p in s['paragraphs']:
                t=trans[p['id']]
                for variant in ['literal','interpretive']:
                    assert isinstance(t.get(variant),str) and t[variant].strip(),f'Empty {variant}: {p["id"]}'
                    assert re.search(r'[\u3400-\u9fff]',t[variant]),f'Non-Chinese {variant}: {p["id"]}'
                    assert t[variant]!=p['original'],f'Original copied into translation: {p["id"]}'
                p['translations']={v:{'text':t[v].strip(),'status':'draft','translator':'Codex parallel agents','humanReviewed':False} for v in ['literal','interpretive']}
                p['annotationIds']=annotations_by_anchor.get(p['id'],[])
                if p['id'] in corrections:
                    p['source']['ocrOriginal']=p['original'];p['source']['corrections']=corrections[p['id']]
                    for c in corrections[p['id']]:
                        assert c['before'] in p['original'],f'Correction mismatch: {c}'
                        p['original']=p['original'].replace(c['before'],c['after'])
                        book['sourceCorrections'].append(c)
                p['termIds']=[]
            book['sections'].append(s)
        for issue in target.get('qualityIssues',[]):book['qualityIssues'].append({'chapterId':cm['id'],'detail':issue})
    book['glossary']=list(glossary.values())
    for s in book['sections']:
        for p in s['paragraphs']:
            p['termIds']=[t['id'] for t in book['glossary'] if p['id'] in t.get('anchorIds',[]) or t['en'].lower() in p['original'].lower()]
    assert [s['number'] for s in book['sections']]==list(range(1,102))
    passages=[p for s in book['sections'] for p in s['paragraphs']]
    assert len(passages)==sum(c['paragraphCount'] for c in manifest['chapters'])
    assert len({p['id'] for p in passages})==len(passages)
    return book

def markdown(book,variant):
    parts=['# 有限与无限的游戏',f'James P. Carse · {book["title"]["en"]}','本文件来自用户提供的1986年底本。译文是并行生成的初稿，未经本人复核。编号小节的阅读标题、章导读与所有注解为编辑补充。扫描识别与纠错记录见阅读包。']
    for c in book['chapters']:
        parts+=['',f'## 第{c["number"]}章 · {c["title"]["zh"]}',c['title']['en']]
        if c.get('overview'):parts+=['','**本章导读 · 编辑补充**',c['overview']]
        for s in book['sections']:
            if s['chapterId']!=c['id']:continue
            parts+=['',f'### §{s["number"]} · {s["title"]}','小节标题 · 编辑补充']
            for p in s['paragraphs']:
                parts+=['',f'<a id="{p["id"]}"></a>',f'原书第{p["source"]["printedPage"]}页 · PDF第{p["source"]["pdfPage"]}页 · {p["id"]}']
                if variant=='bilingual':parts+=['','**英文原文**',p['original'],'','**直译 · 初稿**',p['translations']['literal']['text'],'','**意译 · 初稿**',p['translations']['interpretive']['text']]
                else:parts+=['',p['translations'][variant]['text']]
                for nid in p['annotationIds']:
                    note=next(n for n in book['annotations'] if n['id']==nid)
                    label={'example':'生活例子','paradox':'悖论','difficulty':'理解难点','context':'背景','term':'术语','cross_reference':'关联阅读'}[note['kind']]
                    parts+=['',f'**{label} · 编辑补充｜{note["title"]}**',note['text']]
    parts+=['','## 关键术语 · 编辑补充']
    for t in book['glossary']:parts+=['',f'### {t["zh"]} · {t["en"]}',t['definition']]
    return '\n\n'.join(parts)+'\n'

def write_outputs(book):
    exports=ROOT/'exports';exports.mkdir(exist_ok=True)
    payload=json.dumps(book,ensure_ascii=False,indent=2)
    temporary=ROOT/'book.pending.json';temporary.write_text(payload);temporary.replace(ROOT/'book.json')
    (exports/'book.json').write_text(payload)
    (ROOT/'book-data.js').write_text('window.marginaliaEmbeddedBook='+json.dumps(book,ensure_ascii=False).replace('<','\\u003c')+';\n')
    for variant,filename in [('bilingual','book-bilingual.md'),('literal','book-literal.md'),('interpretive','book-interpretive.md')]:
        (exports/filename).write_text(markdown(book,variant))
    html=(REPO/'_briefs'/'preview.html').read_text()
    html=html.replace('<script src="../local/finite-infinite-games/book-data.js"></script>','')
    inline='window.marginaliaStandalone=true;window.marginaliaEmbeddedBook='+json.dumps(book,ensure_ascii=False).replace('<','\\u003c')+';'
    html=html.replace('<script src="full-book-loader.js"></script>','<script>'+inline+'</script>\n<script>'+(REPO/'_briefs'/'full-book-loader.js').read_text()+'</script>')
    for filename in ['full-book-reader.js','room-interactions.js']:
        html=html.replace(f'<script src="{filename}"></script>','<script>'+(REPO/'_briefs'/filename).read_text()+'</script>')
    (exports/'reader-offline.html').write_text(html)
    report={'date':'2026-10-12','chapters':len(book['chapters']),'sections':len(book['sections']),'paragraphs':sum(len(s['paragraphs']) for s in book['sections']),'literalTranslations':sum(len(s['paragraphs']) for s in book['sections']),'interpretiveTranslations':sum(len(s['paragraphs']) for s in book['sections']),'annotations':len(book['annotations']),'glossaryTerms':len(book['glossary']),'sourceCorrections':len(book['sourceCorrections']),'qualityIssues':book['qualityIssues'],'humanReviewed':False,'sourceReview':'extracted_unreviewed except recorded visual corrections'}
    (ROOT/'validation-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    with zipfile.ZipFile(exports/'reading-pack.zip','w',zipfile.ZIP_DEFLATED) as z:
        for name in ['reader-offline.html','book.json','book-bilingual.md','book-literal.md','book-interpretive.md']:z.write(exports/name,name)
        z.write(ROOT/'validation-report.json','validation-report.json')
        z.write(ROOT/'source-manifest.json','source-manifest.json')
        written_evidence=set()
        for evidence in book['sourceCorrections']:
            for path in [evidence.get('evidence'),evidence.get('evidencePath')]+evidence.get('additionalEvidence',[]):
                if isinstance(path,str):
                    ep=evidence_file(path)
                    if ep.is_file() and str(ep.resolve()) not in written_evidence:
                        z.write(ep,'evidence/'+ep.name);written_evidence.add(str(ep.resolve()))
    return report

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--check-only',action='store_true');args=parser.parse_args()
    book=assemble()
    if args.check_only:print(json.dumps({'chapters':len(book['chapters']),'sections':len(book['sections']),'paragraphs':sum(len(s['paragraphs']) for s in book['sections']),'complete':True},ensure_ascii=False))
    else:print(json.dumps(write_outputs(book),ensure_ascii=False,indent=2))
