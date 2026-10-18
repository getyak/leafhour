import test from 'node:test';
import assert from 'node:assert/strict';
import {mountChoiceControl} from '../app/choice-control.mjs';

// Minimal DOM fixture: real event listeners and dispatch, real option/value
// mirrors, just enough surface for the primitive. Tests drive actual events.
class FakeElement{
  constructor(tag,doc){
    this.tagName=String(tag).toUpperCase();this.ownerDocument=doc;this.children=[];this.parentElement=null;
    this.attributes=new Map();this.dataset={};this.className='';this.id='';this.textContent='';this.value='';
    this.disabled=false;this.hidden=false;this.tabIndex=0;this.type='';this.listeners=new Map();
  }
  addEventListener(type,fn){this.listeners.set(type,[...(this.listeners.get(type)||[]),fn]);}
  removeEventListener(type,fn){this.listeners.set(type,(this.listeners.get(type)||[]).filter(x=>x!==fn));}
  dispatchEvent(event){
    try{Object.defineProperty(event,'target',{value:this,configurable:true});}catch{}
    for(const fn of this.listeners.get(event.type)||[])fn(event);
    return true;
  }
  setAttribute(key,value){this.attributes.set(key,String(value));}
  getAttribute(key){return this.attributes.has(key)?this.attributes.get(key):null;}
  removeAttribute(key){this.attributes.delete(key);}
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
  focus(){this.ownerDocument.activeElement=this;}
}
function makeDocument(){
  const doc={
    activeElement:null,
    createElement(tag){return new FakeElement(tag,doc);},
    querySelector(){return null;}
  };
  return doc;
}
function makeSelect(doc,options){
  const select=new FakeElement('select',doc);
  select.options=options.map(([value,text,disabled=false])=>({value,textContent:text,disabled}));
  select.value=options[0]?.[0]??'';
  return select;
}
const keyEvent=(key,extra={})=>({type:'keydown',key,isComposing:false,defaultPrevented:false,prevented:false,stopped:false,preventDefault(){this.prevented=true;this.defaultPrevented=true;},stopPropagation(){this.stopped=true;},...extra});
const click=()=>({type:'click',preventDefault(){},stopPropagation(){}});

function mount(options=[['a','甲'],['b','乙'],['c','丙']]){
  const doc=makeDocument(),select=makeSelect(doc,options),host=new FakeElement('div',doc);
  host.append(select);
  const control=mountChoiceControl({document:doc,select,label:'示例',onChange:()=>{}});
  return {doc,select,host,control};
}
const changeEvents=select=>{let count=0;select.addEventListener('change',()=>count++);return ()=>count;};

test('a small choice group renders immediate segmented chips and commits exactly one change event',()=>{
  const {select,control}=mount();
  assert.ok(control,'enhancement must mount');
  assert.equal(control.mode,'chips');
  assert.equal(select.hidden,true,'a mounted enhancement hides its native fallback');
  const counts=changeEvents(select);
  control.chips[1].dispatchEvent(click());
  assert.equal(select.value,'b');assert.equal(counts(),1);
  control.chips[1].dispatchEvent(click());
  assert.equal(counts(),1,'selecting the committed value must not fire change');
  control.chips[2].dispatchEvent(click());
  assert.equal(select.value,'c');assert.equal(counts(),2);
  assert.equal(control.chips[2].getAttribute('aria-pressed'),'true');
  assert.equal(control.chips[1].getAttribute('aria-pressed'),'false');
});

test('chips keep label, help and disabled semantics from the native select',()=>{
  const doc=makeDocument(),select=makeSelect(doc,[['a','甲',true],['b','乙']]);
  select.setAttribute('aria-describedby','hint-id');
  const host=new FakeElement('div',doc);host.append(select);
  const control=mountChoiceControl({document:doc,select,label:'示例'});
  assert.equal(control.root.getAttribute('aria-describedby'),'hint-id');
  assert.equal(control.root.getAttribute('aria-label'),'示例');
  assert.equal(control.chips[0].disabled,true,'a disabled native option stays unselectable');
  select.disabled=true;control.sync();
  assert.equal(control.chips[1].disabled,true,'a disabled native select disables every chip');
});

test('programmatic options and value writes are mirrored only through the explicit sync method',()=>{
  const {select,control}=mount();
  select.value='c';select.options.push({value:'d',textContent:'丁',disabled:false});
  assert.notEqual(control.chips[2].getAttribute('aria-pressed'),'true','no blanket observer may rewrite the UI');
  control.sync();
  assert.equal(control.chips.length,4);
  assert.equal(control.chips[2].getAttribute('aria-pressed'),'true');
  const counts=changeEvents(select);
  control.sync();control.sync();
  assert.equal(counts(),0,'sync never fabricates change events');
});

