import test from 'node:test';
import assert from 'node:assert/strict';
import {libraryShelf,roomShelf,hasShelfFilters} from '../app/library-workspace.mjs';
import {bookReadingLanguages} from '../app/book-reading-languages.mjs';
import {createLibraryService} from '../server/library-service.mjs';
import {digest} from '../server/document-import.mjs';
import {mountShelfFilters as mountShelfFiltersActual} from '../app/library-filter-controls.mjs';
import {requestUiRoute} from '../app/ui-locale.mjs';
await requestUiRoute('zh-Hans');
const mounted=[];const mountShelfFilters=options=>{const value=mountShelfFiltersActual(options);mounted.push(value);return value;};
test.afterEach(async()=>{for(const value of mounted.splice(0))value.dispose();await requestUiRoute('zh-Hans');});
import {mountChoiceControl} from '../app/choice-control.mjs';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

const books=[
  {bookId:'unread',visibility:'public',sourceLanguage:'en',topics:['literature'],title:{zh:'未开始的故事'},shelfPosition:0,journey:{status:'reading',lastReadAt:null,completedChapters:0}},
  {bookId:'current',visibility:'private',sourceLanguage:'zh-Hans',topics:['philosophy'],title:{zh:'自己的思考',en:'Thoughts'},author:'林读者',shelfPosition:1,resume:{passageId:'p2'}},
  {bookId:'finished',visibility:'public',sourceLanguage:'en-GB',topics:['philosophy'],title:{zh:'读完的书'},shelfPosition:2,journey:{status:'finished',lastReadAt:'2026-10-16'},resume:{passageId:'p3'}},
  {bookId:'session',visibility:'private',sourceLanguage:'en',title:{zh:'另一段阅读'},shelfPosition:3,journey:{status:'reading',lastReadAt:'2026-10-15'}},
  {bookId:'unknown',visibility:'private',title:{zh:'尚未分类'},shelfPosition:4}
];
const ids=rows=>rows.map(book=>book.bookId);

test('missing language stays unknown and blank or stale translation text cannot advertise a bilingual book',()=>{
  const book={contentVersion:'v1',sections:[{paragraphs:[{id:'p1',original:'Source text',translations:{literal:{text:' ',sourceVersion:'v1'},interpretive:{text:'旧译',sourceVersion:'v0'}}}]}]};
  assert.deepEqual(bookReadingLanguages(book),{sourceLanguage:'unknown',translationLanguages:[],supportsParallel:false,translatedParagraphs:0,translationCoverage:'none'});
  book.sourceLanguage='EN-GB';book.sections[0].paragraphs[0].translations.literal={text:'译文',sourceVersion:'v1'};
  assert.deepEqual(bookReadingLanguages(book),{sourceLanguage:'en',translationLanguages:['zh'],supportsParallel:true,translatedParagraphs:1,translationCoverage:'complete'});
});

test('reading language and form intersect using saved translations without changing the original language',()=>{
  const shelf=[
    {bookId:'english',sourceLanguage:'en'},
    {bookId:'chinese',sourceLanguage:'zh'},
    {bookId:'parallel',sourceLanguage:'en',translationLanguages:['zh'],supportsParallel:true},
    {bookId:'french',sourceLanguage:'fr',translationLanguages:['ja'],supportsParallel:true}
  ];
  assert.deepEqual(ids(libraryShelf(shelf,{language:'zh'})),['chinese','parallel']);
  assert.deepEqual(ids(libraryShelf(shelf,{language:'zh',form:'original'})),['chinese']);
  assert.deepEqual(ids(libraryShelf(shelf,{language:'zh',form:'translated'})),['parallel']);
  assert.deepEqual(ids(libraryShelf(shelf,{language:'en',form:'translated'})),[]);
  assert.deepEqual(ids(libraryShelf(shelf,{language:'ja',form:'bilingual'})),['french']);
  assert.deepEqual(ids(libraryShelf(shelf,{form:'bilingual'})),['parallel','french']);
  assert.equal(hasShelfFilters({form:'translated'}),true);
});

