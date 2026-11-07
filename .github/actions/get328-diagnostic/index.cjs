'use strict';
const {spawn} = require('node:child_process');
const path = require('node:path');

const allowed = [
  'PATH','HOME','TMPDIR','LANG','LC_ALL','DEVELOPER_DIR',
  'GITHUB_ACTIONS','RUNNER_ENVIRONMENT','RUNNER_OS','RUNNER_ARCH','ImageOS','ImageVersion',
  'GITHUB_EVENT_NAME','GITHUB_REPOSITORY','GITHUB_REPOSITORY_ID','GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT',
  'GITHUB_SHA','GITHUB_REF','GITHUB_JOB','GITHUB_WORKFLOW_SHA','GITHUB_WORKFLOW_REF',
  'GITHUB_ACTOR','GITHUB_ACTOR_ID','GITHUB_TRIGGERING_ACTOR','GITHUB_WORKSPACE',
  'GITHUB_EVENT_PATH','GITHUB_SERVER_URL','RUNNER_TEMP',
  'GET328_GRANT_COMMENT_ID','GET328_GRANT_ISSUER_ID',
  'ACTIONS_RUNTIME_TOKEN','ACTIONS_RESULTS_URL',
];
function workerEnvironment(env) {
  const result = {};
  for (const key of allowed) if (typeof env[key] === 'string') result[key] = env[key];
  return result;
}
function main() {
  const env = workerEnvironment(process.env);
  if (!env.RUNNER_TEMP || !env.GITHUB_WORKSPACE) {
    process.stderr.write('diagnostic_worker_context_unknown\n'); process.exitCode = 1; return;
  }
  const worker = path.resolve(__dirname,'../../../scripts/ios/hosted_get328_diagnostic.py');
  const args = ['-B',worker,'run','--root',path.join(env.RUNNER_TEMP,'get328-environment'),
    '--uploader',path.join(env.GITHUB_WORKSPACE,'uploader/dist/upload/index.js'),
    '--node',process.execPath];
  const child = spawn('python3',args,{env,stdio:['ignore','inherit','inherit'],shell:false});
  let completed = false;
  const cancel = signal => {
    if (!completed && child.exitCode === null) child.kill(signal);
  };
  const interrupt = () => cancel('SIGINT');
  const terminate = () => cancel('SIGTERM');
  process.on('SIGINT',interrupt); process.on('SIGTERM',terminate);
  const finish = code => {
    completed = true;
    process.removeListener('SIGINT',interrupt); process.removeListener('SIGTERM',terminate);
    process.exitCode = code === 0 ? 0 : 1;
  };
  child.once('error',() => {process.stderr.write('diagnostic_worker_start_unknown\n'); finish(1);});
  child.once('exit',code => finish(code));
}
module.exports = {workerEnvironment,main};
if (require.main === module) main();
