import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sampleInterpretations,sampleLabel,nextSampleIndex,mountHomeSample} from '../app/home-sample.mjs';

test('every interpretation has text and labels for every UI locale',()=>{
  assert.deepEqual(sampleInterpretations.map(entry=>entry.code),['zh-Hans','zh-Hant','ja','es']);
  for(const entry of sampleInterpretations){
    assert.ok(entry.text.trim());assert.ok(entry.name.trim());
    for(const locale of ['zh-Hans','en','zh-Hant','ja'])assert.ok(entry.labels[locale]?.trim());
  }
});
test('Simplified Chinese interpretation matches the no-JS hero paragraph',()=>{
  const html=readFileSync(new URL('../app/home.html',import.meta.url),'utf8');
  const paragraph=html.match(/class="sample-translation"><span>[^<]+<\/span><p lang="zh-Hans">([^<]+)<\/p>/);
  assert.equal(sampleInterpretations[0].text,paragraph?.[1]);
});
test('sampleLabel falls back to source, then any nonempty label',()=>{
  assert.equal(sampleLabel(sampleInterpretations[2],'en'),'Japanese interpretation · Reading example');
  assert.equal(sampleLabel(sampleInterpretations[0],'fr'),sampleInterpretations[0].labels['zh-Hans']);
  assert.equal(sampleLabel({labels:{en:'',ja:'日本語'}},'fr'),'日本語');
  assert.equal(sampleLabel({},'en'),'');
});
test('nextSampleIndex advances and wraps, including an empty collection',()=>{
  assert.equal(nextSampleIndex(0,4),1);assert.equal(nextSampleIndex(3,4),0);
  assert.equal(nextSampleIndex(0,1),0);assert.equal(nextSampleIndex(0,0),0);
});
test('mount silently skips missing DOM features',()=>{
  assert.doesNotThrow(mountHomeSample());assert.doesNotThrow(mountHomeSample({}));
});
