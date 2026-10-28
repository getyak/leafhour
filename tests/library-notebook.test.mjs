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
 let notebook;const calls=[];notebook=mountLibraryNotebook({document,getSession:()=>({user:{id:'a'}}),getOwner:()=> 'a',getBooks:()=>[book('a')],openAuth(){},onOpen(){notebook.open();},api:async path=>{calls.push(path);return {books:[book('a')],entries:[{book:book('a'),records:records('a',{comments:[note('n','Literal words',{quote:'Original quotation',quoteOrigin:'original'})]})}],failed:[],completed:1,total:1,nextCursor:null};}});
 notebook.open();await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(calls,['/api/library/notebook?limit=12']);assert.equal(document.querySelectorAll('.notebook-entry').length,1);
 const search=document.getElementById('notebook-search');search.value='active draft';search.focus();document.trap=true;notebook.updateLabels();document.trap=false;assert.equal(search.value,'active draft');assert.equal(document.activeElement,search);assert.match(document.querySelector('.notebook-entry-text').textContent,/Literal words/);assert.equal(document.querySelector('.notebook-close').textContent,'×');notebook.dispose();
});

test('clear removes rendered notes synchronously and late archive discovery cannot restart an old owner',async()=>{
 const {fixture}=await import('./annotation-dom-fixture.mjs'),{mountLibraryNotebook}=await import('../app/library-notebook.mjs');const {document}=fixture('<html><body></body></html>');let owner='a';const wait=deferred(),calls=[];
 const notebook=mountLibraryNotebook({document,getSession:()=>({user:{id:owner}}),getOwner:()=>owner,getBooks:()=>[book('a')],openAuth(){},api:path=>{calls.push(path);return wait.promise;}});notebook.open();owner='b';notebook.clear();assert.equal(notebook.isOpen(),false);assert.equal(document.querySelector('.notebook-list').children.length,0);wait.resolve({books:[book('private-old')]});await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(calls,['/api/library/notebook?limit=12']);assert.equal(document.querySelector('.notebook-list').children.length,0);notebook.dispose();
});

test('reopening while notebook pages load shares work and keeps a focused source link',async()=>{
 const {fixture}=await import('./annotation-dom-fixture.mjs'),{mountLibraryNotebook}=await import('../app/library-notebook.mjs');const {document}=fixture('<html><body></body></html>');const wait=deferred(),calls=[];
 const notebook=mountLibraryNotebook({document,getSession:()=>({user:{id:'a'}}),getOwner:()=> 'a',getBooks:()=>[book('a'),book('b')],openAuth(){},api:path=>{calls.push(path);if(path.includes('cursor='))return wait.promise;return Promise.resolve({books:[book('a')],entries:[{book:book('a'),records:records('a',{comments:[note('n','Kept')]})}],failed:[],completed:1,total:2,nextCursor:'page2'});}});
 notebook.open();await new Promise(resolve=>setImmediate(resolve));const link=document.querySelector('.notebook-source');link.focus();notebook.close();notebook.open();await new Promise(resolve=>setImmediate(resolve));assert.equal(calls.length,2);
 link.focus();wait.resolve({books:[book('b')],entries:[{book:book('b'),records:records('b',{comments:[note('b','Later')]})}],failed:[],completed:2,total:2,nextCursor:null});await new Promise(resolve=>setImmediate(resolve));assert.equal(document.querySelector('.notebook-source'),link);assert.equal(document.activeElement,link);assert.equal(document.querySelectorAll('.notebook-entry').length,2);assert.ok(document.querySelector('.notebook-results'));notebook.dispose();
});

test('loader coalesces a ready batch and deduplicates the same in-flight inventory',async()=>{
 const updates=[],wait=deferred();let calls=0;const loader=createNotebookLoader({getOwner:()=> 'a',onUpdate:view=>updates.push(view),api:async path=>{calls++;await wait.promise;return records(path.split('/')[4]);}});
 const books=[book('a'),book('b'),book('c')],first=loader.load(books),second=loader.load(books);assert.equal(calls,3);wait.resolve();await Promise.all([first,second]);assert.equal(loader.view().completed,3);assert.ok(updates.length<=3);loader.dispose();
});

