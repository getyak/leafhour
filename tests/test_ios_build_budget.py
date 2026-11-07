"""Offline behavioral checks for the build-only process budget controller.

The child and clock are in-memory fixtures. These tests never start a native
build, acquire an iOS lease, inspect a simulator, or signal an OS process.
"""

import importlib.util
from pathlib import Path
import signal
import sys
import unittest


MODULE_PATH = Path(__file__).resolve().parents[1] / 'scripts/ios/build_only_budget.py'
SPEC = importlib.util.spec_from_file_location('ios_build_only_budget', MODULE_PATH)
controller = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = controller
SPEC.loader.exec_module(controller)


class FakeClock:
    def __init__(self, start=0, limit=2000):
        self.now = start
        self.limit = start + limit
        self.sleeps = []

    def monotonic(self):
        return self.now

    def sleep(self, seconds):
        if seconds <= 0:
            raise AssertionError('The controller must not busy-spin')
        self.sleeps.append(seconds)
        self.now += seconds
        if self.now > self.limit:
            raise AssertionError('The controller failed to stop within the fixture budget')


class FakeChild:
    """A signal boundary which refuses to act on a replacement process."""

    def __init__(self, clock, *, exit_at=None, exit_code=0,
                 term_exit_delay=0, kill_exit_delay=0):
        self.clock = clock
        self.original = controller.Identity(pid=4101, ppid=4000, pgid=4101,
                                            birth='synthetic-leader-start')
        self.current = self.original
        self.exit_at = exit_at
        self.exit_code = exit_code
        self.term_exit_delay = term_exit_delay
        self.kill_exit_delay = kill_exit_delay
        self.before_identity = None
        self.before_signal = None
        self.delivered = []
        self.rejected = []

    def identity(self):
        if self.before_identity:
            self.before_identity(self)
        return self.current

    def poll(self):
        if self.exit_at is not None and self.clock.monotonic() >= self.exit_at:
            return self.exit_code
        return None

    def send_signal(self, number, expected_identity):
        if self.before_signal:
            self.before_signal(self, number)
        if self.identity() != expected_identity:
            self.rejected.append(number)
            raise RuntimeError('The child identity changed before signal delivery')
        self.delivered.append((number, self.clock.monotonic(), expected_identity))
        delay = (self.term_exit_delay if number == signal.SIGTERM
                 else self.kill_exit_delay if number == signal.SIGKILL else None)
        if delay is not None:
            self.exit_at = self.clock.monotonic() + delay
            self.exit_code = -number


class Probe:
    def __init__(self, clock, *, free_bytes=30 * 1024 ** 3, artifact_bytes=0,
                 change_at=None, changed=None, fail_at=None):
        self.clock = clock
        self.values = {'free_bytes': free_bytes, 'artifact_bytes': artifact_bytes}
        self.change_at = change_at
        self.changed = changed or {}
        self.fail_at = fail_at

    def __call__(self):
        now = self.clock.monotonic()
        if self.fail_at is not None and now >= self.fail_at:
            raise OSError('Synthetic monitor failure')
        if self.change_at is not None and now >= self.change_at:
            return {**self.values, **self.changed}
        return dict(self.values)


