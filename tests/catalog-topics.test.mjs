import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createLibraryService} from '../server/library-service.mjs';
import {digest} from '../server/document-import.mjs';

// GET-177 metadata regression plus the 2026-10-27 Nietzsche and 2026-10-28 classics editions.
// The original thirty-two rows remain byte-for-byte pinned. The frozen rows are the audited
// baseline of the shipped catalog: ids, source files and their SHA-256 (which is
// also the contentVersion), original languages, the pre-fiction topic sets and
// stable paragraph IDs. The fiction topic is the only allowed manifest change,
// and only for the curated unambiguous novels/stories. Nothing here may invent
// translations, records or classifications.
const BASELINE=[
['gutenberg-alice','alice.txt','01b38ea4c710a84bc18d0bd41271a5a1a92b94e97b2812f4dece97d4a694725e','en',['literature'],true,817,'01b38ea4c710a84b-p00001','01b38ea4c710a84b-p00817'],
['gutenberg-meditations','meditations.txt','6977474f82a39dd88a4af31a59504821658174d33c177732c54357e4d680b96c','grc',['philosophy'],false,746,'6977474f82a39dd8-p00001','6977474f82a39dd8-p00746'],
['gutenberg-walden','walden.txt','2d9a76a2e3e8195c69430516ebd33c4d0757a53ad432ff6186b7b794e6fe99f9','en',['philosophy','literature'],false,585,'2d9a76a2e3e8195c-p00001','2d9a76a2e3e8195c-p00585'],
['gutenberg-flatland','world/flatland.json','036a5e8fd197c0371daef9f5816845b2109d17ba290d4c052b8809bcdcf61951','en',['science','literature'],true,385,'036a5e8fd197c037-p00001','036a5e8fd197c037-p00385'],
['gutenberg-frankenstein','world/frankenstein.json','50ff55785f190ba3d548930fa850f99f1aa9f2e98e5de2fc2f127173dc5dd5b6','en',['science','literature'],true,760,'50ff55785f190ba3-p00001','50ff55785f190ba3-p00760'],
['gutenberg-erewhon','world/erewhon.json','8bbcb3dbf3cdfcc9e87a67d214242e56f4bbc2eca4f6f46a880adb8fda63fa6e','en',['science','literature'],true,614,'8bbcb3dbf3cdfcc9-p00001','8bbcb3dbf3cdfcc9-p00614'],
['gutenberg-time-machine','world/time-machine.json','763848d045c41d8f3931f87f351f9b621098321127ec97a71fce194ef757cba1','en',['science','literature'],true,306,'763848d045c41d8f-p00001','763848d045c41d8f-p00306'],
['gutenberg-au-room-of-ones-own','world/room-of-ones-own.json','90ed73bff38ddd2e01ddf69fa2302367931304675b45b941bc6caeb9600248d7','en',['history','literature'],false,150,'90ed73bff38ddd2e-p00001','90ed73bff38ddd2e-p00150'],
['gutenberg-on-liberty','world/on-liberty.json','81d4b1eb66e9c61548bea9554262950a451e5f70481c2c5e50e64e933f7b7582','en',['philosophy','history'],false,136,'81d4b1eb66e9c615-p00001','81d4b1eb66e9c615-p00136'],
['ccel-ivan-ilych','world/ivan-ilych.json','3199f09a4abfd5eba5d32df52a99d874092c6302fa6b9243284cbdfbbe64bc8c','ru',['philosophy','literature'],true,363,'3199f09a4abfd5eb-p00001','3199f09a4abfd5eb-p00363'],
['gutenberg-awakening','world/awakening.json','61a8ca66f7a58cd1b4744ba4d5149cf3c676e92f076fef83a53d33c0d1604a46','en',['literature','history'],true,1355,'61a8ca66f7a58cd1-p00001','61a8ca66f7a58cd1-p01355'],
['gutenberg-home-and-world','world/home-and-world.json','d2d1ae6bce21a95d86121d60b7e32584da79efb309d2aed8cdd00971950ff63b','bn',['literature','history'],true,1538,'d2d1ae6bce21a95d-p00001','d2d1ae6bce21a95d-p01538'],
['gutenberg-brazilian-tales','world/brazilian-tales.json','ca69c2d6fbd88c5051bd9b804a340c69089ff04eee22ed69c4b666d4d18a2014','pt',['literature'],true,424,'ca69c2d6fbd88c50-p00001','ca69c2d6fbd88c50-p00424'],
['gutenberg-book-of-tea','world/book-of-tea.json','cd52ebd15129098b9d478a20b7f8e36a5e9a5a1d53ecc4441b48da89b747099d','en',['philosophy','literature'],false,117,'cd52ebd15129098b-p00001','cd52ebd15129098b-p00117'],
['gutenberg-prophet','world/prophet.json','c7a36cac406f525d23d5940bb6250be5f3fa565b6b047779b507486b7f232193','en',['philosophy','literature'],false,764,'c7a36cac406f525d-p00001','c7a36cac406f525d-p00764'],
['gutenberg-tao-te-ching','world/tao-te-ching.json','2645bca82104b6fa609fad484d1e7c085f0dc35fa4b5beed46e6a90a2122da84','zh',['philosophy'],false,250,'2645bca82104b6fa-p00001','2645bca82104b6fa-p00250'],
['gutenberg-dhammapada','world/dhammapada.json','9846ddf7b69fd6ace4ecab08eb69aef86c9d2aa84bfebfd48fe6f7c73c48e829','pi',['philosophy'],false,414,'9846ddf7b69fd6ac-p00001','9846ddf7b69fd6ac-p00414'],
['gutenberg-bhagavad-gita','world/bhagavad-gita.json','b967902ff029c48f81d77b4669d3d2d419c1a04bf53544aed31f8639ba4dc30a','sa',['philosophy','literature'],false,295,'b967902ff029c48f-p00001','b967902ff029c48f-p00295'],
['gutenberg-rubaiyat','world/rubaiyat.json','518a6c37316408ff7040d821ae004a9bde9a8a093cd66b280f6a016fdc51b1e4','fa',['philosophy','literature'],false,402,'518a6c37316408ff-p00001','518a6c37316408ff-p00402'],
['gutenberg-notes-underground','world/notes-underground.json','7def971e8ffe8a58335b9567fb549ce4f6367b6e09ccace52a8e79db77c89f98','ru',['philosophy','literature'],true,494,'7def971e8ffe8a58-p00001','7def971e8ffe8a58-p00494'],
['gutenberg-young-werther','world/young-werther.json','e74a117f3ba44a2e07a76329621692258c3be3fa43750f725fc1bb20f321cc3f','de',['literature'],true,435,'e74a117f3ba44a2e-p00001','e74a117f3ba44a2e-p00435'],
['gutenberg-pride-prejudice','world/pride-prejudice.json','2ab5b00b3feb86cbd7af22a0d6a2de2e8eb40f1e84e30dd8d942b8a8a22647f4','en',['literature'],true,2058,'2ab5b00b3feb86cb-p00001','2ab5b00b3feb86cb-p02058'],
['gutenberg-don-quixote','world/don-quixote.json','d47ad6492265b1243e8c52b11fd6b06e1a17700f2165fbca6cf05497bd631e6b','es',['literature'],true,3718,'d47ad6492265b124-p00001','d47ad6492265b124-p03718'],
['gutenberg-candide','world/candide.json','35a0415f40c38c2ca2358915ab8345df0f8b153402142e5e21e6103ef811807b','fr',['philosophy','literature'],true,775,'35a0415f40c38c2c-p00001','35a0415f40c38c2c-p00775'],
['gutenberg-arabian-nights','world/arabian-nights.json','8ad53ad6c81129e51eef40624ed4a04a35fa1e61b205156c719a1433d16b64e2','ar',['literature'],true,1826,'8ad53ad6c81129e5-p00001','8ad53ad6c81129e5-p01826'],
['gutenberg-underdogs','world/underdogs.json','5e79587102c63e3f0a47ef229d5785e063dd60e006dbc60fcb77a5d7d8560d5d','es',['literature','history'],true,1221,'5e79587102c63e3f-p00001','5e79587102c63e3f-p01221'],
['gutenberg-equiano','world/equiano.json','56acf0cdc09e6f54f347eb95f0883da8c71493e175fd3637f4f5c6cbd8cc1a89','en',['history','literature'],false,318,'56acf0cdc09e6f54-p00001','56acf0cdc09e6f54-p00318'],
['gutenberg-african-farm','world/african-farm.json','c24e2b5f86aa46340fd891e7cc26217c692f418c6097044218267e235fde3905','en',['literature','history'],true,2343,'c24e2b5f86aa4634-p00001','c24e2b5f86aa4634-p02343'],
['gutenberg-douglass','world/douglass.json','ca232c39e000830d259fa7bfbca39caa3bc0e75aa045f5fbaa489ed1a7721de5','en',['history','literature'],false,163,'ca232c39e000830d-p00001','ca232c39e000830d-p00163'],
['gutenberg-seacole','world/seacole.json','dd7438368201924ef27803132fffd17bb96bb449a3c25245955a3d1d93b621f1','en',['history','literature'],false,466,'dd7438368201924e-p00001','dd7438368201924e-p00466'],
['gutenberg-beyond-good-and-evil','world/beyond-good-and-evil.json','e19805bf4bbb11e3e02e2a4df2ca3049baca32fca1a57bb83fe7040079c9e1d0','de',['philosophy'],false,319,'e19805bf4bbb11e3-p00001','e19805bf4bbb11e3-p00319'],
['gutenberg-zarathustra','world/zarathustra.json','0429d315f5d90046c051b09327b7665a83f3732b7a1e455319c173c78a4af5c1','de',['philosophy','literature'],false,3478,'0429d315f5d90046-p00001','0429d315f5d90046-p03478'],
["gutenberg-analects-zh","world/analects-zh.json","6d8d1cfb7fc3d3c5036c3b3a6ecb415174c3965489ca8c23f39ee3db336e5e6e","zh",["philosophy","history"],false,492,"6d8d1cfb7fc3d3c5-p00001","6d8d1cfb7fc3d3c5-p00492","zh"],
["gutenberg-mencius-zh","world/mencius-zh.json","b3379a295f5c813e394722b72efec43d4289689ea72eb44bea47c5905a6c4a66","zh",["philosophy","history"],false,658,"b3379a295f5c813e-p00001","b3379a295f5c813e-p00658","zh"],
["gutenberg-zhuangzi-zh","world/zhuangzi-zh.json","2a64b1134cb8988910584313540d8322c1e0681c9e27166e8a55f8e958463b54","zh",["philosophy","literature"],false,270,"2a64b1134cb89889-p00001","2a64b1134cb89889-p00270","zh"],
["gutenberg-art-of-war-zh","world/art-of-war-zh.json","320edf22f0079233502104817deaccd0e3d428907aa2f5b141b5d7734922f634","zh",["philosophy","history"],false,39,"320edf22f0079233-p00001","320edf22f0079233-p00039","zh"],
["gutenberg-tao-te-ching-zh","world/tao-te-ching-zh.json","5cf18c66f57352f32f7f431a56ffc0f5429f633625d609d80eb240bcf50f9b43","zh",["philosophy","literature"],false,81,"5cf18c66f57352f3-p00001","5cf18c66f57352f3-p00081","zh"],
["gutenberg-republic","world/republic.json","f7555cb8337e63b40195aadfb8f54b6ee17291bfc7f126cf98750ce1dc6e4631","grc",["philosophy","history"],false,4317,"f7555cb8337e63b4-p00001","f7555cb8337e63b4-p04317","en"],
["gutenberg-nicomachean-ethics","world/nicomachean-ethics.json","c4b85208c4786a06fe03291ea127bceab6f07781b0109d9a2f59d86f83e281ac","grc",["philosophy"],false,1439,"c4b85208c4786a06-p00001","c4b85208c4786a06-p01439","en"],
["gutenberg-epictetus-discourses-handbook","world/epictetus-discourses-handbook.json","c710655da8b7dad649792003a89eb21d3cbe1576069f1b5f3d3131bd74192f6b","grc",["philosophy"],false,292,"c710655da8b7dad6-p00001","c710655da8b7dad6-p00292","en"],
["gutenberg-confessions-augustine","world/confessions-augustine.json","36a5abf3794e2f0300eab955570506769b977a98fa024a643ae98fb58c121341","la",["philosophy","literature"],false,461,"36a5abf3794e2f03-p00001","36a5abf3794e2f03-p00461","en"],
["gutenberg-prince","world/prince.json","db4a155675088745f00cafaaab225f5a0b8db79b9fb1e6e99fb3bde423ae40a9","it",["philosophy","history"],false,293,"db4a155675088745-p00001","db4a155675088745-p00293","en"],
["gutenberg-discourse-on-method","world/discourse-on-method.json","3812d9bee10cdfc9c3488e9e2c36f657c670ae46d2a22d816f1b391271fb7e60","fr",["philosophy","science"],false,64,"3812d9bee10cdfc9-p00001","3812d9bee10cdfc9-p00064","en"],
["gutenberg-ethics-spinoza","world/ethics-spinoza.json","ea633e031d17f226d4c4f5b2a41e3a1b29a3d1d2d2ba943cc769e8d496f03319","la",["philosophy"],false,1081,"ea633e031d17f226-p00001","ea633e031d17f226-p01081","en"],
["gutenberg-enquiry-human-understanding","world/enquiry-human-understanding.json","42d6305f693fb747cb35403efb1e76b0fffeda1a183c4520976835c6c5f03bd1","en",["philosophy","science"],false,352,"42d6305f693fb747-p00001","42d6305f693fb747-p00352","en"],
["gutenberg-novum-organum","world/novum-organum.json","0a2e4396711f06fb854316503e436f27da2b81d63239466c2bd304ce55a4f3fc","la",["philosophy","science"],false,807,"0a2e4396711f06fb-p00001","0a2e4396711f06fb-p00807","en"],
["gutenberg-hamlet","world/hamlet.json","9125e0650999275b3325f7882397550cdf4899d808eb069c8570f8600c2ecea7","en",["literature"],false,1380,"9125e0650999275b-p00001","9125e0650999275b-p01380","en"],
["gutenberg-odyssey","world/odyssey.json","d45b3742949e403e820275d035ab28b51541f5715620f07e5f518882e6842e2d","grc",["literature"],false,1288,"d45b3742949e403e-p00001","d45b3742949e403e-p01288","en"],
["gutenberg-crime-and-punishment","world/crime-and-punishment.json","1b38f2309b31b960542b39928ea7549ad353416862f8870a8453150b9ed565f0","ru",["literature","philosophy"],true,3914,"1b38f2309b31b960-p00001","1b38f2309b31b960-p03914","en"],
["gutenberg-wealth-of-nations","world/wealth-of-nations.json","fa1485aad379b088640daeba26128f020267d54bbeecfb2221e0ae02c5b22783","en",["history","philosophy"],false,2122,"fa1485aad379b088-p00001","fa1485aad379b088-p02122","en"],
["gutenberg-origin-of-species","world/origin-of-species.json","dc687b16a644442e64101da3278d622cda239030b69e0e2c1c9f6a8bdb9a1d96","en",["science","history"],false,1936,"dc687b16a644442e-p00001","dc687b16a644442e-p01936","en"],
["gutenberg-peloponnesian-war","world/peloponnesian-war.json","c19045ef406da849551e408af8fe0bfee41d19588438f3a4bc4c48cf94e2268a","grc",["history","philosophy"],false,1029,"c19045ef406da849-p00001","c19045ef406da849-p01029","en"],
["gutenberg-wisdom-of-life-1","world/wisdom-of-life-1.json","4930e6968f24cac6fa7d6f71835d7e8997f3e49c94599583926c9df41e14e487","de",["philosophy"],false,296,"4930e6968f24cac6-p00001","4930e6968f24cac6-p00296","en"],
["gutenberg-wisdom-of-life-2","world/wisdom-of-life-2.json","7ae569797e7e7aab60d1bac73b5376edaabf2197fd30fe3ec311100cfade92dc","de",["philosophy"],false,561,"7ae569797e7e7aab-p00001","7ae569797e7e7aab-p00561","en"],
["gutenberg-genealogy-of-morals","world/genealogy-of-morals.json","baf2a53d79dde6340de0ff5461f0b082e2778e18ff14ca2d5185d4baa7fc582c","de",["philosophy","history"],false,180,"baf2a53d79dde634-p00001","baf2a53d79dde634-p00180","en"],
["gutenberg-dream-red-chamber-1","world/dream-red-chamber-1.json","e50f9fdde16de703c5386deea8e6716791a7f132e9d75ebd4c8891baa11cbc7e","zh",["literature"],true,1143,"e50f9fdde16de703-p00001","e50f9fdde16de703-p01143","zh"],
["gutenberg-dream-red-chamber-2","world/dream-red-chamber-2.json","2aa272de7ff23753afa855707749e1ac4bad356392b33c6e6cf6d7ddadfcd460","zh",["literature"],true,929,"2aa272de7ff23753-p00001","2aa272de7ff23753-p00929","zh"],
["gutenberg-dream-red-chamber-3","world/dream-red-chamber-3.json","263be03640e9a383e2688e81cc7e856641dba1e147e217893b02a2cca352aab9","zh",["literature"],true,553,"263be03640e9a383-p00001","263be03640e9a383-p00553","zh"],
["gutenberg-essays-montaigne-1","world/essays-montaigne-1.json","064f59e61e7784dd2bf4120ac9801461f2f00c29ebf3f0b80851dd1688b2b4e7","fr",["philosophy","literature"],false,1179,"064f59e61e7784dd-p00001","064f59e61e7784dd-p01179","en"],
["gutenberg-essays-montaigne-2","world/essays-montaigne-2.json","e7c1bb4c8711d09fc22384dde766d993e9b5533de909f7632bd5243fc28ea9ee","fr",["philosophy","literature"],false,1425,"e7c1bb4c8711d09f-p00001","e7c1bb4c8711d09f-p01425","en"],
["gutenberg-essays-montaigne-3","world/essays-montaigne-3.json","789c3c7908e601064f1c30d6807ef669f95bd8a89c993dfa722e23be77c7999c","fr",["philosophy","literature"],false,1237,"789c3c7908e60106-p00001","789c3c7908e60106-p01237","en"],
["gutenberg-world-will-idea-1","world/world-will-idea-1.json","e29c85e30dbc1893f9d955ae478f762bf6bea4ae6f90ca8911ad9a5d19ca6284","de",["philosophy"],false,597,"e29c85e30dbc1893-p00001","e29c85e30dbc1893-p00597","en"],
["gutenberg-world-will-idea-2","world/world-will-idea-2.json","53778d8c71179281ac6f8766905fd3edff9f8d6de079782c89881eb9c23255fc","de",["philosophy"],false,636,"53778d8c71179281-p00001","53778d8c71179281-p00636","en"],
["gutenberg-world-will-idea-3","world/world-will-idea-3.json","95165d8afe7c919249ac4eccb1c9229df448f50a9e23153bd3a50622e21ca369","de",["philosophy"],false,2285,"95165d8afe7c9192-p00001","95165d8afe7c9192-p02285","en"]
];

