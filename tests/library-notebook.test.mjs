import test from 'node:test';
import assert from 'node:assert/strict';
import {collectNotebookEntries,filterNotebookEntries,notebookMarkdown,createNotebookLoader} from '../app/library-notebook-state.mjs';
const book=(id,title=id)=>({bookId:id,title:{zh:title,en:title},contentVersion:'v1'});
const note=(id,text,extra={})=>({id,origin:'user',text,passageId:'p1',contentVersion:'v1',createdAt:'2026-10-26T10:00:00Z',...extra});
const records=(id,extra={})=>({bookId:id,comments:[],questions:[],highlights:[],...extra});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};

test('notebook collects only active own records and retains full source text separately',()=>{
 const text='自己的完整思考。'.repeat(80),rows=collectNotebookEntries(book('a','甲'),records('a',{comments:[note('c',text,{quote:'Original words',quoteOrigin:'original'}),note('x','generated',{origin:'ai'}),note('d','deleted',{deletedAt:'2026-10-27T00:00:00Z'}),note('foreign','wrong book',{bookId:'other'})],questions:[note('q','Why?')],highlights:[{id:'h',origin:'user',chapterId:'ch1',createdAt:'2026-10-27T00:00:00Z',parts:[{passageId:'p2',text:'Selected source'}]}]}));
 assert.deepEqual(rows.map(x=>x.id),['c','q','h']);assert.equal(rows[0].text,text);assert.equal(rows[0].quote,'Original words');assert.equal(rows[2].kind,'highlight');assert.equal(rows[2].quote,'Selected source');assert.equal(rows[2].text,'');assert.match(rows[2].href,/passage=p2/);assert.deepEqual(collectNotebookEntries(book('a'),records('b',{comments:[note('x','wrong owner book')]})),[]);
});

test('cross-book search and filters compose, do not mutate originals, and sort deterministically',()=>{
 const rows=[...collectNotebookEntries(book('a','一本书'),records('a',{comments:[note('same','Thinking about seasons')]})),...collectNotebookEntries(book('b','另一本书'),records('b',{questions:[note('same','What is time?',{createdAt:'2026-10-27T00:00:00Z'})]}))];
 assert.equal(new Set(rows.map(x=>x.key)).size,2);assert.deepEqual(filterNotebookEntries(rows).map(x=>x.bookId),['b','a']);assert.equal(filterNotebookEntries(rows,{query:'SEASONS'}).length,1);assert.equal(filterNotebookEntries(rows,{query:'另一本',kind:'question',bookId:'b'}).length,1);assert.equal(filterNotebookEntries(rows,{kind:'comment',bookId:'b'}).length,0);assert.equal(rows[0].bookId,'a');
});

test('markdown exports only selected records with origin, quote, dates and source route',()=>{
 const rows=collectNotebookEntries(book('a','My book'),records('a',{comments:[note('c','My thought',{quote:'A quotation',quoteOrigin:'original',updatedAt:'2026-10-27T00:00:00Z'})]}));
 const md=notebookMarkdown(rows,{title:'My notebook',labels:{comment:'Thought',quote:'Quotation',created:'Created',updated:'Updated',source:'Open source'}});
 assert.match(md,/My thought/);assert.match(md,/A quotation/);assert.match(md,/Thought/);assert.match(md,/2026-10-27/);assert.match(md,/\/read\?book=a&passage=p1&note=comment/);assert.doesNotMatch(md,/readingSessions|token|owner/);assert.equal(notebookMarkdown([],{title:'Empty'}),'# Empty\n\n');
});

test('loader bounds parallel requests, exposes partial success and retryable failures',async()=>{
 const pending=new Map(),updates=[];let inflight=0,max=0;
 const loader=createNotebookLoader({getOwner:()=> 'owner-a',concurrency:2,onUpdate:view=>updates.push(view),api:async path=>{const id=decodeURIComponent(path.split('/')[4]);inflight++;max=Math.max(max,inflight);const wait=deferred();pending.set(id,wait);try{return await wait.promise;}finally{inflight--;}}});
 const operation=loader.load([book('a'),book('b'),book('c'),book('a')]);assert.equal(pending.size,2);pending.get('a').resolve(records('a',{comments:[note('a','One')]}));await new Promise(resolve=>setImmediate(resolve));assert.equal(pending.size,3);pending.get('b').reject(Error('Offline'));pending.get('c').resolve(records('c'));const result=await operation;
 assert.equal(max,2);assert.equal(result.loading,false);assert.equal(result.entries.length,1);assert.deepEqual(result.failed.map(x=>x.bookId),['b']);assert.equal(result.completed,3);assert.ok(updates.some(x=>x.loading&&x.entries.length===1));
});

test('owner change and explicit clear prevent stale private results from returning',async()=>{
 let owner='a';const wait=deferred(),updates=[];const loader=createNotebookLoader({api:()=>wait.promise,getOwner:()=>owner,onUpdate:v=>updates.push(v)});const loading=loader.load([book('a')]);owner='b';loader.clear();assert.equal(updates.at(-1).entries.length,0);wait.resolve(records('a',{comments:[note('private','Secret')]}));await loading;assert.equal(updates.at(-1).entries.length,0);assert.equal(loader.view().entries.length,0);
});

