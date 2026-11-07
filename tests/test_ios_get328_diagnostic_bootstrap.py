"""Synthetic bootstrap files and fake curl only; all real network/processes denied."""
from contextlib import ExitStack
import hashlib
import importlib
import json
import os
from pathlib import Path
import socket
import sys
import tempfile
import textwrap
import types
import unittest
from unittest import mock
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts/ios'))
try:
    bootstrap_module = importlib.import_module('hosted_get328_diagnostic_bootstrap')
except ModuleNotFoundError as error:
    if error.name != 'hosted_get328_diagnostic_bootstrap':
        raise
    bootstrap_module = None
try:
    renderer = importlib.import_module('render_get328_diagnostic_workflow')
except ModuleNotFoundError as error:
    if error.name != 'render_get328_diagnostic_workflow':
        raise
    renderer = None

SHA = 'a' * 40
NONCE = 'b' * 32
REF = 'refs/heads/codex/get-328-environment-once/' + SHA + '/' + NONCE
CONTROLLER_FILES = (
    'scripts/ios/hosted_get328_diagnostic_core.py',
    'scripts/ios/hosted_get328_diagnostic_admission.py',
    'scripts/ios/hosted_get328_diagnostic.py',
    'scripts/ios/hosted_get328_evidence.py',
    '.github/actions/get328-diagnostic/action.yml',
    '.github/actions/get328-diagnostic/index.cjs',
)


class Offline(unittest.TestCase):
    def setUp(self):
        self.stack = self.enterContext(ExitStack())
        for target in ((socket, 'socket'), (socket, 'create_connection'),
                       (urllib.request, 'urlopen'), (urllib.request.OpenerDirector, 'open')):
            self.stack.enter_context(mock.patch.object(*target, side_effect=AssertionError('network denied')))
        self.stack.enter_context(mock.patch('subprocess.Popen', side_effect=AssertionError('real process denied')))


