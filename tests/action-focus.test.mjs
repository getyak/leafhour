import test from 'node:test';
import assert from 'node:assert/strict';
import {trackActionFocus} from '../app/action-focus.mjs';
function fixture(){
 const listeners=new Set(),doc={body:{},addEventListener(type,fn){listeners.add(fn);},removeEventListener(type,fn){listeners.delete(fn);}};
 const control=()=>({focus(){doc.activeElement=this;for(const fn of [...listeners])fn({target:this});}});
 const trigger=control(),replacement=control(),other=control();trigger.focus();
 return {doc,trigger,replacement,other,listeners};
}
test('a replaced or temporarily disabled action restores a connected retry target',()=>{
 const f=fixture(),focus=trackActionFocus(f.doc,f.trigger);f.doc.activeElement=f.doc.body;
 focus.restore(f.replacement);assert.equal(f.doc.activeElement===f.replacement,true);assert.equal(f.listeners.size,0);
});
test('an asynchronous completion never takes focus back from another edited control',()=>{
 const f=fixture(),focus=trackActionFocus(f.doc,f.trigger);f.other.focus();f.doc.activeElement=f.doc.body;
 focus.restore(f.replacement);assert.equal(f.doc.activeElement===f.doc.body,true);assert.equal(f.listeners.size,0);
});
test('programmatic rendering can stop observation before making its own focus changes',()=>{
 const f=fixture(),focus=trackActionFocus(f.doc,f.trigger);focus.stop();f.other.focus();f.doc.activeElement=f.doc.body;
 focus.restore(f.replacement);assert.equal(f.doc.activeElement===f.replacement,true);assert.equal(f.listeners.size,0);
});
