import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {auditAccess,exactBuildInput} from '../scripts/ios/access-audit.mjs';

const env={IOS_APP_ID:'123',IOS_BUNDLE_ID:'com.example.leafhour',IOS_AUDIT_BUILD_ID:'build-1',IOS_AUDIT_VERSION:'0.3.0',IOS_AUDIT_BUILD_NUMBER:'1.0.7'};
const group={type:'betaGroups',id:'group-1',attributes:{name:'Internal',isInternalGroup:true,hasAccessToAllBuilds:true,publicLinkEnabled:false}};
function fixture() {
  return {data:{type:'builds',id:'build-1',attributes:{version:'1.0.7',processingState:'VALID',expired:false,expirationDate:'2030-01-01T00:00:00Z'},relationships:{app:{data:{type:'apps',id:'123'}},preReleaseVersion:{data:{type:'preReleaseVersions',id:'version-1'}},buildBetaDetail:{data:{type:'buildBetaDetails',id:'detail-1'}},betaGroups:{data:[{type:'betaGroups',id:'group-1'}]}}},included:[{type:'apps',id:'123',attributes:{bundleId:'com.example.leafhour'}},{type:'preReleaseVersions',id:'version-1',attributes:{version:'0.3.0',platform:'IOS'}},{type:'buildBetaDetails',id:'detail-1',attributes:{internalBuildState:'IN_BETA_TESTING',externalBuildState:'READY_FOR_BETA_SUBMISSION'},relationships:{build:{data:{type:'builds',id:'build-1'}}}},group]};
}
function mock({document=fixture(),groups={data:[group]},app={data:{id:'123',attributes:{name:'Leafhour',bundleId:'com.example.leafhour'}}}}={}) {
  const requests=[];
  return {requests,get:async path=>{
    requests.push(path);
    if(path.startsWith('/v1/apps/123?'))return structuredClone(app);
    if(path.startsWith('/v1/apps/123/betaGroups?'))return structuredClone(groups);
    if(path.startsWith('/v1/builds/build-1?'))return structuredClone(document);
    throw Error('Unexpected GET path');
  },post:()=>assert.fail('No POST'),patch:()=>assert.fail('No PATCH'),delete:()=>assert.fail('No DELETE')};
}
const run=(client,input=env)=>auditAccess(client,input,{now:Date.parse('2026-10-30T00:00:00Z')});

test('no-input audit keeps app/group-only behavior and makes only two GETs',async()=>{
  const client=mock();
  const result=await run(client,{IOS_APP_ID:env.IOS_APP_ID,IOS_BUNDLE_ID:env.IOS_BUNDLE_ID});
  assert.equal(result.mode,'audit-only');assert.equal(result.build,undefined);
  assert.deepEqual(result.groups,[{id:'group-1',...group.attributes}]);
  assert.equal(client.requests.length,2);
});

test('exact build binds included app/version/detail/groups and reports no tester availability',async()=>{
  const client=mock();const result=await run(client);
  assert.equal(result.build.buildId,'build-1');assert.equal(result.build.version,'0.3.0');assert.equal(result.build.buildNumber,'1.0.7');
  assert.equal(result.build.internalBuildState,'IN_BETA_TESTING');
  assert.equal(result.build.externalBuildState,'READY_FOR_BETA_SUBMISSION');
  assert.deepEqual(result.build.groupRelationship.groupIds,['group-1']);
  assert.equal(result.build.availability,'not-established');
  assert.equal(client.requests.length,3);
  const request=new URL(client.requests[2],'https://example.invalid');
  assert.equal(request.pathname,'/v1/builds/build-1');
  assert.equal(request.searchParams.get('include'),'app,preReleaseVersion,buildBetaDetail,betaGroups');
  assert.ok(client.requests.every(path=>!path.includes('testers')));
});

test('partial identity and injection-like input fail before any request',async()=>{
  for(const change of [{IOS_AUDIT_BUILD_NUMBER:''},{IOS_AUDIT_VERSION:undefined},{IOS_AUDIT_BUILD_ID:''},{IOS_AUDIT_BUILD_ID:'../other'},{IOS_AUDIT_VERSION:'0.3.0; echo unsafe'},{IOS_AUDIT_BUILD_NUMBER:'$(unsafe)'}]){
    const client=mock();await assert.rejects(run(client,{...env,...change}));assert.deepEqual(client.requests,[]);
  }
  assert.equal(exactBuildInput({IOS_AUDIT_BUILD_ID:'',IOS_AUDIT_VERSION:'',IOS_AUDIT_BUILD_NUMBER:''}),null);
});