test('list metadata reflects actual account translations and ignores stale overlays without rewriting indexes',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'leafhour-reading-languages-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const library=await createLibraryService({dataDir:dir,translator:async()=>({literal:'直译草稿',interpretive:'意译草稿',model:'fixture'})});
  const owner={id:'language-owner'},other={id:'language-other'};
  const imported=await library.importDocument(owner,{filename:'original.txt',bytes:Buffer.from('An English original with no translation.\n\nAnother paragraph remains untranslated.')});
  const indexFile=path.join(dir,'users',digest(owner.id),'index.json'),before=await readFile(indexFile,'utf8');
  let row=(await library.list(owner)).find(b=>b.bookId===imported.bookId);
  assert.equal(row.sourceLanguage,'en');assert.deepEqual(row.translationLanguages,[]);assert.equal(row.supportsParallel,false);
  const book=await library.getBook(owner,imported.bookId),passage=book.sections[0].paragraphs[0];
  await library.translate(owner,imported.bookId,passage.id);
  row=(await library.list(owner)).find(b=>b.bookId===imported.bookId);
  assert.deepEqual(row.translationLanguages,['zh']);assert.equal(row.supportsParallel,true);assert.equal(row.translationCoverage,'partial');
  assert.equal((await library.list(other)).some(b=>b.bookId===imported.bookId),false);
  const overlayFile=path.join(dir,'users',digest(owner.id),'translations',digest(imported.bookId)+'.json');
  const overlay=JSON.parse(await readFile(overlayFile,'utf8'));overlay[passage.id].contentVersion='stale';await writeFile(overlayFile,JSON.stringify(overlay));
  assert.deepEqual((await library.list(owner)).find(b=>b.bookId===imported.bookId).translationLanguages,[]);
  assert.equal(await readFile(indexFile,'utf8'),before,'listing and translation metadata do not rewrite the index');
  const publicRows=await library.list(null),alice=publicRows.find(b=>b.bookId==='gutenberg-alice');
  assert.deepEqual(alice.translationLanguages,['zh']);assert.equal(alice.translationCoverage,'partial');assert.equal(alice.supportsParallel,true);
  assert.ok(publicRows.every(b=>typeof b.sourceLanguage==='string'&&b.sourceLanguage.length>0));
});

test('reading filters use real activity rather than the default reading journey or a saved position on a finished book',()=>{
  assert.deepEqual(ids(libraryShelf(books,{status:'reading'})),['current','session']);
  assert.deepEqual(ids(libraryShelf(books,{status:'unread'})),['unread','unknown']);
  assert.deepEqual(ids(libraryShelf(books,{status:'finished'})),['finished']);
});

test('source, topic, original language and search intersect while retaining the whole shelf order',()=>{
  const before=structuredClone(books);
  assert.deepEqual(ids(libraryShelf(books,{scope:'public',topic:'philosophy',language:'en'})),['finished']);
  assert.deepEqual(ids(libraryShelf(books,{scope:'private',status:'reading',topic:'philosophy',language:'zh',query:'thoughts'})),['current']);
  assert.deepEqual(ids(libraryShelf(books,{topic:'science'})),[]);
  assert.deepEqual(ids(libraryShelf(books,{language:'unknown'})),['unknown']);
  assert.deepEqual(books,before);
});

test('a Chinese trial does not turn an English original into a Chinese-language book',()=>{
  const trial={...books[0],chineseSample:{paragraphs:6}};
  assert.deepEqual(libraryShelf([trial],{language:'zh'}),[]);
  assert.deepEqual(ids(libraryShelf([trial],{language:'en'})),['unread']);
});

test('filtering collapses the featured card and includes the current book once; clearing restores it',()=>{
  for(const filter of [{status:'reading'},{scope:'private'},{topic:'philosophy'},{language:'zh'},{query:'思考'}]){
    const room=roomShelf(books,{...filter,selectedBookId:'current'});
    assert.equal(room.featured,null);
    assert.equal(ids(room.books).filter(id=>id==='current').length,1);
    assert.equal(room.books.length,room.total);
  }
  const reset=roomShelf(books,{selectedBookId:'current'});
  assert.equal(reset.featured.bookId,'current');
  assert.equal(reset.total,5);
  assert.deepEqual(ids(reset.books),['unread','finished','session','unknown']);
});

