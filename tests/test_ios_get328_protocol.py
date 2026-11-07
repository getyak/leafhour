"""Offline protocol and owned-process checks; no native session is acquired.

Host integration starts only two synthetic Python children owned by this test.
Identity queries are restricted to the supervised child's PID. Session, device,
SDK, disk-capacity, compiler, and live-execution boundaries are never invoked.
"""

from contextlib import ExitStack, redirect_stderr, redirect_stdout
from dataclasses import asdict
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import signal
import stat
import subprocess
import sys
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / 'scripts/ios/get328_build_only.py'
EXPECTED_HEAD = '1' * 40
UDID = '11111111-2222-3333-4444-555555555555'
OTHER_UDID = 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE'


def load_controller():
    if 'get328_build_only' in sys.modules:
        return sys.modules['get328_build_only']
    sys.path.insert(0, str(MODULE_PATH.parent))
    spec = importlib.util.spec_from_file_location('get328_build_only', MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


class ProtocolTestCase(unittest.TestCase):
    def setUp(self):
        self.controller = load_controller()
        self.directory = tempfile.TemporaryDirectory(prefix='leafhour-get328-protocol-')
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name).resolve()
        self.outer = self.controller.Identity(
            pid=4000, ppid=3000, pgid=4000, birth='synthetic-outer-start')

    def make_request(self):
        evidence, products = self.path / 'evidence', self.path / 'products'
        evidence.mkdir()
        products.mkdir()
        return self.controller.Request(EXPECTED_HEAD, UDID, evidence, products)


class PlanProtocolTests(ProtocolTestCase):
    def test_default_and_explicit_plan_never_probe_or_create_run_state(self):
        state_root = self.path / 'state-must-not-exist'
        for arguments in ([], ['--plan']):
            with self.subTest(arguments=arguments):
                output = io.StringIO()
                with patch.object(self.controller, 'STATE_ROOT', state_root), \
                     patch.object(self.controller, 'command_output',
                                  side_effect=AssertionError('Plan performed a host probe')), \
                     patch.object(self.controller, 'execute_live',
                                  side_effect=AssertionError('Plan entered native execution')), \
                     patch.object(self.controller, 'worker',
                                  side_effect=AssertionError('Plan entered a worker')), \
                     patch.object(self.controller.subprocess, 'Popen',
                                  side_effect=AssertionError('Plan spawned a process')), \
                     redirect_stdout(output):
                    code = self.controller.main(arguments)
                plan = json.loads(output.getvalue())
                self.assertEqual(code, 0)
                self.assertEqual(plan['mode'], 'offline-plan')
                self.assertIs(plan['native_execution'], False)
                self.assertEqual(plan['budget']['seconds'], 1200)
                self.assertEqual(plan['budget']['max_new_bytes'], 3 * 1024 ** 3)
                self.assertEqual(plan['budget']['min_free_bytes'], 11274289152)
                self.assertFalse(state_root.exists())

    def test_cli_cannot_lower_the_native_policy_with_test_budget_arguments(self):
        with patch.object(self.controller, 'execute_live',
                          side_effect=AssertionError('Invalid CLI reached execution')), \
             redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as result:
            self.controller.main(['--execute', '--seconds', '0.1'])
        self.assertEqual(result.exception.code, 2)


class InheritedRoleTests(ProtocolTestCase):
    def role(self, environment):
        function = getattr(self.controller, 'inherited_role', None)
        self.assertTrue(callable(function), 'Inherited-role validation is not implemented')
        original = dict(environment)
        try:
            return function(environment)
        finally:
            self.assertEqual(environment, original, 'Role detection changed inherited context')

    def test_unset_empty_false_and_zero_guard_values_without_identity_are_standalone(self):
        for environment in ({}, {'IOS_AUTOMATION_LOCK_HELD': ''},
                            {'IOS_AUTOMATION_LOCK_HELD': 'false'},
                            {'IOS_AUTOMATION_LOCK_HELD': '0'}):
            with self.subTest(environment=environment):
                self.assertIs(self.role(environment), False)

    def test_exact_true_guard_with_a_valid_pid_and_session_id_is_inherited(self):
        environment = {'IOS_AUTOMATION_LOCK_HELD': 'true',
                       'DEV_IOS_SESSION_PID': '4000',
                       'DEV_IOS_SESSION_ID': 'synthetic-inherited-session'}
        self.assertIs(self.role(environment), True)

    def test_any_incomplete_or_invalid_claim_is_refused_without_scrubbing(self):
        claims = (
            {'IOS_AUTOMATION_LOCK_HELD': 'true'},
            {'IOS_AUTOMATION_LOCK_HELD': 'true', 'DEV_IOS_SESSION_PID': '4000'},
            {'IOS_AUTOMATION_LOCK_HELD': 'true', 'DEV_IOS_SESSION_ID': 'fixture'},
            {'DEV_IOS_SESSION_PID': '4000'},
            {'DEV_IOS_SESSION_ID': 'fixture'},
            {'DEV_IOS_SESSION_PID': '4000', 'DEV_IOS_SESSION_ID': 'fixture'},
            {'IOS_AUTOMATION_LOCK_HELD': 'false', 'DEV_IOS_SESSION_PID': '4000',
             'DEV_IOS_SESSION_ID': 'fixture'},
            {'IOS_AUTOMATION_LOCK_HELD': 'true', 'DEV_IOS_SESSION_PID': '0',
             'DEV_IOS_SESSION_ID': 'fixture'},
            {'IOS_AUTOMATION_LOCK_HELD': 'true', 'DEV_IOS_SESSION_PID': '1',
             'DEV_IOS_SESSION_ID': 'fixture'},
            {'IOS_AUTOMATION_LOCK_HELD': 'true', 'DEV_IOS_SESSION_PID': '-1',
             'DEV_IOS_SESSION_ID': 'fixture'},
            {'IOS_AUTOMATION_LOCK_HELD': 'true', 'DEV_IOS_SESSION_PID': 'not-a-pid',
             'DEV_IOS_SESSION_ID': 'fixture'},
        )
        for environment in claims:
            with self.subTest(environment=environment), self.assertRaises(RuntimeError):
                self.role(environment)


