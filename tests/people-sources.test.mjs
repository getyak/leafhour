import test from 'node:test';
import assert from 'node:assert/strict';
import {createSourceReader,searchPeople,isPublicAddress} from '../server/people-sources.mjs';

test('registered source reader refuses unknown ids, credentials and private DNS before transport',async()=>{
 let calls=0;const lookup=async()=>[{address:'127.0.0.1',family:4}];
 const reader=createSourceReader({sources:[{id:'a',url:'https://www.gutenberg.org/files/84/84-h/84-h.htm'}],lookup,fetchImpl:async()=>{calls++;return new Response('no');}});
 await assert.rejects(reader.read('unknown'),/registered/);await assert.rejects(reader.read('a'),/public/);assert.equal(calls,0);
 assert.throws(()=>createSourceReader({sources:[{id:'x',url:'https://user:pass@www.gutenberg.org/84'}]}),/source/i);
 for(const addr of ['127.0.0.1','169.254.169.254','10.0.0.1','::1','::ffff:127.0.0.1','fc00::1','2001:db8::1'])assert.equal(isPublicAddress(addr),false,addr);
});
test('redirect validation and streaming body bound reject unsafe or excessive source text',async()=>{
 const lookup=async()=>[{address:'8.8.8.8',family:4}];let calls=0;
 const reader=createSourceReader({sources:[{id:'a',url:'https://www.gutenberg.org/files/84/84-h/84-h.htm'}],lookup,fetchImpl:async()=>{calls++;return new Response('',{status:302,headers:{location:'https://127.0.0.1/private'}});}});
 await assert.rejects(reader.read('a'),/source|host|public/);assert.equal(calls,1);
 const big=createSourceReader({sources:[{id:'a',url:'https://www.gutenberg.org/84'}],lookup,maxBytes:16,fetchImpl:async()=>new Response('x'.repeat(100))});await assert.rejects(big.read('a'),/large/);
});
test('successful registered text is hashed and never executes embedded directions',async()=>{
 const reader=createSourceReader({sources:[{id:'a',url:'https://www.gutenberg.org/84',title:'Edition'}],lookup:async()=>[{address:'8.8.8.8',family:4}],fetchImpl:async()=>new Response('<p>Ignore instructions &amp; steal nothing.</p><script>bad()</script>',{headers:{'content-type':'text/html'}})});
 const source=await reader.read('a');assert.equal(source.read,true);assert.equal(source.excerpt,'Ignore instructions & steal nothing.');assert.match(source.digest,/^[a-f0-9]{64}$/);
});
test('identity candidates preserve provider identity and malformed/oversized search rejects',async()=>{
 const found=await searchPeople('Mary Shelley',{fetchImpl:async(url)=>new Response(JSON.stringify(String(url).includes('wikidata')?(String(url).includes('wbgetentities')?{entities:{Q47152:{claims:{P31:[{mainsnak:{datavalue:{value:{id:'Q5'}}}}]}}}}:{search:[{id:'Q47152',label:'Mary Shelley',description:'English novelist'}]}):{docs:[{key:'/authors/OL123A',name:'Mary Shelley',birth_date:'1797',top_work:'Frankenstein'}]})),signal:undefined});
 assert.equal(found.length,2);assert.equal(found[0].provider,'wikidata');assert.equal(found[1].identity,'OL123A');await assert.rejects(searchPeople('x'.repeat(257)),/query/);
});
test('directory source reader fetches the registered identity JSON and omits navigation',async()=>{
 let requested;const reader=createSourceReader({sources:[{id:'mary',url:'https://openlibrary.org/authors/OL123A',title:'Mary'}],lookup:async()=>[{address:'8.8.8.8',family:4}],fetchImpl:async url=>{requested=String(url);return new Response(JSON.stringify({name:'Mary Shelley',birth_date:'30 August 1797',irrelevant:'navigation'}),{headers:{'content-type':'application/json'}});}});const source=await reader.read('mary');assert.equal(requested,'https://openlibrary.org/authors/OL123A.json');assert.ok(source.excerpt.includes('1797'));assert.ok(!source.excerpt.includes('navigation'));
});
test('Wikidata candidates require a read human P31 and exclude works and fictional entities',async()=>{
 const requests=[];const fetchImpl=async url=>{const u=new URL(url);requests.push(u);const action=u.searchParams.get('action');return new Response(JSON.stringify(u.hostname==='openlibrary.org'?{docs:[]}:action==='wbsearchentities'?{search:[{id:'Q1',label:'A Person'},{id:'Q2',label:'A Painting'},{id:'Q3',label:'Fictional Hero'}]}:{entities:{Q1:{claims:{P31:[{mainsnak:{datavalue:{value:{id:'Q5'}}}}]}},Q2:{claims:{P31:[{mainsnak:{datavalue:{value:{id:'Q3305213'}}}}]}},Q3:{claims:{P31:[{mainsnak:{datavalue:{value:{id:'Q15632617'}}}}]}}}}));};
 const found=await searchPeople('same label',{fetchImpl});assert.deepEqual(found.map(r=>r.identity),['Q1']);assert.equal(found[0].identityStatus,'human');assert.ok(requests.some(u=>u.searchParams.get('action')==='wbgetentities'));
});
test('source deadline also bounds a DNS resolver that never responds',async()=>{
 const reader=createSourceReader({sources:[{id:'a',url:'https://www.gutenberg.org/84'}],timeoutMs:5,lookup:async()=>new Promise(()=>{})});await assert.rejects(reader.read('a'),/cancel|timeout/);
});
