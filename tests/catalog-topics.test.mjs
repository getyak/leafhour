import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createLibraryService} from '../server/library-service.mjs';
import {digest} from '../server/document-import.mjs';

// GET-177 metadata regression plus the two 2026-10-27 Nietzsche editions.
// The original thirty rows remain byte-for-byte pinned. The frozen rows are the audited
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
['gutenberg-zarathustra','world/zarathustra.json','0429d315f5d90046c051b09327b7665a83f3732b7a1e455319c173c78a4af5c1','de',['philosophy','literature'],false,3478,'0429d315f5d90046-p00001','0429d315f5d90046-p03478']
];

test('the whole shipped catalog keeps its ids, source bytes, content versions and stable paragraph ids',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'catalog-fiction-regression-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const manifest=JSON.parse(await readFile('catalog/manifest.json','utf8'));
  assert.deepEqual(manifest.map(entry=>entry.id),BASELINE.map(row=>row[0]));
  const library=await createLibraryService({dataDir:dir});
  const listing=await library.list(null);
  for(const [id,file,sha,originalLanguage,baseTopics,fiction,count,firstId,lastId] of BASELINE){
    const entry=manifest.find(row=>row.id===id);
    assert.equal(entry.file,file,id+' keeps its exact source file');
    assert.equal(entry.originalLanguage,originalLanguage,id+' keeps its recorded original language');
    assert.equal(entry.sourceLanguage,'en',id+' keeps its source language');
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