class SDKSelectionTests(ProtocolTestCase):
    def setUp(self):
        super().setUp()
        self.request = self.make_request()
        self.developer = Path('/Applications/ProtocolFixtureXcode.app/Contents/Developer')
        self.active_developer = self.developer
        self.sdk = self.developer / 'Platforms/iPhoneSimulator.platform/Developer/SDKs/iPhoneSimulator.sdk'
        self.tools = {name: self.developer / 'usr/bin' / name for name in ('xcodebuild', 'swiftc')}
        self.ops = self.controller.RealOps({'developer_dir': str(self.developer)}, self.request)
        self.commands = []

    def command_output(self, command, timeout=5, allowed=(0,)):
        self.assertGreater(timeout, 0)
        self.assertLessEqual(timeout, 5, 'SDK selection must be bounded')
        self.commands.append(tuple(str(arg) for arg in command))
        if Path(command[0]).name == 'xcode-select' and command[1:] == ['-p']:
            output = str(self.active_developer)
        elif command == ['/usr/bin/xcrun', '--sdk', 'iphonesimulator', '--show-sdk-path']:
            output = str(self.sdk)
        elif command[:2] == ['/usr/bin/xcrun', '--find'] and command[2] in self.tools:
            output = str(self.tools[command[2]])
        elif command == ['/usr/bin/xcrun', '--sdk', 'iphonesimulator', '--show-sdk-version']:
            output = '26.0'
        elif command == [str(self.tools['xcodebuild']), '-version']:
            output = 'Xcode Synthetic\nBuild version SYNTHETIC'
        else:
            raise AssertionError('Unexpected SDK boundary command: ' + repr(command))
        return SimpleNamespace(stdout=output + '\n', stderr='', returncode=0)

    def tool_digest(self, path):
        for name, expected in self.tools.items():
            if Path(path) == expected:
                return 'synthetic-hash-' + name
        raise AssertionError('SDK check tried to read an unowned path: ' + str(path))

    def snapshot(self, environment):
        with patch.dict(os.environ, environment, clear=True), \
             patch.object(self.controller, 'command_output', side_effect=self.command_output), \
             patch.object(self.controller, 'digest', side_effect=self.tool_digest):
            return self.ops.sdk_snapshot()

    def test_exact_inherited_developer_selection_is_preserved(self):
        snapshot = self.snapshot({'DEVELOPER_DIR': str(self.developer)})
        self.assertEqual(snapshot['developer_dir'], str(self.developer))
        self.assertEqual(snapshot['sdk_path'], str(self.sdk))
        self.assertFalse(any(Path(command[0]).name == 'xcode-select'
                             for command in self.commands))

    def test_without_an_override_the_active_selection_is_checked_with_a_bound(self):
        snapshot = self.snapshot({})
        self.assertEqual(snapshot['developer_dir'], str(self.developer))
        self.assertTrue(any(Path(command[0]).name == 'xcode-select' and command[1:] == ('-p',)
                            for command in self.commands))

    def test_active_selection_mismatch_is_refused_when_environment_is_unset(self):
        self.active_developer = Path('/Applications/OtherProtocolXcode.app/Contents/Developer')
        with self.assertRaises(RuntimeError):
            self.snapshot({})

    def test_broad_ancestor_directories_cannot_be_admitted_as_the_developer_root(self):
        for broad in ('/', '/Applications', str(self.developer.parent)):
            with self.subTest(developer_dir=broad), self.assertRaises(RuntimeError):
                self.ops.config['developer_dir'] = broad
                self.snapshot({})


