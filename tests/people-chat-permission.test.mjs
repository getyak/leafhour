import test from 'node:test';
import assert from 'node:assert/strict';
import {createLibraryChatState} from '../app/library-chat-state.mjs';
test('person management permission is explicit and remains in a captured retry payload',()=>{
 let saved;const state=createLibraryChatState({makeId:()=> 'person-question',writePending:(_o,_b,value)=>saved=value});
 state.setContext('reader','one');state.resolveLoad(state.beginLoad(),{available:true,bookId:'one',contentVersion:'v1',scope:{mode:'library',revision:1},context:{passageId:'p1',original:'Source'},turns:[]});
 state.setDraft('Create a person record.');const request=state.beginSend({peopleWrites:true});assert.equal(request.payload.peopleWrites,true);assert.equal(saved.payload.peopleWrites,true);
});