test('aggregate loader pages 112 books in ten requests and fences owner changes',async()=>{
 let owner='a',calls=0;const loader=createNotebookLoader({paged:true,getOwner:()=>owner,api:async path=>{calls++;const offset=Number(new URL(path,'http://local').searchParams.get('cursor')||0),books=Array.from({length:Math.min(12,112-offset)},(_,i)=>book(String(offset+i))),completed=offset+books.length;return {books,entries:books.map(book=>({book,records:records(book.bookId,{comments:[note('n','Own')]})})),failed:[],completed,total:112,nextCursor:completed<112?String(completed):null};}});
 const result=await loader.load([]);assert.equal(calls,10);assert.equal(result.entries.length,112);owner='b';assert.equal(loader.view().entries.length,0);loader.dispose();
});

test('aggregate oversized fallback is bounded to three direct record requests and retains full text',async()=>{
 let active=0,max=0;const books=Array.from({length:5},(_,i)=>book(String(i))),text='Full quote '.repeat(500);const loader=createNotebookLoader({paged:true,getOwner:()=> 'a',api:async path=>{if(path.includes('/notebook?'))return {books,entries:[],failed:books.map(book=>({...book,fallback:true})),completed:5,total:5,nextCursor:null};active++;max=Math.max(max,active);await new Promise(resolve=>setImmediate(resolve));active--;const id=path.split('/')[4];return records(id,{comments:[note('n','Kept',{quote:text,quoteOrigin:'original'})]});}});const result=await loader.load(books);assert.equal(max,3);assert.equal(result.failed.length,0);assert.equal(result.entries.length,5);assert.ok(result.entries.every(row=>row.quote===text));loader.dispose();
});

test('same-owner reopen and partial retry retain an archived book filter before its page arrives',async t=>{
 const {fixture}=await import('./annotation-dom-fixture.mjs'),{mountLibraryNotebook}=await import('../app/library-notebook.mjs');const {document}=fixture('<html><body></body></html>');let owner='a',pass=0;const reopen=deferred(),retry=deferred();
 const a=book('active'),b=book('archived'),entry=book=>({book,records:records(book.bookId,{comments:[note('n',book.bookId+' personal words')]})});
 const notebook=mountLibraryNotebook({document,getSession:()=>({user:{id:owner}}),getOwner:()=>owner,getBooks:()=>[a],openAuth(){},api:async path=>{
   if(path.includes('cursor='))return pass===2?reopen.promise:retry.promise;
   pass++;return pass===1?{books:[a,b],entries:[entry(a),entry(b)],failed:[],completed:2,total:2,nextCursor:null}:{books:[a],entries:[entry(a)],failed:[],completed:1,total:2,nextCursor:'later'};
 }});t.after(()=>notebook.dispose());const tick=()=>new Promise(resolve=>setImmediate(resolve));notebook.open();await tick();const choice=document.querySelector('.notebook-book-filter');choice.value=b.bookId;choice.dispatchEvent(new Event('change'));assert.equal(document.querySelectorAll('.notebook-entry').length,1);
 notebook.close();notebook.open();await tick();assert.equal(choice.value,b.bookId);assert.ok(choice.options.some(option=>option.value===b.bookId));assert.equal(document.querySelectorAll('.notebook-entry').length,0);assert.equal(document.querySelector('.notebook-export').disabled,true);
 reopen.resolve({books:[b],entries:[],failed:[b],completed:2,total:2,nextCursor:null});await tick();assert.equal(choice.value,b.bookId);document.querySelector('.notebook-retry').dispatchEvent(new Event('click'));await tick();assert.equal(choice.value,b.bookId);assert.equal(document.querySelectorAll('.notebook-entry').length,0);
 retry.resolve({books:[b],entries:[entry(b)],failed:[],completed:2,total:2,nextCursor:null});await tick();assert.equal(choice.value,b.bookId);assert.equal(document.querySelectorAll('.notebook-entry').length,1);assert.equal(document.querySelector('.notebook-entry-text').textContent,'archived personal words');
 const originalCreate=URL.createObjectURL,originalRevoke=URL.revokeObjectURL;let exported;URL.createObjectURL=blob=>{exported=blob;return 'blob:synthetic';};URL.revokeObjectURL=()=>{};t.after(()=>{URL.createObjectURL=originalCreate;URL.revokeObjectURL=originalRevoke;});const create=document.createElement;document.createElement=tag=>{const node=create(tag);if(tag==='a')node.click=()=>{};return node;};document.querySelector('.notebook-export').dispatchEvent(new Event('click'));const markdown=await exported.text();assert.match(markdown,/archived personal words/);assert.doesNotMatch(markdown,/active personal words/);
 owner='new-owner';notebook.clear();assert.equal(choice.value,'');assert.ok(!choice.options.some(option=>option.value===b.bookId));assert.equal(document.querySelectorAll('.notebook-entry').length,0);
});