class SessionProtocolTests(ProtocolTestCase):
    def setUp(self):
        super().setUp()
        self.request = self.make_request()
        self.session_tool = self.path / 'fake-session-tool'
        self.session_tool.write_bytes(b'Synthetic admitted session protocol.\n')
        self.config = {'outer_identity': asdict(self.outer), 'inherited': True,
                       'session_tool_hash': sha256(self.session_tool)}
        self.ops = self.controller.RealOps(self.config, self.request)
        self.environment = {'DEV_IOS_PROFILE': 'primary', 'IOS_SIMULATOR_ID': UDID,
                            'DEV_IOS_SESSION_ID': 'inherited-fixture-session'}
        self.fence = {'udid': UDID, 'session_id': 'inherited-fixture-session',
                      'owner_pid': 5000, 'lock_inode': 100,
                      'metadata_hash': 'synthetic-metadata-hash'}

    def verify(self, *, owner='true\n', fence=None, is_ancestor=True,
               identity=None, udid=UDID, environment=None):
        environment = environment or self.environment
        with patch.dict(os.environ, environment), \
             patch.object(self.controller, 'SESSION', self.session_tool), \
             patch.object(self.controller, 'command_output',
                          return_value=SimpleNamespace(stdout=owner, returncode=0)), \
             patch.object(self.controller, 'session_fence',
                          return_value=self.fence if fence is None else fence), \
             patch.object(self.controller, 'ancestor', return_value=is_ancestor), \
             patch.object(self.controller, 'process_identity',
                          return_value=self.outer if identity is None else identity):
            try:
                return self.ops.verify_session(udid)
            finally:
                self.assertEqual({key: os.environ.get(key) for key in environment},
                                 environment)

    def test_copied_session_environment_does_not_replace_real_owner_proof(self):
        with self.assertRaises(RuntimeError):
            self.verify(owner='false\n')

    def test_stale_session_id_is_refused_even_when_owner_probe_succeeds(self):
        with self.assertRaises(RuntimeError):
            self.verify(fence={**self.fence, 'session_id': 'successor-session'})

    def test_a_different_selected_device_is_refused_before_host_probes(self):
        with patch.dict(os.environ, self.environment), \
             patch.object(self.controller, 'SESSION', self.session_tool), \
             patch.object(self.controller, 'command_output',
                          side_effect=AssertionError('Wrong device reached owner probe')), \
             self.assertRaises(RuntimeError):
            self.ops.verify_session(OTHER_UDID)

    def test_matching_copied_selection_cannot_rebind_the_pinned_request_device(self):
        different_environment = {**self.environment, 'IOS_SIMULATOR_ID': OTHER_UDID}
        with self.assertRaises(RuntimeError):
            self.verify(udid=OTHER_UDID, environment=different_environment,
                        fence={**self.fence, 'udid': OTHER_UDID})

    def test_changed_live_session_tool_is_refused_before_executing_new_bytes(self):
        self.session_tool.write_bytes(b'Replaced unadmitted session protocol.\n')
        with patch.dict(os.environ, self.environment), \
             patch.object(self.controller, 'SESSION', self.session_tool), \
             patch.object(self.controller, 'command_output',
                          side_effect=AssertionError('Unadmitted helper bytes were executed')), \
             self.assertRaises(RuntimeError):
            self.ops.verify_session(UDID)

    def test_outer_process_must_remain_the_exact_live_ancestor(self):
        reused = self.controller.Identity(pid=4000, ppid=3000, pgid=4000,
                                          birth='reused-outer-pid')
        for arguments in ({'is_ancestor': False}, {'identity': reused}):
            with self.subTest(arguments=arguments), self.assertRaises(RuntimeError):
                self.verify(**arguments)

    def test_exact_owner_fence_and_ancestor_allow_a_read_only_context(self):
        context = self.verify()
        self.assertIs(context['valid'], True)
        self.assertEqual(context['udid'], UDID)
        self.assertEqual(context['session_id'], 'inherited-fixture-session')
        self.assertIs(context['inherited'], True)


