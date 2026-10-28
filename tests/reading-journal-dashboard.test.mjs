import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {parse} from 'acorn';
import {createCanvas} from '@napi-rs/canvas';
import * as locale from '../app/ui-locale.mjs';
import * as journal from '../app/reading-journal.mjs';
import * as calendar from '../app/reading-calendar.mjs';
import * as workspace from '../app/library-workspace.mjs';
import * as policy from '../app/reading-time-policy.mjs';
import {inferSourceLanguage} from '../app/source-language.mjs';
import {paintBookCover,bookCoverLabel} from '../app/book-binding.mjs';
import {paintBookIdentity} from '../app/book-cover-ui.mjs';
import {mountReadingArrival} from '../app/reading-arrival.mjs';
import {trackActionFocus} from '../app/action-focus.mjs';
class Element extends EventTarget{
 constructor(tag,doc){super();this.tagName=tag;this.ownerDocument=doc;this.children=[];this.attrs={};this.dataset={};this.value='';this.textContent='';this.hidden=false;this.className='';this.replacements=0;this.classList={add:n=>this.toggle(n,true),remove:n=>this.toggle(n,false),toggle:(n,v)=>this.toggle(n,v)};}
 toggle(n,v){const a=new Set(this.className.split(' '));if(v)a.add(n);else a.delete(n);this.className=[...a].join(' ');}
 get isConnected(){return this===this.ownerDocument.body||!!this.parentElement?.isConnected;}
 append(...nodes){for(const n of nodes){n.parentElement?.children.splice(n.parentElement.children.indexOf(n),1);n.parentElement=this;this.children.push(n);}}
 replaceChildren(...nodes){this.replacements++;for(const n of this.children)n.parentElement=null;this.children=[];this.append(...nodes);}
 setAttribute(k,v){this.attrs[k]=String(v);}getAttribute(k){return this.attrs[k];}hasAttribute(k){return Object.hasOwn(this.attrs,k);}removeAttribute(k){delete this.attrs[k];}
 toggleAttribute(k,force){const next=force===undefined?!this.hasAttribute(k):!!force;if(next)this.setAttribute(k,'');else this.removeAttribute(k);return next;}
 contains(n){return n===this||this.children.some(c=>c.contains(n));}
 querySelectorAll(s){return all(this).slice(1).filter(n=>s.startsWith('.')?n.className.split(' ').includes(s.slice(1)):s==='[data-reading-arrival]'?!!n.dataset.readingArrival:s.startsWith('[data-date=')?n.dataset.date===s.slice(12,-2):false);}
 querySelector(s){return this.querySelectorAll(s)[0]||null;}focus(){this.ownerDocument.activeElement=this;}showModal(){this.open=true;}close(){this.open=false;this.dispatchEvent(new Event('close'));}
}
const all=n=>[n,...n.children.flatMap(all)],flush=()=>new Promise(setImmediate);
const source=await readFile(new URL('../app/reading-dashboard.mjs',import.meta.url),'utf8'),ast=parse(source,{ecmaVersion:'latest',sourceType:'module'});
const executable=ast.body.map(n=>n.type==='ImportDeclaration'?'':n.type==='ExportNamedDeclaration'?source.slice(n.declaration.start,n.end):source.slice(n.start,n.end)).join('\n');
function fixture({pending=false,timeZone=null,shelfOnly=false}={}){
 const intl=timeZone?Object.create(Intl):Intl;if(timeZone)intl.DateTimeFormat=function(language,options={}){return new Intl.DateTimeFormat(language,{timeZone,...options});};
 const doc=new EventTarget();doc.defaultView={location:{search:''}};doc.createElement=tag=>new Element(tag,doc);doc.body=doc.createElement('body');const roots=Array.from({length:3},()=>doc.createElement('section'));doc.body.append(...roots);roots[1].hidden=true;let owner='a',resolve,calls=0;
 const date=calendar.localReadingDate(Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC'),month=date.slice(0,7),day={date,durationSeconds:600,sourceDurationSeconds:{reader_focus:600},notes:1,questions:1,chapterMarks:0,books:[{bookId:'book',title:{zh:'Literal title'},durationSeconds:600,notes:1,questions:1,chapterMarks:0,source:{bookId:'book',passageId:'p1',type:'reading'}}],totalDetails:1,details:[{id:'s1',bookId:'book',passageId:'p1',type:'reading',title:{zh:'Literal title'},source:'reader_focus'}]};const data={month,days:[day],durationSeconds:600,readingDays:1,notes:1,questions:1};
 const promise=new Promise(r=>resolve=r);const context={...locale,...journal,...calendar,...workspace,...policy,document:doc,Intl:intl,Date,Event,inferSourceLanguage,paintBookCover,bookCoverLabel,paintBookIdentity,mountReadingArrival,trackActionFocus,crypto:globalThis.crypto};vm.createContext(context);vm.runInContext(executable+'\nthis.mount=mountReadingDashboard;',context);
 const ui=context.mount({shelfOnly,root:roots[0],overviewRoot:roots[1],historyRoot:roots[2],api(){calls++;return pending?promise:Promise.resolve(data);},getSession:()=>({user:{id:owner}}),getOwner:()=>owner,getBooks:()=>[],openAuth(){},refresh(){}});
 return {doc,ui,roots,day,date,data,resolve,calls:()=>calls,setOwner:value=>owner=value,find:cls=>all(doc.body).find(n=>n.className.split(' ').includes(cls)),days:()=>all(roots[1]).filter(n=>n.className==='journal-day')};
}
test('actual shelf journal is visible, shows every real month day and drills into its source-linked activity',async()=>{
 const f=fixture();try{f.ui.update(null);await flush();assert.equal(f.roots[1].hidden,false);assert.equal(f.days().length,calendar.calendarMonth(f.date.slice(0,7)).filter(Boolean).length);const today=f.days().find(n=>n.dataset.date===f.date);assert.equal(today.dataset.level,'2');assert.equal(today.dataset.hasActivity,'true','notes remain marked on a day that also has measured reading');assert.ok(f.days().some(n=>n.dataset.hasActivity==='false'),'empty days have no note marker');assert.equal(today.getAttribute('aria-current'),'date');today.dispatchEvent(new Event('click'));await flush();assert.equal(f.roots[2].open,true);const returnLink=f.find('day-books').children[0].children[0];assert.match(returnLink.href,/book=book&passage=p1/);assert.equal(f.find('journal-share-preview').hidden,true);}finally{f.ui.dispose();}
});
test('shelf month uses one tab stop and arrow keys move between dates without fetching records',async()=>{
 const f=fixture();try{f.ui.update(null);await flush();assert.equal(f.days().filter(n=>n.tabIndex===0).length,1);const active=f.days().find(n=>n.tabIndex===0),before=f.calls(),event=new Event('keydown',{cancelable:true});Object.defineProperty(event,'key',{value:'ArrowLeft'});active.focus();active.dispatchEvent(event);assert.equal(event.defaultPrevented,true);assert.equal(f.days().filter(n=>n.tabIndex===0).length,1);assert.notEqual(f.doc.activeElement,active);assert.equal(f.calls(),before);}finally{f.ui.dispose();}
});
test('a late previous-owner activity response cannot paint personal journal data',async()=>{
 const f=fixture({pending:true});try{f.ui.update(null);f.setOwner('b');f.ui.clear();f.resolve(f.data);await flush();assert.ok(f.days().every(n=>n.dataset.level==='0'));assert.equal(f.find('journal-summary').hidden,true);}finally{f.ui.dispose();}
});
test('locale changes relabel the month and day descriptions without replacing calendar nodes or fetching records',async()=>{
 const f=fixture();try{f.ui.update(null);await flush();const days=f.days(),count=f.calls();days[0].focus();for(const code of ['zh-Hans','ja','en']){await locale.requestUiRoute(code);assert.equal(f.calls(),count);assert.deepEqual(f.days(),days);assert.equal(f.doc.activeElement,days[0]);}}finally{f.ui.dispose();}
});
test('share image paints deterministic portrait pixels from the allowlisted model',()=>{
 const canvas=createCanvas(1,1),model=journal.buildReadingJournalShare({date:'2026-10-28',durationSeconds:600,sourceDurationSeconds:{reader_focus:600}}),copy={title:'Reading footprint',dateLabel:'October 28, 2026',timeLabel:'10 minutes',sourceLabels:{reader_focus:()=> 'Active focus 10 minutes'},bookLabel:'Books',returnLabel:'Read with Leafhour'};
 journal.paintReadingJournalShare(canvas,model,copy);const first=canvas.toBuffer('image/png');assert.equal(canvas.width,1200);assert.equal(canvas.height,1500);assert.ok(first.length>20000);journal.paintReadingJournalShare(canvas,model,copy);assert.deepEqual(canvas.toBuffer('image/png'),first);
});

test('calendar date keys keep their day and Monday-first labels in positive-offset time zones',async()=>{
 await locale.requestUiRoute('en');
 for(const timeZone of ['Pacific/Kiritimati','Pacific/Auckland','Pacific/Fiji']){
  const f=fixture({timeZone});try{
   f.ui.openHistory('2026-10-31');
   assert.equal(f.find('calendar-detail').children[0].textContent,'October 31',timeZone+' month boundary');
   assert.deepEqual(f.find('calendar-grid').children.filter(n=>n.className==='calendar-weekday').map(n=>n.textContent),['M','T','W','T','F','S','S'],timeZone+' weekday columns');
   f.ui.openHistory('2026-10-28');
   assert.equal(f.find('calendar-detail').children[0].textContent,'October 28',timeZone+' selected date');
  }finally{f.ui.dispose();}
 }
});
test('book-only library keeps the journal hidden and fetches activity only when its dedicated view opens',async()=>{
 const f=fixture({shelfOnly:true});try{f.ui.update(null);await flush();assert.equal(f.roots[1].hidden,true);assert.equal(f.days().length,0);assert.equal(f.calls(),0);f.ui.openHistory();await flush();assert.equal(f.roots[2].open,true);assert.ok(f.calls()>0);assert.equal(f.roots[1].hidden,true);}finally{f.ui.dispose();}
});


test('selected calendar day distinguishes loading, failure and a genuinely empty day',async()=>{
 await locale.requestUiRoute('en');
 const f=fixture({pending:true});try{
  f.ui.openHistory();
  const detail=f.find('calendar-detail');
  assert.equal(detail.getAttribute('aria-busy'),'true');
  assert.equal(detail.children[1].textContent,locale.t('dash.calendar.loading'));
  f.resolve({...f.data,days:[]});await flush();
  assert.equal(detail.getAttribute('aria-busy'),'false');
  assert.equal(detail.children[1].textContent,locale.t('dash.detail.empty.today'));
 }finally{f.ui.dispose();}
 const failed=fixture({pending:true});try{
  failed.ui.openHistory();failed.resolve(Promise.reject(Error('offline')));await flush();
  const detail=failed.find('calendar-detail');assert.equal(detail.getAttribute('aria-busy'),'false');
  assert.equal(detail.children[1].textContent,locale.t('dash.calendar.error'));
 }finally{failed.ui.dispose();}
});
