// GET-201 settings control primitives: grouped rows, native-backed switches,
// the selectable dropzone, the heavy-action confirmation and the 24-hour time
// choices. These are behavior contracts (events, states, focus), not CSS
// mirroring tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import {settingGroup,settingRow,switchRow,mountDropzone,mountConfirm,mountTimeChoices,mountTimeEditor} from '../app/settings-controls.mjs';

class Element extends EventTarget{
  constructor(tag,doc){super();this.tagName=String(tag).toUpperCase();this.doc=doc;this.children=[];this.attributes={};this.dataset={};this.classList=new ClassList(this);this.value='';this.checked=false;this.disabled=false;this.hidden=false;this.isConnected=true;this.textContent='';this.className='';this.files=null;this.type='';}
  get id(){return this.attributes.id||'';}set id(value){this.attributes.id=String(value);}
  append(...nodes){for(const node of nodes){if(node.parentElement)node.parentElement.children=node.parentElement.children.filter(child=>child!==node);node.parentElement=this;this.children.push(node);}}
  appendChild(node){this.append(node);return node;}
  replaceChildren(...nodes){this.children=[];this.append(...nodes);}
  remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(child=>child!==this);this.parentElement=null;}
  setAttribute(key,value){this.attributes[key]=String(value);}getAttribute(key){return key in this.attributes?this.attributes[key]:null;}hasAttribute(key){return key in this.attributes;}removeAttribute(key){delete this.attributes[key];}
  focus(){this.doc.activeElement=this;}
  click(){this.dispatchEvent(new Event('click',{cancelable:true,bubbles:true}));}
}
class ClassList{
  constructor(node){this.node=node;this.set=new Set();}
  add(...names){for(const name of names)this.set.add(name);}remove(...names){for(const name of names)this.set.delete(name);}
  toggle(name,force){if(force===undefined)force=!this.set.has(name);if(force)this.set.add(name);else this.set.delete(name);return force;}
  contains(name){return this.set.has(name);}
}
const fixture=()=>{const doc={activeElement:null};doc.createElement=tag=>new Element(tag,doc);doc.createTextNode=text=>{const node=new Element('#text',doc);node.textContent=text;return node;};doc.body=new Element('body',doc);globalThis.document=doc;return doc;};

test('a setting group and row keep the title, the plain description and the control in one labelled row',()=>{
  const doc=fixture();
  const group=settingGroup({document:doc,title:'Backups',description:'Short plain line.'});
  assert.equal(group.title.textContent,'Backups');assert.equal(group.description.textContent,'Short plain line.');
  const input=doc.createElement('input');input.id='setting-x';
  const row=settingRow({document:doc,label:'Include source files',description:'Larger, no re-upload.',control:input,labelFor:'setting-x'});
  assert.equal(row.label.textContent,'Include source files');assert.equal(row.description.textContent,'Larger, no re-upload.');
  assert.equal(row.label.getAttribute('for'),'setting-x','the visible label stays associated with the backing control');
  assert.equal(row.control,input);
  group.body.append(row.root);
  assert.equal(group.body.children[0],row.root);
  row.setLabel('New label');row.setDescription('New line');
  assert.equal(row.label.textContent,'New label');assert.equal(row.description.textContent,'New line');
});

test('the switch keeps its native checkbox backing node and never invents a second change event',()=>{
  const doc=fixture(),changes=[];
  const input=doc.createElement('input');input.type='checkbox';input.id='daily-consent';
  const wrap=switchRow({document:doc,input,label:'Allow',description:'Bounded reading.'});
  assert.equal(input.type,'checkbox','the native checkbox stays the value owner');
  assert.equal(input.id,'daily-consent');assert.equal(wrap.input,input);
  assert.equal(input.parentElement,wrap.root);
  assert.equal(wrap.label.textContent,'Allow');assert.equal(wrap.description.textContent,'Bounded reading.');
  input.addEventListener('change',()=>changes.push(input.checked));
  input.checked=true;input.dispatchEvent(new Event('change'));
  assert.deepEqual(changes,[true],'exactly one native change event reaches existing listeners');
  wrap.setDisabled(true);assert.equal(input.disabled,true);wrap.setDisabled(false);assert.equal(input.disabled,false);
});