class BootstrapTests(Offline):
    def setUp(self):
        super().setUp()
        self.assertIsNotNone(bootstrap_module, 'Exclusive shared-clock bootstrap is not implemented')
        self.base = Path(self.enterContext(tempfile.TemporaryDirectory(prefix='get328-bootstrap-unit-'))).resolve()
        self.temp = self.base / 'temp'; self.temp.mkdir()
        self.workspace = self.base / 'workspace'; self.workspace.mkdir()
        self.output = self.base / 'output'; self.output.write_text('')
        self.event = dict(repository=dict(full_name='getyak/leafhour', id=1415706040, private=False),
                          sender=dict(login='kubbot', id=124379614), created=True,
                          deleted=False, forced=False, ref=REF, after=SHA)
        self.event_file = self.base / 'event.json'; self.event_file.write_text(json.dumps(self.event))
        self.env = dict(GITHUB_REPOSITORY='getyak/leafhour', GITHUB_REPOSITORY_ID='1415706040',
            GITHUB_EVENT_NAME='push', GITHUB_JOB='diagnose', GITHUB_ACTOR='kubbot',
            GITHUB_ACTOR_ID='124379614', GITHUB_TRIGGERING_ACTOR='kubbot', GITHUB_RUN_ATTEMPT='1',
            GITHUB_RUN_ID='123', GITHUB_SHA=SHA, GITHUB_WORKFLOW_SHA=SHA, GITHUB_REF=REF,
            GITHUB_WORKFLOW_REF='getyak/leafhour/.github/workflows/get328-environment-once.yml@'+REF,
            GITHUB_EVENT_PATH=str(self.event_file), GITHUB_OUTPUT=str(self.output),
            GITHUB_WORKSPACE=str(self.workspace), RUNNER_TEMP=str(self.temp),
            GET328_GRANT_COMMENT_ID='6703465445', GET328_GRANT_ISSUER_ID='124379614',
            RUNNER_ENVIRONMENT='github-hosted', RUNNER_OS='macOS', RUNNER_ARCH='X64',
            ImageOS='macos26', ImageVersion='20260824.0517.1',
            DEVELOPER_DIR='/Applications/Xcode_26.6.app/Contents/Developer',
            ACTIONS_RUNTIME_TOKEN='synthetic-not-forwarded', GITHUB_TOKEN='synthetic-not-forwarded')
        self.clock = [100.0]
        self.calls = []
        self.failure = None
        self.payloads = {path: ('synthetic '+path).encode() for path in CONTROLLER_FILES}
        self.payloads['dist/upload/index.js'] = b'synthetic uploader, never executed'
        fake_uploader = self.payloads['dist/upload/index.js']
        self.stack.enter_context(mock.patch.object(bootstrap_module, 'UPLOADER_BYTES', len(fake_uploader)))
        self.stack.enter_context(mock.patch.object(bootstrap_module, 'UPLOADER_SHA256', hashlib.sha256(fake_uploader).hexdigest()))
        self.stack.enter_context(mock.patch.object(bootstrap_module.platform, 'system', return_value='Darwin'))
        self.stack.enter_context(mock.patch.object(bootstrap_module.platform, 'machine', return_value='x86_64'))
        self.stack.enter_context(mock.patch.object(bootstrap_module.shutil, 'disk_usage', return_value=type('Disk', (), {'free': 9*1024**3})()))
        outer = self
        class FakeRunner:
            def __init__(self, root, budget):
                self.root, self.budget = Path(root), budget
            def run(self, argv, name, seconds=20, **kwargs):
                self.budget.check()
                outer.calls.append((argv, name, seconds, kwargs))
                outer.assertEqual(argv[0], '/usr/bin/curl')
                outer.assertNotIn('--retry', argv)
                outer.assertNotIn('--location', argv)
                outer.assertEqual(seconds, 20)
                outer.assertFalse({'ACTIONS_RUNTIME_TOKEN', 'GITHUB_TOKEN'} & set(kwargs.get('env', {})))
                dest = Path(argv[argv.index('--output')+1])
                outer.assertTrue(dest.is_file() and not dest.is_symlink())
                url = argv[-1]
                path = next(p for p in outer.payloads if url.endswith('/'+p))
                dest.write_bytes(outer.payloads[path])
                outer.clock[0] += 1
                if outer.failure:
                    return outer.failure(dest, len(outer.calls))
                return 0, '200'
        self.runner = FakeRunner
        self.manifest = [dict(scope='controller', path=p, bytes=len(self.payloads[p]),
                          sha256=hashlib.sha256(self.payloads[p]).hexdigest()) for p in CONTROLLER_FILES]
        self.manifest.append(dict(scope='uploader', path='dist/upload/index.js', bytes=len(fake_uploader),
                                  sha256=hashlib.sha256(fake_uploader).hexdigest()))

    def invoke(self):
        return bootstrap_module.bootstrap(self.manifest, environ=self.env,
                    clock=lambda: self.clock[0], runner_factory=self.runner)

    def test_valid_source_closure_publishes_ready_after_original_stamp(self):
        proof = self.invoke()
        root = self.temp / 'get328-environment'
        stamp = json.loads((root/'start.json').read_text())
        self.assertEqual((stamp['started_monotonic'], stamp['work_deadline_monotonic'], stamp['deadline_monotonic']), (100,340,430))
        self.assertEqual(stamp['controller_sha'], SHA)
        self.assertEqual(len(self.calls), 7)
        self.assertTrue(proof['ready'])
        self.assertIn('ready=true\n', self.output.read_text())
        for p in CONTROLLER_FILES:
            self.assertEqual((self.workspace/'controller'/p).read_bytes(), self.payloads[p])
        self.assertEqual((self.workspace/'uploader/dist/upload/index.js').read_bytes(), self.payloads['dist/upload/index.js'])
        source = json.loads((root/'receipts/bootstrap-source.json').read_text())
        self.assertTrue(source['complete'])
        self.assertEqual(len(source['assets']),7)
        self.assertFalse(any(p.suffix in ('.py','.cjs') for p in root.rglob('*')))

    def test_wrong_image_or_event_stamps_then_stops_without_fetch(self):
        self.env['ImageVersion'] = 'unapproved'
        with self.assertRaises(bootstrap_module.DiagnosticError): self.invoke()
        self.assertEqual(self.calls, [])
        self.assertTrue((self.temp/'get328-environment/start.json').is_file())
        self.assertNotIn('ready=true', self.output.read_text())

    def test_ref_actor_private_or_attempt_substitution_never_downloads(self):
        cases=[('GITHUB_REF','refs/heads/main'),('GITHUB_ACTOR_ID','2'),('GITHUB_RUN_ATTEMPT','2'),
               ('GITHUB_WORKFLOW_SHA','c'*40),('DEVELOPER_DIR','/unapproved')]
        for key,value in cases:
            with self.subTest(key=key):
                original=self.env[key]; self.env[key]=value
                with self.assertRaises(bootstrap_module.DiagnosticError): self.invoke()
                self.assertEqual(self.calls, [])
                self.env[key]=original
                # Each subcase gets a separate exclusive root, never reuses one.
                self.temp=self.base/key; self.temp.mkdir(); self.env['RUNNER_TEMP']=str(self.temp)

    def test_stamp_collision_is_never_reused_or_modified(self):
        root=self.temp/'get328-environment'; root.mkdir(); (root/'keep').write_bytes(b'protected')
        with self.assertRaises(bootstrap_module.DiagnosticError): self.invoke()
        self.assertEqual((root/'keep').read_bytes(),b'protected')
        self.assertEqual(list(root.iterdir()),[root/'keep'])
        self.assertEqual(self.calls,[])

    def test_unknown_http_stops_before_second_asset_and_never_sets_ready(self):
        self.failure=lambda dest,count:(0,'404')
        with self.assertRaises(bootstrap_module.DiagnosticError): self.invoke()
        self.assertEqual(len(self.calls),1)
        self.assertFalse((self.temp/'get328-environment/receipts/bootstrap-ready.json').exists())
        self.assertNotIn('ready=true',self.output.read_text())
        proof=json.loads((self.temp/'get328-environment/receipts/bootstrap-source.json').read_text())
        self.assertEqual(len(proof['assets']),1)
        attempt=proof['assets'][0]
        self.assertEqual(attempt['expected_bytes'],len(self.payloads[CONTROLLER_FILES[0]]))
        self.assertEqual(attempt['url'],'https://raw.githubusercontent.com/getyak/leafhour/'+SHA+'/'+CONTROLLER_FILES[0])
        self.assertIsNone(attempt['actual_sha256'])
        self.assertFalse(attempt['published'])

    def test_wrong_hash_and_late_result_are_not_published(self):
        def fail(dest,count):
            dest.write_bytes(b'wrong bytes')
            return 0,'200'
        self.failure=fail
        with self.assertRaises(bootstrap_module.DiagnosticError): self.invoke()
        self.assertEqual(len(self.calls),1)
        self.assertFalse((self.workspace/'controller'/CONTROLLER_FILES[0]).exists())

    def test_original_work_deadline_is_checked_after_fetch(self):
        def late(dest,count):
            self.clock[0]=341
            return 0,'200'
        self.failure=late
        with self.assertRaises(bootstrap_module.DiagnosticError): self.invoke()
        self.assertEqual(len(self.calls),1)
        self.assertNotIn('ready=true',self.output.read_text())

    def test_manifest_escape_missing_extra_or_duplicate_is_rejected(self):
        self.manifest[0]['path']='../outside.py'
        with self.assertRaises(bootstrap_module.DiagnosticError): self.invoke()
        self.assertEqual(self.calls,[])
        self.assertFalse((self.workspace/'outside.py').exists())

    def test_foreign_workspace_target_or_symlink_is_never_overwritten(self):
        foreign=self.base/'foreign'; foreign.mkdir(); (foreign/'keep').write_bytes(b'private')
        (self.workspace/'controller').symlink_to(foreign,target_is_directory=True)
        with self.assertRaises(bootstrap_module.DiagnosticError): self.invoke()
        self.assertEqual(self.calls,[])
        self.assertEqual((foreign/'keep').read_bytes(),b'private')

    def test_output_symlink_does_not_append_to_a_foreign_file(self):
        protected=self.base/'protected'; protected.write_text('keep')
        self.output.unlink(); self.output.symlink_to(protected)
        with self.assertRaises(bootstrap_module.DiagnosticError): self.invoke()
        self.assertEqual(protected.read_text(),'keep')

    def test_replaced_download_symlink_is_unknown_without_reading_its_target(self):
        protected=self.base/'protected'; protected.write_text('keep')
        def replace(dest,count):
            dest.unlink(); dest.symlink_to(protected)
            return 0,'200'
        self.failure=replace
        with self.assertRaises(bootstrap_module.DiagnosticError): self.invoke()
        self.assertEqual(len(self.calls),1)
        self.assertEqual(protected.read_text(),'keep')
        self.assertNotIn('ready=true',self.output.read_text())

    def test_generated_real_inline_code_stamps_then_rejects_bad_identity_without_process(self):
        self.assertIsNotNone(renderer)
        source_tree=self.base/'render-source'; source_tree.mkdir()
        for p in CONTROLLER_FILES:
            target=source_tree/p; target.parent.mkdir(parents=True,exist_ok=True)
            target.write_bytes((ROOT/p).read_bytes() if p.endswith('_core.py') else self.payloads[p])
        path='scripts/ios/hosted_get328_diagnostic_bootstrap.py'
        (source_tree/path).write_bytes((ROOT/path).read_bytes())
        workflow=renderer.render_workflow(source_tree)
        inline=textwrap.dedent(workflow.split("python3 -B - <<'PY'\n",1)[1].split('          PY\n',1)[0])
        module=types.ModuleType('__main__')
        env={**self.env,'ImageVersion':'wrong'}
        with mock.patch.dict(os.environ,env,clear=True), mock.patch.dict(sys.modules,{'__main__':module}), \
                mock.patch.object(bootstrap_module.time,'monotonic',return_value=100):
            with self.assertRaises(RuntimeError) as blocked:
                exec(compile(inline,'<generated reviewed inline>','exec'),module.__dict__)
        self.assertIsInstance(blocked.exception,module.DiagnosticError)
        self.assertEqual(self.calls,[])
        self.assertTrue((self.temp/'get328-environment/start.json').is_file())


