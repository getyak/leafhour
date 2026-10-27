import test from 'node:test';
import assert from 'node:assert/strict';
import {loadPeopleSeeds} from '../server/people-sources.mjs';
import {createPeopleService} from '../server/people-service.mjs';
import {createReadingAgentTools} from '../server/reading-agent-tools.mjs';
test('current private book can read its matching public author without exposing the private book in person data',async()=>{
 const seeds=await loadPeopleSeeds(),people=createPeopleService({seeds,publicBookIds:['gutenberg-au-room-of-ones-own','gutenberg-frankenstein'],dataStore:{read:async(_k,f)=>f,mutate:async()=>{throw Error('No write expected');}}});
 const book={bookId:'private-book',author:'James P. Carse',title:{en:'Finite and Infinite Games'},contentVersion:'v1',chapters:[],sections:[]};
 const tools=createReadingAgentTools({library:{},people,user:{id:'reader'},bookId:book.bookId,currentBook:book});
 assert.deepEqual((await tools.execute('people_search',{})).people.map(p=>p.id),['james-p-carse']);
 const context=await tools.execute('people_get_work_context',{personId:'james-p-carse',workId:'carse-finite-infinite'});assert.equal(context.error,undefined);assert.ok(!JSON.stringify(context).includes('private-book'));
 assert.deepEqual(people.publicIdsForBook(book.bookId,{...book,author:'A different person'}),[]);
});
