import {pathToFileURL} from 'node:url';

const jobs = {web:'test', native:'native-ios', catalog:'catalog-sources', ios_release:'ios-release-contracts'};
export function checkJobs(results) {
  if (results.changes?.result !== 'success') throw Error('CI planner did not succeed');
  for (const [area, job] of Object.entries(jobs)) {
    const required = results.changes.outputs?.[area];
    if (!['true', 'false'].includes(required)) throw Error('Invalid CI plan for ' + area);
    const result = results[job]?.result;
    if (required === 'true' ? result !== 'success' : !['success', 'skipped'].includes(result)) {
      throw Error(`${job}: expected ${required === 'true' ? 'success' : 'success or deliberate skip'}, received ${result}`);
    }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  checkJobs(JSON.parse(process.env.CI_JOB_RESULTS));
  console.log('CI gate passed: every required area succeeded.');
}