test('the dropzone reports selection, size and validation and never starts the business action itself',()=>{
  const doc=fixture(),changes=[];
  const input=doc.createElement('input');input.type='file';input.id='settings-file';
  input.addEventListener('change',()=>changes.push(input.files?.[0]?.name||null));
  const zone=mountDropzone({document:doc,input,title:'Drop a backup here',action:'Choose a file',hint:'ZIP or JSON.'});
  assert.equal(zone.input,input);assert.equal(input.parentElement,zone.root,'the native file input stays inside the zone');
  assert.equal(zone.state.dataset.state,'empty');
  input.files=[{name:'backup.zip',size:2048}];
  input.dispatchEvent(new Event('change'));
  assert.deepEqual(changes,['backup.zip']);
  assert.equal(zone.state.dataset.state,'selected');
  assert.match(zone.state.textContent,/backup\.zip/);assert.match(zone.state.textContent,/2\.0 ?KiB|2048/);
  // A drop is a file selection, not a restore.
  const over=new Event('dragover',{cancelable:true});zone.root.dispatchEvent(over);assert.equal(over.defaultPrevented,true);assert.equal(zone.root.dataset.dragover,'true');
  const leave=new Event('dragleave');zone.root.dispatchEvent(leave);assert.equal(zone.root.dataset.dragover,'false');
  const drop=new Event('drop',{cancelable:true});drop.dataTransfer={files:[{name:'dropped.zip',size:10}]};zone.root.dispatchEvent(drop);
  assert.equal(drop.defaultPrevented,true);assert.equal(input.files[0].name,'dropped.zip');
  assert.deepEqual(changes,['backup.zip','dropped.zip'],'a drop commits exactly one change event');
  assert.equal(changes.length,2,'no implicit restore action runs on selection or drop');
  zone.setState({state:'checking',message:'Checking the archive…'});assert.equal(zone.state.dataset.state,'checking');assert.match(zone.state.textContent,/Checking/);
  zone.setState({state:'invalid',message:'Not a Leafhour backup.'});assert.equal(zone.state.dataset.state,'invalid');assert.match(zone.state.textContent,/Not a Leafhour backup/);
  zone.setState({state:'valid',name:'ok.zip',size:42});assert.equal(zone.state.dataset.state,'valid');assert.match(zone.state.textContent,/ok\.zip/);
});

test('the confirmation states the consequence and runs the heavy action only after explicit confirm',()=>{
  const doc=fixture(),runs=[];
  const confirm=mountConfirm({document:doc,labels:{cancel:'Cancel',confirm:'Restore now'}});
  const opener=doc.createElement('button');doc.body.append(opener);doc.activeElement=opener;
  confirm.open({title:'Restore this backup?',consequence:'Records in the archive merge into this reading room.',opener,onConfirm:()=>runs.push('restore')});
  assert.equal(confirm.dialog.getAttribute('open'),'true','the confirmation is visible');
  assert.match(confirm.consequence.textContent,/merge into this reading room/);
  assert.equal(confirm.confirmButton.textContent,'Restore now');
  assert.equal(doc.activeElement,confirm.cancelButton,'the safe option holds initial focus');
  confirm.cancelButton.click();assert.deepEqual(runs,[]);
  assert.equal(confirm.dialog.getAttribute('open'),null);assert.equal(doc.activeElement,opener,'cancel returns focus to the opener');
  confirm.open({title:'Cancel this restore?',consequence:'Staged parts are discarded.',opener,onConfirm:()=>runs.push('cancel')});
  confirm.confirmButton.click();assert.deepEqual(runs,['cancel'],'only the explicit confirm runs the action');
  assert.equal(confirm.dialog.getAttribute('open'),null);
  confirm.open({title:'Again?',consequence:'Second consequence.',opener,onConfirm:()=>runs.push('again')});
  confirm.dialog.dispatchEvent(new Event('keydown')); // not Escape: untouched
  assert.equal(confirm.dialog.getAttribute('open'),'true');
  const escape=new Event('keydown');escape.key='Escape';confirm.dialog.dispatchEvent(escape);
  assert.equal(confirm.dialog.getAttribute('open'),null);assert.deepEqual(runs,['cancel'],'Escape cancels, never confirms');
});

test('time choices commit exactly one change and keep the native input authoritative',()=>{
  const doc=fixture(),events=[];
  const input=doc.createElement('input');input.type='time';input.id='daily-time';input.value='20:00';
  for(const type of ['input','change'])input.addEventListener(type,()=>events.push(type));
  const choices=mountTimeChoices({document:doc,input,times:['07:00','12:30','20:00','22:30'],customLabel:'Custom'});
  assert.equal(input.value,'20:00','the native input keeps the value');
  assert.equal(choices.buttons.length,4);
  assert.equal(choices.buttons[2].getAttribute('aria-pressed'),'true');
  choices.buttons[0].click();
  assert.equal(input.value,'07:00');assert.deepEqual(events,['input','change'],'one user change, one input and one change event');
  events.length=0;
  choices.buttons[0].click();
  assert.deepEqual(events,[],'re-picking the active time changes nothing');
  input.value='23:10';input.dispatchEvent(new Event('input'));choices.sync();
  assert.equal(choices.buttons.every(button=>button.getAttribute('aria-pressed')==='false'),true);
  assert.equal(choices.custom.getAttribute('aria-pressed'),'true');
  input.disabled=true;choices.sync();assert.equal(choices.buttons.every(button=>button.disabled===true),true);
});

