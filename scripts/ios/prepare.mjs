import {readFileSync,writeFileSync} from 'node:fs';
import {releaseDecision,releaseMetadata} from './release-policy.mjs';
import {verifyReceiptProvenance,decodeReceiptArchive} from './receipt-provenance.mjs';

export async function prepare({github,context,core,env=process.env}) {
  const repository=context.payload.repository.full_name;
  const {owner,repo}=context.repo;
  const branch=await github.rest.repos.getBranch({owner,repo,branch:'main'});
  const tip=branch.data.commit.sha;
  const ci=context.payload.workflow_run;
  const sha=context.eventName==='workflow_run'?ci.head_sha:context.sha;
  let ciRunId=ci?.id;
  let ciVerified=false;
  if(context.eventName==='workflow_dispatch') {
    const runs=await github.rest.actions.listWorkflowRuns({owner,repo,workflow_id:'ci.yml',head_sha:sha,event:'push',per_page:100});
    const latest=runs.data.workflow_runs.sort((a,b)=>b.id-a.id)[0];
    ciVerified=latest?.head_branch==='main' && latest?.head_repository?.full_name===repository && latest?.status==='completed' && latest?.conclusion==='success';
    ciRunId=latest?.id;
  }
  const decision=releaseDecision({event:context.eventName,ref:context.ref,sha,tip,ci,repository,enabled:env.IOS_TESTFLIGHT_ENABLED==='true',automatic:env.IOS_AUTOMATIC_TESTFLIGHT==='true',publish:env.PUBLISH_TESTFLIGHT==='true',ciVerified});
  if(decision.publish && context.eventName==='workflow_run') {
    const runs=await github.paginate(github.rest.actions.listWorkflowRuns,{owner,repo,workflow_id:'release-ios.yml',branch:'main',status:'success',per_page:100});
    for(const run of runs.sort((a,b)=>b.id-a.id)) {
      if(String(run.id)===String(context.runId))continue;
      const artifacts=await github.rest.actions.listWorkflowRunArtifacts({owner,repo,run_id:run.id,per_page:100});
      const artifact=artifacts.data.artifacts.find(item=>item.name==='ios-testflight-receipt' && !item.expired && item.size_in_bytes<=65536);
      if(!artifact)continue;
      const result=await github.rest.actions.downloadArtifact({owner,repo,artifact_id:artifact.id,archive_format:'zip'});
      let receipt;
      try {receipt=decodeReceiptArchive(Buffer.from(result.data),artifact);}catch{continue;}
      const proof={getRun:async id=>(await github.rest.actions.getWorkflowRun({owner,repo,run_id:Number(id)})).data};
      if(!await verifyReceiptProvenance(artifact,receipt,{appId:env.IOS_APP_ID,bundleId:env.IOS_BUNDLE_ID},proof))continue;
      const comparison=await github.rest.repos.compareCommitsWithBasehead({owner,repo,basehead:`${receipt.commitSha}...${sha}`,per_page:100});
      const files=comparison.data.files??[];
      const relevant=path=>/^(apps\/ios\/|scripts\/ios\/|tests\/(?:ios-|test_ios_)|\.github\/workflows\/(?:release-ios|refresh-ios-signing)\.yml$)/.test(path);
      if(files.length<300 && !files.some(file=>relevant(file.filename) || relevant(file.previous_filename??''))) {
        decision.publish=false;decision.reason='No iOS changes since the last trusted Apple VALID receipt';
      }
      break;
    }
  }
  core.setOutput('publish',String(decision.publish));
  core.setOutput('sha',sha);
  await core.summary.addHeading('Leafhour TestFlight decision').addRaw(decision.reason).write();
  if(!decision.publish)return;
  const version=env.VERSION_OVERRIDE || JSON.parse(readFileSync('apps/ios/release.json','utf8')).marketingVersion;
  const metadata=releaseMetadata({version,runNumber:String(context.runNumber),offset:env.IOS_BUILD_NUMBER_OFFSET||'0',sha});
  if(!/^\d+$/.test(env.IOS_APP_ID??'') || !/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(env.IOS_BUNDLE_ID??''))throw Error('Verified IOS_APP_ID and IOS_BUNDLE_ID are required');
  const plan={...metadata,repository,appId:env.IOS_APP_ID,bundleId:env.IOS_BUNDLE_ID,runId:String(context.runId),ciRunId:String(ciRunId)};
  writeFileSync('release-plan.json',JSON.stringify(plan,null,2)+'\n');
}
