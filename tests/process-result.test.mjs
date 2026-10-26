import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {processResult} from './helpers/process-result.mjs';

test('process diagnostics wait for an inherited stderr pipe after the child exits',{timeout:10000},async t=>{
 // The descendant waits for its parent's actual disappearance, then writes to
 // the inherited pipe. This gives a real exit-before-stderr ordering without
 // guessing a delay or mocking ChildProcess events.
 const child=spawn(process.execPath,[fileURLToPath(new URL('./fixtures/inherited-stderr-child.mjs',import.meta.url))],{stdio:['ignore','ignore','pipe']});
 t.after(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');});
 const result=await processResult(child);
 assert.equal(result.status,1);assert.match(result.output,/reader_billing:subscription_exists/);
});

test('a failed spawn retains its actual error instead of assuming stderr exists',async()=>{
 const child=spawn(process.execPath+'-not-present',[],{stdio:['ignore','ignore','pipe']});
 const result=await processResult(child);assert.equal(result.status,-1);assert.match(result.output,/ENOENT/);
});
