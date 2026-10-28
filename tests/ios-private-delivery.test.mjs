import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
test('signed IPA stays on one ephemeral runner and is never uploaded to GitHub artifacts or releases',()=>{
  const workflow=JSON.parse(execFileSync('ruby',['-ryaml','-rjson','-e','puts JSON.generate(YAML.load_file(ARGV[0]))','.github/workflows/release-ios.yml'],{encoding:'utf8'}));
  const jobs=Object.values(workflow.jobs);
  const uploadJob=jobs.find(job=>job.steps.some(step=>step.run?.includes('bash scripts/ios/upload.sh')));
  assert.ok(uploadJob.steps.some(step=>step.run?.includes('bash scripts/ios/archive.sh')),'archive and ASC upload must share the runner');
  for(const job of jobs) {
    assert.notEqual(job.permissions?.contents,'write');
    for(const step of job.steps)if(step.uses?.startsWith('actions/upload-artifact@')) {
      const paths=step.with.path.split('\n').filter(Boolean);
      assert.ok(paths.every(path=>['release-plan.json','build/ios/testflight-receipt.json','build/ios/apple-validation.json'].includes(path)),`Only explicitly allowed non-sensitive JSON may leave the runner: ${paths}`);
    }
  }
  assert.equal(readFileSync('.github/workflows/release-ios.yml','utf8').includes('scripts/ios/finalize.mjs'),false);
});
