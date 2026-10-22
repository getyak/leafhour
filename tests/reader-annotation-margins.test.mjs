import test from 'node:test';
import assert from 'node:assert/strict';
import {annotationRails,arrangeMarginNotes} from '../app/reader-annotation-margins.mjs';

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
test('fourteen nearby annotations use both margins without overlapping each other',()=>{
 const entries=Array.from({length:14},(_,i)=>({id:'note-'+i,top:100+Math.floor(i/3)*90}));
 const placed=arrangeMarginNotes(entries,annotationRails({left:380,right:1060,viewport:1440}));
 assert.deepEqual(new Set(placed.map(e=>e.side)),new Set(['left','right']));
 for(const side of ['left','right']){const column=placed.filter(e=>e.side===side);for(let i=1;i<column.length;i++)assert.ok(column[i].top>=column[i-1].top+140);}
 assert.deepEqual(arrangeMarginNotes(entries,[]).map(e=>e.id),entries.map(e=>e.id));
});