test('crossing the option threshold remounts as a searchable combobox with unique stable active descendant ids',()=>{
  const {select,control}=mount();
  select.options.push({value:'d',textContent:'丁',disabled:false},{value:'e',textContent:'戊',disabled:false},{value:'f',textContent:'己',disabled:false},{value:'g',textContent:'庚',disabled:false});
  control.sync();
  assert.equal(control.mode,'combobox');
  assert.equal(select.hidden,true);
  const input=control.input;
  assert.equal(input.getAttribute('role'),'combobox');
  assert.equal(input.getAttribute('aria-expanded'),'false');
  assert.equal(input.getAttribute('aria-controls'),control.listbox.id);
  assert.equal(control.listbox.getAttribute('role'),'listbox');
  assert.ok(control.listbox.id&&control.listbox.id===input.getAttribute('aria-controls'));
  const ids=control.options.map(option=>option.node.id);
  assert.equal(new Set(ids).size,ids.length,'active descendant ids stay unique');
  for(const option of control.options)assert.equal(option.node.getAttribute('role'),'option');
});

test('search only changes candidate text while the committed select value waits for an explicit commit',()=>{
  const {select,control}=mount([['a','apple'],['b','banana'],['c','cherry'],['d','date'],['e','elder'],['f','fig'],['g','grape']]);
  const counts=changeEvents(select),input=control.input;
  input.value='an';
  input.dispatchEvent({type:'input',preventDefault(){}});
  assert.equal(select.value,'a');
  assert.deepEqual(control.options.filter(option=>!option.node.hidden).map(option=>option.value),['b']);
  input.dispatchEvent(keyEvent('ArrowDown'));
  input.dispatchEvent(keyEvent('Enter'));
  assert.equal(select.value,'b');assert.equal(counts(),1);
  assert.equal(input.value,'banana','the display shows the committed label');
});

test('arrow keys skip disabled options while Home and End reach the first and last enabled ones',()=>{
  const {select,control}=mount([['a','甲'],['b','乙',true],['c','丙'],['d','丁',true],['e','戊'],['f','己'],['g','庚']]);
  const input=control.input;
  input.dispatchEvent(keyEvent('ArrowDown'));
  assert.equal(control.activeValue,'c');
  input.dispatchEvent(keyEvent('End'));
  assert.equal(control.activeValue,'g');
  input.dispatchEvent(keyEvent('Home'));
  assert.equal(control.activeValue,'a');
  input.dispatchEvent(keyEvent('ArrowUp'));
  assert.equal(control.activeValue,'a','navigation stops at the first enabled option');
});

test('Escape reverts the display and returns focus without committing, and Tab stays normal traversal',()=>{
  const {select,control,doc}=mount([['a','甲'],['b','乙'],['c','丙'],['d','丁'],['e','戊'],['f','己'],['g','庚']]);
  const input=control.input,counts=changeEvents(select);
  input.focus();
  input.value='乙';input.dispatchEvent({type:'input'});
  input.dispatchEvent(keyEvent('Escape'));
  assert.equal(input.value,'甲','typed text is cancelled');
  assert.equal(select.value,'a');assert.equal(counts(),0);
  assert.equal(input.getAttribute('aria-expanded'),'false');
  assert.equal(doc.activeElement,input);
  const tab=keyEvent('Tab');
  input.dispatchEvent(tab);
  assert.equal(tab.prevented,false,'Tab must never be trapped');
});

test('IME composition suspends commit, navigation and cancel until compositionend',()=>{
  const {select,control}=mount([['a','甲'],['b','乙'],['c','丙'],['d','丁'],['e','戊'],['f','己'],['g','庚']]);
  const input=control.input,counts=changeEvents(select);
  input.dispatchEvent({type:'compositionstart'});
  input.dispatchEvent(keyEvent('ArrowDown',{isComposing:true}));
  assert.equal(control.activeValue,'a');
  input.dispatchEvent(keyEvent('Enter',{isComposing:true}));
  assert.equal(select.value,'a');assert.equal(counts(),0);
  input.dispatchEvent(keyEvent('Escape',{isComposing:true}));
  assert.equal(input.getAttribute('aria-expanded'),'false');
  input.dispatchEvent({type:'compositionend'});
  input.dispatchEvent(keyEvent('ArrowDown'));
  input.dispatchEvent(keyEvent('Enter'));
  assert.equal(select.value,'b');assert.equal(counts(),1);
});

