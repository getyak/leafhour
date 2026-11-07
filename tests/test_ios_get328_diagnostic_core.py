"""Synthetic files/clocks and tiny owned Python children; network is denied."""
import importlib
import json
import os
from pathlib import Path
import signal
import socket
import sys
import tempfile
import time
import unittest
from unittest import mock
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/ios'))
with mock.patch.object(socket, 'socket', side_effect=AssertionError('network denied')), \
        mock.patch.object(urllib.request.OpenerDirector, 'open', side_effect=AssertionError('network denied')):
    try:
        core = importlib.import_module('hosted_get328_diagnostic_core')
    except ModuleNotFoundError as error:
        if error.name != 'hosted_get328_diagnostic_core':
            raise
        core = None

GIB = 1024 ** 3


def stamp(start=100):
    return dict(schema_version=1, started_monotonic=start,
                work_deadline_monotonic=start + 240, deadline_monotonic=start + 330,
                initial_free_bytes=9 * GIB)


class DiagnosticCoreTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(core, 'The bounded diagnostic core is not implemented')
        self.stack = self.enterContext(__import__('contextlib').ExitStack())
        for target in ((socket, 'socket'), (socket, 'create_connection'),
                       (urllib.request, 'urlopen'), (urllib.request.OpenerDirector, 'open')):
            self.stack.enter_context(mock.patch.object(*target, side_effect=AssertionError('network denied')))

    def runner(self, sample=None, start=None):
        root = Path(self.enterContext(tempfile.TemporaryDirectory(prefix='get328-diagnostic-unit-')))
        budget = core.Budget(stamp(time.monotonic() if start is None else start))
        runner = core.Runner(root, budget, sample=sample or (lambda: (9 * GIB, 0, 0)), poll=.005)
        return root, budget, runner

    def receipt(self, root, name):
        return json.loads((root / 'receipts' / (name + '-command.json')).read_text())

    def test_original_stamp_and_command_limits_cannot_be_extended(self):
        for key, value in [('schema_version', True), ('deadline_monotonic', 431),
                           ('work_deadline_monotonic', 341), ('started_monotonic', True),
                           ('initial_free_bytes', 7 * GIB)]:
            with self.subTest(field=key), self.assertRaises(core.DiagnosticError):
                core.Budget({**stamp(), key: value}, clock=lambda: 100)
        for seconds in (0, -1, 20.01, True, float('nan'), float('inf')):
            budget = core.Budget(stamp(), clock=lambda: 100)
            with self.subTest(seconds=seconds), self.assertRaises(core.DiagnosticError):
                budget.deadline(seconds)
            self.assertTrue(budget.stopped)

    def test_work_cutoff_stops_new_work_but_does_not_reset_global_end(self):
        clock = [339]
        budget = core.Budget(stamp(), clock=lambda: clock[0])
        self.assertGreater(budget.deadline(20), 339)
        self.assertLess(budget.deadline(20), 340)
        clock[0] = 340
        with self.assertRaises(core.DiagnosticError):
            budget.check()
        self.assertEqual(budget.begin_final(), 430)
        budget.check(final=True)
        clock[0] = 430
        with self.assertRaises(core.DiagnosticError):
            budget.check(final=True)

    def test_final_start_is_sticky_across_stages_cancellation_and_snapshot_restore(self):
        clock = [150]
        budget = core.Budget(stamp(), clock=lambda: clock[0])
        self.assertEqual(budget.begin_final(), 240)
        clock[0] = 170
        budget.cancel(signal.SIGINT)
        budget.cancel(signal.SIGTERM)
        self.assertEqual(budget.cancel_signal, signal.SIGINT)
        self.assertEqual(budget.begin_final(), 240)
        restored = core.Budget(budget.snapshot(), clock=lambda: clock[0])
        self.assertEqual(restored.final_start, 150)
        self.assertEqual(restored.begin_final(), 240)
        with self.assertRaises(core.DiagnosticError):
            restored.check()
        restored.check(final=True)
        clock[0] = 240
        with self.assertRaises(core.DiagnosticError):
            restored.check(final=True)

    def test_unknown_stop_is_sticky_but_allows_bounded_finalization(self):
        clock = [120]
        budget = core.Budget(stamp(), clock=lambda: clock[0])
        budget.stop('monitor_unknown')
        budget.stop('another_error')
        self.assertEqual(budget.stop_reason, 'monitor_unknown')
        with self.assertRaises(core.DiagnosticError):
            budget.check()
        self.assertEqual(budget.begin_final(), 210)
        budget.check(final=True)
        clock[0] = 211
        with self.assertRaises(core.DiagnosticError):
            budget.check(final=True)
        self.assertEqual(budget.begin_final(), 210)

    def test_late_finalization_is_clamped_to_original_total_deadline(self):
        clock = [420]
        budget = core.Budget(stamp(), clock=lambda: clock[0])
        self.assertEqual(budget.begin_final(), 430)
        self.assertGreater(budget.deadline(20, final=True), 420)
        self.assertLess(budget.deadline(20, final=True), 430)
        clock[0] = 429
        self.assertEqual(budget.begin_final(), 430)

    def test_clock_rollback_cannot_reopen_an_earlier_window(self):
        clock = [100]
        budget = core.Budget(stamp(), clock=lambda: clock[0])
        clock[0] = 120
        budget.check()
        clock[0] = 110
        with self.assertRaises(core.DiagnosticError):
            budget.check()
        self.assertTrue(budget.stopped)

    def test_restored_cancellation_cannot_claim_work_is_unstopped(self):
        with self.assertRaises(core.DiagnosticError):
            core.Budget({**stamp(), 'stopped': False, 'cancel_signal': 2}, clock=lambda: 100)

    def test_normal_child_records_immutable_raw_exit_and_checks_resources_after_exit(self):
        samples = []
        def sample():
            samples.append(True)
            return 9 * GIB, 0, 0
        root, budget, runner = self.runner(sample)
        self.assertEqual(runner.run([sys.executable, '-c', 'print("synthetic-ok")'], 'normal', 2),
                         (0, 'synthetic-ok\n'))
        record = self.receipt(root, 'normal')
        self.assertTrue(record['started'] and record['reaped'] and record['group_absent'])
        self.assertEqual(record['raw_exit'], 0)
        self.assertFalse(record['partial'])
        self.assertFalse(budget.stopped)
        self.assertGreaterEqual(len(samples), 3)
        original = {p: p.read_bytes() for p in (root / 'receipts').iterdir()}
        with self.assertRaises(core.DiagnosticError):
            runner.run([sys.executable, '-c', 'pass'], 'normal', 2)
        self.assertEqual({p: p.read_bytes() for p in original}, original)

    def test_inherited_secrets_are_not_forwarded_and_explicit_whitelist_is_not_logged(self):
        root, budget, runner = self.runner()
        code = ('import os; assert "DIAG_SYNTHETIC_SECRET" not in os.environ; '
                'assert os.environ["DIAG_APPROVED_UPLOAD"]=="synthetic"; '
                'assert os.environ["DEVELOPER_DIR"]=="/Applications/Xcode_26.6.app/Contents/Developer"; '
                'print("safe")')
        with mock.patch.dict(os.environ, {'DIAG_SYNTHETIC_SECRET': 'do-not-forward'}):
            self.assertEqual(runner.run([sys.executable, '-c', code], 'environment', 2,
                             env={'DIAG_APPROVED_UPLOAD': 'synthetic'}), (0, 'safe\n'))
        record = self.receipt(root, 'environment')
        self.assertNotIn('env', record)

    def test_more_than_twenty_seconds_is_rejected_before_spawn(self):
        root, budget, runner = self.runner()
        with mock.patch.object(core.subprocess, 'Popen', side_effect=AssertionError('must not spawn')):
            with self.assertRaises(core.DiagnosticError):
                runner.run([sys.executable, '-c', 'pass'], 'too-long', 21)
        self.assertTrue(budget.stopped)
        self.assertFalse((root / 'receipts/too-long-owner.json').exists())

    def test_resource_preflight_time_is_inside_the_same_command_horizon(self):
        root, budget, runner = self.runner()
        clock = [budget.start]
        budget.clock = lambda: clock[0]
        def sample():
            clock[0] += 19
            return 9 * GIB, 0, 0
        runner.sample = sample
        with mock.patch.object(core.subprocess, 'Popen', side_effect=AssertionError('must not spawn')) as spawn:
            with self.assertRaises(core.DiagnosticError):
                runner.run([sys.executable, '-c', 'pass'], 'preflight', 20)
        spawn.assert_not_called()

    def test_default_resource_scan_does_not_follow_an_unrelated_directory_link(self):
        root, budget, runner = self.runner()
        outside = Path(self.enterContext(tempfile.TemporaryDirectory(prefix='get328-unrelated-unit-')))
        (outside / 'outside').write_bytes(b'not-owned')
        (root / 'owned').write_bytes(b'abc')
        (root / 'foreign').symlink_to(outside, target_is_directory=True)
        volume = __import__('types').SimpleNamespace(f_bavail=9 * GIB, f_frsize=1)
        with mock.patch.object(core.os, 'fstatvfs', return_value=volume):
            self.assertEqual(runner.resources(), (9 * GIB, 3, 3))

    def test_earlier_global_deadline_terminates_real_child_within_reserved_tail(self):
        now = time.monotonic()
        root, budget, runner = self.runner(start=now - 329.2)
        budget.begin_final()
        with self.assertRaises(core.DiagnosticError):
            runner.run([sys.executable, '-c', 'import time; time.sleep(5)'], 'global', 20, final=True)
        record = self.receipt(root, 'global')
        self.assertTrue(record['reaped'] and record['group_absent'])
        self.assertIsNotNone(record['raw_exit'])
        self.assertLessEqual(record['finished_monotonic'], budget.end)
        self.assertTrue(budget.stopped)

    def test_command_timeout_stops_an_ignoring_owned_group_without_extra_grace(self):
        root, budget, runner = self.runner()
        code = ('import signal,time; signal.signal(signal.SIGINT,signal.SIG_IGN); '
                'signal.signal(signal.SIGTERM,signal.SIG_IGN); print("ready",flush=True); time.sleep(5)')
        began = time.monotonic()
        with self.assertRaises(core.DiagnosticError):
            runner.run([sys.executable, '-c', code], 'ignoring', .9)
        record = self.receipt(root, 'ignoring')
        self.assertEqual(record['raw_exit'], -signal.SIGKILL)
        self.assertTrue(record['group_absent'] and record['reaped'])
        self.assertLess(record['finished_monotonic'] - began, .95)

    def test_output_is_stopped_at_streaming_bound_and_marked_partial(self):
        root, budget, runner = self.runner()
        with self.assertRaises(core.DiagnosticError):
            runner.run([sys.executable, '-c', 'import os; os.write(1,b"x"*1048576)'],
                       'overflow', 2, output_limit=4096)
        record = self.receipt(root, 'overflow')
        self.assertTrue(record['partial'] and record['reaped'] and record['group_absent'])
        self.assertLessEqual((root / 'logs/overflow.log').stat().st_size, 4096)
        self.assertTrue(budget.stopped)

    def test_evidence_cap_also_limits_output_before_writing_it(self):
        root, budget, runner = self.runner(sample=lambda: (9 * GIB, 0, 32 * 1024 ** 2 - 65536))
        with self.assertRaises(core.DiagnosticError):
            runner.run([sys.executable, '-c', 'import os; os.write(1,b"x"*131072)'], 'evidence', 2)
        self.assertTrue(self.receipt(root, 'evidence')['partial'])
        self.assertLessEqual((root / 'logs/evidence.log').stat().st_size, 32768)

    def test_resource_floor_vm_growth_root_growth_and_evidence_all_stop_before_spawn(self):
        samples = [(3 * GIB, 0, 0), (4 * GIB, 0, 0), (9 * GIB, 4 * GIB, 0),
                   (9 * GIB, 0, 32 * 1024 ** 2), (True, 0, 0), (9 * GIB, 0)]
        for value in samples:
            with self.subTest(sample=value):
                root, budget, runner = self.runner(sample=lambda: value)
                with mock.patch.object(core.subprocess, 'Popen', side_effect=AssertionError('must not spawn')):
                    with self.assertRaises(core.DiagnosticError):
                        runner.run([sys.executable, '-c', 'pass'], 'unsafe', 2)
                self.assertTrue(budget.stopped)

    def test_unknown_resource_state_stops_new_work(self):
        def sample():
            raise OSError('synthetic inaccessible root')
        root, budget, runner = self.runner(sample)
        with self.assertRaises(core.DiagnosticError):
            runner.run([sys.executable, '-c', 'pass'], 'unknown', 2)
        self.assertTrue(budget.stopped)
        self.assertFalse((root / 'receipts/unknown-owner.json').exists())

    def test_live_resource_drop_stops_the_real_owned_child(self):
        calls = [0]
        def sample():
            calls[0] += 1
            return (9 if calls[0] == 1 else 2) * GIB, 0, 0
        root, budget, runner = self.runner(sample)
        with self.assertRaises(core.DiagnosticError):
            runner.run([sys.executable, '-c', 'import time; time.sleep(5)'], 'live-drop', 2)
        record = self.receipt(root, 'live-drop')
        self.assertTrue(record['started'] and record['reaped'] and record['group_absent'])
        self.assertTrue(budget.stopped)

    def test_post_exit_resource_drop_keeps_raw_zero_but_cannot_report_success(self):
        holder = []
        original = core.subprocess.Popen
        def spawn(*args, **kwargs):
            child = original(*args, **kwargs)
            if not holder:
                holder.append(child)
            return child
        root, budget, runner = self.runner(sample=lambda: (
            (2 if holder and holder[0].returncode is not None else 9) * GIB, 0, 0))
        with mock.patch.object(core.subprocess, 'Popen', side_effect=spawn):
            with self.assertRaises(core.DiagnosticError):
                runner.run([sys.executable, '-c', 'pass'], 'post-drop', 2)
        self.assertEqual(self.receipt(root, 'post-drop')['raw_exit'], 0)
        self.assertTrue(budget.stopped)

    def test_cancellation_during_preflight_never_spawns_new_work(self):
        root, budget, runner = self.runner()
        def sample():
            budget.cancel(signal.SIGINT)
            return 9 * GIB, 0, 0
        runner.sample = sample
        with mock.patch.object(core.subprocess, 'Popen', side_effect=AssertionError('must not spawn')) as spawn:
            with self.assertRaises(core.DiagnosticError):
                runner.run([sys.executable, '-c', 'pass'], 'cancelled', 2)
        spawn.assert_not_called()
        self.assertEqual(budget.cancel_signal, signal.SIGINT)

    def test_cancellation_while_opening_log_prevents_the_following_child_spawn(self):
        root, budget, runner = self.runner()
        original_open = Path.open
        logfile = root / 'logs/cancel-log.log'
        def opening(path, *args, **kwargs):
            handle = original_open(path, *args, **kwargs)
            if path == logfile:
                budget.cancel(signal.SIGINT)
            return handle
        with mock.patch.object(Path, 'open', new=opening), \
                mock.patch.object(core.subprocess, 'Popen', side_effect=AssertionError('must not spawn')) as spawn:
            with self.assertRaises(core.DiagnosticError):
                runner.run([sys.executable, '-c', 'pass'], 'cancel-log', 2)
        spawn.assert_not_called()
        self.assertTrue(budget.stopped)
        self.assertFalse((root / 'receipts/cancel-log-owner.json').exists())

    def test_live_cancellation_stops_the_owned_child_and_remains_sticky(self):
        root, budget, runner = self.runner()
        samples = [0]
        def sample():
            samples[0] += 1
            if samples[0] == 2:
                budget.cancel(signal.SIGINT)
            return 9 * GIB, 0, 0
        runner.sample = sample
        with self.assertRaises(core.DiagnosticError):
            runner.run([sys.executable, '-c', 'import time; time.sleep(5)'], 'cancel-live', 2)
        record = self.receipt(root, 'cancel-live')
        self.assertTrue(record['started'] and record['reaped'] and record['group_absent'])
        self.assertEqual(budget.cancel_signal, signal.SIGINT)
        with self.assertRaises(core.DiagnosticError):
            budget.check()

    def test_nonzero_is_observable_only_explicitly_and_still_stops_new_work(self):
        root, budget, runner = self.runner()
        self.assertEqual(runner.run([sys.executable, '-c', 'raise SystemExit(7)'],
                                   'nonzero', 2, allow_failure=True), (7, ''))
        self.assertTrue(budget.stopped)
        with self.assertRaises(core.DiagnosticError):
            runner.run([sys.executable, '-c', 'pass'], 'after-nonzero', 2)

    def test_reaped_leader_with_existing_numeric_group_is_unknown_and_never_signalled(self):
        root, budget, runner = self.runner()
        child = mock.Mock(pid=99999999, returncode=0)
        child.poll.return_value = 0
        with mock.patch.object(runner, 'group_members', return_value={123456: 'S'}), \
                mock.patch.object(core.os, 'killpg') as kill:
            with self.assertRaises(core.DiagnosticError):
                runner.stop_owned(child, time.monotonic() + 1)
        kill.assert_not_called()
        self.assertTrue(budget.stopped)

    def test_expired_termination_budget_never_starts_another_probe_or_signal(self):
        root, budget, runner = self.runner()
        child = mock.Mock(pid=99999999, returncode=None)
        with mock.patch.object(runner, 'group_members') as probe, mock.patch.object(core.os, 'killpg') as kill:
            with self.assertRaises(core.DiagnosticError):
                runner.stop_owned(child, time.monotonic() - 1)
        probe.assert_not_called()
        kill.assert_not_called()

    def test_deadline_crossed_by_identity_read_never_signals_after_it(self):
        root, budget, runner = self.runner()
        clock = [budget.start]
        budget.clock = lambda: clock[0]
        deadline = budget.start + 1
        child = mock.Mock(pid=99999999, returncode=None)
        child.poll.return_value = None
        def getpgid(unused):
            clock[0] = deadline + 1
            return child.pid
        with mock.patch.object(core.os, 'getpgid', side_effect=getpgid), \
                mock.patch.object(core.os, 'killpg') as kill, \
                mock.patch.object(runner, 'group_members') as probe:
            with self.assertRaises(core.DiagnosticError):
                runner.stop_owned(child, deadline)
        kill.assert_not_called()
        probe.assert_not_called()
        child.wait.assert_not_called()

    def test_final_sensitive_output_and_argv_never_touch_any_evidence_file(self):
        root, budget, runner = self.runner()
        marker = '::add-mask::synthetic-SAS-do-not-persist'
        code = 'import sys; print(' + repr(marker) + '); print(' + repr(marker) + ',file=sys.stderr)'
        self.assertEqual(runner.run([sys.executable, '-c', code], 'upload', 2,
                                   final=True, capture=False), (0, ''))
        self.assertFalse((root / 'logs/upload.log').exists())
        self.assertEqual(self.receipt(root, 'upload')['output_policy'], 'discarded-provider-sensitive')
        for path in root.rglob('*'):
            if path.is_file():
                self.assertNotIn(marker.encode(), path.read_bytes(), str(path))

    def test_sensitive_discard_requires_final_mode_before_spawn(self):
        root, budget, runner = self.runner()
        with mock.patch.object(core.subprocess, 'Popen', side_effect=AssertionError('must not spawn')):
            with self.assertRaises(core.DiagnosticError):
                runner.run([sys.executable, '-c', 'pass'], 'bad-discard', 2, capture=False)
        self.assertTrue(budget.stopped)

    def test_exact_official_uploader_hyphen_input_keys_reach_the_child_without_logging_values(self):
        root, budget, runner = self.runner()
        marker = root / 'approved-inputs.json'
        approved = {'INPUT_IF-NO-FILES-FOUND': 'error', 'INPUT_INCLUDE-HIDDEN-FILES': 'true',
                    'INPUT_RETENTION-DAYS': '1', 'INPUT_COMPRESSION-LEVEL': '0',
                    'ACTIONS_RUNTIME_TOKEN': 'synthetic-runtime-token-never-persist'}
        code = ('import os,json; from pathlib import Path; '
                'ok=all(os.environ.get(k)==v for k,v in ' + repr(approved) + '.items()); '
                'Path(' + repr(str(marker)) + ').write_text(json.dumps({"ok":ok})); '
                'raise SystemExit(0 if ok else 7)')
        try:
            result = runner.run([sys.executable, '-c', code], 'approved-inputs', 2,
                                final=True, capture=False, env=approved)
        except core.DiagnosticError as error:
            self.fail('The four exact official uploader inputs must be accepted: ' + str(error))
        self.assertEqual(result, (0, ''))
        self.assertEqual(json.loads(marker.read_text()), {'ok': True})
        record = self.receipt(root, 'approved-inputs')
        self.assertEqual(record['output_policy'], 'discarded-provider-sensitive')
        self.assertNotIn('env', record)
        self.assertNotIn('argv', record)
        for path in root.rglob('*'):
            if path.is_file():
                self.assertNotIn(approved['ACTIONS_RUNTIME_TOKEN'].encode(), path.read_bytes())

    def test_unknown_hyphen_environment_keys_still_refuse_new_children(self):
        for key in ('bad-name', 'INPUT_UNKNOWN-OPTION', 'INPUT_RETENTION-DAYS-extra'):
            with self.subTest(key=key):
                root, budget, runner = self.runner()
                with mock.patch.object(core.subprocess, 'Popen', side_effect=AssertionError('must not spawn')):
                    with self.assertRaises(core.DiagnosticError):
                        runner.run([sys.executable, '-c', 'pass'], 'unknown-env', 2,
                                   final=True, capture=False, env={key: 'synthetic'})
                self.assertTrue(budget.stopped)
                self.assertFalse((root / 'receipts/unknown-env-owner.json').exists())

    def test_sensitive_spawn_error_is_classified_without_exception_text_or_argv(self):
        marker = 'synthetic-private-provider-signature'
        for error in (OSError(marker), core.DiagnosticError(marker)):
            with self.subTest(error_type=type(error).__name__):
                root, budget, runner = self.runner()
                with mock.patch.object(core.subprocess, 'Popen', side_effect=error):
                    with self.assertRaises(core.DiagnosticError):
                        runner.run([sys.executable, '-c', 'print(' + repr(marker) + ')'],
                                   'upload-error', 2, final=True, capture=False)
                for path in root.rglob('*'):
                    if path.is_file():
                        self.assertNotIn(marker.encode(), path.read_bytes())
                self.assertTrue(budget.stopped)


if __name__ == '__main__':
    unittest.main()
