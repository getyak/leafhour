import test from 'node:test';
import assert from 'node:assert/strict';
const {createGiftDrafts}=await import('../app/gift-compose-state.mjs').catch(()=>({}));
const first={recipient:'小林',message:'第一封',includeTranslations:true},second={...first,recipient:'山间',message:'第二封'};
test('a late seal response cannot replace a newer letter or erase an edited draft',()=>{
  assert.equal(typeof createGiftDrafts,'function');const state=createGiftDrafts(),key='owner/book';
  state.remember(key,first);const a=state.begin(key);
  state.remember(key,second);assert.equal(state.commit(key,a,{token:'old'}),false);assert.deepEqual(state.draft(key),second);
  const b=state.begin(key);assert.equal(state.commit(key,b,{token:'new'}),true);
  assert.equal(state.commit(key,a,{token:'old'}),false);assert.deepEqual(state.sealed(key),{token:'new'});
  state.remember(key,first);assert.equal(state.sealed(key),undefined,'editing after a background completion keeps the new draft visible');
});
test('closing with an unchanged draft keeps a completed seal, while reset or account switch rejects old requests',()=>{
  assert.equal(typeof createGiftDrafts,'function');const state=createGiftDrafts(),key='owner/book';
  state.remember(key,first);const a=state.begin(key);state.remember(key,{...first});
  assert.equal(state.commit(key,a,{token:'ready'}),true);assert.equal(state.draft(key),undefined);
  const b=state.begin(key);state.reset(key);assert.equal(state.commit(key,b,{token:'reset'}),false);
  state.remember(key,first);const c=state.begin(key);state.clear();state.remember(key,first);
  assert.equal(state.commit(key,c,{token:'previous-account'}),false);
});