class ConfigProtocolTests(ProtocolTestCase):
    def setUp(self):
        super().setUp()
        self.evidence_directory = tempfile.TemporaryDirectory(
            prefix='ai-test-GET-328-build-only-evidence.', dir=self.path)
        self.products_directory = tempfile.TemporaryDirectory(
            prefix='ai-test-GET-328-build-only-products.', dir=self.path)
        self.addCleanup(self.evidence_directory.cleanup)
        self.addCleanup(self.products_directory.cleanup)
        self.evidence = Path(self.evidence_directory.name)
        self.products = Path(self.products_directory.name)
        self.state_root = self.path / 'isolated-state'
        self.state_root.mkdir()
        self.session_tool = self.path / 'fake-session-tool'
        self.session_tool.write_bytes(b'Synthetic protocol bytes; never executable.\n')
        self.session_tool.chmod(0o600)
        self.config = {
            'attempt_id': 'fixture-attempt-1', 'expected_head': EXPECTED_HEAD,
            'udid': UDID, 'evidence': str(self.evidence), 'products': str(self.products),
            'developer_dir': '/synthetic/Xcode.app/Contents/Developer',
            'outer_identity': asdict(self.outer), 'inherited': False,
            'session_tool_hash': sha256(self.session_tool),
            'controller_hashes': {
                name: sha256(MODULE_PATH.parent / name)
                for name in ('get328_build_only.py', 'build_only_budget.py')},
        }
        self.config_path = self.evidence / 'run-config.json'
        self.save_config()

    def save_config(self):
        self.config_path.write_text(json.dumps(self.config, sort_keys=True))
        self.config_path.chmod(0o600)
        self.config_hash = sha256(self.config_path)
        self.ledger = {'status': 'running', 'attempt_id': 'fixture-attempt-1',
                       'controller_pid': self.outer.pid, 'config_digest': self.config_hash}
        (self.state_root / 'ledger.json').write_text(json.dumps(self.ledger))

    def validate(self, *, config_hash=None, is_ancestor=True, identity=None):
        with patch.object(self.controller, 'STATE_ROOT', self.state_root), \
             patch.object(self.controller, 'ARTIFACT_PARENT', self.path), \
             patch.object(self.controller, 'SESSION', self.session_tool), \
             patch.object(self.controller, 'ancestor', return_value=is_ancestor), \
             patch.object(self.controller, 'process_identity',
                          return_value=self.outer if identity is None else identity), \
             patch.object(self.controller, 'command_output',
                          side_effect=AssertionError('Config validation probed the host')), \
             patch.object(self.controller, 'OwnedBuild',
                          side_effect=AssertionError('Config validation spawned a build')):
            return self.controller.validate_config(
                self.config_path, self.config_hash if config_hash is None else config_hash)

    def assert_unclaimed(self):
        self.assertFalse((self.evidence / 'worker.started').exists())

    def test_exact_config_is_claimed_once_and_cannot_be_replayed(self):
        config, request = self.validate()
        self.assertEqual(config, self.config)
        self.assertEqual(request.expected_head, EXPECTED_HEAD)
        self.assertEqual(request.udid, UDID)
        self.assertEqual(request.evidence, self.evidence)
        self.assertEqual(request.products, self.products)
        claim = self.evidence / 'worker.started'
        self.assertEqual(claim.read_text(), self.config_hash + '\n')
        self.assertEqual(stat.S_IMODE(claim.stat().st_mode), 0o600)
        saved_claim = claim.read_bytes()
        with self.assertRaises((RuntimeError, FileExistsError)):
            self.validate()
        self.assertEqual(claim.read_bytes(), saved_claim)

    def test_modified_config_bytes_are_refused_before_claim(self):
        original_hash = self.config_hash
        self.config_path.write_text(self.config_path.read_text() + '\n')
        with self.assertRaises(RuntimeError):
            self.validate(config_hash=original_hash)
        self.assert_unclaimed()

    def test_running_ledger_must_match_attempt_owner_and_config_digest(self):
        for changes in ({'attempt_id': 'different-attempt'}, {'controller_pid': 5001},
                        {'config_digest': '0' * 64}, {'status': 'ready'}):
            with self.subTest(changes=changes):
                ledger = {**self.ledger, **changes}
                (self.state_root / 'ledger.json').write_text(json.dumps(ledger))
                with self.assertRaises(RuntimeError):
                    self.validate()
                self.assert_unclaimed()

    def test_outer_ancestry_and_birth_are_checked_before_claim(self):
        reused = self.controller.Identity(pid=4000, ppid=3000, pgid=4000,
                                          birth='replacement-outer-start')
        for arguments in ({'is_ancestor': False}, {'identity': reused}):
            with self.subTest(arguments=arguments), self.assertRaises(RuntimeError):
                self.validate(**arguments)
            self.assert_unclaimed()

    def test_changed_controller_bytes_are_not_admitted_by_a_fresh_config_hash(self):
        self.config['controller_hashes']['get328_build_only.py'] = '0' * 64
        self.save_config()
        with self.assertRaises(RuntimeError):
            self.validate()
        self.assert_unclaimed()

    def test_changed_session_protocol_bytes_are_refused_before_claim(self):
        self.session_tool.write_bytes(b'Different synthetic session protocol.\n')
        with self.assertRaises(RuntimeError):
            self.validate()
        self.assert_unclaimed()

    def test_config_cannot_redirect_products_to_an_unrelated_directory(self):
        self.config['products'] = str(self.path / 'unrelated-products')
        self.save_config()
        with self.assertRaises(RuntimeError):
            self.validate()
        self.assert_unclaimed()

    def test_config_symlink_is_refused_without_consuming_the_claim(self):
        original = self.evidence / 'original-config.json'
        self.config_path.rename(original)
        self.config_path.symlink_to(original)
        with self.assertRaises(RuntimeError):
            self.validate()
        self.assert_unclaimed()


