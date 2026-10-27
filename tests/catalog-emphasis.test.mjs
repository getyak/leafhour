import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createLibraryService} from '../server/library-service.mjs';
import {passagePresentation} from '../app/passage-layers.mjs';
import {sourceEmphasisEligible,sourceEmphasisRanges} from '../app/source-emphasis.mjs';

// Frozen baseline copied from get167-evidence/catalog-emphasis-before.json
// (read-only public-catalog diagnosis): [paragraphs, paragraphsWithUnderscores,
// conservativePairs, sourceHash]. Source hash is
// sha256(JSON.stringify(paragraphs.map(p=>[p.id,p.original]))).
const baseline={
 'gutenberg-alice':[817,179,218,'f69fe39443faa48ae36824e17051069bbe0dbf5f72299feca462ffc076fb015a'],
 'gutenberg-meditations':[746,21,31,'3196fa5d1fd30a4b8ac686b81c430056c41af12e471e596e8466f54865123318'],
 'gutenberg-walden':[585,138,279,'ebedf050f3e6f900d497d327178e5ea145552dd5bf35455662bd340254680c58'],
 'gutenberg-flatland':[385,0,0,'496a062583ed4cdb21be2c1a2b7ac3e2f0b1e3529135bef841957ab8f9ae5d89'],
 'gutenberg-frankenstein':[760,0,0,'27076865dcc56384be73f4c18b6eb796fdf5b341b44091b2a5b5b0941d374f7d'],
 'gutenberg-erewhon':[614,0,0,'fdf30197ca3d80b5ec165977e439fb6b9d08b913104b3f1f3d2ef5b74228496d'],
 'gutenberg-time-machine':[306,0,0,'9a4b406182fff2aec3b9c225cf4e17d5abed088629fbf89e87756e88e96b1c72'],
 'gutenberg-au-room-of-ones-own':[150,0,0,'fd320d4460ca906bd71d2ba4d3ea46eeaebef6a72c5068706422c2cf24796550'],
 'gutenberg-on-liberty':[136,0,0,'90dc3a01861a9f95504c48f9b204d750b538a122ba2df02c5739658bc32e7e97'],
 'ccel-ivan-ilych':[363,0,0,'b1f936a0c71ac807add4c8da2101868a6f5450d02a385ebc5dceea269f6f831d'],
 'gutenberg-awakening':[1355,0,0,'7617a443aa67e465cdc23df79564850626f48b6f92ac3a89cd7adad5d0df61fb'],
 'gutenberg-home-and-world':[1538,111,0,'bd6f5119e811ef0762645be1c4163bb0da78f0bcbf20395e8c092f173c460d16'],
 'gutenberg-brazilian-tales':[424,0,0,'4cc923e0ccee9df97ccca3525929ca580ae8b92096fae877769cc784b10873a9'],
 'gutenberg-book-of-tea':[117,0,0,'ed8c39547d6c13ff919af275bc401a64ea742688c93a28535e41b221c543657f'],
 'gutenberg-prophet':[764,0,0,'4dbbe0d2ac7438b895a8bfcadaec3fdd0c1f41aab1418d7cf7cc3023d891bb91'],
 'gutenberg-tao-te-ching':[250,0,0,'7285d3a91ded0cead8a17591c68cf91f84e8f2ade1f997549647dcead96e2ace'],
 'gutenberg-dhammapada':[414,0,0,'40908e35ef31f0dc097772b7517a90dd25d09aadd548d62ddc3146f406b5cd32'],
 'gutenberg-bhagavad-gita':[295,0,0,'bdc2bb2fdf6beca2084662af0a220a83a67b51632158ff3491c507b2ed571bb0'],
 'gutenberg-rubaiyat':[402,0,0,'ad3fb94def0ce34f8b37497d1ce8c6e236a5f942b50c6b1160c85d81de4e7ca5'],
 'gutenberg-notes-underground':[494,0,0,'828847be47c172f9529dea5fd64e3e6e2c2b1b676842be36427e94382c279231'],
 'gutenberg-young-werther':[435,1,0,'a31b6cdd522586c3c3dd11d197725b4b720269f86ec31c26fdae1a84461545db'],
 'gutenberg-pride-prejudice':[2058,0,0,'3bc8b1f6fae685aaf1e1b04d09f551d4994979da78a512162092372483812864'],
 'gutenberg-don-quixote':[3718,0,0,'944d4573a16012934ebc427d37ee3d0991794316c4a908958ec5182a0dd3368f'],
 'gutenberg-candide':[775,0,0,'112d02c840a831c841869c4763b514ceb530ee81d5b31cb4429037dfc2256993'],
 'gutenberg-arabian-nights':[1826,0,0,'892998b73cf8db0a73add086df3717e00d2b257f2437a503d7914547b6c05c2e'],
 'gutenberg-underdogs':[1221,0,0,'364528d0a25ed84a9fde0198a650743dffcce98452e11076d7a36b9858966458'],
 'gutenberg-equiano':[318,0,0,'b730a00993abea10fa1f6a0acf8059b05ae719f738e384f3d4a1119c506d0cfe'],
 'gutenberg-african-farm':[2343,0,0,'9eca71c535c02d110ef1d0f15f16618b2143f68a65a31c54b2c4d407c150bb99'],
 'gutenberg-douglass':[163,0,0,'898bd5dd9b560232de22fe6c92b8908a420e0e5af98b98188b8972386234d44d'],
 'gutenberg-seacole':[466,0,0,'1602380467514c2ed7e993b9f1fcf6634f929b12aea39056eaf6ad3688538c1c'],
 'gutenberg-beyond-good-and-evil':[319,0,0,'a7a5b47fe2612056bc2a26b2cb2fb13708fe4cf5391b0e980fd826fc7c5d6610'],
 'gutenberg-zarathustra':[3478,0,0,'bf35f86ffe4582d5a32d5bc6515d3033f8202143d53090f7494547fef8c8930e']
};
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');

