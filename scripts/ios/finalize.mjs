import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {assertPublishedReceipt} from './receipt-provenance.mjs';
const receipt=JSON.parse(readFileSync('build/ios/testflight-receipt.json','utf8'));
const repo='getyak/leafhour';
const gh=args=>execFileSync('gh',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']});
const query=path=>JSON.parse(gh(['api',path]));
const tag=receipt.tag;
if (!/^ios\/v\d+\.\d+\.\d+-build\d+\.\d+\.\d+$/.test(tag??''))throw Error('Invalid immutable release tag');
// Reading the list distinguishes absent releases from network/auth failures.
const releases=JSON.parse(gh(['api',`repos/${repo}/releases?per_page=100`,'--paginate','--slurp'])).flat();
const existing=releases.find(item=>item.tag_name===tag);
const identity={bundleId:receipt.bundleId,appId:receipt.appId};
const proof={getRun:async id=>query(`repos/${repo}/actions/runs/${id}`),getTag:async name=>query(`repos/${repo}/git/ref/tags/${name}`).object,allowCurrentRunId:process.env.GITHUB_RUN_ID};
if(existing) {
  const asset=existing.assets.find(item=>item.name==='testflight-receipt.json');
  if(!asset || asset.size>65536)throw Error('Existing release receipt is missing or oversized; stop for review');
  const prior=JSON.parse(gh(['api',`repos/${repo}/releases/assets/${asset.id}`,'-H','Accept: application/octet-stream']));
  await assertPublishedReceipt(existing,prior,receipt,identity,proof);
  console.log(`Exact receipt already published: ${existing.html_url}`);
}else {
  const refs=JSON.parse(gh(['api',`repos/${repo}/git/matching-refs/tags/${tag}`]));
  if(refs.some(item=>item.ref===`refs/tags/${tag}` && item.object.sha!==receipt.commitSha))throw Error('Existing tag points to another source; never force-update');
  gh(['release','create',tag,'build/ios/Leafhour.ipa','build/ios/testflight-receipt.json','--repo',repo,'--target',receipt.commitSha,'--prerelease','--title',`Leafhour iOS ${receipt.version} (${receipt.buildNumber})`,'--notes',`Apple independently confirmed this exact build as VALID. Source: ${receipt.commitSha}. IPA SHA-256: ${receipt.ipaSha256}. Workflow: ${receipt.workflowRunUrl}. Tester assignment, installation and data-preserving update acceptance remain separate.`]);
  const published=query(`repos/${repo}/releases/tags/${tag}`);
  const asset=published.assets.find(item=>item.name==='testflight-receipt.json');
  if(!asset || asset.size>65536)throw Error('Release creation outcome is incomplete; inspect before retrying');
  const prior=JSON.parse(gh(['api',`repos/${repo}/releases/assets/${asset.id}`,'-H','Accept: application/octet-stream']));
  await assertPublishedReceipt(published,prior,receipt,identity,proof);
  console.log(`Published ${tag}`);
}
