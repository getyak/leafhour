import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
test('parent and offline pack preparation fail closed without exact arguments, before any runtime admission',()=>{
 for(const file of ['tools/get273-safari-parent.mjs','tools/prepare-get273-safari-parent.mjs']){
  const result=spawnSync(process.execPath,[file],{encoding:'utf8'});assert.equal(result.status,64);assert.equal(result.stdout,'');
 }
});
