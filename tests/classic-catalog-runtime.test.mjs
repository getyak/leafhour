import test from 'node:test';
import assert from 'node:assert/strict';
import {structuredCatalogBook} from '../server/structured-catalog.mjs';
import {passagePresentation} from '../app/passage-layers.mjs';
import {bookReadingLanguages} from '../app/book-reading-languages.mjs';

const entry={id:'catalog-fixture',file:'world/fixture.json',title:'原典',originalTitle:'原典',author:'Source author',sourceLanguage:'zh',originalLanguage:'zh',topics:['philosophy']};
const document=()=>({schemaVersion:1,downloadUrl:'https://www.gutenberg.org/ebooks/23839',downloadSha256:'a'.repeat(64),license:'Public-domain source fixture',notices:'Original source notices',importedAt:'2026-10-28',chapters:[{title:'Source chapter',kind:'body',paragraphs:['子曰：「學而時習之，不亦說乎？」','Year    Price\n1700    10\n1701     9']}]});
const build=(doc,e=entry)=>structuredCatalogBook(e,Buffer.from(JSON.stringify(doc)));

test('a Chinese original remains source Chinese, never an invented Chinese translation',()=>{
 const book=build(document());assert.equal(book.sourceLanguage,'zh');assert.equal(book.source.originalLanguage,'zh');
 assert.deepEqual(bookReadingLanguages(book),{sourceLanguage:'zh',translationLanguages:[],supportsParallel:false,translatedParagraphs:0,translationCoverage:'none'});
 const p=book.sections[0].paragraphs[0],view=passagePresentation(p,{mode:'zh',sourceLanguage:book.sourceLanguage});
 assert.equal(view.layers[0].kind,'original');assert.equal(view.layers[0].fallback,undefined);assert.equal(view.layers[0].text,p.original);assert.deepEqual(p.translations,{});
});

test('numeric source tables preserve their exact characters and a separate presentation hint',()=>{
 const doc=document();doc.layouts={'0:1':{presentation:'preformatted'}};const book=build(doc),p=book.sections[0].paragraphs[1];
 assert.equal(p.original,doc.chapters[0].paragraphs[1]);assert.equal(p.source.presentation,'preformatted');
 assert.equal(passagePresentation(p,{mode:'en',sourceLanguage:'en'}).layers[0].preformatted,true);
 assert.throws(()=>build({...doc,layouts:{'0:9':{presentation:'preformatted'}}}),/layout/i);
 assert.throws(()=>build({...doc,layouts:{'0:1':{presentation:'html'}}}),/layout/i);
});

test('original figures are anchored resources, not additional author prose',()=>{
 const doc=document();doc.resources=[{chapterIndex:0,paragraphIndex:0,url:'/book-assets/fixture.png',title:'Original figure',originalUrl:'https://www.gutenberg.org/files/2009/images/diagram.jpg',sha256:'b'.repeat(64),mime:'image/png',bytes:30}];
 const book=build(doc),p=book.sections[0].paragraphs[0];assert.equal(p.original,doc.chapters[0].paragraphs[0]);
 assert.equal(p.source.resources[0].url,'/book-assets/fixture.png');assert.equal(book.source.resources.length,1);assert.equal(book.source.illustrations,'linked_originals');
 assert.throws(()=>build({...doc,resources:[{...doc.resources[0],paragraphIndex:99}]}),/resource/i);
 assert.throws(()=>build({...doc,resources:[{...doc.resources[0],url:'javascript:alert(1)'}]}),/resource/i);
});
