import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceEmphasisRanges,sliceEmphasisRanges,emphasisSourceRuns,emphasisDisplayRuns,sourceEmphasisEligible} from '../app/source-emphasis.mjs';

const rangesOf=text=>sourceEmphasisRanges(text);
const runsOf=text=>emphasisSourceRuns(text,sliceEmphasisRanges(rangesOf(text),0,text.length));
const visibleOf=text=>emphasisDisplayRuns(text,sliceEmphasisRanges(rangesOf(text),0,text.length)).map(r=>r.text).join('');
const rawOf=list=>list.map(r=>r.text).join('');

test('conservative single-underscore pairs become content ranges over the immutable source',()=>{
  const text='There was nothing so _very_ remarkable in that.';
  assert.deepEqual(rangesOf(text),[{start:text.indexOf('very'),end:text.indexOf('very')+4}]);
  assert.equal(rawOf(runsOf(text)),text,'every raw UTF-16 character stays in the runs exactly once');
  assert.equal(visibleOf(text),'There was nothing so very remarkable in that.','visible rendering omits only the marker characters');
  assert.deepEqual(runsOf(text).filter(r=>r.marker).map(r=>r.text),['_','_']);
  assert.deepEqual(runsOf(text).filter(r=>r.italic).map(r=>r.text),['very']);
});

test('multi-word punctuation content keeps one conservative pair and multiple pairs stay separate',()=>{
  const text='the Rabbit actually _took a watch out of its waistcoat-pocket_, and looked';
  assert.deepEqual(rangesOf(text),[{start:text.indexOf('took'),end:text.indexOf('waistcoat-pocket')+16}]);
  assert.equal(visibleOf(text),'the Rabbit actually took a watch out of its waistcoat-pocket, and looked');
  const two='_a_ then _b_';assert.deepEqual(rangesOf(two),[{start:1,end:2},{start:10,end:11}]);
  assert.equal(visibleOf(two),'a then b');
});

test('escaped, unmatched, intraword, double and empty underscores stay safe literal text',()=>{
  for(const text of ['\\_very\\_ remarkable','a _b c','a b_ c','snake_case_name','foo_bar_baz','__strong__','____','_ _','__','a _b_c_ d','end_']){
    assert.deepEqual(rangesOf(text),[],text);
    assert.equal(rawOf(runsOf(text)),text,text);
    assert.equal(visibleOf(text),text,text);
  }
  assert.deepEqual(rangesOf('_a _b_ c'),[{start:4,end:5}]);
});

test('code spans, paths and links keep their underscores literal without HTML interpretation',()=>{
  assert.deepEqual(rangesOf('`_x_` stays literal'),[]);
  assert.deepEqual(rangesOf('run `make_it_work` then _go_'),[{start:25,end:27}]);
  assert.deepEqual(rangesOf('see /path/to_file_name for _now_'),[{start:28,end:31}]);
  assert.deepEqual(rangesOf('https://example.com/a_b_c never formats'),[]);
  assert.deepEqual(rangesOf('a "snake_case" and [link_text](https://e.org/a_b)'),[]);
  const dangerous='<script>alert("_x_")</script> _safe_';
  assert.deepEqual(rangesOf(dangerous),[{start:dangerous.indexOf('x'),end:dangerous.indexOf('x')+1},{start:dangerous.indexOf('safe'),end:dangerous.indexOf('safe')+4}]);
  assert.equal(visibleOf(dangerous),'<script>alert("x")</script> safe');
  assert.ok(!runsOf(dangerous).some(r=>r.italic&&/<[^>]+>/.test(r.text)),'no run invents markup');
  assert.ok(!runsOf(dangerous).some(r=>r.marker&&r.text!=='_'),'markers are plain hidden characters only');
});

test('UTF-16 surrogate pairs and emoji keep offsets exact through slicing and runs',()=>{
  const text='😀 start _very_ 😀 end';
  assert.deepEqual(rangesOf(text),[{start:text.indexOf('very'),end:text.indexOf('very')+4}]);
  assert.equal(rawOf(runsOf(text)),text);
  const mid='😀_a_😀';assert.deepEqual(rangesOf(mid),[{start:3,end:4}]);
  assert.equal(rawOf(runsOf(mid)),mid);assert.equal(visibleOf(mid),'😀a😀');
  for(const r of runsOf(mid))assert.ok(r.text.isWellFormed(),'runs never split a surrogate pair');
});

