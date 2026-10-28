import {trustedReceipt} from './release-policy.mjs';

export async function verifyReceiptProvenance(release,receipt,identity,{getRun,getTag,allowCurrentRunId}) {
  if(!trustedReceipt(release,receipt,identity))return false;
  const tag=await getTag(release.tag_name);
  if(tag?.type!=='commit' || tag.sha!==receipt.commitSha)return false;
  const [releaseRun,ciRun]=await Promise.all([getRun(receipt.runId),getRun(receipt.ciRunId)]);
  const sourceMatches=run=>run?.head_sha===receipt.commitSha && run.head_branch==='main' && run.head_repository?.full_name===receipt.repository;
  const successful=run=>run?.status==='completed' && run.conclusion==='success';
  const current=String(releaseRun?.id)===allowCurrentRunId && releaseRun?.status==='in_progress';
  return sourceMatches(releaseRun) && String(releaseRun.id)===receipt.runId && releaseRun.path==='.github/workflows/release-ios.yml' && ['workflow_run','workflow_dispatch'].includes(releaseRun.event) && (successful(releaseRun)||current) && sourceMatches(ciRun) && String(ciRun.id)===receipt.ciRunId && ciRun.path==='.github/workflows/ci.yml' && ciRun.event==='push' && successful(ciRun);
}

export async function assertPublishedReceipt(release,prior,expected,identity,proof) {
  if(!await verifyReceiptProvenance(release,prior,identity,proof))throw Error('Published receipt lacks matching source, artifact or Apple provenance');
  for(const field of ['commitSha','ipaSha256','appId','bundleId','version','buildNumber','runId','ciRunId'])if(prior[field]!==expected[field])throw Error('Published receipt differs; never overwrite');
  for(const field of ['appId','bundleId','version','buildNumber','buildId','uploadId','uploadState','processingState'])if(prior.apple[field]!==expected.apple[field])throw Error('Published Apple evidence differs; never claim idempotent success');
}