test('clicking a listed option commits once and closes the popup',()=>{
  const {select,control}=mount([['a','甲'],['b','乙'],['c','丙'],['d','丁'],['e','戊'],['f','己'],['g','庚']]);
  const counts=changeEvents(select);
  control.input.dispatchEvent(keyEvent('ArrowDown'));
  control.options[2].node.dispatchEvent(click());
  assert.equal(select.value,'c');assert.equal(counts(),1);
  assert.equal(control.input.getAttribute('aria-expanded'),'false');
  assert.equal(control.input.value,'丙');
});

test('an enhancement that cannot mount leaves the native select visible and untouched',()=>{
  const doc=makeDocument(),select=makeSelect(doc,[['a','甲']]);
  const control=mountChoiceControl({document:doc,select,label:'示例'});
  assert.equal(control,null);
  assert.equal(select.hidden,false,'fallback stays visible only when the mount failed');
});

const mouseDown=()=>({type:'mousedown',defaultPrevented:false,prevented:false,preventDefault(){this.prevented=true;this.defaultPrevented=true;},stopPropagation(){}});

test('a closed combobox hides its listbox from layout and accessibility at every close point',()=>{
  const {control}=mount([['a','apple'],['b','banana'],['c','cherry'],['d','date'],['e','elder'],['f','fig'],['g','grape']]);
  assert.equal(control.listbox.hidden,true,'the popup is hidden from first mount');
  control.input.dispatchEvent(keyEvent('ArrowDown'));
  assert.equal(control.listbox.hidden,false);
  control.input.dispatchEvent(keyEvent('Escape'));
  assert.equal(control.listbox.hidden,true,'Escape hides the popup again');
  control.input.dispatchEvent(keyEvent('ArrowDown'));
  assert.equal(control.listbox.hidden,false);
  control.options[1].node.dispatchEvent(click());
  assert.equal(control.listbox.hidden,true,'a commit hides the popup');
  control.input.dispatchEvent(keyEvent('ArrowDown'));
  control.input.dispatchEvent({type:'blur'});
  assert.equal(control.listbox.hidden,true,'blur hides the popup');
});

test('pointer press keeps the searched rows stable so the click lands on the row under the pointer',()=>{
  const {select,control}=mount([['a','amber'],['b','brave'],['c','crisp'],['d','dawn'],['e','echo'],['f','fern'],['g','grape']]);
  const counts=changeEvents(select),input=control.input;
  input.value='grape';input.dispatchEvent({type:'input'});
  assert.deepEqual(control.options.filter(option=>!option.node.hidden).map(option=>option.value),['g']);
  const press=mouseDown();
  control.options[6].node.dispatchEvent(press);
  assert.equal(press.prevented,true,'mousedown keeps focus so blur cannot reset the rows before the click');
  assert.deepEqual(control.options.filter(option=>!option.node.hidden).map(option=>option.value),['g'],'the searched rows stay put during the press');
  control.options[6].node.dispatchEvent(click());
  assert.equal(select.value,'g');assert.equal(counts(),1);
});

test('sync reconciles stable keyed chips so a focused chip survives option and value updates',()=>{
  const {doc,select,control}=mount();
  const chip=control.chips[1];
  chip.focus();
  select.value='b';
  control.sync();
  assert.equal(control.chips[1],chip,'the chip node for the same value is reused, not replaced');
  assert.equal(chip.parentElement,control.root,'the focused chip stays connected to its group');
  assert.equal(doc.activeElement,chip);
  select.options.push({value:'c2',textContent:'丙二',disabled:false});
  control.sync();
  assert.equal(control.chips[1],chip);
  assert.equal(chip.parentElement,control.root);
  assert.equal(doc.activeElement,chip);
  assert.equal(control.chips.length,4);
});

test('a real remount restores focus to the control for the same visible value',()=>{
  const {doc,select,control}=mount();
  control.chips[1].focus();
  select.options.push({value:'d',textContent:'丁',disabled:false},{value:'e',textContent:'戊',disabled:false},{value:'f',textContent:'己',disabled:false},{value:'g',textContent:'庚',disabled:false});
  control.sync();
  assert.equal(control.mode,'combobox');
  assert.equal(doc.activeElement,control.input,'after an actual remount focus returns to the control');
});