// ---- component review 01/02 repairs ----
test('a disabled dropzone refuses drops and a failed file adoption never emits change',()=>{
  const doc=fixture(),changes=[];
  const input=doc.createElement('input');input.type='file';input.id='settings-file';
  input.addEventListener('change',()=>changes.push(input.files&&input.files[0]&&input.files[0].name||null));
  const zone=mountDropzone({document:doc,input,title:'Drop',action:'Choose',hint:'ZIP'});
  input.files=[{name:'old.zip',size:1}];
  input.disabled=true;
  const over=new Event('dragover',{cancelable:true});zone.root.dispatchEvent(over);
  assert.equal(over.defaultPrevented,true,'a locked dropzone still cancels browser file-drop handling');
  assert.notEqual(zone.root.dataset.dragover,'true','a locked dropzone never advertises acceptance');
  const drop=new Event('drop',{cancelable:true});drop.dataTransfer={files:[{name:'new.zip',size:2}]};zone.root.dispatchEvent(drop);
  assert.equal(drop.defaultPrevented,true,'a refused file cannot trigger browser navigation');
  assert.deepEqual(changes,[],'a disabled input refuses the drop entirely');
  assert.equal(zone.root.dataset.dragover,'false');
  assert.equal(input.files[0].name,'old.zip','the staged file is untouched');
  input.disabled=false;
  // A rejecting files setter must not announce the old file as a new selection.
  Object.defineProperty(input,'files',{configurable:true,set(){throw Error('no setter');},get(){return [{name:'old.zip',size:1}];}});
  const failed=new Event('drop',{cancelable:true});failed.dataTransfer={files:[{name:'new.zip',size:2}]};zone.root.dispatchEvent(failed);
  assert.deepEqual(changes,[],'a failed adoption emits no change at all');
  assert.equal(zone.state.dataset.state,'selected','the visible state still describes the old staged file');
  // A successful adoption emits exactly one change.
  const store=[{name:'new.zip',size:2}];
  Object.defineProperty(input,'files',{configurable:true,set(value){assert.equal(value,store);this.adopted=value;},get(){return this.adopted||null;}});
  const good=new Event('drop',{cancelable:true});good.dataTransfer={files:store};zone.root.dispatchEvent(good);
  assert.deepEqual(changes,['new.zip'],'exactly one change after the real adoption');
});

test('the confirmation carries stable accessible name and description associations',()=>{
  const doc=fixture();
  const first=mountConfirm({document:doc,labels:{cancel:'Cancel',confirm:'Do it'}});
  const second=mountConfirm({document:doc,labels:{cancel:'Cancel',confirm:'Do it'}});
  for(const confirm of [first,second]){
    const titleId=confirm.dialog.getAttribute('aria-labelledby'),descId=confirm.dialog.getAttribute('aria-describedby');
    assert.ok(titleId&&descId,'every confirmation dialog names and describes itself');
    assert.equal(confirm.title.id,titleId);assert.equal(confirm.consequence.id,descId);
  }
  assert.notEqual(first.title.id,second.title.id,'identifiers stay unique per instance');
  assert.notEqual(first.consequence.id,second.consequence.id);
});

test('dropzone, time choices and an open confirmation relabel in place without rebuilding',()=>{
  const doc=fixture(),changes=[];
  const input=doc.createElement('input');input.type='file';input.id='settings-file';
  input.addEventListener('change',()=>changes.push('change'));
  const zone=mountDropzone({document:doc,input,title:'Drop here',action:'Choose',hint:'ZIP'});
  const time=doc.createElement('input');time.type='time';time.value='20:00';
  const choices=mountTimeChoices({document:doc,input:time,times:['20:00'],customLabel:'Custom'});
  const confirm=mountConfirm({document:doc,labels:{cancel:'Cancel',confirm:'Confirm'}});
  const opener=doc.createElement('button');doc.body.append(opener);
  confirm.open({title:'Old title',consequence:'Old consequence',confirmLabel:'Old confirm',cancelLabel:'Old cancel',opener,action(){throw Error('must not run on relabel');}});
  const dialogNode=confirm.dialog,titleNode=confirm.title,consequenceNode=confirm.consequence;
  zone.updateLabels({title:'Neuer Titel',action:'Wählen',hint:'ZIP oder JSON'});
  choices.updateLabels({customLabel:'Eigene Zeit'});
  confirm.updateLabels({title:'Nuevo título',consequence:'Nueva consecuencia',confirmLabel:'Confirmar',cancelLabel:'Cancelar'});
  assert.equal(zone.input,input,'the backing input is never rebuilt');
  assert.equal(changes.length,0,'a label refresh never emits business events');
  assert.equal(zone.labels.title.textContent,'Neuer Titel');assert.equal(zone.labels.action.textContent,'Wählen');assert.equal(zone.labels.hint.textContent,'ZIP oder JSON');
  assert.equal(choices.custom.textContent,'Eigene Zeit');
  assert.equal(confirm.dialog,dialogNode);assert.equal(confirm.title,titleNode);assert.equal(confirm.consequence,consequenceNode);
  assert.match(titleNode.textContent,/Nuevo título/);assert.match(consequenceNode.textContent,/Nueva consecuencia/);
  assert.equal(confirm.confirmButton.textContent,'Confirmar');assert.equal(confirm.cancelButton.textContent,'Cancelar');
  assert.equal(confirm.dialog.getAttribute('open'),'true','an open confirmation stays open across a language commit');
});

