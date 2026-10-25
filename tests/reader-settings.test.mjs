import test from 'node:test';import assert from 'node:assert/strict';
import {requestUiRoute} from '../app/ui-locale.mjs';
test.beforeEach(async()=>{await requestUiRoute('zh-Hans');});
const settings=()=>import('../app/reader-settings.mjs').catch(()=>({}));
class Element extends EventTarget{
  constructor(tab){super();this.dataset=tab?{settingsTab:tab}:{};this.attributes=new Map();this.hidden=false;this.scrollTop=80;}
  setAttribute(key,value){this.attributes.set(key,String(value));}getAttribute(key){return this.attributes.get(key);}focus(){this.focused=true;}
}
function fixture(){const tabs=['reading','sound','habits','data'].map(name=>new Element(name)),elements=new Map(['settings-content','translation-settings','parallel-settings','translation-details',...tabs.map(t=>'settings-'+t.dataset.settingsTab)].map(id=>[id,new Element()]));return {tabs,elements,document:{querySelectorAll:()=>tabs,getElementById:id=>elements.get(id)}};}
test('settings only expose the translation controls relevant to the active reading mode',async()=>{
  const {mountReaderSettings}=await settings();assert.equal(typeof mountReaderSettings,'function');
  const f=fixture(),ui=mountReaderSettings({document:f.document});
  for(const [mode,translation,parallel]of [['en',false,false],['zh',true,false],['parallel',true,true]]){
    ui.update({mode});assert.equal(f.elements.get('translation-settings').hidden,!translation);assert.equal(f.elements.get('translation-details').hidden,false);assert.equal(f.elements.get('parallel-settings').hidden,!parallel);
  }
});
test('four settings tabs expose one panel at a time and keep keyboard focus in the selected tab',async()=>{
  const {mountReaderSettings}=await settings();assert.equal(typeof mountReaderSettings,'function');
  const f=fixture();mountReaderSettings({document:f.document});assert.equal(f.tabs[0].getAttribute('aria-selected'),'true');
  f.tabs[1].dispatchEvent(new Event('click'));assert.equal(f.elements.get('settings-reading').hidden,true);assert.equal(f.elements.get('settings-sound').hidden,false);
  const arrow=new Event('keydown',{cancelable:true});Object.defineProperty(arrow,'key',{value:'ArrowRight'});f.tabs[1].dispatchEvent(arrow);
  assert.equal(f.tabs[2].getAttribute('aria-selected'),'true');assert.equal(f.tabs[2].focused,true);assert.equal(f.elements.get('settings-habits').hidden,false);
  assert.equal(f.tabs.filter(t=>t.getAttribute('aria-selected')==='true').length,1);
});