test('composition from closed applies only the final composed search and closed Home/End keep native text editing',()=>{
  const {control}=mount([['a','amber'],['b','brave'],['c','crisp'],['d','dawn'],['e','echo'],['f','fern'],['g','grape']]);
  const input=control.input;
  input.value='gra';
  input.dispatchEvent({type:'compositionstart'});
  input.dispatchEvent({type:'input'});
  assert.deepEqual(control.options.filter(option=>!option.node.hidden).map(option=>option.value),['a','b','c','d','e','f','g'],'partial composition text never filters');
  input.value='grape';
  input.dispatchEvent({type:'compositionend'});
  assert.deepEqual(control.options.filter(option=>!option.node.hidden).map(option=>option.value),['g'],'the final composed query filters');
  assert.equal(control.listbox.hidden,false);
  const home=keyEvent('Home'),end=keyEvent('End');
  input.dispatchEvent({type:'blur'});
  input.dispatchEvent(home);input.dispatchEvent(end);
  assert.equal(home.prevented,false,'closed Home keeps native caret behavior');
  assert.equal(end.prevented,false,'closed End keeps native caret behavior');
});

test('sync reconciles a stale active descendant after options change under an open search',()=>{
  const {select,control}=mount([['a','amber'],['b','brave'],['c','crisp'],['d','dawn'],['e','echo'],['f','fern'],['g','grape']]);
  const input=control.input;
  input.value='g';input.dispatchEvent({type:'input'});
  assert.equal(control.activeValue,'g');
  select.options.splice(6,1,{value:'h',textContent:'guava',disabled:false});
  control.sync();
  assert.equal(control.activeValue,'h','the active option reconciles to an existing visible enabled option');
  const node=control.options.find(option=>option.value==='h').node;
  assert.equal(input.getAttribute('aria-activedescendant'),node.id);
  assert.equal(node.hidden,false);
  select.options.splice(6,1,{value:'i',textContent:'honey',disabled:false});
  control.sync();
  assert.notEqual(control.activeValue,'h','a stale active value never survives an option change');
  assert.equal(input.getAttribute('aria-activedescendant'),null,'with no visible enabled option the stale aria is reset');
});

test('a failed enhancement removes its partial chrome and keeps the native select visible and named',()=>{
  const doc=makeDocument(),select=makeSelect(doc,[['a','甲'],['b','乙']]);
  const label=new FakeElement('label',doc);label.setAttribute('for','pick');label.textContent='挑选';
  doc.querySelector=selector=>selector==='label[for="pick"]'?label:null;
  select.id='pick';
  const host=new FakeElement('div',doc);host.append(select,label);
  let created=0;
  const realCreate=doc.createElement.bind(doc);
  doc.createElement=tag=>{if(created++>0)throw Error('mount failure');return realCreate(tag);};
  const control=mountChoiceControl({document:doc,select});
  assert.equal(control,null);
  assert.equal(select.hidden,false,'the native fallback stays visible when the mount failed');
  assert.deepEqual(host.children.map(node=>node.tagName),['SELECT','LABEL'],'no partial enhancement chrome survives the failure');
  assert.equal(label.getAttribute('for'),'pick','the native label association survives the failure');
});


test('a reused option click reads the current disabled state after each sync',()=>{
 const {select,control}=mount([['a','apple'],['b','banana'],['c','cherry'],['d','date'],['e','elder'],['f','fig'],['g','grape']]);
 const count=changeEvents(select),node=control.options[1].node;
 select.options[1].disabled=true;control.sync();node.dispatchEvent(click());assert.equal(select.value,'a');assert.equal(count(),0);
 select.options[1].disabled=false;control.sync();node.dispatchEvent(click());assert.equal(select.value,'b');assert.equal(count(),1);
});
test('combobox to chips to combobox resets expansion and hands focus across both thresholds',()=>{
 const {doc,select,control}=mount([['a','apple'],['b','banana'],['c','cherry'],['d','date'],['e','elder'],['f','fig'],['g','grape']]);
 control.input.focus();control.input.dispatchEvent(keyEvent('ArrowDown'));
 const removed=select.options.pop();control.sync();assert.equal(control.mode,'chips');assert.equal(doc.activeElement,control.chips.find(c=>c.dataset.value===select.value));
 select.options.push(removed);control.sync();assert.equal(control.mode,'combobox');assert.equal(doc.activeElement,control.input);
 assert.equal(control.input.getAttribute('aria-expanded'),'false');assert.equal(control.listbox.hidden,true);assert.equal(control.input.getAttribute('aria-activedescendant'),null);
 control.input.dispatchEvent(keyEvent('ArrowDown'));assert.equal(control.input.getAttribute('aria-expanded'),'true');assert.equal(control.listbox.hidden,false);
});
