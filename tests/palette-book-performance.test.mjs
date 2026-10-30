import test from 'node:test';
import assert from 'node:assert/strict';
import {matchPaletteBook} from '../app/palette-book.mjs';

const bookFor=original=>({chapters:[{id:'chapter',title:{en:'Synthetic chapter'}}],sections:[{chapterId:'chapter',paragraphs:[{id:'passage',original}]}]});

test('an early search hit only segments the excerpt instead of materializing the whole paragraph',t=>{
 const original=Intl.Segmenter.prototype.segment;let visited=0;
 t.mock.method(Intl.Segmenter.prototype,'segment',function(text){
  const segments=original.call(this,text);
  return {[Symbol.iterator]:function*(){for(const part of segments){visited++;yield part;}}};
 });
 const [hit]=matchPaletteBook(bookFor('target '+ 'a'.repeat(5000)),'target').hits;
 assert.equal(hit.label,'target '+'a'.repeat(173)+'…');
 assert.ok(visited<=181,'only the 180 displayed graphemes and one truncation check are needed; visited '+visited);
});

test('bounded excerpts retain exact complete source graphemes around normalized matches',()=>{
 const grapheme='👩🏽‍💻',original=grapheme.repeat(70)+'ＭＡＧＩＣ'+'e\u0301'.repeat(200);
 const [hit]=matchPaletteBook(bookFor(original),'magic').hits;
 assert.equal(hit.label,'…'+grapheme.repeat(36)+'ＭＡＧＩＣ'+'e\u0301'.repeat(139)+'…');
 assert.ok(hit.label.isWellFormed());
 for(const original of ['target','target '+'a'.repeat(173),'a'.repeat(36)+'target']){
  const [hit]=matchPaletteBook(bookFor(original),'target').hits;assert.equal(hit.label,original,'short and exact-length passages need no ellipsis');
 }
});
