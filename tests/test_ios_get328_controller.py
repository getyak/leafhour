"""Offline checks for GET-328's one-attempt build and durable retry gate.

Only the controller and temporary JSON files are real. The clock, process,
session, source, SDK, resources, products, and device are explicit boundaries;
these tests must never acquire a native lease or touch a Simulator.
"""

import copy
import importlib.util
import json
import os
from pathlib import Path
import signal
import sys
import tempfile
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / 'scripts/ios/get328_build_only.py'
EXPECTED_HEAD = '1' * 40
UDID = '11111111-2222-3333-4444-555555555555'
GIB = 1024 ** 3


def load_controller():
    if 'get328_build_only' in sys.modules:
        return sys.modules['get328_build_only']
    sys.path.insert(0, str(MODULE_PATH.parent))
    spec = importlib.util.spec_from_file_location('get328_build_only', MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class FakeClock:
    def __init__(self):
        self.now = 0

    def monotonic(self):
        return self.now

    def sleep(self, seconds):
        if seconds <= 0:
            raise AssertionError('The controller must not busy-spin')
        self.now += seconds
        if self.now > 2000:
            raise AssertionError('The fake build did not stop within its budget')


class FakeChild:
    def __init__(self, clock, identity_type, *, exit_at=2, exit_code=0,
                 on_exit=None):
        self.clock = clock
        self.original = identity_type(pid=4101, ppid=4000, pgid=4101,
                                      birth='synthetic-build-start')
        self.current = self.original
        self.exit_at = exit_at
        self.exit_code = exit_code
        self.on_exit = on_exit
        self.notified = False
        self.delivered = []
        self.identity_changes_at = None

    def identity(self):
        if (self.identity_changes_at is not None
                and self.clock.monotonic() >= self.identity_changes_at):
            return type(self.original)(pid=4101, ppid=4000, pgid=4101,
                                       birth='replacement-process-start')
        return self.current

    def poll(self):
        if self.exit_at is None or self.clock.monotonic() < self.exit_at:
            return None
        if not self.notified:
            self.notified = True
            if self.on_exit:
                self.on_exit()
        return self.exit_code

    def send_signal(self, number, expected_identity):
        if self.identity() != expected_identity:
            raise RuntimeError('The process identity changed before delivery')
        self.delivered.append(number)
        self.exit_at = self.clock.monotonic()
        self.exit_code = -number


class FakeOps:
    """Only model external observations and effects, never controller decisions."""

    def __init__(self, identity_type, entry='Booted'):
        self.clock = FakeClock()
        self.entry = entry
        self.current_state = entry
        self.valid_owner = True
        self.owner_lost_after_spawn = False
        self.restore_error = None
        self.final_state_error = None
        self.state_after_build = None
        self.source_error_at = None
        self.sdk_error_at = None
        self.source_changed = False
        self.sdk_changed = False
        self.preflight_head = EXPECTED_HEAD
        self.free_bytes = 30 * GIB
        self.artifact_bytes = 0
        self.sample_error_at = None
        self.sample_source_changed_at = None
        self.products_missing = False
        self.cancel_during_final_sdk = False
        self.cancel_during_products = False
        self.preflight_quiescent = True
        self.quiescent = True
        self.quiescence_error = None
        self.quiescence_values = []
        self.cancel_at = None
        self.calls = []
        self.source_calls = 0
        self.sdk_calls = 0
        self.sample_calls = 0
        self.spawned = []
        self.restored = []
        self.product_calls = []
        self.child = FakeChild(self.clock, identity_type, on_exit=self.build_exited)

    def verify_session(self, udid):
        self.calls.append(('verify_session', udid))
        if udid != UDID or not self.valid_owner:
            raise RuntimeError('The selected session is no longer owned')
        return {'udid': udid, 'owner_pid': 4000,
                'session_id': 'fixture-session', 'valid': True}

    def device_state(self, udid):
        self.calls.append(('device_state', udid))
        if udid != UDID:
            raise AssertionError('The controller inspected another device')
        if self.final_state_error and self.spawned:
            raise self.final_state_error
        return self.current_state

    def source_snapshot(self, expected_head):
        self.source_calls += 1
        self.calls.append(('source_snapshot', expected_head))
        if expected_head != EXPECTED_HEAD:
            raise AssertionError('The controller changed the pinned source head')
        if self.source_calls == self.source_error_at:
            raise OSError('Synthetic source readback failure')
        fingerprint = ('source-B' if self.source_changed and self.source_calls > 1
                       else 'source-A')
        return {'head': self.preflight_head, 'clean': True,
                'fingerprint': fingerprint}

    def sdk_snapshot(self):
        self.sdk_calls += 1
        self.calls.append(('sdk_snapshot',))
        if self.cancel_during_final_sdk and self.sdk_calls > 1:
            self.cancel_at = self.clock.monotonic()
        if self.sdk_calls == self.sdk_error_at:
            raise OSError('Synthetic SDK readback failure')
        fingerprint = ('sdk-B' if self.sdk_changed and self.sdk_calls > 1
                       else 'sdk-A')
        return {'developer_dir': '/Applications/Xcode.app/Contents/Developer',
                'xcode_build': '17A000', 'sdk': 'iphonesimulator',
                'sdk_version': '26.0', 'fingerprint': fingerprint}

    def sample(self):
        self.sample_calls += 1
        self.calls.append(('sample',))
        if self.sample_calls == self.sample_error_at:
            raise OSError('Synthetic resource probe failure')
        unchanged = (self.sample_source_changed_at is None
                     or self.clock.monotonic() < self.sample_source_changed_at)
        return {'free_bytes': self.free_bytes,
                'artifact_bytes': self.artifact_bytes,
                'source_unchanged': unchanged}

    def spawn_build(self, command, log_path):
        if not self.valid_owner:
            raise AssertionError('A build started after session ownership was lost')
        self.calls.append(('spawn_build',))
        self.spawned.append((list(command), Path(log_path)))
        Path(log_path).parent.mkdir(parents=True, exist_ok=True)
        Path(log_path).write_text('Synthetic build log; no native process ran.\n')
        if self.owner_lost_after_spawn:
            self.valid_owner = False
        return self.child

    def build_exited(self):
        if self.state_after_build is not None:
            self.current_state = self.state_after_build

    def restore_device(self, udid, entry):
        if not self.valid_owner:
            raise AssertionError('A device mutation occurred without an owned session')
        if udid != UDID or entry != self.entry:
            raise AssertionError('The controller restored a different device or state')
        self.calls.append(('restore_device', udid, entry))
        self.restored.append((udid, entry))
        if self.restore_error:
            raise self.restore_error
        self.current_state = entry

    def group_quiescent(self):
        self.calls.append(('group_quiescent',))
        if not self.spawned:
            return self.preflight_quiescent
        if self.quiescence_error:
            raise self.quiescence_error
        if self.quiescence_values:
            return self.quiescence_values.pop(0)
        return self.quiescent

    def product_snapshot(self, products, complete):
        self.calls.append(('product_snapshot', str(products), complete))
        self.product_calls.append((Path(products), complete))
        if self.cancel_during_products:
            self.cancel_at = self.clock.monotonic()
        if complete and self.products_missing:
            raise RuntimeError('Build exited zero but complete products are missing')
        return {'complete': complete,
                'app': str(Path(products) / 'Synthetic.app'),
                'xctestrun': str(Path(products) / 'Synthetic.xctestrun')}

    def cancelled(self):
        if self.cancel_at is not None and self.clock.monotonic() >= self.cancel_at:
            return signal.SIGINT
        return None


class ControllerTestCase(unittest.TestCase):
    def setUp(self):
        self.assertTrue(MODULE_PATH.is_file(),
                        'The GET-328 build-only controller has not been implemented')
        self.controller = load_controller()
        self.directory = tempfile.TemporaryDirectory(prefix='leafhour-get328-controller-')
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name)
        self.attempt_count = 0
        self.request = self.controller.Request(
            expected_head=EXPECTED_HEAD, udid=UDID,
            evidence=self.path / 'evidence', products=self.path / 'products')

    def make_ops(self, entry='Booted'):
        return FakeOps(self.controller.Identity, entry=entry)

    def run_build(self, ops=None, budget=None):
        ops = ops or self.make_ops()
        self.attempt_count += 1
        self.request = self.controller.Request(
            expected_head=EXPECTED_HEAD, udid=UDID,
            evidence=self.path / ('evidence-' + str(self.attempt_count)),
            products=self.path / ('products-' + str(self.attempt_count)))
        report = self.controller.perform_build(
            ops, self.request, budget=budget or self.controller.Budget())
        self.assertIsInstance(report, dict)
        report_path = self.request.evidence / 'report.json'
        self.assertTrue(report_path.is_file(), 'Every outcome needs a durable report')
        self.assertEqual(json.loads(report_path.read_text()), report)
        return report

    def assert_blocked(self, report):
        self.assertEqual(report['status'], 'blocked')
        self.assertIs(report['next_attempt_allowed'], False)