class RegisteredArtifactTests(ProtocolTestCase):
    def register(self, root):
        with patch.object(self.controller, 'ARTIFACT_PARENT', self.path), \
             patch.object(self.controller, 'command_output',
                          return_value=SimpleNamespace(stdout=str(root) + '\n')):
            return self.controller.registered_root('GET-328-build-only-evidence')

    def test_registration_uses_the_same_exact_artifact_parent_as_config_validation(self):
        root = self.path / 'ai-test-GET-328-build-only-evidence.fixture'
        root.mkdir()
        self.assertEqual(self.register(root), root)

    def test_registration_refuses_a_different_parent_even_with_the_right_name(self):
        directory = tempfile.TemporaryDirectory(prefix='leafhour-get328-unrelated-')
        self.addCleanup(directory.cleanup)
        root = Path(directory.name).resolve() / 'ai-test-GET-328-build-only-evidence.fixture'
        root.mkdir()
        with self.assertRaises(RuntimeError):
            self.register(root)

    def test_registration_refuses_nonempty_or_symlinked_roots(self):
        root = self.path / 'ai-test-GET-328-build-only-evidence.fixture'
        root.mkdir()
        sentinel = root / 'preserve.txt'
        sentinel.write_text('existing evidence')
        with self.assertRaises(RuntimeError):
            self.register(root)
        sentinel.unlink()
        target = self.path / 'preserved-original'
        root.rename(target)
        root.symlink_to(target, target_is_directory=True)
        with self.assertRaises(RuntimeError):
            self.register(root)
        self.assertTrue(target.is_dir())


class NoSessionLatchTests(ProtocolTestCase):
    def setUp(self):
        super().setUp()
        self.request = self.make_request()
        self.counter = 0
        self.report = {'status': 'failed', 'returncode': 75,
                       'admission_refused': True, 'no_session_started': True,
                       'build_started': False, 'build_exit_code': None,
                       'next_attempt_allowed': True, 'errors': []}

    def finish(self, report=None, *, roots_clear=True, source_unchanged=True):
        self.counter += 1
        ledger_path = self.path / ('ledger-' + str(self.counter) + '.json')
        with self.controller.RunLatch(ledger_path) as latch:
            latch.begin('attempt-' + str(self.counter),
                        self.request.evidence, self.request.products)
            ledger = latch.finish_without_session(
                self.report if report is None else report, roots_clear, source_unchanged)
        self.assertEqual(json.loads(ledger_path.read_text()), ledger)
        return ledger

    def test_only_a_known_no_session_refusal_with_conclusive_readbacks_is_ready(self):
        ledger = self.finish()
        self.assertEqual(ledger['status'], 'ready')
        self.assertIs(ledger['session_started'], False)
        self.assertNotIn('restoration', ledger['result'])
        self.assertNotIn('session_context', ledger['result'])

    def test_false_zero_and_unknown_readbacks_never_unlock_another_attempt(self):
        for field in ('roots_clear', 'source_unchanged'):
            for value in (False, 0, None):
                with self.subTest(field=field, value=value):
                    ledger = self.finish(**{field: value})
                    self.assertEqual(ledger['status'], 'blocked')

    def test_incomplete_refusal_or_fabricated_native_evidence_is_blocked(self):
        changes = (
            {'no_session_started': False}, {'no_session_started': 1},
            {'build_started': True}, {'build_started': 0},
            {'build_exit_code': 0}, {'build': {'leader_exited': True}},
            {'admission_refused': False}, {'status': 'blocked'}, {'returncode': 70},
            {'next_attempt_allowed': False}, {'errors': ['unknown observation']},
            {'received_signal': signal.SIGTERM},
            {'entry': 'Booted'},
            {'restoration': {'entry': 'Shutdown', 'final': 'Shutdown', 'ok': True}},
            {'session_context': {'valid': True, 'udid': UDID}},
        )
        for change in changes:
            with self.subTest(change=change):
                ledger = self.finish({**self.report, **change})
                self.assertEqual(ledger['status'], 'blocked')