class RenderTests(Offline):
    def setUp(self):
        super().setUp()
        self.assertIsNotNone(renderer,'Verbatim source workflow generator is not implemented')
        self.base=Path(self.enterContext(tempfile.TemporaryDirectory(prefix='get328-render-unit-'))).resolve()
        for p in CONTROLLER_FILES:
            path=self.base/p; path.parent.mkdir(parents=True,exist_ok=True)
            path.write_text('# synthetic '+p+'\n')
        (self.base/'scripts/ios/hosted_get328_diagnostic_bootstrap.py').write_text('# synthetic bootstrap\n')

    def test_generated_action_uses_literal_sources_no_checkout_post_or_hidden_exec(self):
        text=renderer.render_workflow(self.base)
        # The generated artifact must preserve the executable inline source,
        # because drift would execute a different bootstrap from the reviewed file.
        for label,path in [('CORE','scripts/ios/hosted_get328_diagnostic_core.py'),
                           ('BOOTSTRAP','scripts/ios/hosted_get328_diagnostic_bootstrap.py')]:
            block=text.split('# BEGIN '+label+' SOURCE\n',1)[1].split('# END '+label+' SOURCE',1)[0]
            self.assertEqual(textwrap.dedent(block),(self.base/path).read_text())
        self.assertIn("sys.modules['hosted_get328_diagnostic_core'] = sys.modules['__main__']",text)
        self.assertNotIn('actions/checkout',text)
        self.assertNotIn('actions/upload-artifact@',text)
        self.assertNotIn('base64',text)
        self.assertNotIn('exec(',text)
        self.assertIn('uses: ./controller/.github/actions/get328-diagnostic',text)
        self.assertIn("steps.bootstrap.outputs.ready == 'true'",text)

    def test_literal_asset_manifest_binds_six_controller_files_and_fixed_uploader(self):
        manifest=renderer.asset_manifest(self.base)
        self.assertEqual([e['path'] for e in manifest[:-1]],list(CONTROLLER_FILES))
        self.assertEqual(manifest[-1],dict(scope='uploader',path='dist/upload/index.js',bytes=5051718,
            sha256='0165b8a75330f3228f2c7a234b4ff8a107b9139c2b519147f4c8e9fe99b262d8'))
        for entry in manifest[:-1]:
            raw=(self.base/entry['path']).read_bytes()
            self.assertEqual(entry['bytes'],len(raw))
            self.assertEqual(entry['sha256'],hashlib.sha256(raw).hexdigest())

    def test_blank_source_lines_do_not_emit_trailing_workflow_whitespace(self):
        (self.base/'scripts/ios/hosted_get328_diagnostic_core.py').write_text('# synthetic core\n\n')
        workflow=renderer.render_workflow(self.base)
        self.assertTrue(all(line==line.rstrip(' \t') for line in workflow.splitlines()),
                        'Generated source blank lines must pass git whitespace validation')

    def test_checked_in_workflow_is_byte_exact_with_the_actual_source_files(self):
        path=ROOT/'.github/workflows/get328-environment-once.yml'
        self.assertTrue(path.is_file(),'Final literal workflow has not been rendered')
        actual=path.read_text()
        self.assertEqual(path.read_bytes(),renderer.render_workflow(ROOT).encode('utf-8'))
        for label,source in [('CORE','scripts/ios/hosted_get328_diagnostic_core.py'),
                             ('BOOTSTRAP','scripts/ios/hosted_get328_diagnostic_bootstrap.py')]:
            block=actual.split('# BEGIN '+label+' SOURCE\n',1)[1].split('# END '+label+' SOURCE',1)[0]
            self.assertEqual(textwrap.dedent(block).encode('utf-8'),(ROOT/source).read_bytes())


if __name__=='__main__': unittest.main()
