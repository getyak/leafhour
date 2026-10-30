import {pathToFileURL} from 'node:url';
import {clientFromEnvironment,verifyApp,PermanentError} from './app-store-connect.mjs';

export function exactBuildInput(env) {
  const values=[env.IOS_AUDIT_BUILD_ID,env.IOS_AUDIT_VERSION,env.IOS_AUDIT_BUILD_NUMBER];
  if(values.every(value=>value===undefined || value===''))return null;
  if(values.some(value=>typeof value!=='string' || value===''))throw new PermanentError('Exact audit requires build ID, version and build number together');
  const [buildId,version,buildNumber]=values;
  if(!/^[A-Za-z0-9-]+$/.test(buildId) || !/^\d+\.\d+\.\d+$/.test(version) || !/^\d+(?:\.\d+){0,2}$/.test(buildNumber))throw new PermanentError('Invalid exact build audit identity');
  return {buildId,version,buildNumber};
}

function completeList(document,label) {
  if(!Array.isArray(document?.data))throw new PermanentError(`Missing ${label} list`);
  if(document.links?.next || (document.meta?.paging?.total!==undefined && document.meta.paging.total!==document.data.length))throw new PermanentError(`${label} list is paginated or incomplete; review explicitly before drawing conclusions`);
  return document.data;
}
function includedResource(document,build,name,type) {
  const relation=build.relationships?.[name]?.data;
  if(!relation || relation.type!==type || typeof relation.id!=='string' || !relation.id)throw new PermanentError(`Missing or invalid build ${name} relationship`);
  const matches=(document.included??[]).filter(item=>item.type===type && item.id===relation.id);
  if(matches.length!==1)throw new PermanentError(`Missing or ambiguous included ${name}`);
  return matches[0];
}
const groupAttributes=({id,attributes})=>({id,...attributes});

export async function auditAccess(client,env=process.env,{now=Date.now()}={}) {
  // Validate optional inputs before any request. No mutation API is used here.
  const exact=exactBuildInput(env);
  const app=await verifyApp(client,{appId:env.IOS_APP_ID,bundleId:env.IOS_BUNDLE_ID});
  const query=new URLSearchParams({'fields[betaGroups]':'name,isInternalGroup,hasAccessToAllBuilds,publicLinkEnabled',limit:'200'});
  const groups=completeList(await client.get(`/v1/apps/${app.appId}/betaGroups?${query}`),'Group');
  const result={mode:'audit-only',app,groups:groups.map(groupAttributes),note:'No tester invitations, repairs, assignments, group edits or public links were created. Physical installation and retained-data updates require separate evidence.'};
  if(!exact)return result;

  // Apple calls this singular relationship buildBetaDetail.
  // https://developer.apple.com/documentation/appstoreconnectapi/get-v1-builds-_id_
  const buildQuery=new URLSearchParams({include:'app,preReleaseVersion,buildBetaDetail,betaGroups'});
  const document=await client.get(`/v1/builds/${exact.buildId}?${buildQuery}`);
  const build=document?.data;
  if(document.links?.next || build?.type!=='builds' || build.id!==exact.buildId || !Array.isArray(document.included))throw new PermanentError('Apple did not return the exact build resource');
  const relatedApp=includedResource(document,build,'app','apps');
  const release=includedResource(document,build,'preReleaseVersion','preReleaseVersions');
  const detail=includedResource(document,build,'buildBetaDetail','buildBetaDetails');
  if(relatedApp.id!==app.appId || relatedApp.attributes?.bundleId!==app.bundleId)throw new PermanentError('Exact build belongs to a different app or bundle identifier');
  if(build.attributes?.version!==exact.buildNumber || release.attributes?.version!==exact.version || release.attributes?.platform!=='IOS')throw new PermanentError('Exact build version, build number or platform differs');
  if(build.attributes?.processingState!=='VALID' || build.attributes?.expired!==false)throw new PermanentError('Exact build is not VALID and unexpired');
  const expirationDate=build.attributes.expirationDate;
  if(expirationDate!==undefined && (!Number.isFinite(Date.parse(expirationDate)) || Date.parse(expirationDate)<=now))throw new PermanentError('Exact build expiration is invalid or elapsed');
  const detailBuild=detail.relationships?.build?.data;
  if(detailBuild && (detailBuild.type!=='builds' || detailBuild.id!==exact.buildId))throw new PermanentError('Beta detail belongs to a different build');
  const {internalBuildState,externalBuildState}=detail.attributes??{};
  if(![internalBuildState,externalBuildState].every(value=>typeof value==='string' && value.length>0))throw new PermanentError('Missing internal or external beta state');

  const relationship=build.relationships?.betaGroups;
  let groupRelationship={status:'not-reported',groupIds:[],note:'The build response did not report group linkage; app-wide all-build flags do not prove assignment of this build.'};
  if(relationship?.data!==undefined) {
    const links=completeList(relationship,'Build beta-group relationship');
    const ids=links.map(link=>{
      if(link.type!=='betaGroups' || typeof link.id!=='string' || !link.id)throw new PermanentError('Invalid build beta-group relationship');
      return link.id;
    });
    if(new Set(ids).size!==ids.length)throw new PermanentError('Ambiguous build beta-group relationship');
    for(const id of ids) {
      const matches=(document.included??[]).filter(item=>item.type==='betaGroups' && item.id===id);
      if(matches.length!==1 || groups.filter(group=>group.id===id).length!==1)throw new PermanentError('Missing, ambiguous or foreign linked beta group');
    }
    groupRelationship={status:'reported',groupIds:ids,note:'These are the exact build response group relationships, not tester eligibility or installation proof.'};
  }
  result.build={...exact,appId:app.appId,bundleId:app.bundleId,platform:release.attributes.platform,processingState:build.attributes.processingState,expired:build.attributes.expired,expirationDate:expirationDate??null,betaDetailId:detail.id,internalBuildState,externalBuildState,groupRelationship,availability:'not-established',availabilityNote:'Raw beta states and group relationships do not establish availability for any particular tester, completed installation, or retained-data updates.'};
  return result;
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(await auditAccess(clientFromEnvironment()),null,2));
}