// GET-187: every conditional Aa drawer select upgrades to the shared choice
// primitive without changing its native value/change side effects; the native
// select stays the progressive fallback only when a mount fails.
const CHOICE_SELECTS=['reading-purpose','preferred-language','view-mode','page-layout','translation-variant','parallelLayout','parallelStyle','parallelColor','parallelBackground'];
class RichElement extends EventTarget{
  constructor(tag,doc){super();this.tagName=String(tag).toUpperCase();this.ownerDocument=doc;this.children=[];this.parentElement=null;this.attributes=new Map();this.dataset={};this.className='';this.id='';this.textContent='';this.value='';this.disabled=false;this.hidden=false;this.tabIndex=0;this.type='';this.options=[];}
  setAttribute(key,value){this.attributes.set(key,String(value));}getAttribute(key){return this.attributes.has(key)?this.attributes.get(key):null;}removeAttribute(key){this.attributes.delete(key);}
  get classList(){const owner=this;return{add(...n){const s=new Set(owner.className.split(/\s+/).filter(Boolean));n.forEach(x=>s.add(x));owner.className=[...s].join(' ');},remove(...n){const s=new Set(owner.className.split(/\s+/).filter(Boolean));n.forEach(x=>s.delete(x));owner.className=[...s].join(' ');},toggle(x,f){const s=new Set(owner.className.split(/\s+/).filter(Boolean));const on=f===undefined?!s.has(x):!!f;on?s.add(x):s.delete(x);owner.className=[...s].join(' ');return on;},contains(x){return owner.className.split(/\s+/).includes(x);}};}
  append(...nodes){for(const node of nodes){node.parentElement=this;this.children.push(node);}}
  replaceChildren(...nodes){this.children=[];this.append(...nodes);}
  after(node){const parent=this.parentElement;const index=parent.children.indexOf(this);parent.children.splice(index+1,0,node);node.parentElement=parent;}
  remove(){const parent=this.parentElement;if(parent){parent.children.splice(parent.children.indexOf(this),1);this.parentElement=null;}}
  focus(){this.ownerDocument.activeElement=this;}
  dispatchEvent(event){try{Object.defineProperty(event,'target',{value:this,configurable:true});}catch{}return super.dispatchEvent(event);}
  matches(){return false;}
}
function richFixture(){
  const doc={activeElement:null,createElement:tag=>new RichElement(tag,doc),querySelector:()=>null};
  const elements=new Map();
  const host=new RichElement('div',doc);
  const add=(id,tag='div')=>{const node=new RichElement(tag,doc);node.id=id;elements.set(id,node);host.append(node);return node;};
  const tabs=['reading','sound','habits','data'].map(name=>add('settings-'+name));
  for(const id of ['settings-content','translation-settings','parallel-settings','translation-details'])add(id);
  tabs.forEach(tab=>tab.dataset.settingsTab=tab.id.replace('settings-',''));
  const rows={};
  for(const id of CHOICE_SELECTS){
    const select=add(id,'select');
    const rowsOptions=id==='reading-purpose'?[['manual','未设置'],['deep','深入理解'],['language','语言学习']]:id==='view-mode'?[['en','英文原文'],['zh','中文译文'],['parallel','中英对照']]:[['a','甲'],['b','乙'],['c','丙'],['d','丁'],['e','戊'],['f','己'],['g','庚']];
    select.options=rowsOptions.map(([value,text,disabled=false])=>({value,textContent:text,disabled}));
    select.value=select.options[0].value;
    rows[id]=select;
  }
  add('reading-time-source','select').options=[['reader_focus','主动专注'],['reader_estimate','前台估计']];
  Object.assign(doc,{querySelectorAll:()=>tabs,getElementById:id=>elements.get(id)||null,querySelector:()=>null});
  return {doc,elements,tabs,rows,document:doc};
}
test('all nine Aa drawer selects upgrade to the shared choice primitive while the drawer-outside timer select stays native',async()=>{
  const {mountReaderSettings}=await settings();
  const f=richFixture(),ui=mountReaderSettings({document:f.document});await ui.enhance();
  for(const id of CHOICE_SELECTS){
    assert.ok(ui.choices[id],id+' must use the shared choice primitive');
    assert.equal(f.rows[id].hidden,true,id+' hides its native fallback only after a successful mount');
    assert.ok(ui.choices[id].mode==='chips'||ui.choices[id].mode==='combobox');
  }
  assert.equal(ui.choices['reading-time-source'],undefined,'the reading-time source select stays outside the drawer');
  assert.equal(f.elements.get('reading-time-source').hidden,false);
});
test('Aa option and value writes need the explicit sync call and never fabricate change events',async()=>{
  const {mountReaderSettings}=await settings();
  const f=richFixture(),ui=mountReaderSettings({document:f.document});await ui.enhance();
  let changes=0;f.rows['view-mode'].addEventListener('change',()=>changes++);
  f.rows['view-mode'].value='zh';
  assert.notEqual(ui.choices['view-mode'].chips[1].getAttribute('aria-pressed'),'true');
  ui.sync();
  assert.equal(ui.choices['view-mode'].chips[1].getAttribute('aria-pressed'),'true');
  assert.equal(changes,0,'sync mirrors state without inventing a change event');
  ui.choices['view-mode'].chips[2].dispatchEvent(new Event('click'));
  assert.equal(f.rows['view-mode'].value,'parallel');
  assert.equal(changes,1,'a confirmed changed value fires exactly one normal change event');
  ui.choices['view-mode'].chips[2].dispatchEvent(new Event('click'));
  assert.equal(changes,1,'the same value never repeats the change event');
});