class BuildOnlyControllerTests(ControllerTestCase):
    def test_reusing_an_attempt_rejects_without_overwriting_its_report(self):
        ops = self.make_ops()
        self.run_build(ops)
        report_path = self.request.evidence / 'report.json'
        original = report_path.read_bytes()
        calls = list(ops.calls)
        with self.assertRaises((ValueError, RuntimeError, FileExistsError)):
            self.controller.perform_build(ops, self.request)
        self.assertEqual(report_path.read_bytes(), original)
        self.assertEqual(ops.calls, calls)

    def test_success_preserves_each_known_entry_state_and_saves_readbacks(self):
        for entry in ('Booted', 'Shutdown'):
            with self.subTest(entry=entry):
                ops = self.make_ops(entry)
                report = self.run_build(ops)
                self.assertEqual(report['status'], 'succeeded')
                self.assertEqual(report['build_exit_code'], 0)
                self.assertIs(report['build_started'], True)
                self.assertFalse(report['cancellation'])
                self.assertEqual(report['restoration'],
                                 {'entry': entry, 'final': entry, 'ok': True})
                self.assertIs(report['next_attempt_allowed'], True)
                self.assertGreaterEqual(ops.source_calls, 2)
                self.assertGreaterEqual(ops.sdk_calls, 2)
                self.assertIn((self.request.products, True), ops.product_calls)
                entry_record = json.loads(
                    (self.request.evidence / 'entry-state.json').read_text())
                self.assertEqual(entry_record['udid'], UDID)
                self.assertEqual(entry_record['state'], entry)
                provenance = json.loads(
                    (self.request.evidence / 'source-sdk-before.json').read_text())
                self.assertEqual(provenance['source']['head'], EXPECTED_HEAD)
                self.assertEqual(provenance['source']['fingerprint'], 'source-A')
                self.assertEqual(provenance['sdk']['fingerprint'], 'sdk-A')
                self.assertEqual(report['source_after'], provenance['source'])
                self.assertEqual(report['sdk_after'], provenance['sdk'])
                self.assertEqual(report['session_context']['session_id'], 'fixture-session')

    def test_build_only_command_is_fixed_and_uses_only_the_selected_destination(self):
        ops = self.make_ops()
        self.run_build(ops)
        self.assertEqual(len(ops.spawned), 1)
        command, log_path = ops.spawned[0]
        self.assertEqual(Path(command[0]).name, 'xcodebuild')
        self.assertEqual(command.count('build-for-testing'), 1)
        self.assertTrue({'test', 'test-without-building', 'install', 'archive', 'build'}
                        .isdisjoint(command))
        self.assertEqual(command[command.index('-jobs') + 1], '2')
        self.assertEqual(command[command.index('-scheme') + 1],
                         'LeafhourGET328CurrentAcceptance')
        destination = command[command.index('-destination') + 1]
        self.assertIn('id=' + UDID, destination)
        self.assertNotIn('generic/', destination)
        derived_data = Path(command[command.index('-derivedDataPath') + 1])
        self.assertTrue(derived_data == self.request.products
                        or self.request.products in derived_data.parents)
        self.assertIn('CODE_SIGNING_ALLOWED=NO', command)
        self.assertIn(self.request.evidence, log_path.parents)

    def test_build_side_effect_is_restored_to_the_exact_original_state(self):
        for entry, side_effect in (('Booted', 'Shutdown'), ('Shutdown', 'Booted')):
            with self.subTest(entry=entry):
                ops = self.make_ops(entry)
                ops.state_after_build = side_effect
                report = self.run_build(ops)
                self.assertEqual(report['status'], 'succeeded')
                self.assertEqual(ops.restored, [(UDID, entry)])
                self.assertEqual(ops.current_state, entry)
                restore_index = next(i for i, call in enumerate(ops.calls)
                                     if call[0] == 'restore_device')
                self.assertTrue(any(call[0] == 'verify_session'
                                    for call in ops.calls[ops.calls.index(('spawn_build',))
                                                          + 1:restore_index]))

    def test_lost_session_ownership_never_mutates_the_device(self):
        ops = self.make_ops('Shutdown')
        ops.owner_lost_after_spawn = True
        ops.state_after_build = 'Booted'
        report = self.run_build(ops)
        self.assert_blocked(report)
        self.assertEqual(ops.restored, [])
        self.assertEqual(ops.current_state, 'Booted')
        self.assertIs(report['restoration']['ok'], False)

    def test_invalid_entry_session_blocks_before_spawn_or_device_mutation(self):
        ops = self.make_ops()
        ops.valid_owner = False
        report = self.run_build(ops)
        self.assert_blocked(report)
        self.assertEqual(ops.spawned, [])
        self.assertEqual(ops.restored, [])
        self.assertIs(report['build_started'], False)

    def test_failed_restoration_blocks_an_otherwise_successful_build(self):
        ops = self.make_ops('Shutdown')
        ops.state_after_build = 'Booted'
        ops.restore_error = OSError('Synthetic restore failure')
        report = self.run_build(ops)
        self.assert_blocked(report)
        self.assertEqual(report['build_exit_code'], 0)
        self.assertIs(report['restoration']['ok'], False)

    def test_unknown_entry_state_blocks_without_starting_a_build(self):
        ops = self.make_ops('Creating')
        report = self.run_build(ops)
        self.assert_blocked(report)
        self.assertEqual(ops.spawned, [])
        self.assertEqual(ops.restored, [])

    def test_unknown_final_device_readback_cannot_unlock_another_attempt(self):
        ops = self.make_ops()
        ops.final_state_error = OSError('Synthetic device readback failure')
        report = self.run_build(ops)
        self.assert_blocked(report)
        self.assertIs(report['restoration']['ok'], False)

    def test_live_process_group_blocks_without_restoring_a_device(self):
        ops = self.make_ops('Shutdown')
        ops.state_after_build = 'Booted'
        ops.quiescent = False
        report = self.run_build(ops)
        self.assert_blocked(report)
        self.assertEqual(report['build_exit_code'], 0)
        self.assertEqual(ops.restored, [])
        self.assertIs(report['restoration']['ok'], False)

    def test_preexisting_process_group_blocks_before_a_build_starts(self):
        ops = self.make_ops()
        ops.preflight_quiescent = False
        report = self.run_build(ops)
        self.assert_blocked(report)
        self.assertEqual(ops.spawned, [])
        self.assertEqual(ops.restored, [])

    def test_unknown_process_group_readback_blocks_without_device_mutation(self):
        ops = self.make_ops('Shutdown')
        ops.state_after_build = 'Booted'
        ops.quiescence_error = OSError('Synthetic group readback failure')
        report = self.run_build(ops)
        self.assert_blocked(report)
        self.assertEqual(ops.restored, [])
        self.assertIs(report['restoration']['ok'], False)

    def test_process_group_must_still_be_quiescent_after_device_restoration(self):
        ops = self.make_ops('Shutdown')
        ops.state_after_build = 'Booted'
        ops.quiescence_values = [True, False]
        report = self.run_build(ops)
        self.assert_blocked(report)
        self.assertEqual(ops.restored, [(UDID, 'Shutdown')])
        self.assertIs(report['restoration']['ok'], False)

    def test_known_build_failure_remains_failed_and_can_retry_after_restoration(self):
        ops = self.make_ops('Shutdown')
        ops.child.exit_code = 65
        ops.state_after_build = 'Booted'
        report = self.run_build(ops)
        self.assertEqual(report['status'], 'failed')
        self.assertEqual(report['build_exit_code'], 65)
        self.assertIs(report['next_attempt_allowed'], True)
        self.assertEqual(report['restoration'],
                         {'entry': 'Shutdown', 'final': 'Shutdown', 'ok': True})
        self.assertIn((self.request.products, False), ops.product_calls)

    def test_resource_floor_refuses_spawn_and_allows_a_conclusive_retry(self):
        for free_bytes in (int(10.5 * GIB), int(10.5 * GIB) - 1):
            with self.subTest(free_bytes=free_bytes):
                ops = self.make_ops()
                ops.free_bytes = free_bytes
                report = self.run_build(ops)
                self.assertEqual(report['status'], 'failed')
                self.assertIs(report['next_attempt_allowed'], True)
                self.assertIs(report.get('admission_refused'), True)
                self.assertIs(report['build_started'], False)
                self.assertIsNone(report['build_exit_code'])
                self.assertEqual(ops.spawned, [])
                self.assertEqual(report['restoration'],
                                 {'entry': 'Booted', 'final': 'Booted', 'ok': True})
                self.assertGreaterEqual(ops.source_calls, 2)
                self.assertGreaterEqual(ops.sdk_calls, 2)

    def test_known_artifact_admission_refusal_is_retryable_after_conclusive_readback(self):
        ops = self.make_ops('Shutdown')
        ops.artifact_bytes = 3 * GIB
        report = self.run_build(ops)
        self.assertEqual(report['status'], 'failed')
        self.assertIs(report['next_attempt_allowed'], True)
        self.assertIs(report.get('admission_refused'), True)
        self.assertIs(report['build_started'], False)
        self.assertIsNone(report['build_exit_code'])
        self.assertEqual(ops.spawned, [])
        self.assertEqual(report['restoration'],
                         {'entry': 'Shutdown', 'final': 'Shutdown', 'ok': True})

    def test_signal_before_spawn_is_blocked_without_starting_a_build(self):
        ops = self.make_ops()
        ops.cancel_at = 0
        report = self.run_build(ops)
        self.assert_blocked(report)
        self.assertIs(report['build_started'], False)
        self.assertEqual(ops.spawned, [])
        self.assertTrue(report['cancellation'])

    def test_known_resource_refusal_with_a_pending_signal_still_blocks(self):
        ops = self.make_ops()
        ops.free_bytes = int(10.5 * GIB)
        ops.cancel_at = 0
        report = self.run_build(ops)
        self.assert_blocked(report)
        self.assertEqual(ops.spawned, [])
        self.assertTrue(report['cancellation'])

    def test_resource_refusal_cannot_unlock_unknown_provenance_or_group_state(self):
        for boundary, value in (('source_changed', True), ('sdk_changed', True),
                                ('preflight_quiescent', False)):
            with self.subTest(boundary=boundary):
                ops = self.make_ops()
                ops.free_bytes = int(10.5 * GIB)
                setattr(ops, boundary, value)
                report = self.run_build(ops)
                self.assert_blocked(report)
                self.assertEqual(ops.spawned, [])

    def test_signal_during_final_sdk_or_product_snapshot_can_never_turn_green(self):
        for boundary in ('cancel_during_final_sdk', 'cancel_during_products'):
            with self.subTest(boundary=boundary):
                ops = self.make_ops()
                setattr(ops, boundary, True)
                report = self.run_build(ops)
                self.assert_blocked(report)
                self.assertEqual(report['build_exit_code'], 0)
                self.assertTrue(report['cancellation'])

    def test_inherited_session_and_sdk_environment_is_preserved(self):
        inherited = {'DEV_IOS_SESSION_ID': 'fixture-inherited-session',
                     'DEV_IOS_UDID': UDID,
                     'DEVELOPER_DIR': '/synthetic/inherited/Xcode/Developer'}
        with patch.dict(os.environ, inherited):
            report = self.run_build()
            self.assertEqual(report['status'], 'succeeded')
            self.assertEqual({key: os.environ.get(key) for key in inherited}, inherited)

    def test_changed_source_between_preflight_and_postflight_blocks(self):
        ops = self.make_ops()
        ops.source_changed = True
        report = self.run_build(ops)
        self.assert_blocked(report)
        self.assertEqual(report['build_exit_code'], 0)

    def test_changed_sdk_between_preflight_and_postflight_blocks(self):
        ops = self.make_ops()
        ops.sdk_changed = True
        report = self.run_build(ops)
        self.assert_blocked(report)
        self.assertEqual(report['build_exit_code'], 0)

    def test_pinned_source_mismatch_blocks_before_spawn(self):
        ops = self.make_ops()
        ops.preflight_head = '2' * 40
        report = self.run_build(ops)
        self.assert_blocked(report)
        self.assertEqual(ops.spawned, [])

    def test_unknown_source_or_sdk_observation_is_always_blocked(self):
        for boundary in ('source_error_at', 'sdk_error_at'):
            for observation in (1, 2):
                with self.subTest(boundary=boundary, observation=observation):
                    ops = self.make_ops()
                    setattr(ops, boundary, observation)
                    report = self.run_build(ops)
                    self.assert_blocked(report)
                    if observation == 1:
                        self.assertEqual(ops.spawned, [])

    def test_unknown_resource_probe_never_becomes_an_ordinary_build_failure(self):
        for observation in (1, 3):
            with self.subTest(observation=observation):
                ops = self.make_ops()
                ops.sample_error_at = observation
                report = self.run_build(ops)
                self.assert_blocked(report)
                if observation == 1:
                    self.assertEqual(ops.spawned, [])

    def test_source_change_during_supervision_cancels_and_blocks(self):
        ops = self.make_ops('Shutdown')
        ops.child.exit_at = None
        ops.sample_source_changed_at = 1
        report = self.run_build(ops)
        self.assert_blocked(report)
        self.assertTrue(report['cancellation'])
        self.assertEqual(ops.child.delivered, [signal.SIGTERM])

    def test_unknown_child_identity_blocks_without_signalling_a_replacement(self):
        ops = self.make_ops()
        ops.child.exit_at = None
        ops.child.identity_changes_at = 1
        report = self.run_build(ops, self.controller.Budget(seconds=2))
        self.assert_blocked(report)
        self.assertEqual(ops.child.delivered, [])

    def test_cancellation_retains_the_raw_child_exit_and_restores_the_device(self):
        ops = self.make_ops('Shutdown')
        ops.child.exit_at = None
        ops.state_after_build = 'Booted'
        ops.cancel_at = 1
        report = self.run_build(ops)
        self.assertIn(report['status'], ('failed', 'blocked'))
        self.assertEqual(report['build_exit_code'], -signal.SIGTERM)
        self.assertTrue(report['cancellation'])
        self.assertEqual(report['restoration'],
                         {'entry': 'Shutdown', 'final': 'Shutdown', 'ok': True})

    def test_zero_exit_without_complete_products_is_never_success(self):
        ops = self.make_ops()
        ops.products_missing = True
        report = self.run_build(ops)
        self.assertEqual(report['build_exit_code'], 0)
        self.assertIn(report['status'], ('failed', 'blocked'))


