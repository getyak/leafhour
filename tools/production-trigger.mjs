import {readFile,appendFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

export function shouldVerify(eventName, event, ref, config) {
  const enabled = config.git?.deploymentEnabled;
  const single = enabled && typeof enabled === 'object' && enabled['**'] === false
    && Object.keys(enabled).every(key => ['**','main','production'].includes(key));
  const legacy = single && enabled.main === true && !enabled.production;
  const hourly = single && enabled.production === true && !enabled.main;
  if (!legacy && !hourly) throw Error('Expected a single publication chain');
  if (hourly) return eventName === 'push' && ref === 'refs/heads/production';
  const run = event.workflow_run;
  return eventName === 'workflow_run' && run?.event === 'push' && run.conclusion === 'success'
    && run.head_branch === 'main' && run.head_repository?.full_name === 'getyak/leafhour';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = JSON.parse(await readFile('vercel.json', 'utf8'));
  const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const verify = shouldVerify(process.env.GITHUB_EVENT_NAME, event, process.env.GITHUB_REF, config);
  await appendFile(process.env.GITHUB_OUTPUT, `verify=${verify}\n`);
  console.log(verify ? 'Verify the published source.' : 'No publication was requested by this event.');
}