test('Aa controls load once on explicit opening and read the latest native values after the load',async()=>{
 const {mountReaderSettings}=await settings(),f=richFixture();let calls=0,resolve;
 const ui=mountReaderSettings({document:f.document,loadChoices:()=>{calls++;return new Promise(r=>resolve=r);}});
 assert.equal(calls,0);assert.equal(f.rows['view-mode'].hidden,false);
 const first=ui.enhance(),second=ui.enhance();assert.equal(calls,1);assert.equal(first,second);
 f.rows['view-mode'].value='zh';ui.sync();
 resolve(await import('../app/reader-settings-choices.mjs'));await first;
 assert.equal(f.rows['view-mode'].hidden,true);assert.equal(ui.choices['view-mode'].chips[1].getAttribute('aria-pressed'),'true');
});
test('a rejected Aa module keeps every native fallback available',async()=>{
 const {mountReaderSettings}=await settings(),f=richFixture();
 const ui=mountReaderSettings({document:f.document,loadChoices:async()=>{throw Error('offline');}});
 assert.equal(await ui.enhance(),false);assert.equal(Object.keys(ui.choices).length,0);
 for(const id of CHOICE_SELECTS)assert.equal(f.rows[id].hidden,false);
});

test('an Aa module arriving while a native select has focus transfers focus to its selected enhancement',async()=>{
 const {mountReaderSettings}=await settings(),f=richFixture();let resolve;
 const ui=mountReaderSettings({document:f.document,loadChoices:()=>new Promise(r=>resolve=r)}),ready=ui.enhance();
 f.rows['view-mode'].value='zh';f.rows['view-mode'].focus();resolve(await import('../app/reader-settings-choices.mjs'));await ready;
 assert.equal(f.rows['view-mode'].hidden,true);assert.equal(f.doc.activeElement,ui.choices['view-mode'].chips[1]);assert.equal(f.doc.activeElement.parentElement,ui.choices['view-mode'].root);
});

test('locale relabels existing Aa choices without touching native values, open query or composition',async()=>{
  const {mountReaderSettings}=await settings(),f=richFixture();
  const mode=f.rows['view-mode'];
  const keys=['prefs.mode.original','prefs.mode.translation','prefs.mode.parallel'];
  mode.options.forEach((option,i)=>option.getAttribute=name=>name==='data-ui'?keys[i]:null);
  const longer=f.rows.parallelStyle;longer.options.forEach((option,i)=>option.getAttribute=name=>name==='data-ui'?keys[i%3]:null);
  const ui=mountReaderSettings({document:f.document});await ui.enhance();
  const choice=ui.choices.parallelStyle,chip=ui.choices['view-mode'].chips[0],input=choice.input;
  input.focus();input.value='原文';input.dispatchEvent(new Event('input'));
  const active=choice.activeValue,activeDescendant=input.getAttribute('aria-activedescendant'),options=choice.options.map(row=>row.node),hidden=options.map(node=>node.hidden),values=Object.fromEntries(CHOICE_SELECTS.map(id=>[id,f.rows[id].value]));
  let inputWrites=0,nativeWrites=0,changes=0;const rawInput=input.value;
  Object.defineProperty(input,'value',{configurable:true,get:()=>rawInput,set(){inputWrites++;}});
  for(const id of CHOICE_SELECTS){const select=f.rows[id],value=select.value;Object.defineProperty(select,'value',{configurable:true,get:()=>value,set(){nativeWrites++;}});select.addEventListener('change',()=>changes++);}
  input.dispatchEvent(new Event('compositionstart'));f.elements.get('settings-content').scrollTop=123;
  await requestUiRoute('en');assert.equal(chip.textContent,'Original');assert.equal(ui.choices['view-mode'].chips[0],chip);
  assert.deepEqual(choice.options.map(row=>row.node),options);assert.deepEqual(options.map(node=>node.hidden),hidden);
  assert.equal(input.getAttribute('aria-expanded'),'true');assert.equal(input.getAttribute('aria-activedescendant'),activeDescendant);assert.equal(choice.activeValue,active);
  await requestUiRoute('ja');assert.equal(chip.textContent,'原文');assert.equal(input.value,'原文');assert.equal(f.doc.activeElement,input);
  assert.equal(inputWrites,0);assert.equal(nativeWrites,0);assert.equal(changes,0);assert.equal(f.elements.get('settings-content').scrollTop,123);
  assert.deepEqual(Object.fromEntries(CHOICE_SELECTS.map(id=>[id,f.rows[id].value])),values);
  ui.unmount();const detached=chip.textContent;await requestUiRoute('en');assert.equal(chip.textContent,detached);
});

