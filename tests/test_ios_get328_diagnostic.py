"""Offline contracts for the environment collector; all fixtures are synthetic."""
import hashlib
import base64
import importlib
import json
import os
from pathlib import Path
import plistlib
import socket
import subprocess
import sys
import tempfile
import shutil
import time
import unittest
from unittest import mock
import urllib.request
import io
from contextlib import redirect_stdout

SCRIPTS = Path(__file__).resolve().parents[1] / 'scripts/ios'
sys.path.insert(0, str(SCRIPTS))


class CollectorContracts(unittest.TestCase):
    def setUp(self):
        self.network = self.enterContext(mock.patch.object(
            urllib.request.OpenerDirector, 'open', side_effect=AssertionError('offline network denied')))
        self.enterContext(mock.patch.object(socket, 'create_connection',
                                         side_effect=AssertionError('offline network denied')))
        self.assertTrue((SCRIPTS / 'hosted_get328_diagnostic.py').is_file(),
                        'diagnostic collector feature is missing')
        self.d = importlib.import_module('hosted_get328_diagnostic')
        self.temp = self.enterContext(tempfile.TemporaryDirectory(prefix='get328-diag-fixture-'))
        self.root = Path(self.temp).resolve()

    def tearDown(self):
        self.assertEqual(self.network.call_count, 0)

    def outputs(self, values=None):
        values = values or {
            'artifact-id': '123', 'artifact-digest': 'a' * 64,
            'artifact-url': 'https://github.com/getyak/leafhour/actions/runs/99/artifacts/123'}
        path = self.root / 'output'
        path.write_text(''.join('\n' + key + '<<ghadelimiter_' + key + '\n' + value
                                + '\nghadelimiter_' + key + '\n' for key, value in values.items()))
        return path

    def test_uploader_heredoc_requires_all_three_bound_values(self):
        result = self.d.parse_upload_outputs(self.outputs(), 99)
        self.assertEqual(result, {'id': 123, 'digest': 'a' * 64,
                                 'url': 'https://github.com/getyak/leafhour/actions/runs/99/artifacts/123'})

    def test_upload_exit_metadata_cannot_accept_wrong_run_or_extra_values(self):
        for change in [
            {'artifact-id': '0'}, {'artifact-digest': 'z' * 64},
            {'artifact-url': 'https://github.com/getyak/leafhour/actions/runs/98/artifacts/123'},
            {'artifact-url': 'https://github.com/getyak/leafhour/actions/runs/99/artifacts/123?signature=x'},
            {'unknown': 'surprise'},
        ]:
            with self.subTest(change=change):
                path = self.outputs()
                values = {'artifact-id': '123', 'artifact-digest': 'a' * 64,
                          'artifact-url': 'https://github.com/getyak/leafhour/actions/runs/99/artifacts/123'}
                values.update(change)
                path.unlink(); path = self.outputs(values)
                with self.assertRaises((ValueError, self.d.DiagnosticError)):
                    self.d.parse_upload_outputs(path, 99)

    def test_duplicate_missing_partial_and_oversized_outputs_are_unknown(self):
        good = self.outputs().read_text()
        for raw in [good + 'artifact-id=123\n', good.replace('ghadelimiter_artifact-url\n', '', 1),
                    good.replace('artifact-digest', 'missing-digest'), good[:-1], 'x' * 8193]:
            with self.subTest(raw=raw[:35]):
                path = self.root / 'output'; path.write_text(raw)
                with self.assertRaises((ValueError, self.d.DiagnosticError)):
                    self.d.parse_upload_outputs(path, 99)

    def test_output_symlink_is_not_an_owned_output_file(self):
        real = self.outputs(); link = self.root / 'link'; link.symlink_to(real)
        with self.assertRaises((ValueError, self.d.DiagnosticError)):
            self.d.parse_upload_outputs(link, 99)

    def base_env(self):
        return {'PATH': '/usr/bin:/bin', 'HOME': str(self.root),
                'ACTIONS_RUNTIME_TOKEN': 'synthetic-runtime-token',
                'ACTIONS_RESULTS_URL': 'https://results-receiver.actions.githubusercontent.com/',
                'GITHUB_REPOSITORY': 'getyak/leafhour', 'GITHUB_RUN_ID': '99',
                'GITHUB_SERVER_URL': 'https://github.com',
                'GITHUB_TOKEN': 'synthetic-must-not-forward', 'PRIVATE_SECRET': 'synthetic-other-secret',
                'ACTIONS_ID_TOKEN_REQUEST_TOKEN': 'synthetic-oidc-must-not-forward'}

    def test_upload_environment_keeps_only_existing_minimum_capability(self):
        env = self.d.upload_environment(self.base_env(), self.root/'output', self.root/'artifact', 99)
        self.assertEqual(env['ACTIONS_RUNTIME_TOKEN'], 'synthetic-runtime-token')
        self.assertNotIn('GITHUB_TOKEN', env); self.assertNotIn('PRIVATE_SECRET', env)
        self.assertNotIn('ACTIONS_ID_TOKEN_REQUEST_TOKEN', env)
        self.assertEqual(env['INPUT_RETENTION-DAYS'], '3')
        self.assertEqual(env['INPUT_OVERWRITE'], 'false')
        self.assertEqual(env['INPUT_INCLUDE-HIDDEN-FILES'], 'false')
        self.assertEqual(env['INPUT_IF-NO-FILES-FOUND'], 'error')
        self.assertEqual(env['INPUT_NAME'], 'get328-environment-99-attempt-1')
        self.assertEqual(env['GITHUB_OUTPUT'], str(self.root/'output'))

    def test_missing_results_or_untrusted_endpoint_has_no_fallback(self):
        for bad in [None, 'http://results-receiver.actions.githubusercontent.com/',
                    'https://results-receiver.actions.githubusercontent.com.evil.test/',
                    'https://token@results-receiver.actions.githubusercontent.com/']:
            with self.subTest(endpoint=bad):
                env = self.base_env()
                if bad is None: del env['ACTIONS_RESULTS_URL']
                else: env['ACTIONS_RESULTS_URL'] = bad
                with self.assertRaises((ValueError, self.d.DiagnosticError)):
                    self.d.upload_environment(env, self.root/'output', self.root/'artifact', 99)

    def test_image_version_mismatch_stops_before_any_probe(self):
        env = {'GITHUB_ACTIONS': 'true', 'RUNNER_ENVIRONMENT': 'github-hosted',
               'RUNNER_OS': 'macOS', 'RUNNER_ARCH': 'X64', 'ImageOS': 'macos26',
               'ImageVersion': '20260824.0517.2',
               'DEVELOPER_DIR': '/Applications/Xcode_26.6.app/Contents/Developer'}
        with self.assertRaises((ValueError, self.d.DiagnosticError)):
            self.d.validate_host(env, system='Darwin', machine='x86_64')

    def test_identity_reads_contents_version_plist_and_sdk_without_native_command(self):
        contents=self.root/'Synthetic.app/Contents';developer=contents/'Developer'
        developer.mkdir(parents=True)
        (contents/'version.plist').write_bytes(plistlib.dumps({
            'CFBundleShortVersionString':'26.6','ProductBuildVersion':'17F113'}))
        sdks=developer/'Platforms/iPhoneSimulator.platform/Developer/SDKs'
        sdk=sdks/'iPhoneSimulator26.5.sdk';(sdk/'usr/lib').mkdir(parents=True)
        (sdks/'iPhoneSimulator.sdk').symlink_to(sdk,target_is_directory=True)
        (sdk/'SDKSettings.plist').write_bytes(plistlib.dumps({'Version':'26.5'}))
        (sdk/'usr/lib/libSystem.tbd').write_text('targets: [ x86_64-ios-simulator ]\n')
        output=io.StringIO()
        with mock.patch.object(self.d,'DEVELOPER_DIR',str(developer)), \
                mock.patch('subprocess.Popen',side_effect=AssertionError('identity is passive')),redirect_stdout(output):
            try:self.d.tool_files()
            except Exception as error:self.fail('valid synthetic Xcode layout rejected: '+type(error).__name__)
        last=json.loads(output.getvalue().splitlines()[-1]);self.assertTrue(last['complete'])
        self.assertIn('no runtime compatibility claim',last['meaning'])

    def evidence(self):
        source = self.root / 'evidence'; (source/'logs').mkdir(parents=True)
        (source/'receipts').mkdir()
        (source/'logs/probe.log').write_text('synthetic observation\n')
        (source/'receipts/report.json').write_text(json.dumps({
            'status': 'partial', 'partial_reason': 'diagnostic only; no App or original seven'}))
        return source

    def test_real_tar_roundtrip_keeps_bytes_and_private_32mib_policy(self):
        import hosted_get328_evidence as legacy
        before = legacy.MAX_BYTES
        source = self.evidence()
        result = self.d.package_bounded(source, self.root/'package', deadline=time.monotonic()+5)
        self.assertLessEqual(result['total_bytes'], 32*1024**2)
        manifest = Path(result['manifest_path']); archive = Path(result['archive_path'])
        verified = self.d.verify_package(archive, manifest, self.root/'restored', result['manifest_sha256'])
        self.assertTrue(verified['verified'])
        self.assertEqual((self.root/'restored/logs/probe.log').read_bytes(),
                         (source/'logs/probe.log').read_bytes())
        self.assertEqual(legacy.MAX_BYTES, before)
        self.assertEqual(before, 256*1024**2)

    def test_sparse_oversize_source_is_rejected_before_large_read(self):
        source = self.evidence()
        with (source/'logs/large').open('wb') as out: out.truncate(32*1024**2+1)
        with self.assertRaises(Exception):
            self.d.package_bounded(source, self.root/'package', deadline=time.monotonic()+3)
        self.assertEqual((source/'logs/large').stat().st_size, 32*1024**2+1)

    def test_restore_requires_trusted_manifest_digest(self):
        source = self.evidence()
        result = self.d.package_bounded(source, self.root/'package', deadline=time.monotonic()+5)
        with self.assertRaises((ValueError, self.d.DiagnosticError)):
            self.d.verify_package(Path(result['archive_path']), Path(result['manifest_path']),
                                  self.root/'restored', 'b'*64)
        self.assertFalse((self.root/'restored').exists())

    def fixture_runtime(self, cache=True):
        base = self.root/'runtimes'; bundle = base/'Synthetic.simruntime'
        info = bundle/'Contents/Info.plist'; info.parent.mkdir(parents=True)
        info.write_bytes(plistlib.dumps({'CFBundleIdentifier': 'synthetic.runtime',
                                        'CFBundleShortVersionString': '26.5'}))
        if cache:
            file = bundle/'Contents/Resources/RuntimeRoot/System/Library/dyld/dyld_shared_cache_x86_64'
            file.parent.mkdir(parents=True); file.write_bytes(b'dyld_v1  x86_64'.ljust(16,b'\0')+b'synthetic')
        return base

    def test_inventory_reads_synthetic_headers_without_simctl(self):
        base = self.fixture_runtime()
        with mock.patch('subprocess.Popen', side_effect=AssertionError('no command in passive inventory')):
            inventory = self.d.inventory_runtime_files([base], deadline=time.monotonic()+2)
        self.assertEqual(len(inventory['runtimes']), 1)
        self.assertEqual(inventory['runtimes'][0]['architectures_observed'], ['x86_64'])

    def test_missing_cache_remains_unproven_instead_of_claiming_compatibility(self):
        inventory = self.d.inventory_runtime_files([self.fixture_runtime(False)], deadline=time.monotonic()+2)
        self.assertEqual(inventory['runtimes'][0]['architectures_observed'], [])
        self.assertEqual(inventory['runtimes'][0]['architecture_status'], 'unproven')

    def test_passive_inventory_refuses_expired_deadline(self):
        with self.assertRaises((ValueError, self.d.DiagnosticError)):
            self.d.inventory_runtime_files([self.root], deadline=time.monotonic()-1)

    def test_first_unknown_stops_real_later_synthetic_probe(self):
        from hosted_get328_diagnostic_core import Budget, Runner
        began = time.monotonic()
        budget = Budget({'schema_version':1, 'started_monotonic':began,
                         'work_deadline_monotonic':began+240, 'deadline_monotonic':began+330,
                         'initial_free_bytes':9*1024**3})
        (self.root/'job').mkdir()
        runner = Runner(self.root/'job', budget, sample=lambda: (9*1024**3,0,0))
        marker = self.root/'must-not-exist'
        probes = [('first', [sys.executable,'-c','import sys; sys.exit(3)'],512),
                  ('later', [sys.executable,'-c',
                             'from pathlib import Path; Path('+repr(str(marker))+').write_text("bad")'],512)]
        report = self.d.execute_probe_plan(runner, probes)
        self.assertEqual(report[0]['status'], 'unknown')
        self.assertEqual(report[1]['status'], 'not-run')
        self.assertFalse(marker.exists())
        self.assertTrue(budget.stopped)
        receipt=json.loads((runner.root/'receipts/first-command.json').read_text())
        self.assertTrue(receipt['started']);self.assertEqual(receipt['raw_exit'],3)

    def test_node_wrapper_import_does_not_start_worker_or_leak_other_env(self):
        wrapper = SCRIPTS.parents[1]/'.github/actions/get328-diagnostic/index.cjs'
        self.assertTrue(wrapper.is_file(), 'local Node wrapper is missing')
        source = ('const w=require('+json.dumps(str(wrapper))+');'
                  'const e=w.workerEnvironment({PATH:"/bin",GITHUB_EVENT_NAME:"push",ACTIONS_RUNTIME_TOKEN:"synthetic",'
                  'ACTIONS_RESULTS_URL:"https://results-receiver.actions.githubusercontent.com/",'
                  'GITHUB_TOKEN:"synthetic-do-not-forward",PRIVATE_SECRET:"synthetic-other"});'
                  'process.stdout.write(JSON.stringify(e));')
        child = subprocess.run(['node','-e',source],capture_output=True,text=True,timeout=5,check=True)
        env = json.loads(child.stdout)
        self.assertEqual(env['ACTIONS_RUNTIME_TOKEN'], 'synthetic')
        self.assertNotIn('GITHUB_TOKEN', env); self.assertNotIn('PRIVATE_SECRET', env)
        self.assertEqual(env.get('GITHUB_EVENT_NAME'), 'push')

    def test_node_forwards_termination_until_the_owned_worker_exits(self):
        wrapper=SCRIPTS.parents[1]/'.github/actions/get328-diagnostic/index.cjs'
        source=('const cp=require("node:child_process");const {EventEmitter}=require("node:events");'
            'const child=new EventEmitter();child.exitCode=null;child.killed=false;let signals=[];'
            'child.kill=s=>{signals.push(s);child.killed=true;return true};cp.spawn=()=>child;'
            'const w=require('+json.dumps(str(wrapper))+');w.main();process.emit("SIGINT");'
            'process.emit("SIGTERM");child.exitCode=0;child.emit("exit",0);'
            'process.emit("SIGTERM");process.stdout.write(JSON.stringify(signals));')
        env={'PATH':os.environ['PATH'],'RUNNER_TEMP':str(self.root),'GITHUB_WORKSPACE':str(self.root)}
        result=subprocess.run(['node','-e',source],env=env,capture_output=True,text=True,check=True,timeout=5)
        self.assertEqual(json.loads(result.stdout),['SIGINT','SIGTERM'])

    def test_bootstrap_canonical_manifest_is_accepted_without_clock_reset(self):
        from hosted_get328_diagnostic_core import Budget
        from hosted_get328_diagnostic_bootstrap import CONTROLLER_FILES
        workspace=self.root/'workspace';controller=workspace/'controller'
        root=self.root/'job';(root/'receipts').mkdir(parents=True)
        sha='a'*40;manifest=[];assets=[]
        for relative in CONTROLLER_FILES:
            target=controller/relative;target.parent.mkdir(parents=True,exist_ok=True)
            data=(SCRIPTS.parents[1]/relative).read_bytes();target.write_bytes(data)
            digest=hashlib.sha256(data).hexdigest()
            manifest.append({'scope':'controller','path':relative,'bytes':len(data),'sha256':digest})
            assets.append({'scope':'controller','path':relative,'url':'https://raw.githubusercontent.com/getyak/leafhour/'+sha+'/'+relative,
                'destination':str(target),'expected_bytes':len(data),'actual_bytes':len(data),
                'expected_sha256':digest,'actual_sha256':digest,'published':True})
        uploader=workspace/'uploader/dist/upload/index.js';uploader.parent.mkdir(parents=True)
        data=b'synthetic uploader; never executed';uploader.write_bytes(data);digest=hashlib.sha256(data).hexdigest()
        manifest.append({'scope':'uploader','path':'dist/upload/index.js','bytes':len(data),'sha256':digest})
        assets.append({'scope':'uploader','path':'dist/upload/index.js',
            'url':'https://raw.githubusercontent.com/actions/upload-artifact/ea165f8d65b6e75b540449e92b4886f43607fa02/dist/upload/index.js',
            'destination':str(uploader),'expected_bytes':len(data),'actual_bytes':len(data),
            'expected_sha256':digest,'actual_sha256':digest,'published':True})
        manifest_sha=hashlib.sha256(json.dumps(manifest,sort_keys=True,separators=(',',':')).encode()).hexdigest()
        proof={'complete':True,'controller_sha':sha,'source_manifest_sha256':manifest_sha,
               'manifest':manifest,'assets':assets}
        raw=(json.dumps(proof,sort_keys=True,separators=(',',':'))+'\n').encode()
        (root/'receipts/bootstrap-source.json').write_bytes(raw)
        ready={'ready':True,'run_id':'99','controller_sha':sha,'source_manifest_sha256':manifest_sha,
               'source_proof_sha256':hashlib.sha256(raw).hexdigest(),'controller_root':str(controller),
               'uploader_entry':str(uploader),'uploader_sha256':digest}
        (root/'receipts/bootstrap-ready.json').write_text(json.dumps(ready))
        (root/'start.json').write_text(json.dumps({'source_manifest_sha256':manifest_sha}))
        began=time.monotonic();budget=Budget({'schema_version':1,'started_monotonic':began,
            'work_deadline_monotonic':began+240,'deadline_monotonic':began+330,'initial_free_bytes':9*1024**3})
        with mock.patch.object(self.d,'__file__',str(controller/'scripts/ios/hosted_get328_diagnostic.py')), \
                mock.patch.object(self.d,'UPLOADER_SHA256',digest),mock.patch.object(self.d,'UPLOADER_BYTES',len(data)):
            try:
                result=self.d.validate_source_closure(root,uploader,
                    {'GITHUB_WORKSPACE':str(workspace),'GITHUB_RUN_ID':'99','GITHUB_SHA':sha},budget)
            except Exception as error:self.fail('generated source proof rejected: '+type(error).__name__)
            for changed in [{},{'source_manifest_sha256':'c'*64}]:
                (root/'start.json').write_text(json.dumps(changed))
                with self.assertRaises(ValueError):
                    self.d.validate_source_closure(root,uploader,
                        {'GITHUB_WORKSPACE':str(workspace),'GITHUB_RUN_ID':'99','GITHUB_SHA':sha},budget)
        self.assertEqual(result['run_id'],'99');self.assertEqual(budget.end,began+330)

    def api_runner(self, **overrides):
        from hosted_get328_diagnostic_core import Budget
        began = time.monotonic()
        budget = Budget({'schema_version':1,'started_monotonic':began,
                         'work_deadline_monotonic':began+240,'deadline_monotonic':began+330,
                         'initial_free_bytes':9*1024**3})
        root = self.root/'job';root.mkdir();(root/'receipts').mkdir();(root/'logs').mkdir()
        payload = {'url':self.d.admission.API_ROOT+'/actions/runs/99', 'status':200,
                   'link':None, 'body_complete':True,
                   'raw_body_base64':base64.b64encode(b'{"id":99}\n').decode()}
        payload.update(overrides)
        class SyntheticRunner:
            def __init__(self): self.root=root;self.budget=budget;self.calls=[]
            def run(self,*args,**kwargs):
                self.calls.append((args,kwargs));return 0,json.dumps(payload)
        return SyntheticRunner(),payload

    def test_api_raw_bytes_and_exact_requested_endpoint_are_recorded(self):
        self.assertTrue(callable(getattr(self.d,'fetch_api',None)), 'API evidence boundary is missing')
        runner,payload=self.api_runner()
        result=self.d.fetch_api(runner,payload['url'],'current-run',{})
        self.assertEqual(result,{'id':99})
        self.assertEqual((runner.root/'receipts/current-run.json').read_bytes(),
                         base64.b64decode(payload['raw_body_base64']))
        receipt=json.loads((runner.root/'receipts/current-run-http.json').read_text())
        self.assertEqual(receipt['requested_url'],payload['url'])
        self.assertTrue(receipt['complete'])
        self.assertFalse(runner.budget.stopped)

    def test_pagination_or_changed_endpoint_stops_admission_chain(self):
        self.assertTrue(callable(getattr(self.d,'fetch_api',None)), 'API evidence boundary is missing')
        for override in [{'link':'<https://api.github.com/next>; rel="next"'},
                         {'url':'https://example.test/elsewhere'}, {'body_complete':False},
                         {'status':403}]:
            with self.subTest(override=override):
                runner,payload=self.api_runner(**override)
                requested=self.d.admission.API_ROOT+'/actions/runs/99'
                with self.assertRaises((ValueError,self.d.DiagnosticError)):
                    self.d.fetch_api(runner,requested,'current-run',{})
                self.assertTrue(runner.budget.stopped)
                import shutil;shutil.rmtree(runner.root)

    def test_non_public_api_url_is_rejected_before_network(self):
        self.assertTrue(callable(getattr(self.d,'read_public_api',None)), 'API worker boundary is missing')
        with self.assertRaises((ValueError,self.d.DiagnosticError)):
            self.d.read_public_api('https://example.test/private')

    def test_hosted_entry_refuses_wrong_image_before_runner_or_files(self):
        self.assertTrue(callable(getattr(self.d,'run_hosted',None)), 'hosted entry is missing')
        with mock.patch.dict('os.environ',{'ImageVersion':'different'}), \
                mock.patch.object(self.d,'Runner',side_effect=AssertionError('no runner before image gate')):
            with self.assertRaises((ValueError,self.d.DiagnosticError)):
                self.d.run_hosted(self.root/'absent',self.root/'uploader',self.root/'node')

    def stamp_fixture(self):
        from hosted_get328_diagnostic_core import Budget
        began=time.monotonic()
        env={'GITHUB_REPOSITORY':'getyak/leafhour','GITHUB_RUN_ID':'99',
             'GITHUB_SHA':'a'*40,'GITHUB_REF':'refs/heads/codex/get-328-environment-once/'+'a'*40+'/'+'b'*32,
             'GITHUB_ACTOR':'kubbot','GITHUB_ACTOR_ID':'124379614',
             'ImageOS':'macos26','ImageVersion':'20260824.0517.1','RUNNER_ARCH':'X64'}
        start={'schema_version':1,'started_monotonic':began,'work_deadline_monotonic':began+240,
               'deadline_monotonic':began+330,'initial_free_bytes':9*1024**3,
               'repository':env['GITHUB_REPOSITORY'],'run_id':env['GITHUB_RUN_ID'],'run_attempt':1,
               'controller_sha':env['GITHUB_SHA'],'ref':env['GITHUB_REF'],
               'actor':{'login':'kubbot','id':'124379614'},
               'image':{k:env[k] for k in ['ImageOS','ImageVersion','RUNNER_ARCH']}}
        return start,Budget(start).snapshot(),env

    def test_first_stamp_is_bound_to_this_run_ref_and_unchanged_clock(self):
        self.assertTrue(callable(getattr(self.d,'validate_start',None)), 'stamp binding boundary is missing')
        start,snapshot,env=self.stamp_fixture()
        self.d.validate_start(start,snapshot,env)

    def test_cross_run_or_cancelled_bootstrap_cannot_open_new_work(self):
        self.assertTrue(callable(getattr(self.d,'validate_start',None)), 'stamp binding boundary is missing')
        for change in [{'run_id':'98'},{'ref':'refs/heads/elsewhere'},{'controller_sha':'c'*40},
                       {'run_attempt':True},{'image':{'ImageVersion':'different'}}]:
            with self.subTest(change=change):
                start,snapshot,env=self.stamp_fixture();start.update(change)
                with self.assertRaises((ValueError,self.d.DiagnosticError)):
                    self.d.validate_start(start,snapshot,env)
        start,snapshot,env=self.stamp_fixture();snapshot['stopped']=True;snapshot['stop_reason']='cancelled'
        with self.assertRaises((ValueError,self.d.DiagnosticError)):
            self.d.validate_start(start,snapshot,env)

    def final_runner(self, *, late=False):
        from hosted_get328_diagnostic_core import Budget
        source=self.evidence();began=time.monotonic()
        stamp={'schema_version':1,'started_monotonic':began,'work_deadline_monotonic':began+240,
               'deadline_monotonic':began+330,'initial_free_bytes':9*1024**3}
        (source/'start.json').write_text(json.dumps(stamp))
        budget=Budget(stamp);budget.begin_final()
        uploader=self.root/'uploader';uploader.write_bytes(b'synthetic uploader; never executed')
        node=self.root/'node';node.write_text('synthetic node; never executed');node.chmod(0o700)
        self.enterContext(mock.patch.object(self.d,'UPLOADER_BYTES',uploader.stat().st_size))
        self.enterContext(mock.patch.object(self.d,'UPLOADER_SHA256',hashlib.sha256(uploader.read_bytes()).hexdigest()))
        class SyntheticRunner:
            def __init__(runner):runner.root=source;runner.budget=budget;runner.calls=[]
            def run(runner,argv,name,seconds=20,**kwargs):
                runner.calls.append((name,kwargs))
                if name=='package':
                    result=self.d.package_bounded(Path(argv[argv.index('--source')+1]),
                        Path(argv[argv.index('--output')+1]),deadline=budget.final_end)
                    return 0,json.dumps(result)
                if name=='upload':
                    self.assertTrue(kwargs['final']);self.assertFalse(kwargs['capture'])
                    path=Path(kwargs['env']['GITHUB_OUTPUT'])
                    path.write_text('artifact-id=123\nartifact-digest='+'a'*64+
                        '\nartifact-url=https://github.com/getyak/leafhour/actions/runs/99/artifacts/123\n')
                    if late:raise self.d.DiagnosticError('command_deadline')
                    return 0,''
                raise AssertionError('unexpected synthetic final command')
        return SyntheticRunner()

    def test_finalizer_freezes_probe_bytes_and_uses_only_private_upload_output(self):
        self.assertTrue(callable(getattr(self.d,'finalize',None)), 'deadline-bound finalizer is missing')
        runner=self.final_runner()
        result=self.d.finalize(runner,runner.root,self.root/'uploader',self.root/'node',self.base_env())
        self.assertEqual(result['id'],123)
        self.assertEqual([name for name,_ in runner.calls],['package','upload'])
        upload=json.loads((runner.root/'receipts/upload.json').read_text())
        self.assertEqual(upload['status'],'reported-uploaded')
        manifest=json.loads((runner.root/'artifact/evidence.manifest.json').read_text())
        self.assertNotIn('uploader-output.txt',[e['path'] for e in manifest['entries']])
        self.assertEqual((runner.root/'snapshot/logs/probe.log').read_text(),'synthetic observation\n')
        self.assertLessEqual(runner.budget.final_end,runner.budget.end)

    def test_late_upload_with_valid_output_is_unknown_and_never_invoked_twice(self):
        self.assertTrue(callable(getattr(self.d,'finalize',None)), 'deadline-bound finalizer is missing')
        runner=self.final_runner(late=True)
        with self.assertRaises((ValueError,self.d.DiagnosticError)):
            self.d.finalize(runner,runner.root,self.root/'uploader',self.root/'node',self.base_env())
        upload=json.loads((runner.root/'receipts/upload.json').read_text())
        self.assertEqual(upload['status'],'unknown')
        self.assertNotIn('artifact',upload)
        with self.assertRaises((ValueError,self.d.DiagnosticError,FileExistsError)):
            self.d.finalize(runner,runner.root,self.root/'uploader',self.root/'node',self.base_env())
        self.assertEqual(sum(name=='upload' for name,_ in runner.calls),1)

    def test_secret_runtime_value_never_enters_snapshot_or_archive(self):
        self.assertTrue(callable(getattr(self.d,'finalize',None)), 'deadline-bound finalizer is missing')
        runner=self.final_runner();env=self.base_env()
        sentinel='synthetic-secret-must-stay-only-in-memory';env['ACTIONS_RUNTIME_TOKEN']=sentinel
        self.d.finalize(runner,runner.root,self.root/'uploader',self.root/'node',env)
        for file in runner.root.rglob('*'):
            if file.is_file():self.assertNotIn(sentinel.encode(),file.read_bytes(),str(file))


if __name__ == '__main__':
    unittest.main()