class OuterAdmissionRefusalTests(ProtocolTestCase):
    def setUp(self):
        super().setUp()
        self.generated_roots = []
        self.session_tool = self.path / 'session-must-never-execute'
        self.session_tool.write_bytes(b'Synthetic unexecuted session fixture.\n')

    def execute_fake(self, *, free_bytes=11274289152, source='same',
                     roots_clear=True, state_name='state'):
        """Exercise outer control flow with every host/native boundary fenced."""
        commands, allocated, forbidden_calls = [], [], []
        head_reads = status_reads = 0
        state_root = self.path / state_name

        def forbidden(name):
            def fail(*args, **kwargs):
                forbidden_calls.append(name)
                raise AssertionError('No-session refusal reached ' + name)
            return fail

        def command_output(command, timeout=5, allowed=(0,)):
            nonlocal head_reads, status_reads
            words = tuple(str(value) for value in command)
            commands.append(words)
            if words == ('git', 'rev-parse', 'HEAD'):
                head_reads += 1
                if head_reads > 1 and source == 'error':
                    raise OSError('Synthetic refusal source readback failure')
                output = '2' * 40 if head_reads > 1 and source == 'changed' else EXPECTED_HEAD
            elif words == ('git', 'status', '--porcelain'):
                status_reads += 1
                output = ' M apps/ios/changed.swift' if status_reads > 1 and source == 'dirty' else ''
            elif words == ('git', 'remote', 'get-url', 'origin'):
                output = 'https://github.com/getyak/leafhour'
            elif words in ((str(self.controller.GUARD), 'resources'),
                           (str(self.controller.GUARD), 'audit')):
                self.assertGreater(timeout, 0)
                self.assertLessEqual(timeout, 30)
                return SimpleNamespace(stdout='Synthetic ' + words[-1] + ' warning\n',
                                       stderr='', returncode=2)
            else:
                return forbidden('tool command ' + repr(words))()
            return SimpleNamespace(stdout=output + '\n', stderr='', returncode=0)

        def register(label):
            self.assertIn(label, ('GET-328-build-only-evidence', 'GET-328-build-only-products'))
            root = Path(tempfile.mkdtemp(prefix='ai-test-' + label + '.', dir=self.path)).resolve()
            allocated.append((label, root))
            self.generated_roots.append(root)
            return root

        def capacity(path):
            self.assertEqual(str(path), '/System/Volumes/Data')
            self.assertEqual([words[-1] for words in commands
                              if words[0] == str(self.controller.GUARD)],
                             ['resources', 'audit'])
            self.assertGreaterEqual(head_reads, 1)
            self.assertGreaterEqual(status_reads, 1)
            self.assertEqual(len(allocated), 2)
            return SimpleNamespace(free=free_bytes)

        def references(products, evidence):
            if (products, evidence) != (allocated[1][1], allocated[0][1]):
                return forbidden('reference check outside the allocated attempt')()
            if isinstance(roots_clear, Exception):
                raise roots_clear
            return roots_clear

        original_exists, original_is_file = Path.exists, Path.is_file

        def exists(path):
            return False if path.name == '.agent-pause' else original_exists(path)

        def is_file(path):
            return False if path.name == '.agent-pause' else original_is_file(path)

        output = io.StringIO()
        with ExitStack() as stack:
            stack.enter_context(patch.dict(os.environ, {}, clear=True))
            stack.enter_context(patch.object(self.controller.sys, 'platform', 'darwin'))
            stack.enter_context(patch.object(self.controller, 'STATE_ROOT', state_root))
            stack.enter_context(patch.object(self.controller, 'ARTIFACT_PARENT', self.path))
            stack.enter_context(patch.object(self.controller, 'SESSION', self.session_tool))
            stack.enter_context(patch.object(self.controller, 'command_output', side_effect=command_output))
            stack.enter_context(patch.object(self.controller, 'registered_root', side_effect=register))
            stack.enter_context(patch.object(self.controller.shutil, 'disk_usage', side_effect=capacity))
            stack.enter_context(patch.object(self.controller, 'references_clear', side_effect=references))
            stack.enter_context(patch.object(self.controller.subprocess, 'Popen', side_effect=forbidden('Popen')))
            stack.enter_context(patch.object(Path, 'exists', exists))
            stack.enter_context(patch.object(Path, 'is_file', is_file))
            for name in ('session_fence', 'devices', 'OwnedBuild', 'RealOps', 'worker',
                         'process_identity', 'ancestor'):
                stack.enter_context(patch.object(self.controller, name, side_effect=forbidden(name)))
            stack.enter_context(redirect_stdout(output))
            try:
                code = self.controller.execute_live(
                    EXPECTED_HEAD, '/synthetic/unused/Xcode.app/Contents/Developer')
            finally:
                self.assertEqual(forbidden_calls, [])
        evidence, products = allocated[0][1], allocated[1][1]
        report = json.loads((evidence / 'report.json').read_text())
        ledger = json.loads((state_root / 'ledger.json').read_text())
        summary = json.loads(output.getvalue())
        self.assertIs(report['no_session_started'], True)
        self.assertIs(report['build_started'], False)
        self.assertIsNone(report['build_exit_code'])
        self.assertIs(report['admission_refused'], True)
        for field in ('entry', 'restoration', 'session_context'):
            self.assertNotIn(field, report)
        for name in ('entry-state.json', 'source-sdk-before.json', 'run-config.json',
                     'session-command.json', 'session.log'):
            self.assertFalse((evidence / name).exists())
        self.assertEqual(json.loads((evidence / 'admission-space.json').read_text()),
                         {'free_bytes': free_bytes, 'min_free_bytes': 11274289152})
        for action in ('resources', 'audit'):
            self.assertEqual(json.loads((evidence / (action + '-exit.json')).read_text()),
                             {'returncode': 2})
        self.assertEqual(summary['status'], ledger['status'])
        self.assertEqual(summary['build_status'], 'not-started')
        self.assertEqual(summary['returncode'], code)
        return SimpleNamespace(code=code, report=report, ledger=ledger,
                               evidence=evidence, products=products, commands=commands)

    def test_exact_resource_floor_refuses_before_session_selection(self):
        for free_bytes in (11274289152, 11274289151):
            with self.subTest(free_bytes=free_bytes):
                result = self.execute_fake(free_bytes=free_bytes,
                                           state_name='state-' + str(free_bytes))
                self.assertEqual(result.code, 75)
                self.assertEqual(result.report['status'], 'failed')
                self.assertIs(result.report['next_attempt_allowed'], True)
                self.assertEqual(result.ledger['status'], 'ready')
                self.assertEqual(sum(words == ('git', 'rev-parse', 'HEAD')
                                     for words in result.commands), 2)

    def test_known_refusal_can_retry_only_as_an_explicit_fresh_attempt(self):
        first = self.execute_fake()
        original_report = (first.evidence / 'report.json').read_bytes()
        second = self.execute_fake()
        self.assertEqual(first.code, 75)
        self.assertEqual(second.code, 75)
        self.assertNotEqual(first.evidence, second.evidence)
        self.assertNotEqual(first.products, second.products)
        self.assertNotEqual(first.ledger['attempt_id'], second.ledger['attempt_id'])
        self.assertEqual((first.evidence / 'report.json').read_bytes(), original_report)

    def test_changed_unknown_or_referenced_refusal_readbacks_leave_the_ledger_blocked(self):
        cases = ({'source': 'changed'}, {'source': 'dirty'}, {'source': 'error'},
                 {'roots_clear': False}, {'roots_clear': 0}, {'roots_clear': None},
                 {'roots_clear': OSError('Synthetic reference readback failure')})
        for index, changes in enumerate(cases):
            with self.subTest(changes=changes):
                result = self.execute_fake(state_name='blocked-' + str(index), **changes)
                self.assertEqual(result.code, 70)
                self.assertIs(result.report['next_attempt_allowed'], False)
                self.assertEqual(result.ledger['status'], 'blocked')

    def test_a_blocked_refusal_cannot_allocate_another_attempt(self):
        result = self.execute_fake(roots_clear=False)
        self.assertEqual(result.ledger['status'], 'blocked')
        roots_before = list(self.generated_roots)
        with self.assertRaises(RuntimeError):
            self.execute_fake()
        self.assertEqual(self.generated_roots, roots_before)


