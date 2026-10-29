import test from 'node:test';
import assert from 'node:assert/strict';
import {auditSigning,refreshProfile} from '../scripts/ios/signing-audit.mjs';
const plan={appId:'123',bundleId:'example.verified'};
function client() {
  const calls=[];
  return {calls,get:async path=>{
    calls.push(['GET',path]);
    if(path.startsWith('/v1/apps/'))return {data:{id:'123',attributes:{bundleId:'example.verified',name:'Synthetic app'}}};
    if(path.startsWith('/v1/bundleIds?'))return {data:[{id:'bundle-resource',attributes:{identifier:'example.verified',platform:'IOS'}}]};
    if(path.startsWith('/v1/certificates/'))return {data:{id:'cert-resource',attributes:{certificateType:'DISTRIBUTION',expirationDate:'2030-01-01T00:00:00Z'}}};
    if(path==='/v1/bundleIds/bundle-resource/profiles?limit=200')return {data:[{id:'profile-resource',attributes:{name:'Leafhour App Store',profileType:'IOS_APP_STORE',profileState:'ACTIVE',expirationDate:'2030-01-01T00:00:00Z'}}]};
    throw Error('Unexpected read');
  },post:async(path,body)=>{calls.push(['POST',path,body]);return {data:{id:'new-profile',attributes:{profileContent:Buffer.from('synthetic profile').toString('base64')}}};}};
}
test('default signing audit is read only and reports exact app/certificate profile metadata',async()=>{
  const api=client();const result=await auditSigning(api,plan,{certificateId:'cert-resource'});
  assert.equal(result.bundleResourceId,'bundle-resource');assert.equal(result.profiles.length,1);
  assert.equal(api.calls.every(([method])=>method==='GET'),true);
});
test('profile creation requires a distinct explicit approval and never revokes a resource',async()=>{
  const api=client();
  await assert.rejects(refreshProfile(api,plan,{certificateId:'cert-resource'}),/approval/);
  assert.equal(api.calls.length,0);
  await refreshProfile(api,plan,{certificateId:'cert-resource',approved:true,profileName:'Leafhour verified profile'});
  const mutations=api.calls.filter(([method])=>method!=='GET');
  assert.equal(mutations.length,1);assert.equal(mutations[0][1],'/v1/profiles');
  assert.deepEqual(mutations[0][2].data.relationships.certificates.data,[{type:'certificates',id:'cert-resource'}]);
});
