import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {clientFromEnvironment,verifyApp,PermanentError} from './app-store-connect.mjs';

export async function auditSigning(client,plan,{certificateId}) {
  await verifyApp(client,plan);
  if (!/^[A-Za-z0-9-]+$/.test(certificateId??'')) throw new PermanentError('An explicitly verified IOS_CERTIFICATE_ID is required');
  const query=new URLSearchParams({'filter[identifier]':plan.bundleId,limit:'2'});
  const bundles=(await client.get(`/v1/bundleIds?${query}`)).data??[];
  if (bundles.length!==1 || bundles[0].attributes?.identifier!==plan.bundleId || bundles[0].attributes?.platform!=='IOS') throw new PermanentError('Expected one exact registered iOS bundle identifier');
  const cert=(await client.get(`/v1/certificates/${certificateId}`)).data;
  if (cert?.id!==certificateId || !['DISTRIBUTION','IOS_DISTRIBUTION'].includes(cert.attributes?.certificateType)) throw new PermanentError('An existing Apple distribution certificate is required');
  if (!(Date.parse(cert.attributes.expirationDate)>Date.now()+7*86400000)) throw new PermanentError('Distribution certificate expires within seven days');
  // Use the bundle relationship endpoint, rather than an unsupported global profile filter.
  // https://developer.apple.com/documentation/appstoreconnectapi/get-v1-bundleids-_id_-profiles
  const document=await client.get(`/v1/bundleIds/${bundles[0].id}/profiles?limit=200`);
  if (document.links?.next) throw new PermanentError('Profile audit requires pagination; stop for explicit review');
  return {appId:plan.appId,bundleId:plan.bundleId,bundleResourceId:bundles[0].id,certificateId,certificateExpiresAt:cert.attributes.expirationDate,profiles:(document.data??[]).filter(item=>item.attributes?.profileType==='IOS_APP_STORE').map(({id,attributes})=>({id,name:attributes.name,state:attributes.profileState,expiresAt:attributes.expirationDate}))};
}

export async function refreshProfile(client,plan,{certificateId,approved=false,profileName}) {
  if (!approved) throw new PermanentError('Explicit profile refresh approval is required');
  if (!/^Leafhour [A-Za-z0-9 ._-]{1,80}$/.test(profileName??'')) throw new PermanentError('A Leafhour-scoped profile name is required');
  const audit=await auditSigning(client,plan,{certificateId});
  // Never delete/revoke certificates or profiles. A lost POST response is uncertain, not retryable.
  // https://developer.apple.com/documentation/appstoreconnectapi/post-v1-profiles
  const created=await client.post('/v1/profiles',{data:{type:'profiles',attributes:{name:profileName,profileType:'IOS_APP_STORE'},relationships:{bundleId:{data:{type:'bundleIds',id:audit.bundleResourceId}},certificates:{data:[{type:'certificates',id:certificateId}]}}}});
  if (!created.data?.id || !created.data.attributes?.profileContent) throw new PermanentError('Profile creation outcome is uncertain; inspect ASC before retrying');
  return created.data;
}

async function main() {
  const mode=process.argv[2]??'audit';
  if (!['audit','refresh'].includes(mode)) throw Error('Use audit or refresh');
  const plan={appId:process.env.IOS_APP_ID,bundleId:process.env.IOS_BUNDLE_ID};
  const options={certificateId:process.env.IOS_CERTIFICATE_ID};
  const client=clientFromEnvironment();
  if (mode==='audit') {
    // Only metadata reaches the summary. No certificate/profile content, tester email, or key.
    console.log(JSON.stringify(await auditSigning(client,plan,options),null,2));
    return;
  }
  if (process.env.IOS_SIGNING_REFRESH_ENABLED!=='true' || process.env.CONFIRM_PROFILE_REFRESH!=='true' || process.env.GITHUB_ACTIONS!=='true') throw Error('Profile refresh is disabled or lacks explicit confirmation');
  const created=await refreshProfile(client,plan,{...options,approved:true,profileName:`Leafhour App Store ${process.env.GITHUB_RUN_ID}`});
  writeFileSync(`${process.env.RUNNER_TEMP}/leafhour-refreshed.mobileprovision`,Buffer.from(created.attributes.profileContent,'base64'),{mode:0o600});
  const certificate=(await client.get(`/v1/certificates/${options.certificateId}`)).data;
  if(!certificate?.attributes?.certificateContent) throw Error('Created profile must be reviewed; certificate bytes unavailable for independent validation');
  writeFileSync(`${process.env.RUNNER_TEMP}/leafhour-certificate.der`,Buffer.from(certificate.attributes.certificateContent,'base64'),{mode:0o600});
  writeFileSync(`${process.env.RUNNER_TEMP}/leafhour-signing-plan.json`,JSON.stringify(plan),{mode:0o600});
  console.log(`Created exact Leafhour profile ${created.id}; previous profiles retained. Validate before replacing the environment secret.`);
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) main().catch(error=>{console.error(error.message);process.exitCode=1;});