class ArtifactBoundaryTests(ProtocolTestCase):
    def test_allocated_bytes_deduplicates_hardlinks_and_never_follows_external_links(self):
        first, second, outside = (self.path / name for name in ('first', 'second', 'outside'))
        for root in (first, second, outside):
            root.mkdir()
        payload = first / 'payload.bin'
        payload.write_bytes(bytes(range(256)) * 256)
        os.link(payload, second / 'same-inode.bin')
        (outside / 'private.bin').write_bytes(bytes(range(256)) * 1024)
        shortcut = first / 'outside-link'
        shortcut.symlink_to(outside, target_is_directory=True)
        allocated_payload = payload.stat().st_blocks * 512
        self.assertGreater(allocated_payload, 0, 'Fixture requires an allocated file')
        expected = (first.stat().st_blocks * 512 + second.stat().st_blocks * 512
                    + allocated_payload + shortcut.lstat().st_blocks * 512)
        actual = self.controller.allocated_bytes([first, second, first])
        self.assertEqual(actual, expected)
        self.assertEqual((outside / 'private.bin').stat().st_size, 262144)

    def test_allocated_bytes_refuses_a_symlink_used_as_an_owned_root(self):
        outside = self.path / 'outside'
        outside.mkdir()
        root = self.path / 'root-link'
        root.symlink_to(outside, target_is_directory=True)
        with self.assertRaises((OSError, RuntimeError)):
            self.controller.allocated_bytes([root])

    def test_replaced_or_symlinked_roots_are_refused_before_any_host_probe(self):
        for root_name, use_symlink in (('evidence', False), ('products', False),
                                       ('evidence', True), ('products', True)):
            with self.subTest(root=root_name, symlink=use_symlink):
                case = self.path / (root_name + '-' + str(use_symlink))
                case.mkdir()
                evidence, products = case / 'evidence', case / 'products'
                evidence.mkdir()
                products.mkdir()
                request = self.controller.Request(EXPECTED_HEAD, UDID, evidence, products)
                ops = self.controller.RealOps({}, request)
                replaced = evidence if root_name == 'evidence' else products
                replaced.rename(case / 'preserved-original')
                if use_symlink:
                    unrelated = case / 'unrelated'
                    unrelated.mkdir()
                    (unrelated / 'sentinel').write_text('preserve')
                    replaced.symlink_to(unrelated, target_is_directory=True)
                else:
                    replaced.mkdir()
                with patch.object(ops, 'verify_session',
                                  side_effect=AssertionError('Replaced root reached session probe')), \
                     patch.object(self.controller.shutil, 'disk_usage',
                                  side_effect=AssertionError('Replaced root reached capacity probe')), \
                     patch.object(self.controller, 'command_output',
                                  side_effect=AssertionError('Replaced root reached host command')), \
                     self.assertRaises(RuntimeError):
                    ops.sample()
                if use_symlink:
                    self.assertEqual((unrelated / 'sentinel').read_text(), 'preserve')

    def test_accounting_timeout_cannot_return_a_partial_total(self):
        root = self.path / 'root'
        root.mkdir()
        (root / 'file').write_text('allocated fixture')
        with patch.object(self.controller.time, 'monotonic', side_effect=(0, 3)), \
             self.assertRaises(RuntimeError):
            self.controller.allocated_bytes([root], timeout=2)