test('the time editor panel opens only while editing and the Custom chip reveals its editor',()=>{
  const doc=fixture();
  const input=doc.createElement('input');input.type='time';input.id='daily-time';input.value='20:00';
  const editor=doc.createElement('input');editor.type='text';editor.id='daily-time-text';editor.value='20:00';
  const panel=doc.createElement('div');panel.hidden=true;
  const mount=mountTimeEditor({document:doc,input,editor,panel,times:['07:00','12:30','20:00','22:30'],customLabel:'Custom'});
  assert.equal(panel.hidden,true,'chips and the editor stay closed until the reader asks');
  mount.open();
  assert.equal(panel.hidden,false);
  assert.equal(mount.choices.buttons.length,4);
  mount.choices.custom.dispatchEvent(new Event('click'));
  assert.equal(doc.activeElement,editor,'Custom reveals and focuses the HH:mm editor');
  mount.choices.buttons[0].dispatchEvent(new Event('click'));
  assert.equal(input.value,'07:00','the native input stays the value owner');
  assert.equal(editor.value,'07:00','the editor mirrors the committed value');
  mount.close();
  assert.equal(panel.hidden,true);
  // the text editor validates HH:mm and mirrors commits into the native input
  editor.value='25:99';editor.dispatchEvent(new Event('change'));
  assert.equal(input.value,'07:00','an invalid edit never reaches the native input');
  assert.equal(editor.value,'25:99','invalid text stays visible for correction');assert.equal(editor.getAttribute('aria-invalid'),'true');
  editor.value='09:15';editor.dispatchEvent(new Event('change'));
  assert.equal(input.value,'09:15');assert.equal(editor.value,'09:15');
  mount.updateLabels({customLabel:'自定义时间',label:'时间'});
  assert.equal(mount.choices.custom.textContent,'自定义时间');
  assert.equal(mount.root.getAttribute('aria-label'),'时间');
});


test('withdrawn confirmations cannot dispatch even if the old action is invoked',()=>{
 const doc=fixture(),confirm=mountConfirm({document:doc});let writes=0;
 for(const withdraw of [()=>confirm.close(),()=>confirm.cancelButton.click(),()=>confirm.destroy()]){
  confirm.open({onConfirm:()=>writes++});withdraw();confirm.confirmButton.click();assert.equal(writes,0);
 }
 confirm.open({onConfirm:()=>writes++});confirm.confirmButton.click();confirm.confirmButton.click();assert.equal(writes,1);
});

test('Enter commits valid HH:mm once, blocks implicit submit and respects IME and disabled state',()=>{
 const doc=fixture(),input=doc.createElement('input'),editor=doc.createElement('input'),panel=doc.createElement('div');input.value='20:00';let changes=0;input.addEventListener('change',()=>changes++);
 const mount=mountTimeEditor({document:doc,input,editor,panel});
 const enter=(composing=false)=>{const e=new Event('keydown',{cancelable:true});e.key='Enter';e.isComposing=composing;editor.dispatchEvent(e);assert.equal(e.defaultPrevented,true);};
 editor.value='99:99';enter();assert.equal(input.value,'20:00');assert.equal(changes,0);assert.equal(mount.commit(),false);
 editor.value='09:15';enter(true);assert.equal(input.value,'20:00');enter();assert.equal(input.value,'09:15');assert.equal(changes,1);assert.equal(editor.getAttribute('aria-invalid'),null);
 input.disabled=true;mount.sync();assert.equal(editor.disabled,true);editor.value='12:00';enter();assert.equal(input.value,'09:15');assert.equal(changes,1);
});
