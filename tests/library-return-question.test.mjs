import test from 'node:test';
import assert from 'node:assert/strict';
import * as workspace from '../app/library-workspace.mjs';

const book={bookId:'b',contentVersion:'v1',sections:[{paragraphs:[{id:'p1'},{id:'p2'}]}]};
const question=(id,createdAt,extra={})=>({id,bookId:'b',contentVersion:'v1',passageId:'p2',origin:'user',text:'My real question?',createdAt,...extra});

test('only the latest valid current-book current-version user question can return to the shelf',()=>{
  assert.equal(typeof workspace.latestRoomQuestion,'function');
  const first=question('first','2026-10-12T12:00:00Z'),latest=question('latest','2026-10-14T12:00:00Z');
  const invalid=[{bookId:'other'},{contentVersion:'old'},{passageId:'missing'},{origin:'ai'},{origin:undefined},{text:'  '},{text:'x'.repeat(2001)},{createdAt:'not a date'},{id:null}].map((extra,i)=>question('invalid'+i,'2026-10-15T12:00:00Z',extra));
  assert.deepEqual(workspace.latestRoomQuestion(book,{questions:[latest,...invalid,first],comments:[question('comment','2026-10-16T12:00:00Z')]}),{id:'latest',passageId:'p2',text:'My real question?'});
  assert.equal(workspace.latestRoomQuestion(book,{questions:invalid}),null);
  assert.equal(workspace.latestRoomQuestion(book,null),null);
});

test('a question remains user wording, including resolved status, and links to its own paragraph',()=>{
  assert.equal(typeof workspace.latestRoomQuestion,'function');
  assert.equal(typeof workspace.roomQuestionUrl,'function');
  const record=question('q','2026-10-15T12:00:00Z',{text:'  Exact wording 😀\nSecond line  ',status:'resolved'});
  const selected=workspace.latestRoomQuestion(book,{questions:[record]});
  assert.equal(selected.text,record.text);
  assert.equal(workspace.roomQuestionUrl({...book,resume:{passageId:'p1'}},selected),'/read?book=b&passage=p2&note=question');
});

// Exercise the actual dashboard's async preview ownership without a browser dependency.
import {mountReadingDashboard} from '../app/reading-dashboard.mjs';
function dashboardDocument(){
  const doc={defaultView:{location:{search:''}}};
  class Element{
    constructor(tag){this.tagName=tag;this.children=[];this.dataset={};this.attributes={};this.events={};this.hidden=false;this.open=false;this.textContent='';this.value='';this.className='';this.ownerDocument=doc;this.classList={add(){},remove(){},toggle(){}};}
    append(...children){this.children.push(...children);}
    replaceChildren(...children){this.children=[...children];}
    setAttribute(key,value){this.attributes[key]=value;}
    removeAttribute(key){delete this.attributes[key];if(key==='href')delete this.href;}
    addEventListener(name,fn){this.events[name]=fn;}
    querySelector(selector){const all=this.children.flatMap(child=>[child,...(child.all?.()||[])]);return all.find(child=>selector.startsWith('.')?child.className.split(' ').includes(selector.slice(1)):selector==='[data-reading-arrival]'&&child.dataset.readingArrival)||null;}
    all(){return this.children.flatMap(child=>[child,...(child.all?.()||[])]);}
  }
  doc.createElement=tag=>new Element(tag);return doc;
}

test('dashboard hides stale questions while switching, ignores late previews, and clears personal text on logout',async t=>{
  const doc=dashboardDocument(),previous=globalThis.document;globalThis.document=doc;t.after(()=>{globalThis.document=previous;});
  const root=doc.createElement('div'),overviewRoot=doc.createElement('div'),historyRoot=doc.createElement('dialog');overviewRoot.hidden=true;
  let owner='alice',session={user:{id:owner}},books=[{bookId:'a',contentVersion:'v1',title:{zh:'A'},resume:{passageId:'a1'}},{bookId:'b',contentVersion:'v1',title:{zh:'B'},resume:{passageId:'b1'}}];
  const pending=[],api=url=>new Promise(resolve=>pending.push({url,resolve}));
  const dashboard=mountReadingDashboard({root,overviewRoot,historyRoot,api,getSession:()=>session,getBooks:()=>books,getOwner:()=>owner,openAuth:()=>assert.fail('should not open auth'),refresh:async()=>{}});
  dashboard.update(dashboard.begin());
  const slip=root.querySelector('.room-question'),text=root.querySelector('.room-question-text'),link=root.querySelector('.room-question-link'),choice=root.querySelector('.today-book-choice');
  const data=(id,wording)=>({bookId:id,original:'Source excerpt.',translationStatus:{},question:{id:'q',passageId:id+'2',text:wording}});
  assert.equal(slip.hidden,true);pending[0].resolve(data('a','Actual A question'));await new Promise(resolve=>setImmediate(resolve));
  assert.equal(slip.hidden,false);assert.equal(text.textContent,'Actual A question');assert.equal(link.href,'/read?book=a&passage=a2&note=question');assert.equal(historyRoot.open,false);
  choice.value='b';choice.events.change();assert.equal(slip.hidden,true);assert.equal(text.textContent,'');assert.equal(link.href,undefined);
  choice.value='a';choice.events.change();pending[2].resolve(data('a','Current A question'));await new Promise(resolve=>setImmediate(resolve));
  pending[1].resolve(data('b','Stale B question'));await new Promise(resolve=>setImmediate(resolve));
  assert.equal(text.textContent,'Current A question');assert.equal(link.href,'/read?book=a&passage=a2&note=question');
  owner='guest';session=null;books=[];dashboard.clear();assert.equal(slip.hidden,true);assert.equal(text.textContent,'');assert.equal(link.href,undefined);
});
