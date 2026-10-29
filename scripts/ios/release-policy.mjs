// GitHub workflow_run is privileged: only the current, successful main push can release.
// https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run
export function releaseDecision({event,ref,sha,tip,ci,repository,enabled=false,automatic=false,publish=false,ciVerified=false}) {
  const reject=reason=>({publish:false,reason});
  if (repository!=='getyak/leafhour' || ref!=='refs/heads/main') return reject('Only getyak/leafhour main may publish');
  if (!/^[a-f0-9]{40}$/.test(sha??'') || sha!==tip) return reject('Release source is not the current main tip');
  if (!enabled) return reject('TestFlight channel is disabled');
  if (event==='workflow_dispatch') return publish && ciVerified ? {publish:true,reason:'Explicit manual publish; exact main CI passed'} : reject('Manual publish requires confirmation and successful exact main CI');
  if (event!=='workflow_run' || !automatic) return reject('Automatic updates are disabled');
  if (ci?.event!=='push' || ci?.conclusion!=='success' || ci?.head_branch!=='main' || ci?.head_sha!==sha || ci?.head_repository?.full_name!==repository) return reject('CI is not a successful same-repository main push');
  return {publish:true,reason:'Automatic updates enabled; exact main CI passed'};
}

const versionPattern=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
// Later attempts cannot distinguish delayed Apple visibility from an absent prior submission.
export function maySubmit(runAttempt) {return runAttempt==='1';}
export function releaseMetadata({version,runNumber,offset='0',sha}) {
  if (!versionPattern.test(version??'') || version.length>18) throw Error('Invalid marketing version');
  if (!/^[1-9]\d*$/.test(runNumber??'') || !/^(0|[1-9]\d*)$/.test(offset)) throw Error('Invalid build sequence');
  const n=Number(runNumber)+Number(offset);
  if (!Number.isSafeInteger(n) || n<1 || n>=99990000) throw Error('Build sequence exceeds Apple 4.2.2 component limits');
  if (!/^[a-f0-9]{40}$/.test(sha??'')) throw Error('Invalid commit SHA');
  // Stable for every attempt of one run; increases across this workflow's runs.
  // https://developer.apple.com/documentation/bundleresources/information-property-list/cfbundleversion
  const buildNumber=`${1+Math.floor(n/10000)}.${Math.floor(n%10000/100)}.${n%100}`;
  return {version,buildNumber,commitSha:sha};
}

export function trustedReceipt(artifact,receipt,identity) {
  if (artifact?.name!=='ios-testflight-receipt' || artifact.expired || !Number.isSafeInteger(artifact.id) || artifact.size_in_bytes>65536 || !/^sha256:[a-f0-9]{64}$/.test(artifact.digest??'')) return false;
  if (receipt?.schemaVersion!==2 || receipt.repository!=='getyak/leafhour' || !/^[a-f0-9]{40}$/.test(receipt.commitSha??'') || !/^[a-f0-9]{64}$/.test(receipt.ipaSha256??'')) return false;
  if (!versionPattern.test(receipt.version??'') || !/^[1-9]\d{0,3}\.\d{1,2}\.\d{1,2}$/.test(receipt.buildNumber??'')) return false;
  if (String(artifact.workflow_run?.id)!==receipt.runId || artifact.workflow_run?.head_sha!==receipt.commitSha || artifact.workflow_run?.head_branch!=='main') return false;
  if (receipt.bundleId!==identity.bundleId || receipt.appId!==identity.appId || !/^\d+$/.test(receipt.runId??'') || !/^\d+$/.test(receipt.ciRunId??'')) return false;
  if (!receipt.apple?.buildId || !receipt.apple?.uploadId || receipt.apple.uploadState!=='COMPLETE' || receipt.apple.processingState!=='VALID') return false;
  for(const key of ['appId','bundleId','version','buildNumber']) if(receipt.apple[key]!==receipt[key]) return false;
  return true;
}
