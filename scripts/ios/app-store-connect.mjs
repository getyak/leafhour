import {sign} from 'node:crypto';
import {readFileSync} from 'node:fs';
export class PermanentError extends Error {}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const origin='https://api.appstoreconnect.apple.com';

// https://developer.apple.com/documentation/appstoreconnectapi/generating-tokens-for-api-requests
export function createToken({privateKey,keyId,issuerId,now=Date.now()}) {
  if (!privateKey || !keyId || !issuerId) throw new PermanentError('Missing ASC API credentials');
  const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
  const iat=Math.floor(now/1000);
  const content=`${encode({alg:'ES256',kid:keyId,typ:'JWT'})}.${encode({iss:issuerId,iat,exp:iat+600,aud:'appstoreconnect-v1'})}`;
  return `${content}.${sign('sha256',Buffer.from(content),{key:privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url')}`;
}

export function createClient({token,fetchImpl=fetch,sleep=delay}) {
  async function request(path,{method='GET',body}={}) {
    if (!path.startsWith('/v1/') || path.includes('://') || path.startsWith('//')) throw new PermanentError('Invalid ASC API path');
    for (let attempt=0;attempt<3;attempt++) {
      try {
        const response=await fetchImpl(`${origin}${path}`,{method,redirect:'error',headers:{Accept:'application/json',Authorization:`Bearer ${token()}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
        if (response.ok) return await response.json();
        const message=`ASC ${method} ${path.split('?')[0]} returned HTTP ${response.status}`;
        if (response.status!==429 && response.status<500) throw new PermanentError(message);
        throw Error(message);
      } catch(error) {
        // Mutations are never retried: a lost response may already have created the profile.
        if (method!=='GET' || error instanceof PermanentError || attempt===2) throw error;
        await sleep((attempt+1)*2000);
      }
    }
  }
  return {get:path=>request(path),post:(path,body)=>request(path,{method:'POST',body})};
}

export function clientFromEnvironment(env=process.env) {
  const privateKey=env.ASC_PRIVATE_KEY_PATH?readFileSync(env.ASC_PRIVATE_KEY_PATH,'utf8'):env.ASC_PRIVATE_KEY_P8;
  return createClient({token:()=>createToken({privateKey,keyId:env.ASC_API_KEY_ID,issuerId:env.ASC_ISSUER_ID})});
}

export async function verifyApp(client,{appId,bundleId}) {
  if (!/^\d+$/.test(appId??'') || !/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(bundleId??'') || /(?:^|\.)(?:local|debug)(?:\.|$)/i.test(bundleId)) throw new PermanentError('Verified distribution IOS_APP_ID and IOS_BUNDLE_ID are required');
  const app=(await client.get(`/v1/apps/${appId}?fields[apps]=name,bundleId`)).data;
  if (app?.id!==appId || app.attributes?.bundleId!==bundleId) throw new PermanentError('ASC app does not match the configured bundle identifier');
  return {appId,bundleId,name:app.attributes.name};
}

// https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-builduploads
export function exactUpload(document,{version,buildNumber}) {
  const candidates=(document?.data??[]).filter(item=>item.attributes?.cfBundleVersion===buildNumber && item.attributes?.cfBundleShortVersionString===version && item.attributes?.platform==='IOS');
  if (candidates.length>1) throw new PermanentError('Ambiguous exact Apple build upload');
  if (!candidates.length) return null;
  const upload=candidates[0];
  const build=(document.included??[]).find(item=>item.type==='builds' && item.id===upload.relationships?.build?.data?.id);
  if (build && build.attributes?.version!==buildNumber) throw new PermanentError('Related Apple build number differs');
  const result={uploadId:upload.id,buildId:build?.id??null,uploadState:upload.attributes?.state?.state??'UNKNOWN',processingState:build?.attributes?.processingState??null};
  if (result.uploadState==='FAILED' || ['FAILED','INVALID'].includes(result.processingState)) throw new PermanentError('Apple rejected this exact upload/build');
  return result;
}

export async function lookupBuild(client,{appId,version,buildNumber}) {
  const query=new URLSearchParams({'filter[cfBundleShortVersionString]':version,'filter[cfBundleVersion]':buildNumber,'filter[platform]':'IOS',include:'build','fields[buildUploads]':'cfBundleShortVersionString,cfBundleVersion,platform,state,build','fields[builds]':'version,processingState',limit:'10'});
  return exactUpload(await client.get(`/v1/apps/${appId}/buildUploads?${query}`),{version,buildNumber});
}

export async function waitForBuild({lookup,now=Date.now,sleep=delay,timeoutMs=60*60000,pollMs=30000,log=console.log}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs<=0 || !Number.isFinite(pollMs) || pollMs<=0) throw new PermanentError('Invalid Apple polling bounds');
  const deadline=now()+timeoutMs;
  let state='not visible';
  while (true) {
    try {
      const result=await lookup();
      if (result) {
        state=`${result.uploadState}/${result.processingState??'no build'}`;
        if (['FAILED','INVALID'].includes(result.processingState) || result.uploadState==='FAILED') throw new PermanentError('Apple rejected the exact build');
        if (result.uploadState==='COMPLETE' && result.processingState==='VALID' && result.buildId) return result;
      }
    } catch(error) {
      if (error instanceof PermanentError) throw error;
      // Do not log server bodies, tokens, URLs, or arbitrary transport messages.
      log('Transient Apple read failed; bounded polling continues');
    }
    if (now()>=deadline) throw Error(`Apple processing remains unconfirmed (last state: ${state}); inspect before retrying upload`);
    log(`Apple processing: ${state}`);
    await sleep(Math.min(pollMs,deadline-now()));
  }
}