test('all shared catalog books keep identical original text, IDs, contentVersion and hashes',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'catalog-emphasis-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const library=await createLibraryService({dataDir:dir}),entries=JSON.parse(await readFile('catalog/manifest.json','utf8'));
  assert.deepEqual(entries.map(e=>e.id).sort(),Object.keys(baseline).sort());
  let paragraphs=0,pairs=0;
  for(const entry of entries){
    const [expectedParagraphs,expectedUnderscored,expectedPairs,expectedHash]=baseline[entry.id];
    const book=await library.getBook(null,entry.id),rows=book.sections.flatMap(s=>s.paragraphs);
    assert.equal(rows.length,expectedParagraphs,entry.id+' paragraphs');
    assert.equal(rows.filter(p=>p.original.includes('_')).length,expectedUnderscored,entry.id+' underscored paragraphs');
    const count=rows.reduce((n,p)=>n+sourceEmphasisRanges(p.original).length,0);
    assert.equal(count,expectedPairs,entry.id+' conservative pairs');
    assert.equal(digest(JSON.stringify(rows.map(p=>[p.id,p.original]))),expectedHash,entry.id+' original text and IDs');
    const file=await readFile(path.join('catalog',entry.file));
    assert.equal(book.contentVersion,digest(file),entry.id+' contentVersion');
    paragraphs+=rows.length;pairs+=count;
  }
  assert.equal(paragraphs,28035);
  assert.equal(pairs,528,'218 Alice + 31 Meditations + 279 Walden conservative pairs');
});

test('visible emphasis coverage formats eligible originals only and never rewrites source ranges',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'catalog-emphasis-view-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const library=await createLibraryService({dataDir:dir});
  for(const id of Object.keys(baseline)){
    const book=await library.getBook(null,id),eligible=sourceEmphasisEligible(book),rows=book.sections.flatMap(s=>s.paragraphs);
    assert.equal(eligible,['gutenberg-alice','gutenberg-meditations','gutenberg-walden'].includes(id),id);
    let rendered=0;
    for(const p of rows){
      const layer=passagePresentation(p,{mode:'en',sourceEmphasis:eligible}).layers[0];
      assert.equal(layer.text,p.original,id);
      const ranges=layer.emphasis||[];
      for(const range of ranges){
        assert.equal(p.original.slice(range.start-1,range.end+1).startsWith('_'),true,id);
        assert.equal(p.original.slice(range.start-1,range.end+1).endsWith('_'),true,id);
        assert.equal(p.original.slice(range.start,range.end).includes('_'),false,id);
      }
      rendered+=ranges.length;
    }
    assert.equal(rendered,baseline[id][2],id+' rendered pairs');
  }
});

test('private uploads and translated layers keep underscore strings literal even when the syntax could match',()=>{
  const privateUpload={id:'p',original:'Keep my _private_file_ and _notes_ here.',translations:{interpretive:{text:'保留 _private_file_ 与 _notes_。'}}};
  for(const sourceEmphasis of [false,sourceEmphasisEligible({visibility:'private',source:{format:'txt'}})]){
    const view=passagePresentation(privateUpload,{mode:'parallel',sourceEmphasis});
    assert.equal(view.layers[0].emphasis,undefined);
    assert.equal(view.layers[1].emphasis,undefined);
    assert.equal(view.layers[0].text,privateUpload.original);
    assert.equal(view.layers[1].text,privateUpload.translations.interpretive.text);
  }
  const translation={id:'p',original:'Clean original.',translations:{interpretive:{text:'意译里 _强调_ 不是作者原文。'}}};
  assert.equal(passagePresentation(translation,{mode:'zh',sourceEmphasis:true}).layers[0].emphasis,undefined,'translation layers stay literal');
  assert.equal(sourceEmphasisRanges(privateUpload.original).length,1,'intraword underscores keep _private_file_ literal; the pure tokenizer still reports real pairs');
});
