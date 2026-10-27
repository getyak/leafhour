import test from 'node:test';
import assert from 'node:assert/strict';
import {loadPeopleSeeds} from '../server/people-sources.mjs';
import {validatePersonRecord} from '../app/person-model.mjs';
test('person evidence and portraits cannot retain access credentials in URL query parameters',async()=>{
 const person=(await loadPeopleSeeds()).find(p=>p.id==='virginia-woolf'),options={publicBookIds:['gutenberg-au-room-of-ones-own','gutenberg-frankenstein']};
 for(const query of ['access_token=private','X-Amz-Signature=private','apiKey=private','password=private']){
  const source=structuredClone(person);source.sources[0].url='https://example.org/source?'+query;assert.throws(()=>validatePersonRecord(source,options));
  const photo=structuredClone(person);photo.portrait.url='https://example.org/portrait.jpg?'+query;assert.throws(()=>validatePersonRecord(photo,options));
 }
 const normal=structuredClone(person);normal.sources[0].url='https://www.wikidata.org/w/api.php?action=wbgetentities&ids=Q40909&format=json';assert.doesNotThrow(()=>validatePersonRecord(normal,options));
});