test('locale changes preserve a pending new-book default snapshot and only reformat its receipt',async()=>{
  const {mountReadingDefaults}=await settings(),nodes=new Map(['save-reading-defaults','reading-defaults-status','reading-defaults-setting'].map(id=>[id,new Element()]));
  const status=nodes.get('reading-defaults-status');status.classList={toggle(){}};
  const session={user:{id:'reader-a'},readingPreferences:{revision:4,preferences:{onboarding:'completed'}}},state={mode:'parallel',font:24};let reads=0,stateReads=0,release;const sent=[],saved=[];
  const ui=mountReadingDefaults({document:{getElementById:id=>nodes.get(id)},getSession:()=>{reads++;return session;},getState:()=>{stateReads++;return state;},api:(url,body)=>{sent.push(structuredClone({url,body}));return new Promise(resolve=>release=resolve);},onSaved:value=>saved.push(value)});
  const button=nodes.get('save-reading-defaults');button.dispatchEvent(new Event('click'));const counts={reads,stateReads},payload=structuredClone(sent[0]);
  for(const [code,label]of [['en','Saving…'],['ja','保存中…'],['zh-Hant','正在儲存…'],['zh-Hans','正在保存…']]){
    await requestUiRoute(code);assert.equal(button.textContent,label);assert.equal(button.disabled,true);assert.equal(sent.length,1);assert.deepEqual(sent[0],payload);assert.deepEqual({reads,stateReads},counts);
  }
  state.mode='en';release({revision:5,preferences:payload.body.preferences});await new Promise(setImmediate);assert.equal(saved.length,1);assert.equal(sent[0].body.baseRevision,4);assert.equal(sent[0].body.preferences.mode,'parallel');assert.equal(state.mode,'en');
  await requestUiRoute('en');assert.match(status.textContent,/New books/);assert.equal(button.textContent,'Use for new books');
  ui.unmount();const detached=status.textContent;await requestUiRoute('ja');assert.equal(status.textContent,detached);
});

test('an A to B to A account transition fences a late default save while the current owner remains usable',async()=>{
  const {mountReadingDefaults}=await settings(),nodes=new Map(['save-reading-defaults','reading-defaults-status','reading-defaults-setting'].map(id=>[id,new Element()]));nodes.get('reading-defaults-status').classList={toggle(){}};
  const a={user:{id:'reader-a'},readingPreferences:{revision:4,preferences:{onboarding:'completed'}}},b={user:{id:'reader-b'},readingPreferences:{revision:8,preferences:{onboarding:'completed'}}};let session=a,release;const saved=[];
  const ui=mountReadingDefaults({document:{getElementById:id=>nodes.get(id)},getSession:()=>session,getState:()=>({mode:'parallel'}),api:()=>new Promise(resolve=>release=resolve),onSaved:value=>saved.push(value)});
  nodes.get('save-reading-defaults').dispatchEvent(new Event('click'));session=b;ui.update();session=a;ui.update();release({revision:5});await new Promise(setImmediate);
  assert.equal(saved.length,0);assert.equal(nodes.get('save-reading-defaults').disabled,false);assert.equal(nodes.get('reading-defaults-status').textContent,'');ui.unmount();
});
