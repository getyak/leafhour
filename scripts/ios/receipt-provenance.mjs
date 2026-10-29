import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {trustedReceipt} from './release-policy.mjs';

function decodeMetadataArchive(bytes,artifact,fileName) {
  if(bytes.length>65536 || artifact.digest!==`sha256:${createHash('sha256').update(bytes).digest('hex')}`)throw Error('Receipt archive digest mismatch');
  const script=`import io,json,sys,zipfile
with zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())) as z:
    entries=z.infolist()
    if len(entries)!=1 or entries[0].filename!=sys.argv[1] or entries[0].file_size>32768 or entries[0].flag_bits&1:
        raise ValueError('Unexpected receipt archive content')
    sys.stdout.write(z.read(entries[0]).decode('utf-8'))
`;
  return JSON.parse(execFileSync('python3',['-c',script,fileName],{input:bytes,encoding:'utf8',maxBuffer:32768,stdio:['pipe','pipe','pipe']}));
}
export const decodeReceiptArchive=(bytes,artifact)=>decodeMetadataArchive(bytes,artifact,'testflight-receipt.json');
export const decodePlanArchive=(bytes,artifact)=>decodeMetadataArchive(bytes,artifact,'release-plan.json');

const sourceMatches=(run,plan)=>run?.head_sha===plan.commitSha && run.head_branch==='main' && run.head_repository?.full_name===plan.repository;
const successful=run=>run?.status==='completed' && run.conclusion==='success';
export async function verifySourceRun(expectedRunId,{getRun}) {
  if(!/^[1-9]\d*$/.test(expectedRunId??''))throw Error('Invalid original run ID');
  const source=await getRun(expectedRunId);
  if(String(source?.id)!==expectedRunId || source.head_branch!=='main' || source.head_repository?.full_name!=='getyak/leafhour' || source.path!=='.github/workflows/release-ios.yml' || !['workflow_run','workflow_dispatch'].includes(source.event) || !/^[a-f0-9]{40}$/.test(source.head_sha??''))throw Error('Original run is not a trusted main release workflow');
  return source;
}
export async function verifyOriginalPlan(plan,identity,expectedRunId,{getRun}) {
  if(plan.repository!=='getyak/leafhour' || plan.appId!==identity.appId || plan.bundleId!==identity.bundleId || plan.runId!==expectedRunId || !/^[1-9]\d*$/.test(plan.runId??'') || !/^[1-9]\d*$/.test(plan.ciRunId??'') || !/^[a-f0-9]{40}$/.test(plan.commitSha??'') || !/^\d+\.\d+\.\d+$/.test(plan.version??'') || !/^[1-9]\d{0,3}\.\d{1,2}\.\d{1,2}$/.test(plan.buildNumber??''))throw Error('Recovery plan identity is not the expected original release');
  const [source,ci]=await Promise.all([verifySourceRun(plan.runId,{getRun}),getRun(plan.ciRunId)]);
  if(!sourceMatches(source,plan) || String(source.id)!==plan.runId || source.path!=='.github/workflows/release-ios.yml' || !['workflow_run','workflow_dispatch'].includes(source.event) || !sourceMatches(ci,plan) || String(ci.id)!==plan.ciRunId || ci.path!=='.github/workflows/ci.yml' || ci.event!=='push' || !successful(ci))throw Error('Recovery plan does not have matching original workflow/CI provenance');
  return source;
}

export async function verifyReceiptProvenance(artifact,receipt,identity,proof) {
  if(!trustedReceipt(artifact,receipt,identity))return false;
  try {
    const source=await verifyOriginalPlan(receipt,identity,receipt.runId,proof);
    return successful(source);
  }catch{return false;}
}
