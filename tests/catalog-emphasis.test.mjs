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
 'gutenberg-zarathustra':[3478,0,0,'bf35f86ffe4582d5a32d5bc6515d3033f8202143d53090f7494547fef8c8930e'],
"gutenberg-analects-zh":[492,0,0,"21d5857a590376e2790fb1c0a9409333855cdde0325453a2ad71fa5825227dfb"],
"gutenberg-mencius-zh":[658,0,0,"25543434b2899708e509568c501fd2e6f3cc1e38ade74eb682bfe35835bda581"],
"gutenberg-zhuangzi-zh":[270,0,0,"c81297783fc4f0ad45c1c78f3042e9a885a150f6662a0744ecd268752c2b686b"],
"gutenberg-art-of-war-zh":[39,0,0,"53d7ef453a6917533c0c1942b2ab0f3d18bd7b1ad7b78eb7540be8d1bda19c42"],
"gutenberg-tao-te-ching-zh":[81,0,0,"db00934adea455acfe9b8299dfe8e62a6e88f87cc8c6b4bebbb0b7e959d92428"],
"gutenberg-republic":[4317,0,0,"ccca1d8d5cd8ae2514aab66248132c7229830c4f298d519216d33cfaf70a8e48"],
"gutenberg-nicomachean-ethics":[1439,0,0,"8924eb69285203028f5e5cfef60dfde7de00578a311b2625ff9aff131039f383"],
"gutenberg-epictetus-discourses-handbook":[292,0,0,"2f375e6d8275c1b796347ba955b85b4c82e0af83716fe7cece8d356fccad701b"],
"gutenberg-confessions-augustine":[461,0,0,"42f0df96845c3bb3e7862581e9cdd1b0afc38eb23264b7d0592a01570e2a6a4d"],
"gutenberg-prince":[293,0,0,"2a51c2e5fb313ea4858b34b794a1f2f9062ceb23476570bb0f62c01bb3126111"],
"gutenberg-discourse-on-method":[64,0,0,"2259c8ac13b5e737b977139150ea54c0727930f0794bcbba2d2fe13428e37ef8"],
"gutenberg-ethics-spinoza":[1081,0,0,"51d13fafd456a1b0a138c7f22f9887b88bfa6bb7754d1e82f8a46a68f5095c5c"],
"gutenberg-enquiry-human-understanding":[352,0,0,"63e88e78a5ed05a3559ac0a7b5125295190576e831934e9ecc110d2e93ccd780"],
"gutenberg-novum-organum":[807,0,0,"0a8026a82e73b0112ed37f2934e7320fa8896848d6be5f644de5300fe4d912b4"],
"gutenberg-hamlet":[1380,0,0,"c7a3c7b1fbeac16c7d07ee12116b5a496ae54a2107af28e4a68585841ad48215"],
"gutenberg-odyssey":[1288,0,0,"0d4dfe437fadd1195da8133b59ddf91399b875f210e5dde5e9440b14826cd2fd"],
"gutenberg-crime-and-punishment":[3914,0,0,"afb80ca603e76ff534a312636ce89ba22d5ec54801a723e32697f09e2f1f10e2"],
"gutenberg-wealth-of-nations":[2122,0,0,"f51f596e583187a4bac60d77b48c13b58e6b4f263c7f4499398904bcf058ae98"],
"gutenberg-origin-of-species":[1219,0,0,"2daadcd6f43f51eb2624af9dd431316a91dc91f649288cda61504509fb51c525"],
"gutenberg-peloponnesian-war":[1029,0,0,"3c12f84b49e99ce7094f4309a2a08af9f8154607af73728d3cf069271848accd"],
"gutenberg-wisdom-of-life-1":[296,0,0,"2c68662e2778c64087fdb7a18f01ec9e2b3af1e8bf271491c53905d6d3a877fd"],
"gutenberg-wisdom-of-life-2":[561,0,0,"7287f20d6902e961599fc89b0d64069c1db97fab6c57b8b067bd28306b13f7d4"],
"gutenberg-genealogy-of-morals":[180,0,0,"bb8e875935b37fd32b1f28444eb51369e0f7c88aaa6fcdf4721e61e2b00e936e"],
"gutenberg-dream-red-chamber-1":[1143,7,0,"5ac62d4ecebe1c2fe37444575b4c51f96464f847839c13a44cc6053c5e2c1a09"],
"gutenberg-dream-red-chamber-2":[929,16,0,"43f8f2cc4c2eea64e78161821d55d4cee710c359467ae1e08ce58ec17f624011"],
"gutenberg-dream-red-chamber-3":[553,1,0,"9a512db28ce1d5e64f1a8c79e9f26994aa48fab3267c7764d82b01bd62b14cec"],
"gutenberg-essays-montaigne-1":[1179,0,0,"9c6d65a98f0b2b648a67a342be4c411be2e39a526a39f9330aa69a962fd0b38d"],
"gutenberg-essays-montaigne-2":[1425,1,0,"9e5034248451146d9c0e818f7c5a3f42eb54c4f5677de622000fba2ca2bdeac0"],
"gutenberg-essays-montaigne-3":[1237,0,0,"91d4396ca9b1eb97bdbc1469e0ad8ad545ebe5fc39eeb57c1920014f2fcadc5b"],
"gutenberg-world-will-idea-1":[597,0,0,"32ce8fd995f5d30522abe198585cf7fcd310585647c4746673b466afa0506b64"],
"gutenberg-world-will-idea-2":[636,0,0,"a2135df631a0b6b63e4ebcb8ad358557bfa68fa69df26eab04165c78d36a9802"],
"gutenberg-world-will-idea-3":[2285,0,0,"31e7dd0ccfad7721c331e0236ce96fd021b66d72bc9d043cc89dda26f88d58da"]
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
  assert.equal(paragraphs,60654);
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