test('slice ranges register full-source emphasis with the delimiters partly outside the slice',()=>{
  const text='xx _very_ yy',ranges=rangesOf(text);assert.deepEqual(ranges,[{start:4,end:8}]);
  const inside=sliceEmphasisRanges(ranges,4,8);assert.deepEqual(inside,[{start:0,end:4,open:false,close:false}]);
  assert.deepEqual(emphasisDisplayRuns('very',inside).map(r=>[r.text,r.italic]),[['very',true]]);
  const partial=sliceEmphasisRanges(ranges,3,7);
  assert.deepEqual(partial,[{start:1,end:4,open:true,close:false}]);
  assert.deepEqual(emphasisSourceRuns('_ver',partial).map(r=>[r.text,r.italic,!!r.marker]),[['_',false,true],['ver',true,false]]);
  const closed=sliceEmphasisRanges(ranges,7,10);
  assert.deepEqual(closed,[{start:0,end:1,open:false,close:true}]);
  assert.deepEqual(emphasisSourceRuns('y_ ',closed).map(r=>[r.text,r.italic,!!r.marker]),[['y',true,false],['_',false,true],[' ',false,false]]);
  for(const [start,end] of [[0,12],[1,10],[4,8],[3,7],[7,10],[5,6]]){
    const slice=text.slice(start,end),sliceRanges=sliceEmphasisRanges(ranges,start,end);
    assert.equal(rawOf(emphasisSourceRuns(slice,sliceRanges)),slice,start+':'+end);
  }
});

test('only eligible default public plain-text catalog originals format; private and other source kinds stay literal',()=>{
  assert.equal(sourceEmphasisEligible({visibility:'public',source:{format:'txt'}}),true);
  for(const book of [{visibility:'private',source:{format:'txt'}},{visibility:'public',source:{format:'json'}},{visibility:'public',source:{format:'pdf'}},{visibility:'public',source:{format:'epub'}},{visibility:'public'},null,{}])assert.equal(sourceEmphasisEligible(book),false,JSON.stringify(book));
});

test('balanced underscores in paths, URLs and links stay literal without touching prose emphasis',()=>{
  for(const text of ['/tmp/_cache_/file','https://example.test/?_key_=1','[some _label_](https://example.test)','ftp://host/_a_/b','www.example.test/_x_','see the [docs _page_](https://example.test/a_b) now']){
    assert.deepEqual(rangesOf(text),[],text);
    assert.equal(rawOf(runsOf(text)),text,text);
    assert.equal(visibleOf(text),text,text);
  }
  const prose='read _this_ at https://example.test/a_b_c and _that_';
  assert.deepEqual(rangesOf(prose),[{start:prose.indexOf('this'),end:prose.indexOf('this')+4},{start:prose.indexOf('that'),end:prose.indexOf('that')+4}]);
  assert.deepEqual(rangesOf('a _b [c](https://x.test) d_ e'),[]);
});

test('astral letters and combining marks count as word characters at delimiter boundaries',()=>{
  for(const text of ['\u{10428}_a_','_a_\u{10428}','a\u{301}_b_','_b_a\u{301}','x \u{10428}_a_']){
    assert.deepEqual(rangesOf(text),[],text);
    assert.equal(rawOf(runsOf(text)),text,text);
  }
  assert.deepEqual(rangesOf('\u{10428} _a_ \u{10428}'),[{start:4,end:5}],'astral letters beside the pair do not make it intraword');
  assert.deepEqual(rangesOf('a\u{301} _b_'),[{start:4,end:5}]);
});

test('balanced link destinations and reference labels keep source syntax literal',()=>{
  for(const text of ['[some _label_](https://en.wikipedia.org/wiki/Function_(mathematics))','[some _label_][id]','[some _label_][]','[some _label_](relative_(nested_(target)))']){
    assert.deepEqual(rangesOf(text),[],text);
    assert.equal(visibleOf(text),text);
    assert.equal(rawOf(runsOf(text)),text);
  }
  const prose='[some _label_](relative_(target)) then _prose_';
  assert.deepEqual(rangesOf(prose),[{start:prose.indexOf('prose'),end:prose.indexOf('prose')+5}]);
});
