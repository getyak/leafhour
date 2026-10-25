import test from 'node:test';
import assert from 'node:assert/strict';
import {translationDisclosureMessage} from '../app/catalog-sample.mjs';

test('disclosure derives review status and attribution from saved variants, including personal sample overrides',()=>{
 const book={chineseSample:{paragraphs:6,translator:'Old sample provider'},sections:[{paragraphs:[
  {translations:{literal:{text:'Reviewed human translation',status:'reviewed',origin:'human',translator:'Human editor',license:'CC-BY-4.0'},interpretive:{text:'AI candidate',status:'draft',origin:'ai',translator:'AI provider',license:'CC0-1.0'}}},
  {translations:{literal:{text:'Legacy translation'}}},
  {translations:{interpretive:{text:'   ',status:'reviewed'}}}
 ]}]};
 const message=translationDisclosureMessage(book);
 assert.equal(message.id,'sample.disclosureMetadata');
 assert.deepEqual(message.params,{count:3,reviewed:1,draft:1,unknown:1,ai:1,translators:'Human editor · AI provider',uncredited:1,models:'—',licenses:'CC-BY-4.0 · CC0-1.0',unlicensed:1});
 assert.equal(book.sections[0].paragraphs[0].translations.literal.status,'reviewed');
});
test('a book with no saved translations is not described as an unreviewed AI translation',()=>{
 assert.deepEqual(translationDisclosureMessage({sections:[{paragraphs:[{translations:{}}]}]}),{id:'sample.disclosureNone'});
});
