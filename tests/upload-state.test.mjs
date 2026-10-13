import test from 'node:test';import assert from 'node:assert/strict';
import {createUploadState} from '../app/upload-state.mjs';

test('an invalid replacement clears the previous valid file and cannot start an upload',()=>{
  const state=createUploadState(),valid={name:'book.pdf',size:400};
  state.select(valid);assert.equal(state.file,valid);
  for(const bad of [{name:'bad.exe',size:20},{name:'empty.txt',size:0},{name:'huge.pdf',size:20*1024*1024+1}]){
    state.select(valid);assert.throws(()=>state.select(bad));assert.equal(state.file,null);assert.throws(()=>state.begin());
  }
});
test('upload locks its filename and bytes to one file; a failed attempt can retry the same file',()=>{
  const state=createUploadState(),first={name:'first.txt',size:30},second={name:'second.md',size:40};
  state.select(first);assert.equal(state.begin(),first);assert.equal(state.busy,true);
  assert.equal(state.select(second),false);assert.equal(state.file,first);assert.throws(()=>state.begin());
  state.finish();assert.equal(state.begin(),first);state.finish();state.select(second);assert.equal(state.begin(),second);state.finish();state.reset();assert.equal(state.file,null);
});
