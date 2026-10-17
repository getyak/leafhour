import test from 'node:test';
import assert from 'node:assert/strict';
import {checkPdfPackage} from '../tools/check-pdf-package.mjs';
test('the actual function dependency trace renders a source PDF without the full development installation',{timeout:60000},async()=>{const result=await checkPdfPackage();assert.equal(result.rendered,true);assert.ok(result.nativeBindings>=1);assert.equal(result.modelRequests,0);});