class GroupProbeBoundaryTests(ProtocolTestCase):
    def test_timed_out_group_probe_kills_and_reaps_only_its_own_popen(self):
        class HangingProbe:
            pid = 6001
            returncode = None
            killed = False
            reaped = False

            def communicate(self, timeout=None):
                if not self.killed:
                    raise subprocess.TimeoutExpired('synthetic-owned-probe', timeout)
                self.returncode = -signal.SIGKILL
                self.reaped = True
                return '', ''

            def kill(self):
                self.killed = True

            def wait(self, timeout=None):
                if not self.killed:
                    raise subprocess.TimeoutExpired('synthetic-owned-probe', timeout)
                self.returncode = -signal.SIGKILL
                self.reaped = True
                return self.returncode

        probe = HangingProbe()
        ops = self.controller.RealOps({}, self.make_request())
        with patch.object(self.controller.subprocess, 'Popen', return_value=probe), \
             patch.object(self.controller.os, 'kill',
                          side_effect=AssertionError('Probe cleanup used an arbitrary PID')), \
             patch.object(self.controller.os, 'killpg',
                          side_effect=AssertionError('Probe cleanup signalled a process group')), \
             self.assertRaises((RuntimeError, subprocess.TimeoutExpired)):
            ops.group_quiescent()
        self.assertTrue(probe.killed, 'Timed-out owned probe was left running')
        self.assertTrue(probe.reaped, 'Timed-out owned probe was not reaped')


class OwnedProcessIntegrationTests(ProtocolTestCase):
    @staticmethod
    def stop_owned(process):
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=3)

    def test_owned_python_failure_preserves_the_raw_exit_and_real_log(self):
        log_path = self.path / 'synthetic-exit.log'
        child = self.controller.OwnedBuild(
            [sys.executable, '-c',
             'import sys; print("synthetic build failure", flush=True); sys.exit(65)'],
            log_path)
        self.addCleanup(self.stop_owned, child.process)
        child.process.wait(timeout=5)
        self.assertEqual(child.poll(), 65)
        self.assertTrue(child.output.closed)
        self.assertEqual(log_path.read_text(), 'synthetic build failure\n')

    def test_timeout_signals_only_the_owned_python_leader_and_preserves_a_peer(self):
        peer = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(30)'],
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.addCleanup(self.stop_owned, peer)
        child = self.controller.OwnedBuild(
            [sys.executable, '-c', 'import time; time.sleep(30)'],
            self.path / 'synthetic-timeout.log')
        self.addCleanup(self.stop_owned, child.process)
        original_output = self.controller.command_output

        def own_identity_only(command, *args, **kwargs):
            self.assertEqual(command[:3], ['/bin/ps', '-p', str(child.process.pid)])
            return original_output(command, *args, **kwargs)

        events = []
        budget = self.controller.Budget(seconds=0.1, poll_seconds=0.02,
                                        term_grace=0.3, kill_grace=0.2,
                                        min_free_bytes=0, max_new_bytes=10)
        with patch.object(self.controller, 'command_output', side_effect=own_identity_only):
            result = self.controller.supervise(
                child, budget,
                lambda: {'free_bytes': 1000, 'artifact_bytes': 0,
                         'source_unchanged': True},
                time, events.append)
        self.assertEqual(result['exit_code'], -signal.SIGTERM)
        self.assertEqual(result['cancel_reason'], 'deadline')
        self.assertIs(result['leader_exited'], True)
        self.assertIs(result['identity_verified'], True)
        self.assertIs(result['blocked'], False)
        self.assertIsNone(peer.poll(), 'A peer in the same process group was signalled')
        self.assertTrue(child.output.closed)


if __name__ == '__main__':
    unittest.main()
