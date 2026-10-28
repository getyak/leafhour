import {readFileSync,writeFileSync} from 'node:fs';
import {releaseDecision,releaseMetadata} from './release-policy.mjs';
import {verifyReceiptProvenance} from './receipt-provenance.mjs';

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
    const releases=await github.paginate(github.rest.repos.listReleases,{owner,repo,per_page:100});
    for(const release of releases) {
      if(release.draft || !release.prerelease || release.author?.login!=='github-actions[bot]' || !release.tag_name.startsWith('ios/v'))continue;
      const asset=release.assets?.find(a=>a.name==='testflight-receipt.json');
      if(!asset || asset.size>65536)continue;
      const result=await github.rest.repos.getReleaseAsset({owner,repo,asset_id:asset.id,headers:{accept:'application/octet-stream'}});
      let receipt;
      try {receipt=JSON.parse(typeof result.data==='string'?result.data:Buffer.from(result.data).toString('utf8'));}catch{continue;}
      const proof={getRun:async id=>(await github.rest.actions.getWorkflowRun({owner,repo,run_id:Number(id)})).data,getTag:async name=>(await github.rest.git.getRef({owner,repo,ref:`tags/${name}`})).data.object};
      if(!await verifyReceiptProvenance(release,receipt,{appId:env.IOS_APP_ID,bundleId:env.IOS_BUNDLE_ID},proof))continue;
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
  const plan={...metadata,repository,appId:env.IOS_APP_ID,bundleId:env.IOS_BUNDLE_ID,runId:String(context.runId),ciRunId:String(ciRunId),workflowRunUrl:`https://github.com/${repository}/actions/runs/${context.runId}`};
  writeFileSync('release-plan.json',JSON.stringify(plan,null,2)+'\n');
  core.setOutput('tag',plan.tag);
}
