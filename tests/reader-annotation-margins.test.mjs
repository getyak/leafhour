import test from 'node:test';
import assert from 'node:assert/strict';
import {annotationRails,annotationSheetBounds,arrangeMarginNotes,mountAnnotationMargins} from '../app/reader-annotation-margins.mjs';
import {fixture} from './annotation-dom-fixture.mjs';

test('a fallback annotation sheet stays entirely in the reading region beside a live chat',()=>{
 for(const [viewport,chatWidth]of [[1128,440],[1100,460],[1440,640]]){
  const boundary=viewport-chatWidth,bounds=annotationSheetBounds({viewport,blocked:[{left:boundary,right:viewport}]});
  assert.ok(bounds.left-bounds.width/2>=12);assert.ok(bounds.left+bounds.width/2<=boundary-12);
 }
 for(const viewport of [320,390,768]){
  const bounds=annotationSheetBounds({viewport});assert.ok(bounds.width<=viewport-24);assert.equal(bounds.left,viewport/2);
 }
});

test('the single annotation toggle belongs to existing reading tools through refresh, retries and account changes',()=>{
 const f=fixture('<body><main id="book-page"><div id="reading-pages"><p id="p1">Keep this text selectable.</p></div></main><section id="reading-session"><div id="reading-tools-panel" inert></div></section></body>');
 let scope='owner-a',hides=0,retries=0;const values=new Map(),panel=f.document.getElementById('reading-tools-panel');
 const margins=mountAnnotationMargins({document:f.document,storage:{getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)},getScope:()=>scope,getEntries:()=>[],onOpen:()=>assert.fail('visibility never opens or generates an annotation'),onHide:()=>hides++,onRetry:()=>retries++,write:(node,key,attribute)=>attribute?node.setAttribute(attribute,key):node.textContent=key});
 try{
  const toggle=f.document.getElementById('reader-annotations-toggle'),status=f.document.querySelector('.reader-annotation-load-status');
  assert.ok(panel.contains(toggle),'the annotation switch must be reached through Read, not float above source text');assert.ok(panel.contains(status));
  assert.equal(toggle.getAttribute('aria-pressed'),'true');assert.equal(toggle.getAttribute('aria-controls'),'reader-annotation-margins');
  panel.inert=false;toggle.focus();toggle.dispatchEvent(new Event('click'));assert.equal(toggle.getAttribute('aria-pressed'),'false');assert.equal(hides,1);
  margins.refresh();assert.equal(f.document.getElementById('reader-annotations-toggle'),toggle);assert.equal(f.document.activeElement,toggle);assert.equal(toggle.getAttribute('aria-pressed'),'false');
  margins.state('error');toggle.dispatchEvent(new Event('click'));assert.equal(retries,1);assert.equal(toggle.getAttribute('aria-pressed'),'false');assert.equal(status.textContent,'loadFailed');
  scope='owner-b';margins.reset();assert.ok(panel.contains(toggle));assert.equal(toggle.getAttribute('aria-pressed'),'true');assert.equal(f.document.querySelectorAll('#reader-annotations-toggle').length,1);
  scope=null;margins.reset();assert.equal(f.document.getElementById('reader-annotations-toggle'),null);assert.equal(f.document.getElementById('reading-tools-panel'),panel);
  scope='owner-a';margins.reset();assert.ok(panel.contains(toggle));assert.equal(toggle.getAttribute('aria-pressed'),'false');assert.equal(f.document.getElementById('p1').textContent,'Keep this text selectable.');
 }finally{margins.dispose();}
 assert.equal(f.document.getElementById('reader-annotations-toggle'),null);assert.equal(f.document.getElementById('reading-tools-panel'),panel);
});

test('margin rails leave readable text intact across phone, tablet, laptop and desktop widths',()=>{
 for(const viewport of [320,390,768,1024,1280,1440,1920]){
  const width=Math.min(680,viewport-44),left=(viewport-width)/2,right=left+width;
  for(const rail of annotationRails({left,right,viewport})){
   assert.ok(rail.width>=204);assert.ok(rail.left>=24);assert.ok(rail.left+rail.width<=viewport-24);
   assert.ok(rail.left+rail.width<=left-24||rail.left>=right+24,'annotations must not cover the book');
  }
 }
 assert.equal(annotationRails({left:380,right:1060,viewport:1440}).length,2);
 assert.equal(annotationRails({left:22,right:368,viewport:390}).length,0);
 assert.equal(annotationRails({left:380,right:1060,viewport:1440,paginated:true}).length,0);
 assert.deepEqual(annotationRails({left:380,right:1060,viewport:1440,blocked:[{left:1050,right:1440}]}).map(r=>r.side),['left']);
});

