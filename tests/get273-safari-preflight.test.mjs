import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
test('off-device preflight requires an exact frozen source and existing artifact before it can open a fixture',()=>{
 const result=spawnSync(process.execPath,['tools/prepare-get273-safari-fixture.mjs'],{cwd:new URL('..',import.meta.url),encoding:'utf8'});
 assert.equal(result.status,64);assert.match(result.stderr,/--source.*--artifact/);assert.equal(result.stdout,'');
});