test('overlapping notebook refreshes cannot resurrect older requests',async()=>{
 const waits=[deferred(),deferred()];let i=0;const loader=createNotebookLoader({api:()=>waits[i++].promise,getOwner:()=> 'a'});const old=loader.load([book('old')]);const current=loader.load([book('new')]);waits[1].resolve(records('new',{comments:[note('new','New')]}));await current;waits[0].resolve(records('old',{comments:[note('old','Old')]}));await old;assert.deepEqual(loader.view().entries.map(x=>x.bookId),['new']);
});

test('old or missing source anchors keep the note but never claim a valid passage return',()=>{
 const rows=collectNotebookEntries(book('a'),records('a',{comments:[note('old','Kept',{contentVersion:'old'}),note('missing','Kept too',{passageId:''})]}));
 assert.equal(rows.length,2);assert.equal(rows[0].sourceAvailable,false);assert.equal(rows[1].sourceAvailable,false);assert.doesNotMatch(rows[0].href,/passage=/);assert.doesNotMatch(rows[1].href,/note=/);
});

test('notebook includes accessible archived books without duplicates and reports archive discovery failure',async()=>{
 const calls=[],loader=createNotebookLoader({getOwner:()=> 'a',api:async path=>{calls.push(path);if(path==='/api/library/trash')return {books:[book('archived'),book('active')]};return records(path.split('/')[4],{comments:[note('n','Saved')]});}});
 const result=await loader.load([book('active')],{includeArchived:true});assert.equal(result.entries.length,2);assert.deepEqual(new Set(result.books.map(b=>b.bookId)),new Set(['active','archived']));assert.equal(calls.filter(p=>p.includes('/active/')).length,1);assert.equal(result.archiveFailed,false);
 const unavailable=createNotebookLoader({getOwner:()=> 'a',api:async path=>{if(path==='/api/library/trash')throw Error('Offline');return records('active');}});assert.equal((await unavailable.load([book('active')],{includeArchived:true})).archiveFailed,true);
});

test('markdown quotes identify original and translation layers and links work outside this browser',()=>{
 const rows=collectNotebookEntries(book('a','A [book] *title*'),records('a',{comments:[note('n','Words',{quote:'Source',quoteOrigin:'original'})]}));
 const md=notebookMarkdown(rows,{baseUrl:'http://localhost:8765',labels:{'quote.original':'Original quotation'}});assert.match(md,/Original quotation/);assert.match(md,/http:\/\/localhost:8765\/read\?book=a/);assert.match(md,/A \\\[book\\\] \\\*title\\\*/);
});

test('a routed open is idempotent and a locale refresh leaves native fields and source text intact',async()=>{
 const {fixture}=await import('./annotation-dom-fixture.mjs'),{mountLibraryNotebook}=await import('../app/library-notebook.mjs');const {document}=fixture('<html><body><button id="opener"></button></body></html>');
 let notebook;const calls=[];notebook=mountLibraryNotebook({document,getSession:()=>({user:{id:'a'}}),getOwner:()=> 'a',getBooks:()=>[book('a')],openAuth(){},onOpen(){notebook.open();},api:async path=>{calls.push(path);return path==='/api/library/trash'?{books:[]}:records('a',{comments:[note('n','Literal words',{quote:'Original quotation',quoteOrigin:'original'})]});}});
 notebook.open();await new Promise(resolve=>setImmediate(resolve));assert.equal(calls.filter(x=>x.includes('/records')).length,1);assert.equal(calls.filter(x=>x==='/api/library/trash').length,1);assert.equal(document.querySelectorAll('.notebook-entry').length,1);
 const search=document.getElementById('notebook-search');search.value='active draft';search.focus();document.trap=true;notebook.updateLabels();document.trap=false;assert.equal(search.value,'active draft');assert.equal(document.activeElement,search);assert.match(document.querySelector('.notebook-entry-text').textContent,/Literal words/);assert.equal(document.querySelector('.notebook-close').textContent,'×');notebook.dispose();
});

test('clear removes rendered notes synchronously and late archive discovery cannot restart an old owner',async()=>{
 const {fixture}=await import('./annotation-dom-fixture.mjs'),{mountLibraryNotebook}=await import('../app/library-notebook.mjs');const {document}=fixture('<html><body></body></html>');let owner='a';const wait=deferred(),calls=[];
 const notebook=mountLibraryNotebook({document,getSession:()=>({user:{id:owner}}),getOwner:()=>owner,getBooks:()=>[book('a')],openAuth(){},api:path=>{calls.push(path);return wait.promise;}});notebook.open();owner='b';notebook.clear();assert.equal(notebook.isOpen(),false);assert.equal(document.querySelector('.notebook-list').children.length,0);wait.resolve({books:[book('private-old')]});await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(calls,['/api/library/trash']);assert.equal(document.querySelector('.notebook-list').children.length,0);notebook.dispose();
});