test('book listings expose original language and curated subjects, including older private index entries, without rewriting them',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'leafhour-filter-metadata-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const library=await createLibraryService({dataDir:dir}),user={id:'isolated-filter-reader'};
  const publicRows=await library.list(null),alice=publicRows.find(book=>book.bookId==='gutenberg-alice');
  assert.equal(alice.sourceLanguage,'en');
  assert.ok(alice.topics.includes('literature'));
  const chinese=await library.importDocument(user,{filename:'中文.txt',bytes:Buffer.from('这是一本中文原文。\n\n阅读可以从这里开始。')});
  const indexFile=path.join(dir,'users',digest(user.id),'index.json');
  const index=JSON.parse(await readFile(indexFile,'utf8'));
  delete index.books[0].sourceLanguage;
  await writeFile(indexFile,JSON.stringify(index));
  const before=await readFile(indexFile,'utf8');
  const row=(await library.list(user)).find(book=>book.bookId===chinese.bookId);
  assert.equal(row.sourceLanguage,'zh');
  assert.deepEqual(row.topics,[]);
  assert.equal(await readFile(indexFile,'utf8'),before);
});

test('Chinese originals stay separate from translated English fiction',async t=>{
  const synthetic=[
    {bookId:'fixture-novel',visibility:'private',sourceLanguage:'zh',topics:['fiction'],title:{zh:'合成小说'}},
    {bookId:'fixture-story',visibility:'private',sourceLanguage:'zh',topics:['fiction','literature'],title:{zh:'合成短篇'}}
  ];
  assert.deepEqual(ids(libraryShelf(synthetic,{topic:'fiction',language:'zh'})),['fixture-novel','fixture-story']);
  assert.deepEqual(ids(libraryShelf(synthetic,{topic:'fiction',language:'en'})),[]);
  const dir=await mkdtemp(path.join(tmpdir(),'leafhour-fiction-catalog-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const library=await createLibraryService({dataDir:dir});
  assert.deepEqual(libraryShelf(await library.list(null),{topic:'fiction',language:'zh',form:'original'}),[]);
  assert.ok(libraryShelf(await library.list(null),{topic:'fiction',language:'en'}).length>0,'unambiguous English novels carry the fiction topic');
});

// ---- controller fixture -----------------------------------------------------
// Capability-absent fixture: stock Chrome 113 has no Popover API, so
// ':popover-open' queries throw here exactly as they do there; open state is
// owned by the shared popover controller through its marker and hidden state.
class FakeElement{
  constructor(tag,doc){
    this.tagName=String(tag).toUpperCase();this.ownerDocument=doc;this.children=[];this.parentElement=null;
    this.attributes=new Map();this.dataset={};this.className='';this.id='';this.textContent='';this.value='';
    this.disabled=false;this.hidden=false;this.open=false;this.type='';this.listeners=new Map();this.style={};
  }
  addEventListener(type,fn){this.listeners.set(type,[...(this.listeners.get(type)||[]),fn]);}
  removeEventListener(type,fn){this.listeners.set(type,(this.listeners.get(type)||[]).filter(x=>x!==fn));}
  dispatchEvent(event){
    try{Object.defineProperty(event,'target',{value:this,configurable:true});}catch{}
    for(const fn of this.listeners.get(event.type)||[])fn(event);
    return true;
  }
  emit(type,props={}){this.dispatchEvent({type,preventDefault(){},stopPropagation(){},...props});}
  setAttribute(key,value){this.attributes.set(key,String(value));}
  getAttribute(key){return this.attributes.has(key)?this.attributes.get(key):null;}
  hasAttribute(key){return this.attributes.has(key);}
  removeAttribute(key){this.attributes.delete(key);}
  toggleAttribute(key,force){const on=force===undefined?!this.attributes.has(key):!!force;if(on)this.attributes.set(key,'');else this.attributes.delete(key);return on;}
  get classList(){
    const owner=this;
    return {
      add(...names){const set=new Set(owner.className.split(/\s+/).filter(Boolean));for(const name of names)set.add(name);owner.className=[...set].join(' ');},
      remove(...names){const set=new Set(owner.className.split(/\s+/).filter(Boolean));for(const name of names)set.delete(name);owner.className=[...set].join(' ');},
      toggle(name,force){const set=new Set(owner.className.split(/\s+/).filter(Boolean));const on=force===undefined?!set.has(name):!!force;if(on)set.add(name);else set.delete(name);owner.className=[...set].join(' ');return on;},
      contains(name){return owner.className.split(/\s+/).includes(name);}
    };
  }
  append(...nodes){for(const node of nodes){node.parentElement=this;this.children.push(node);}}
  replaceChildren(...nodes){for(const node of this.children)node.parentElement=null;this.children=[];this.append(...nodes);}
  after(node){const parent=this.parentElement;if(!parent)throw Error('detached');const index=parent.children.indexOf(this);parent.children.splice(index+1,0,node);node.parentElement=parent;}
  remove(){const parent=this.parentElement;if(!parent)return;parent.children.splice(parent.children.indexOf(this),1);this.parentElement=null;}
  contains(node){let current=node;while(current){if(current===this)return true;current=current.parentElement;}return false;}
  matches(selector){if(String(selector).includes(':popover-open'))throw Error('unsupported selector: '+selector);return false;}
  closest(){return null;}
  focus(){this.ownerDocument.activeElement=this;this.focused=true;}
  getClientRects(){return this.open===false&&this.parentElement?.open===false?[]:[{}];}
  querySelector(){return null;}
  querySelectorAll(){return [];}
}
function filterFixture(){
  const listeners=new Map();
  const doc={activeElement:null,createElement:tag=>new FakeElement(tag,doc),querySelector:selector=>{if(String(selector).includes(':popover-open'))throw Error('unsupported selector: '+selector);return null;},querySelectorAll:()=>[],
    addEventListener(type,fn){listeners.set(type,[...(listeners.get(type)||[]),fn]);},removeEventListener(){},dispatchEvent(event){for(const fn of listeners.get(event.type)||[])fn(event);return true;}};
  const byId=new Map(),shelfButtons=[];
  const root=new FakeElement('section',doc);
  root.querySelector=selector=>byId.get(selector.slice(1))||null;
  const make=(tag,id)=>{const node=new FakeElement(tag,doc);node.id=id;if(tag==='select')Object.defineProperty(node,'options',{get:()=>node.children,configurable:true});byId.set(id,node);return node;};
  const search=make('input','book-search'),panel=make('div','shelf-filter-panel'),trigger=make('button','shelf-filter-button');
  const source=make('select','shelf-source'),topic=make('select','shelf-topic'),language=make('select','shelf-language'),form=make('select','shelf-form');
  const options=(select,rows)=>{select.replaceChildren(...rows.map(([value,text,disabled=false])=>{const option=new FakeElement('option',doc);option.value=value;option.textContent=text;option.disabled=disabled;select.append(option);return option;}));select.value=select.options[0]?.value||'';};
  options(source,[['all','全部来源'],['public','内置书'],['private','我上传的']]);
  options(topic,[['all','全部主题']]);
  options(language,[['all','全部阅读语言']]);
  options(form,[['all','全部形态'],['original','原版'],['translated','有译本'],['bilingual','双语对照']]);
  const chips=make('div','shelf-filter-chips'),clear=make('button','shelf-filter-clear'),selection=make('div','shelf-filter-selection'),count=make('span','shelf-filter-count');
  const states=['all','reading','unread','finished'].map(name=>{const button=new FakeElement('button',doc);button.dataset.readingStatus=name;return button;});
  const scopeButtons=['all','private'].map(name=>{const button=new FakeElement('button',doc);button.dataset.shelf=name;shelfButtons.push(button);return button;});
  root.querySelectorAll=selector=>selector==='[data-reading-status]'?states:[];
  doc.querySelectorAll=selector=>selector==='[data-shelf]'?shelfButtons:[];
  root.append(trigger,search,panel,source,topic,language,form,chips,clear,selection,count);
  panel.append(...states);
  for(const node of [source,topic,language,form,search,panel,trigger,chips,clear,selection,count,...states])node.parentElement=root;
  return {doc,root,byId,search,panel,trigger,source,topic,language,form,chips,clear,selection,count,states,scopeButtons};
}

test('the current view summary lists query, status, source, topic and language while the default view stays bare',()=>{
  const f=filterFixture();const changes=[];
  const controls=mountShelfFilters({root:f.root,onChange:action=>changes.push(action)});
  controls.update(books);
  assert.equal(f.selection.hidden,true,'no summary row in the default view');
  assert.equal(f.clear.hidden,true,'no clear-all in the default view');
  controls.set({topic:'fiction'});
  controls.update(books);
  assert.equal(f.selection.hidden,false);
  assert.deepEqual(f.chips.children.map(chip=>chip.textContent),['小说与故事 ×']);
  assert.equal(f.clear.hidden,false);
  f.search.value='爱丽丝';
  controls.set({query:'爱丽丝'});
  controls.set({status:'reading'});
  controls.update(books);
  assert.deepEqual(f.chips.children.map(chip=>chip.textContent),['搜索：爱丽丝 ×','在读 ×','小说与故事 ×']);
  assert.equal(f.count.textContent,'3');
});

test('each summary chip removes only its own filter and returns focus to a sensible visible control',()=>{
  const f=filterFixture();
  const controls=mountShelfFilters({root:f.root,onChange:()=>{}});
  f.search.value='爱丽丝';controls.set({query:'爱丽丝'});controls.set({status:'reading'});controls.set({topic:'fiction'});controls.update(books);
  f.chips.children[2].emit('click');
  assert.deepEqual(controls.read(),{query:'爱丽丝',scope:'all',status:'reading',topic:'all',language:'all',form:'all'});
  assert.equal(f.doc.activeElement,f.trigger,'a chip inside the closed chooser cannot take focus; the connected trigger can');
  f.trigger.emit('click');
  controls.set({topic:'fiction'});controls.update(books);
  f.chips.children[2].emit('click');
  assert.equal(f.doc.activeElement,controls.choices.topic.chips[0],'with the chooser open the owning choice takes focus');
  f.trigger.emit('click');
  f.chips.children[0].emit('click');
  assert.equal(f.doc.activeElement,f.search);
  assert.equal(controls.read().query,'');
});

test('clear-all resets query and every filter and leaves the default view bare again',()=>{
  const f=filterFixture();
  const controls=mountShelfFilters({root:f.root,onChange:()=>{}});
  f.search.value='思考';controls.set({query:'思考'});controls.set({status:'finished'});controls.set({scope:'private'});controls.set({language:'zh',form:'all'});controls.update(books);
  f.clear.emit('click');
  assert.deepEqual(controls.read(),{query:'',scope:'all',status:'all',topic:'all',language:'all',form:'all'});
  assert.equal(f.selection.hidden,true);
  assert.equal(f.clear.hidden,true);
  assert.equal(f.doc.activeElement,f.search);
});

test('form choices, translation language choices and removable chips stay in sync',()=>{
  const f=filterFixture(),controls=mountShelfFilters({root:f.root,onChange:()=>{}});
  controls.update([{bookId:'translated',sourceLanguage:'en',translationLanguages:['ja'],supportsParallel:true}]);
  assert.ok(f.language.options.some(option=>option.value==='ja'));
  controls.set({language:'ja',form:'bilingual'});
  assert.equal(f.form.value,'bilingual');assert.equal(f.chips.children.length,2);
  f.chips.children[1].emit('click');
  assert.equal(controls.read().form,'all');assert.equal(controls.read().language,'ja');
});

test('unchanged shelf refreshes preserve the focused filter chip and its original clear action',()=>{
  const f=filterFixture(),changes=[],controls=mountShelfFilters({root:f.root,onChange:action=>changes.push(action)});
  controls.update(books);controls.set({topic:'philosophy',form:'original'});
  const [topicChip,formChip]=f.chips.children;formChip.focus();
  controls.update([...books]);controls.update([...books,{bookId:'another',sourceLanguage:'fr'}]);
  assert.equal(f.chips.children[0]===topicChip,true);assert.equal(f.chips.children[1]===formChip,true);
  assert.equal(f.doc.activeElement,formChip);assert.equal(f.chips.contains(formChip),true);
  formChip.emit('click');
  assert.equal(controls.read().form,'all');assert.equal(controls.read().topic,'philosophy');
  assert.deepEqual(changes.at(-1),{clear:'form'});
});

test('fiction is an explicit topic choice and the Chinese and English shortcuts stay selectable without matching books',()=>{
  const f=filterFixture();
  const controls=mountShelfFilters({root:f.root,onChange:()=>{}});
  controls.update(books);
  const topicValues=f.topic.options.map(option=>option.value);
  assert.deepEqual(topicValues,['all','philosophy','science','literature','history','fiction']);
  const languageValues=f.language.options.map(option=>option.value);
  assert.deepEqual(languageValues.slice(0,3),['all','zh','en']);
  assert.ok(languageValues.includes('unknown'));
  controls.set({topic:'fiction',language:'zh',form:'all'});
  controls.update(books);
  assert.deepEqual(controls.read(),{query:'',scope:'all',status:'all',topic:'fiction',language:'zh',form:'all'});
  assert.deepEqual(f.chips.children.map(chip=>chip.textContent),['小说与故事 ×','中文 ×']);
});

test('the three filter dropdowns are enhanced by the shared choice primitive and mirror options only through sync',()=>{
  const f=filterFixture();
  const controls=mountShelfFilters({root:f.root,onChange:()=>{}});
  assert.ok(controls.choices.topic&&controls.choices.scope&&controls.choices.language);
  assert.equal(controls.choices.topic.mode,'chips');
  const topicChips=controls.choices.topic.chips.map(chip=>chip.textContent);
  assert.ok(topicChips.includes('小说与故事'));
  controls.update(books);
  const languageChips=controls.choices.language.chips.map(chip=>chip.textContent);
  assert.ok(languageChips.includes('中文')&&languageChips.includes('英文'));
  assert.equal(f.topic.hidden,true,'a mounted enhancement hides its native fallback select');
});

test('actual locale commit changes filter labels in place without applying filters, replacing nodes or writing the search draft',async()=>{
  const f=filterFixture(),changes=[],controls=mountShelfFilters({root:f.root,onChange:action=>changes.push(action)});
  controls.set({topic:'fiction',language:'zh',form:'all'});controls.update(books);
  const native=[...f.topic.options],buttons=[...f.chips.children],choice=controls.choices.topic,choiceNodes=[...choice.chips];
  f.search.value='日本語 composing';f.search.selectionStart=2;f.search.selectionEnd=5;f.search.focus();
  f.chips.replaceChildren=()=>assert.fail('locale change must not rebuild summary');choice.root.replaceChildren=()=>assert.fail('locale change must not rebuild choice');
  f.topic.replaceChildren=()=>assert.fail('locale change must not rebuild native options');
  let draft=f.search.value,writes=0;Object.defineProperty(f.search,'value',{get:()=>draft,set:value=>{writes++;draft=value;},configurable:true});
  const before=changes.length;await requestUiRoute('ja');
  assert.equal(writes,0);assert.equal(f.doc.activeElement,f.search);assert.equal(f.search.selectionStart,2);assert.equal(f.search.selectionEnd,5);assert.equal(changes.length,before);
  assert.deepEqual([...f.topic.options],native);assert.deepEqual(f.chips.children,buttons);assert.deepEqual(choice.chips,choiceNodes);assert.equal(f.topic.value,'fiction');assert.equal(f.language.value,'zh');
  assert.equal(buttons[0].textContent,'小説と物語 ×');assert.equal(buttons[1].textContent,'中国語 ×');assert.equal(choice.root.getAttribute('aria-label'),'テーマ');assert.equal(f.root.getAttribute('lang'),'ja');
  controls.dispose();await requestUiRoute('en');assert.equal(buttons[0].textContent,'小説と物語 ×');
});
