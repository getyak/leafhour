import test from 'node:test';
import assert from 'node:assert/strict';
import {portableChatTurns} from '../app/portable-chat.mjs';
test('all person citations in a valid stored answer survive backup, including more than twenty four',()=>{
 const book={bookId:'one',contentVersion:'v1',sections:[{chapterId:'c1',paragraphs:[{id:'p1',original:'Source'}]}]};
 const refs=Array.from({length:25},(_,n)=>({personId:'writer',revision:1,sourceId:'source-'+n,title:'Source',url:'https://example.org/source/'+n}));
 const turn={id:'question',origin:'user',text:'Explain this writer.',passageId:'p1',contentVersion:'v1',createdAt:'2026-10-28T00:00:00Z',status:'completed',answer:{kind:'conversation',origin:'ai',summary:'A reading response.',sourceRefs:[],recommendations:[],personSources:refs}};
 assert.deepEqual(portableChatTurns({kind:"marginalia-reader-chat",schemaVersion:1,bookId:"one",turns:[turn]},book)[0].answer.personSources,refs);
});
