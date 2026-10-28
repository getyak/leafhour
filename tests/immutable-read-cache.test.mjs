import test from 'node:test';
import assert from 'node:assert/strict';
import {createImmutableReadCache} from '../server/immutable-read-cache.mjs';

test('concurrent immutable reads share one load and isolate every returned object',async()=>{
 const cache=createImmutableReadCache(),source={sections:[{text:'Saved source'}]};let loads=0,release;
 const blocked=new Promise(resolve=>{release=resolve;}),load=async()=>{loads++;await blocked;return source;};
 const first=cache.read('/users/a/chapters/hash.json',load),second=cache.read('/users/a/chapters/hash.json',load);
 await Promise.resolve();assert.equal(loads,1);release();
 const [a,b]=await Promise.all([first,second]);a.sections[0].text='Request mutation';source.sections[0].text='Loader mutation';
 assert.equal(b.sections[0].text,'Saved source');assert.equal((await cache.read('/users/a/chapters/hash.json',load)).sections[0].text,'Saved source');assert.equal(loads,1);
});

test('the byte budget evicts the least recently used document using encoded UTF-8 size',async()=>{
 // Each encoded document is 14 bytes, although its JSON string is 12 code units.
 const cache=createImmutableReadCache({maxBytes:28}),loads={};
 const read=key=>cache.read(key,async()=>{loads[key]=(loads[key]||0)+1;return {text:'甲'};});
 await read('a');await read('b');await read('a');await read('c');await read('a');
 assert.equal(loads.a,1,'a hit must refresh recency');await read('b');assert.equal(loads.b,2,'the least recently used document must be reloaded');
});

test('a document larger than the byte budget is served without displacing a cached document',async()=>{
 const cache=createImmutableReadCache({maxBytes:14});let smallLoads=0,largeLoads=0;
 const small=()=>cache.read('small',async()=>{smallLoads++;return {text:'甲'};}),large=()=>cache.read('large',async()=>{largeLoads++;return {text:'甲乙'};});
 await small();assert.deepEqual(await large(),{text:'甲乙'});await large();await small();assert.equal(smallLoads,1);assert.equal(largeLoads,2);
});

test('a rejected coalesced load releases its key so a later read can recover',async()=>{
 const cache=createImmutableReadCache();let loads=0;
 const broken=async()=>{loads++;throw Error('storage outage');};
 const results=await Promise.allSettled([cache.read('chapter',broken),cache.read('chapter',broken)]);
 assert.equal(loads,1);assert.equal(results.every(result=>result.status==='rejected'&&result.reason.message==='storage outage'),true);
 assert.deepEqual(await cache.read('chapter',async()=>({source:'Recovered'})),{source:'Recovered'});
});
