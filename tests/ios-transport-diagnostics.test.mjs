import test from 'node:test';
import assert from 'node:assert/strict';
import {transportDiagnostics} from '../scripts/ios/transport-diagnostics.mjs';
test('Apple icon failures retain actionable codes without arbitrary messages or userInfo',()=>{
  const output=transportDiagnostics(JSON.stringify({'product-errors':[{code:90023,message:'Missing required icon file; private path /secret/value',userInfo:{password:'never emit'}}]}));
  assert.deepEqual(output,{codes:[90023],categories:['APP_ICON_VALIDATION']});
  assert.ok(!JSON.stringify(output).includes('secret'));
});
test('credential-looking fields and unstructured transport output are never reflected',()=>{
  const secret='eyJsecret.eyJpayload.signature';
  const output=transportDiagnostics(JSON.stringify({errors:[{code:secret,message:secret,token:secret}],token:secret}));
  assert.deepEqual(output,{codes:[],categories:['APPLE_VALIDATION']});
  assert.ok(!JSON.stringify(transportDiagnostics('private token '+secret)).includes(secret));
});
test('authorization and network categories are allowlisted and numeric codes remain bounded',()=>{
  assert.deepEqual(transportDiagnostics(JSON.stringify({errors:[{code:-19000,message:'Authentication failed'},{code:99999999,message:'Connection timed out'}]})),{codes:[-19000],categories:['AUTHORIZATION','TRANSPORT_NETWORK']});
});
test('official plaintext altool errors retain codes and file category without private paths',()=>{
  const output=transportDiagnostics("Running altool at path '/private/secret/altool'...\n2026-11-03 22:23:19 ERROR: [altool.7C4C7C380] File does not exist at path: /private/secret/book.ipa. (20)\n2026-11-03 22:23:19 ERROR: [altool.1058CAD80] ExitFailure (31)\n");
  assert.deepEqual(output,{codes:[20,31],categories:['TRANSPORT_FILE','UNCLASSIFIED_TRANSPORT_ERROR']});
  assert.ok(!JSON.stringify(output).includes('secret'));
});
test('launcher-prefixed JSON retains its structured errors including braces inside quoted messages',()=>{
  const payload={'product-errors':[{code:90023,message:'Missing icon file {private detail}',userInfo:{token:'never-emit-token'}}]};
  const output=transportDiagnostics("Running altool at path '/private/altool'...\n"+JSON.stringify(payload)+'\nFinished private status\n');
  assert.deepEqual(output,{codes:[90023],categories:['APP_ICON_VALIDATION']});
});
test('plaintext network and authorization errors are classified without reflecting messages',()=>{
  const output=transportDiagnostics('ERROR: [altool.123ABC] Authentication failed for secret@example.invalid (-19000)\nERROR: [altool.123ABC] Connection timed out for https://secret.invalid/?token=private (-1001)\n');
  assert.deepEqual(output,{codes:[-19000,-1001],categories:['AUTHORIZATION','TRANSPORT_NETWORK']});
  assert.ok(!/secret|private|https/.test(JSON.stringify(output)));
});
test('malformed output only emits fixed diagnostics and never credential-like error codes',()=>{
  const output=transportDiagnostics('Private bearer eyJsecret.payload.signature\nERROR: [altool.123ABC] password private (eyJsecret.payload.signature)\n{"errors": [{"code":"private-token"}');
  assert.deepEqual(output,{codes:[],categories:['UNCLASSIFIED_TRANSPORT_ERROR']});
  assert.ok(!/private|eyJ/.test(JSON.stringify(output)));
});
test('an uppercase credential in a structured code field is not an error-code allowlist',()=>{
  const output=transportDiagnostics(JSON.stringify({errors:[{code:'ABC123DE45',message:'Authentication failed',userInfo:{token:'private'}}]}));
  assert.deepEqual(output,{codes:[],categories:['AUTHORIZATION']});
});