test('the whole shipped catalog keeps its ids, source bytes, content versions and stable paragraph ids',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'catalog-fiction-regression-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const manifest=JSON.parse(await readFile('catalog/manifest.json','utf8'));
  assert.deepEqual(manifest.map(entry=>entry.id),BASELINE.map(row=>row[0]));
  const library=await createLibraryService({dataDir:dir});
  const listing=await library.list(null);
  for(const [id,file,sha,originalLanguage,baseTopics,fiction,count,firstId,lastId,sourceLanguage='en'] of BASELINE){
    const entry=manifest.find(row=>row.id===id);
    assert.equal(entry.file,file,id+' keeps its exact source file');
    assert.equal(entry.originalLanguage,originalLanguage,id+' keeps its recorded original language');
    assert.equal(entry.sourceLanguage,sourceLanguage,id+' keeps its source language');
    assert.deepEqual(entry.topics,[...baseTopics,...(fiction?['fiction']:[])],id+' may only gain the curated fiction topic');
    const bytes=await readFile(path.join('catalog',file));
    assert.equal(digest(bytes),sha,id+' source bytes are unchanged');
    const row=listing.find(book=>book.bookId===id);
    assert.equal(row.contentVersion,sha,id+' contentVersion still matches its source hash');
    assert.deepEqual(row.topics,entry.topics,id+' listings expose the curated metadata');
    const book=await library.getBook(null,id);
    const ids=book.sections.flatMap(section=>section.paragraphs.map(paragraph=>paragraph.id));
    assert.equal(ids.length,count,id+' keeps its stable paragraph count');
    assert.equal(ids[0],firstId,id+' keeps its first stable paragraph id');
    assert.equal(ids.at(-1),lastId,id+' keeps its last stable paragraph id');
  }
});

test('fiction marks only the curated unambiguous novels and stories, never poems, essays, scriptures or memoirs',async()=>{
  const manifest=JSON.parse(await readFile('catalog/manifest.json','utf8'));
  const fiction=manifest.filter(entry=>entry.topics.includes('fiction')).map(entry=>entry.id);
  assert.deepEqual(fiction,BASELINE.filter(row=>row[5]).map(row=>row[0]));
  for(const id of ['gutenberg-meditations','gutenberg-walden','gutenberg-au-room-of-ones-own','gutenberg-on-liberty','gutenberg-book-of-tea','gutenberg-prophet','gutenberg-tao-te-ching','gutenberg-dhammapada','gutenberg-bhagavad-gita','gutenberg-rubaiyat','gutenberg-equiano','gutenberg-douglass','gutenberg-seacole']){
    assert.ok(!manifest.find(entry=>entry.id===id).topics.includes('fiction'),id+' is not a novel or story and must not claim fiction');
  }
});