class RunLatchTests(ControllerTestCase):
    def setUp(self):
        super().setUp()
        self.ledger_path = self.path / 'attempt-ledger.json'

    @staticmethod
    def session_code(report):
        return report.get('returncode', report['build_exit_code'])

    def finish(self, latch, report, **changes):
        arguments = {'session_returncode': self.session_code(report),
                     'readback_state': report['restoration']['entry'],
                     'roots_clear': True}
        arguments.update(changes)
        ledger = latch.finish(report, **arguments)
        self.assertEqual(json.loads(self.ledger_path.read_text()), ledger)
        return ledger

    def test_begin_writes_a_running_ledger_before_the_session_can_start(self):
        with self.controller.RunLatch(self.ledger_path) as latch:
            latch.begin('attempt-1', self.request.evidence, self.request.products)
            ledger = json.loads(self.ledger_path.read_text())
            self.assertEqual(ledger['status'], 'running')
            self.assertEqual(ledger['attempt_id'], 'attempt-1')
            self.assertIn(str(self.request.evidence), json.dumps(ledger))
            self.assertIn(str(self.request.products), json.dumps(ledger))

    def test_known_failed_attempt_can_unlock_only_after_external_readback(self):
        ops = self.make_ops('Shutdown')
        ops.child.exit_code = 65
        report = self.run_build(ops)
        with self.controller.RunLatch(self.ledger_path) as latch:
            latch.begin('attempt-1', self.request.evidence, self.request.products)
            ledger = self.finish(latch, report)
            self.assertEqual(ledger['status'], 'ready')
        with self.controller.RunLatch(self.ledger_path) as latch:
            latch.begin('attempt-2', self.path / 'evidence-2', self.path / 'products-2')
            self.assertEqual(json.loads(self.ledger_path.read_text())['attempt_id'],
                             'attempt-2')

    def test_known_no_spawn_admission_refusal_can_unlock_after_readback(self):
        ops = self.make_ops('Shutdown')
        ops.free_bytes = int(10.5 * GIB)
        report = self.run_build(ops)
        self.assertIs(report.get('admission_refused'), True)
        self.assertIsNone(report['build_exit_code'])
        self.assertIs(report['build_started'], False)
        with self.controller.RunLatch(self.ledger_path) as latch:
            latch.begin('attempt-1', self.request.evidence, self.request.products)
            ledger = self.finish(latch, report)
            self.assertEqual(ledger['status'], 'ready')
        with self.controller.RunLatch(self.ledger_path) as latch:
            latch.begin('attempt-2', self.path / 'evidence-2', self.path / 'products-2')
            self.assertEqual(json.loads(self.ledger_path.read_text())['status'], 'running')

    def test_running_blocked_and_malformed_ledgers_refuse_before_session_action(self):
        for stored in ('{"status":"running"}', '{"status":"blocked"}',
                       '{broken', '{}', '[]', 'null'):
            with self.subTest(stored=stored):
                self.ledger_path.write_text(stored)
                session_actions = []
                with self.assertRaises(RuntimeError):
                    with self.controller.RunLatch(self.ledger_path):
                        session_actions.append('must not start')
                self.assertEqual(session_actions, [])
                self.assertEqual(self.ledger_path.read_text(), stored)

    def test_a_second_holder_is_refused_without_waiting_for_the_first(self):
        with self.controller.RunLatch(self.ledger_path) as first:
            first.begin('attempt-1', self.request.evidence, self.request.products)
            with self.assertRaises(RuntimeError):
                with self.controller.RunLatch(self.ledger_path):
                    self.fail('A simultaneous run acquired the same attempt latch')

    def test_unfinished_attempt_is_not_unlocked_by_context_exit(self):
        with self.controller.RunLatch(self.ledger_path) as latch:
            latch.begin('attempt-1', self.request.evidence, self.request.products)
        with self.assertRaises(RuntimeError):
            with self.controller.RunLatch(self.ledger_path):
                self.fail('An unknown previous attempt must remain blocked')

    def test_unknown_postflight_readback_blocks_this_and_later_attempts(self):
        report = self.run_build()
        with self.controller.RunLatch(self.ledger_path) as latch:
            latch.begin('attempt-1', self.request.evidence, self.request.products)
            ledger = self.finish(latch, report, readback_state=None)
            self.assertEqual(ledger['status'], 'blocked')
        with self.assertRaises(RuntimeError):
            with self.controller.RunLatch(self.ledger_path):
                self.fail('An unknown readback unlocked a later attempt')

    def test_child_permission_unknown_exit_bad_restoration_or_uncleared_roots_blocks(self):
        original = self.run_build()
        cases = (
            ('permission', {'next_attempt_allowed': False}, {}),
            ('unknown-exit', {'build_exit_code': None}, {}),
            ('unconfirmed-leader', {'build': {**original['build'],
                                             'leader_exited': False}}, {}),
            ('unconfirmed-identity', {'build': {**original['build'],
                                               'identity_verified': False}}, {}),
            ('blocked-supervision', {'build': {**original['build'],
                                              'blocked': True}}, {}),
            ('bad-restoration', {'restoration': {'entry': 'Booted',
                                                'final': 'Shutdown', 'ok': False}}, {}),
            ('mismatched-readback', {}, {'readback_state': 'Shutdown'}),
            ('uncleared-roots', {}, {'roots_clear': False}),
            ('successor-fence', {}, {'fence_stable': False}),
        )
        for name, changes, arguments in cases:
            with self.subTest(case=name):
                self.ledger_path.unlink(missing_ok=True)
                report = {**copy.deepcopy(original), **changes}
                with self.controller.RunLatch(self.ledger_path) as latch:
                    latch.begin(name, self.request.evidence, self.request.products)
                    ledger = self.finish(latch, report, **arguments)
                    self.assertEqual(ledger['status'], 'blocked')

    def test_session_returncode_must_match_the_reported_controller_returncode(self):
        report = self.run_build()
        report['returncode'] = 0
        with self.controller.RunLatch(self.ledger_path) as latch:
            latch.begin('attempt-1', self.request.evidence, self.request.products)
            ledger = self.finish(latch, report, session_returncode=1)
            self.assertEqual(ledger['status'], 'blocked')


if __name__ == '__main__':
    unittest.main()
