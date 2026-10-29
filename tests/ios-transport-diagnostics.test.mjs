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
