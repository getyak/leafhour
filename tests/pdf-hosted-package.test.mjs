import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
test('the function package renders a PDF from an explicit root even when the runtime working directory differs',{timeout:60000},()=>{
 const child=spawnSync(process.execPath,[path.join(root,'tools/check-pdf-package.mjs'),root],{cwd:tmpdir(),env:{PATH:process.env.PATH,HOME:tmpdir(),TMPDIR:tmpdir()},encoding:'utf8',timeout:55000,maxBuffer:65536});assert.equal(child.status,0,child.error?.message||child.stderr);const result=JSON.parse(child.stdout.trim().split('\n').at(-1));assert.equal(result.rendered,true);assert.ok(result.nativeBindings>=1);assert.equal(result.modelRequests,0);
});
