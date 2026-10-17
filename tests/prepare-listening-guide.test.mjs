import test from 'node:test';import assert from 'node:assert/strict';import {guideOptions} from '../tools/prepare-listening-guide.mjs';
test('guide preparation is dry-run by default and persistent output requires a real account identity',()=>{
 assert.throws(()=>guideOptions(['--book','gutenberg-alice','--owner-id','owner']));
 const args=guideOptions(['--book','gutenberg-alice','--owner-id','5f07b7ac-a2fa-4b7d-ae71-16851cf95715']);assert.equal(args.generate,false);assert.equal(args.intent,'intro');assert.equal(args.includeAudio,false);
 assert.throws(()=>guideOptions(['--book','gutenberg-alice','--owner-id','5f07b7ac-a2fa-4b7d-ae71-16851cf95715','--include-audio']));
});
