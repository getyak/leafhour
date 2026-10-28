import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {clientFromEnvironment,verifyApp,lookupBuild,waitForBuild} from './app-store-connect.mjs';
import {maySubmit} from './release-policy.mjs';

const read=path=>JSON.parse(readFileSync(path,'utf8'));
const write=(path,value)=>writeFileSync(path,`${JSON.stringify(value,null,2)}\n`,{mode:0o600});
export function checkPackage(plan,ipa) {
  const actual=createHash('sha256').update(ipa).digest('hex');
  if (!/^[a-f0-9]{64}$/.test(plan.ipaSha256??'') || plan.ipaSha256!==actual) throw Error('IPA digest does not match the archived release plan');
  return actual;
}
export function makeReceipt(plan,apple) {
  if (apple.uploadState!=='COMPLETE' || apple.processingState!=='VALID' || !apple.buildId || !apple.uploadId) throw Error('An exact VALID Apple build is required');
  for (const key of ['appId','bundleId','version','buildNumber']) if (plan[key]!==apple[key]) throw Error(`Apple proof differs from plan: ${key}`);
  if (!/^[a-f0-9]{64}$/.test(plan.ipaSha256??'') || !/^[a-f0-9]{40}$/.test(plan.commitSha??'')) throw Error('Receipt requires source and IPA digests');
  return {schemaVersion:1,...plan,apple,confirmedAt:new Date().toISOString()};
}
export async function requireUnusedBuild(client,plan) {
  if(await lookupBuild(client,plan)) throw Error('This Apple version/build already exists before archive; use the original signed artifact and rerun only failed upload/finalize jobs');
}

async function main() {
  const [command,planPath='release-plan.json']=process.argv.slice(2);
  if(command==='can-submit') {process.exitCode=maySubmit(process.env.GITHUB_RUN_ATTEMPT)?0:3;return;}
  const plan=read(planPath);
  if (command==='check-package') {checkPackage(plan,readFileSync('build/ios/Leafhour.ipa'));return;}
  if (command==='receipt') {write('build/ios/testflight-receipt.json',makeReceipt(plan,read('build/ios/apple-validation.json')));return;}
  const client=clientFromEnvironment();
  await verifyApp(client,plan);
  if (command==='preflight') {await requireUnusedBuild(client,plan);return;}
  const lookup=()=>lookupBuild(client,plan);
  if (command==='probe') {
    const existing=await lookup();
    if (!existing) {process.exitCode=2;return;}
    console.log(`Existing exact upload: ${existing.uploadState}/${existing.processingState??'no build'}`);
    return;
  }
  if (command==='wait') {
    const apple=await waitForBuild({lookup});
    write('build/ios/apple-validation.json',{...apple,appId:plan.appId,bundleId:plan.bundleId,version:plan.version,buildNumber:plan.buildNumber});
    return;
  }
  throw Error('Usage: release.mjs preflight|probe|wait|check-package|receipt [release-plan.json]');
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) main().catch(error=>{console.error(error.message);process.exitCode=1;});