test('quiet reading tucks saved summaries away by default and preserves an explicit visibility choice',()=>{
 for(const [focused,saved,expected]of [[true,null,false],[false,null,true],[true,'true',true],[true,'false',false],[false,'false',false]]){
  const f=fixture('<body><div id="reading-pages"><p id="p1">The author’s words.</p></div><div id="reading-tools-panel"></div></body>');
  f.document.body.classList.toggle('is-focused',focused);const writes=[],values=new Map(saved===null?[]:[['marginalia-annotation-visible-v1|quiet-reader',saved]]);
  const margins=mountAnnotationMargins({document:f.document,storage:{getItem:key=>values.get(key),setItem:(key,value)=>{writes.push({key,value});values.set(key,value);}},getScope:()=> 'quiet-reader',getEntries:()=>[{id:'saved-explanation',passageId:'p1',origin:'ai',text:'An existing explanation.'}],onOpen:()=>assert.fail('presentation never opens or generates'),onHide:()=>{},write:(node,key,attribute)=>attribute?node.setAttribute(attribute,key):node.textContent=key});
  try{
   margins.refresh();assert.equal(f.document.getElementById('reader-annotation-margins').hidden,!expected);assert.equal(f.document.getElementById('reader-annotations-toggle').getAttribute('aria-pressed'),String(expected));assert.equal(writes.length,0,'opening a book never rewrites the visibility preference');
   margins.reveal();assert.equal(f.document.getElementById('reader-annotation-margins').hidden,false);assert.equal(f.document.getElementById('p1').textContent,'The author’s words.');
   margins.state('error');assert.equal(f.document.querySelector('.reader-annotation-load-status').textContent,'loadFailed');
  }finally{margins.dispose();}
 }
});
test('fourteen nearby annotations use both margins without overlapping each other',()=>{
 const entries=Array.from({length:14},(_,i)=>({id:'note-'+i,top:100+Math.floor(i/3)*90}));
 const placed=arrangeMarginNotes(entries,annotationRails({left:380,right:1060,viewport:1440}));
 assert.deepEqual(new Set(placed.map(e=>e.side)),new Set(['left','right']));
 for(const side of ['left','right']){const column=placed.filter(e=>e.side===side);for(let i=1;i<column.length;i++)assert.ok(column[i].top>=column[i-1].top+140);}
 assert.deepEqual(arrangeMarginNotes(entries,[]).map(e=>e.id),entries.map(e=>e.id));
});


test('personal margin summaries do not label a highlighted author quote as the reader’s own words',()=>{
 const f=fixture('<body><div id="reading-pages"><p id="p1">Author quotation.</p></div><div id="reading-tools-panel"></div></body>');
 const entries=[{id:'mark-only',passageId:'p1',origin:'user',quote:'Author quotation.'},{id:'personal-note',passageId:'p1',origin:'user',text:'My own thought.'},{id:'ai-note',passageId:'p1',origin:'ai',text:'AI explanation.'}];
 const margins=mountAnnotationMargins({document:f.document,getScope:()=> 'isolated-owner',getEntries:()=>entries,onOpen:()=>{},onHide:()=>{},write:(node,key,attribute)=>attribute?node.setAttribute(attribute,key):node.textContent=key});
 try{
  margins.refresh();
  const summaries=f.document.querySelectorAll('.reader-annotation-summary');
  assert.deepEqual(summaries.map(node=>node.querySelector('.reader-annotation-summary-author').textContent),['personalSummary','personalSummary','ai']);
  assert.equal(summaries[0].querySelector('.reader-annotation-summary-text').textContent,'Author quotation.');
  assert.equal(summaries[1].querySelector('.reader-annotation-summary-text').textContent,'My own thought.');
 }finally{margins.dispose();}
});

test('laptop widths always use compact marks even when both gutters appear to fit',()=>{
 for(const viewport of [1024,1280,1399])assert.deepEqual(annotationRails({left:400,right:viewport-400,viewport}),[]);
 assert.equal(annotationRails({left:360,right:1040,viewport:1400}).length,2);
});
