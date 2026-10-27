import test from 'node:test';
import assert from 'node:assert/strict';
import {publicPersonShare} from '../app/person-share.mjs';
const person={id:'writer',visibility:'public',originalName:'Writer',names:{en:'Writer'},intro:{en:'A public introduction.'},works:[],sources:[],excerpts:[]};
test('shared cards return to the configured self-hosted instance without accepting unrelated destinations',()=>{
 const url='https://reading.example/people/writer';assert.equal(publicPersonShare(person,{publicUrl:url,publicOrigin:'https://reading.example'}).url,url);
 assert.equal(publicPersonShare(person,{publicUrl:url}),null);
 assert.equal(publicPersonShare(person,{publicUrl:'https://foreign.example/people/writer',publicOrigin:'https://reading.example'}),null);
 assert.equal(publicPersonShare(person,{publicUrl:'http://127.0.0.1:8330/people/writer',publicOrigin:'http://127.0.0.1:8330'}).url,'http://127.0.0.1:8330/people/writer');
});