test('wrong resource ID, app ownership, release version/build/platform and detail ownership fail',async()=>{
  const mutations=[
    d=>{d.data.id='other';},d=>{d.data.relationships.app.data.id='999';},
    d=>{d.included[0].attributes.bundleId='com.other.app';},d=>{d.data.attributes.version='2.0.0';},
    d=>{d.included[1].attributes.version='0.4.0';},d=>{d.included[1].attributes.platform='MAC_OS';},
    d=>{d.included[2].relationships.build.data.id='other';},d=>{d.data.relationships.buildBetaDetail.data.type='wrong';}
  ];
  for(const mutate of mutations){const document=fixture();mutate(document);await assert.rejects(run(mock({document})));}
});

test('missing and ambiguous included resources or group linkage fail closed',async()=>{
  for(const index of [0,1,2,3]){
    let document=fixture();document.included.splice(index,1);await assert.rejects(run(mock({document})));
    document=fixture();document.included.push(structuredClone(document.included[index]));await assert.rejects(run(mock({document})));
  }
  let document=fixture();delete document.data.relationships.buildBetaDetail;await assert.rejects(run(mock({document})));
  document=fixture();document.data.relationships.betaGroups.data.push({type:'betaGroups',id:'group-1'});await assert.rejects(run(mock({document})));
  await assert.rejects(run(mock({groups:{data:[]}})),/foreign linked beta group/);
});

test('VALID and explicitly unexpired are required; expiration dates cannot contradict them',async()=>{
  for(const attributes of [{expired:true},{expired:undefined},{processingState:'PROCESSING'},{processingState:'UNKNOWN'},{expirationDate:'2025-01-01T00:00:00Z'},{expirationDate:'not a date'}]){
    const document=fixture();Object.assign(document.data.attributes,attributes);await assert.rejects(run(mock({document})));
  }
});

test('beta states are raw observations, including future values, never an installation verdict',async()=>{
  const document=fixture();document.included[2].attributes={internalBuildState:'FUTURE_INTERNAL_STATE',externalBuildState:'FUTURE_EXTERNAL_STATE'};
  const result=await run(mock({document}));
  assert.equal(result.build.internalBuildState,'FUTURE_INTERNAL_STATE');assert.equal(result.build.externalBuildState,'FUTURE_EXTERNAL_STATE');
  assert.equal(result.build.availability,'not-established');
  delete document.included[2].attributes.externalBuildState;
  await assert.rejects(run(mock({document})),/Missing internal or external beta state/);
});

test('missing build group relation is explicit unknown; all-build flags cannot establish assignment',async()=>{
  const document=fixture();delete document.data.relationships.betaGroups;
  const result=await run(mock({document}));
  assert.equal(result.groups[0].hasAccessToAllBuilds,true);
  assert.equal(result.build.groupRelationship.status,'not-reported');
  assert.equal(result.build.availability,'not-established');
});

test('pagination and incomplete lists cannot be silently accepted',async()=>{
  for(const extra of [{links:{next:'/v1/next'}},{meta:{paging:{total:2}}}]){
    await assert.rejects(run(mock({groups:{data:[group],...extra}})),/paginated or incomplete/);
    const document=fixture();Object.assign(document.data.relationships.betaGroups,extra);
    await assert.rejects(run(mock({document})),/paginated or incomplete/);
  }
  const document=fixture();document.links={next:'/v1/next'};await assert.rejects(run(mock({document})));
  await assert.rejects(run(mock({groups:{}})),/Missing Group list/);
});

test('workflow passes inputs through environment and keeps a literal read-only command',()=>{
  const source=readFileSync(new URL('../.github/workflows/testflight-access.yml',import.meta.url),'utf8');
  for(const [input,name] of [['build_id','BUILD_ID'],['version','VERSION'],['build_number','BUILD_NUMBER']]){
    assert.ok(source.includes(`IOS_AUDIT_${name}: \u0024{{ inputs.${input} }}`));
  }
  assert.match(source,/run: node scripts\/ios\/access-audit\.mjs/);
  assert.doesNotMatch(source,/run:[^\n]*\u0024\{\{\s*inputs\./);
});