class BuildOnlyBudgetTests(unittest.TestCase):
    def supervise(self, child, budget=None, probe=None, cancelled=lambda: None):
        events = []
        result = controller.supervise(
            child=child,
            budget=budget or controller.Budget(),
            probe=probe or Probe(child.clock),
            clock=child.clock,
            emit=events.append,
            cancelled=cancelled,
        )
        self.assertIsInstance(result, dict)
        self.assertTrue(all(isinstance(event, dict) for event in events))
        return result, events

    def assert_result(self, result, *, exit_code, cancel_reason=None,
                      leader_exited=True, identity_verified=True, blocked=False):
        self.assertEqual(result['exit_code'], exit_code)
        self.assertEqual(result['cancel_reason'], cancel_reason)
        self.assertIs(result['leader_exited'], leader_exited)
        self.assertIs(result['identity_verified'], identity_verified)
        self.assertIs(result['blocked'], blocked)

    def test_success_keeps_the_raw_exit_status_without_cancellation(self):
        child = FakeChild(FakeClock(), exit_at=3)
        result, events = self.supervise(child)
        self.assert_result(result, exit_code=0)
        self.assertEqual(child.delivered, [])
        self.assertTrue(any(event.get('free_bytes') == 30 * 1024 ** 3
                            and event.get('artifact_bytes') == 0 for event in events))

    def test_known_build_failure_is_not_an_unknown_monitor_failure(self):
        child = FakeChild(FakeClock(), exit_at=2, exit_code=65)
        result, _ = self.supervise(child)
        self.assert_result(result, exit_code=65)
        self.assertEqual(child.delivered, [])

    def test_initial_identity_failure_preserves_an_already_known_build_exit(self):
        child = FakeChild(FakeClock(), exit_at=0, exit_code=65)
        signal_attempts = []

        def fail_identity(candidate):
            raise OSError('Synthetic initial identity lookup failure')

        child.before_identity = fail_identity
        child.before_signal = lambda candidate, number: signal_attempts.append(number)
        result, _ = self.supervise(child)
        self.assertEqual(result['exit_code'], 65)
        self.assertIs(result['leader_exited'], True)
        self.assertTrue(result['blocked'] or result['identity_verified'] is False)
        self.assertEqual(signal_attempts, [])
        self.assertEqual(child.delivered, [])

    def test_default_deadline_uses_1200_elapsed_seconds_from_a_nonzero_clock(self):
        clock = FakeClock(start=31000)
        child = FakeChild(clock)
        result, events = self.supervise(child)
        self.assert_result(result, exit_code=-signal.SIGTERM, cancel_reason='deadline')
        self.assertEqual(child.delivered, [(signal.SIGTERM, 32200, child.original)])
        self.assertTrue(any(event.get('reason') == 'deadline' for event in events))

    def test_spawn_and_provenance_time_are_charged_to_the_same_deadline(self):
        child = FakeChild(FakeClock(start=100))
        child.started_at = 0
        result, _ = self.supervise(child, controller.Budget(seconds=1200))
        self.assert_result(result, exit_code=-signal.SIGTERM, cancel_reason='deadline')
        self.assertEqual(child.delivered, [(signal.SIGTERM, 1200, child.original)])

    def test_poll_interval_cannot_extend_the_deadline(self):
        child = FakeChild(FakeClock())
        result, _ = self.supervise(child, controller.Budget(seconds=2, poll_seconds=1.5))
        self.assert_result(result, exit_code=-signal.SIGTERM, cancel_reason='deadline')
        self.assertEqual(child.delivered, [(signal.SIGTERM, 2, child.original)])

    def test_first_observed_exit_at_or_after_deadline_retains_the_deadline_reason(self):
        for entry_time in (0, 3):
            with self.subTest(entry_time=entry_time):
                child = FakeChild(FakeClock(start=entry_time), exit_at=2)
                child.started_at = 0
                result, _ = self.supervise(child, controller.Budget(seconds=2))
                self.assertEqual(result['exit_code'], 0)
                self.assertEqual(result['cancel_reason'], 'deadline')
                self.assertIs(result['leader_exited'], True)
                self.assertEqual(child.delivered, [])

    def test_free_space_above_the_floor_allows_the_build_to_finish(self):
        child = FakeChild(FakeClock(), exit_at=2)
        result, _ = self.supervise(child, probe=Probe(child.clock, free_bytes=11274289153))
        self.assert_result(result, exit_code=0)
        self.assertEqual(child.delivered, [])

    def test_free_space_at_or_below_10_point_5_gib_cancels(self):
        for free_bytes in (11274289152, 11274289151):
            with self.subTest(free_bytes=free_bytes):
                child = FakeChild(FakeClock())
                result, _ = self.supervise(child, probe=Probe(child.clock, free_bytes=free_bytes))
                self.assert_result(result, exit_code=-signal.SIGTERM, cancel_reason='free_space')
                self.assertEqual(child.delivered, [(signal.SIGTERM, 0, child.original)])

    def test_artifact_bytes_below_three_gib_allow_the_build_to_finish(self):
        child = FakeChild(FakeClock(), exit_at=2)
        result, _ = self.supervise(child, probe=Probe(child.clock, artifact_bytes=3221225471))
        self.assert_result(result, exit_code=0)
        self.assertEqual(child.delivered, [])

    def test_three_gib_artifact_cap_includes_the_exact_boundary(self):
        for artifact_bytes in (3221225472, 3221225473):
            with self.subTest(artifact_bytes=artifact_bytes):
                child = FakeChild(FakeClock())
                result, _ = self.supervise(child, probe=Probe(child.clock, artifact_bytes=artifact_bytes))
                self.assert_result(result, exit_code=-signal.SIGTERM, cancel_reason='artifact_budget')
                self.assertEqual(child.delivered, [(signal.SIGTERM, 0, child.original)])

    def test_growth_after_launch_triggers_cancellation(self):
        child = FakeChild(FakeClock())
        probe = Probe(child.clock, change_at=2, changed={'artifact_bytes': 3221225472})
        result, _ = self.supervise(child, probe=probe)
        self.assert_result(result, exit_code=-signal.SIGTERM, cancel_reason='artifact_budget')
        self.assertEqual(child.delivered, [(signal.SIGTERM, 2, child.original)])

    def test_final_probe_after_success_still_detects_the_artifact_cap(self):
        child = FakeChild(FakeClock(), exit_at=2)
        probe = Probe(child.clock, change_at=2, changed={'artifact_bytes': 3221225472})
        result, _ = self.supervise(child, probe=probe)
        self.assertEqual(result['exit_code'], 0)
        self.assertEqual(result['cancel_reason'], 'artifact_budget')
        self.assertIs(result['leader_exited'], True)
        self.assertEqual(child.delivered, [])

    def test_caller_signal_cancels_only_the_owned_leader(self):
        child = FakeChild(FakeClock())
        result, _ = self.supervise(
            child, cancelled=lambda: signal.SIGINT if child.clock.monotonic() >= 2 else None)
        self.assert_result(result, exit_code=-signal.SIGTERM, cancel_reason='signal')
        self.assertEqual(child.delivered, [(signal.SIGTERM, 2, child.original)])

    def test_exit_observed_with_a_caller_signal_retains_the_signal_reason(self):
        child = FakeChild(FakeClock(), exit_at=2)
        result, _ = self.supervise(
            child, cancelled=lambda: signal.SIGINT if child.clock.monotonic() >= 2 else None)
        self.assertEqual(result['exit_code'], 0)
        self.assertEqual(result['cancel_reason'], 'signal')
        self.assertIs(result['leader_exited'], True)
        self.assertEqual(child.delivered, [])

    def test_source_change_stops_the_build_and_blocks_binary_certification(self):
        child = FakeChild(FakeClock())
        probe = Probe(child.clock, change_at=1, changed={'source_unchanged': False})
        result, _ = self.supervise(child, probe=probe)
        self.assert_result(result, exit_code=-signal.SIGTERM,
                           cancel_reason='source_changed', blocked=True)
        self.assertEqual(child.delivered, [(signal.SIGTERM, 1, child.original)])

    def test_probe_failure_stops_the_leader_but_keeps_the_monitor_blocked(self):
        child = FakeChild(FakeClock())
        result, _ = self.supervise(child, probe=Probe(child.clock, fail_at=1))
        self.assert_result(result, exit_code=-signal.SIGTERM,
                           cancel_reason='monitor_error', blocked=True)
        self.assertEqual(child.delivered, [(signal.SIGTERM, 1, child.original)])

    def test_final_probe_source_change_blocks_even_after_cancellation_exited(self):
        child = FakeChild(FakeClock(), term_exit_delay=1)
        probe = Probe(child.clock, change_at=2, changed={'source_unchanged': False})
        result, _ = self.supervise(child, controller.Budget(seconds=1), probe=probe)
        self.assertEqual(result['exit_code'], -signal.SIGTERM)
        self.assertIs(result['leader_exited'], True)
        self.assertIs(result['blocked'], True)
        self.assertEqual(child.delivered, [(signal.SIGTERM, 1, child.original)])

    def test_final_probe_failure_blocks_even_after_cancellation_exited(self):
        child = FakeChild(FakeClock(), term_exit_delay=1)
        result, _ = self.supervise(child, controller.Budget(seconds=1),
                                   probe=Probe(child.clock, fail_at=2))
        self.assertEqual(result['exit_code'], -signal.SIGTERM)
        self.assertIs(result['leader_exited'], True)
        self.assertIs(result['blocked'], True)
        self.assertEqual(child.delivered, [(signal.SIGTERM, 1, child.original)])

    def test_deadline_or_signal_cannot_hide_a_critical_observation_that_later_recovers(self):
        for cancel_reason, observation in (
                ('deadline', 'source_changed'), ('deadline', 'monitor_error'),
                ('signal', 'source_changed'), ('signal', 'monitor_error')):
            with self.subTest(cancel_reason=cancel_reason, observation=observation):
                child = FakeChild(FakeClock())
                state = {'observed': False, 'recovered': False}

                def recovering_probe():
                    healthy = {'free_bytes': 30 * 1024 ** 3, 'artifact_bytes': 0}
                    if child.clock.monotonic() >= 1 and not state['observed']:
                        state['observed'] = True
                        if observation == 'monitor_error':
                            raise OSError('Synthetic transient monitor failure')
                        return {**healthy, 'source_unchanged': False}
                    if state['observed']:
                        state['recovered'] = True
                    return healthy

                budget = controller.Budget(seconds=1 if cancel_reason == 'deadline' else 1200)
                cancelled = (lambda: signal.SIGINT if child.clock.monotonic() >= 1 else None
                             ) if cancel_reason == 'signal' else lambda: None
                result, _ = self.supervise(child, budget, probe=recovering_probe,
                                           cancelled=cancelled)
                self.assertIs(state['observed'], True)
                self.assertIs(state['recovered'], True)
                self.assert_result(result, exit_code=-signal.SIGTERM,
                                   cancel_reason=cancel_reason, blocked=True)
                self.assertEqual(child.delivered, [(signal.SIGTERM, 1, child.original)])

    def test_any_identity_component_change_prevents_signalling_a_foreign_process(self):
        replacements = (
            {'pid': 9999, 'ppid': 4000, 'pgid': 4101, 'birth': 'synthetic-leader-start'},
            {'pid': 4101, 'ppid': 9999, 'pgid': 4101, 'birth': 'synthetic-leader-start'},
            {'pid': 4101, 'ppid': 4000, 'pgid': 9999, 'birth': 'synthetic-leader-start'},
            {'pid': 4101, 'ppid': 4000, 'pgid': 4101, 'birth': 'synthetic-replacement-start'},
        )
        for replacement in replacements:
            with self.subTest(replacement=replacement):
                child = FakeChild(FakeClock())
                foreign = controller.Identity(**replacement)

                def change_identity(candidate):
                    if candidate.clock.monotonic() >= 1:
                        candidate.current = foreign

                child.before_identity = change_identity
                result, _ = self.supervise(child, controller.Budget(seconds=1))
                self.assert_result(result, exit_code=None, cancel_reason='deadline',
                                   leader_exited=False, identity_verified=False, blocked=True)
                self.assertEqual(child.delivered, [])
                self.assertEqual(child.current, foreign)

    def test_pid_reuse_at_the_signal_boundary_is_rejected_without_delivery(self):
        child = FakeChild(FakeClock())
        foreign = controller.Identity(pid=4101, ppid=5000, pgid=4101,
                                      birth='synthetic-replacement-start')
        child.before_signal = lambda candidate, number: setattr(candidate, 'current', foreign)
        result, _ = self.supervise(child, controller.Budget(seconds=1))
        self.assert_result(result, exit_code=None, cancel_reason='deadline',
                           leader_exited=False, identity_verified=False, blocked=True)
        self.assertEqual(child.delivered, [])
        self.assertEqual(child.rejected, [signal.SIGTERM])

    def test_ignored_term_escalates_to_kill_after_the_term_grace(self):
        child = FakeChild(FakeClock(), term_exit_delay=None)
        result, _ = self.supervise(child, controller.Budget(seconds=2))
        self.assert_result(result, exit_code=-signal.SIGKILL, cancel_reason='deadline')
        self.assertEqual(child.delivered, [(signal.SIGTERM, 2, child.original),
                                           (signal.SIGKILL, 12, child.original)])

    def test_term_grace_waits_for_a_known_exit_without_escalating(self):
        child = FakeChild(FakeClock(), term_exit_delay=4)
        result, _ = self.supervise(child, controller.Budget(seconds=2))
        self.assert_result(result, exit_code=-signal.SIGTERM, cancel_reason='deadline')
        self.assertEqual(child.clock.monotonic(), 6)
        self.assertEqual(child.delivered, [(signal.SIGTERM, 2, child.original)])

    def test_identity_is_checked_again_before_kill(self):
        child = FakeChild(FakeClock(), term_exit_delay=None)
        foreign = controller.Identity(pid=4101, ppid=4000, pgid=4101,
                                      birth='synthetic-replacement-start')

        def replace_before_kill(candidate, number):
            if number == signal.SIGKILL:
                candidate.current = foreign

        child.before_signal = replace_before_kill
        result, _ = self.supervise(child, controller.Budget(seconds=2))
        self.assert_result(result, exit_code=None, cancel_reason='deadline',
                           leader_exited=False, identity_verified=False, blocked=True)
        self.assertEqual(child.delivered, [(signal.SIGTERM, 2, child.original)])
        self.assertEqual(child.rejected, [signal.SIGKILL])

    def test_unknown_exit_after_kill_grace_remains_blocked_with_no_fake_exit_code(self):
        child = FakeChild(FakeClock(), term_exit_delay=None, kill_exit_delay=None)
        result, _ = self.supervise(child, controller.Budget(seconds=2))
        self.assert_result(result, exit_code=None, cancel_reason='deadline',
                           leader_exited=False, blocked=True)
        self.assertEqual(child.clock.monotonic(), 17)
        self.assertEqual(child.delivered, [(signal.SIGTERM, 2, child.original),
                                           (signal.SIGKILL, 12, child.original)])


if __name__ == '__main__':
    unittest.main()
