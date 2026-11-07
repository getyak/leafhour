"""Aggregate probe deadlines; only owned host-Python helpers, never native tools."""
import importlib.util
from pathlib import Path
import signal
import sys
import time
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/ios'))
import get328_build_only as controller
from build_only_budget import Budget, Identity, supervise


def healthy():
    return dict(free_bytes=30 * 1024 ** 3, artifact_bytes=0, source_unchanged=True)


class AggregateProbeTests(unittest.TestCase):
    def test_a_slow_probe_is_bounded_by_remaining_child_deadline(self):
        probe = controller.BudgetedProbe(healthy)
        before = probe()
        probe.function = lambda: (time.sleep(5), healthy())[1]
        started = time.monotonic()
        result = probe.until(started + 0.05)
        self.assertLess(time.monotonic() - started, 1)
        self.assertTrue(result['deadline_reached'])
        self.assertFalse(result['fresh'])
        self.assertEqual(result['measured_at'], before['measured_at'])
        self.assertFalse(probe.last_process.is_alive())

    def test_expired_deadline_starts_no_new_probe_and_marks_cached_values(self):
        probe = controller.BudgetedProbe(healthy)
        before = probe()
        original = probe.last_process
        probe.function = lambda: (_ for _ in ()).throw(AssertionError('must not start'))
        result = probe.until(time.monotonic() - 1)
        self.assertEqual(result['measured_at'], before['measured_at'])
        self.assertFalse(result['fresh'])
        self.assertIs(probe.last_process, original)

    def test_probe_failure_is_not_hidden_by_a_previous_healthy_sample(self):
        probe = controller.BudgetedProbe(healthy)
        probe()
        probe.function = lambda: (_ for _ in ()).throw(OSError('synthetic observation failed'))
        with self.assertRaises(RuntimeError):
            probe.until(time.monotonic() + 1)

    def test_no_previous_sample_cannot_be_fabricated_at_an_expired_deadline(self):
        probe = controller.BudgetedProbe(healthy)
        with self.assertRaises(RuntimeError):
            probe.until(time.monotonic() - 1)

    def test_supervisor_passes_one_absolute_remaining_deadline_to_probe_chain(self):
        class Clock:
            now = 1199
            def monotonic(self): return self.now
            def sleep(self, seconds): self.now += seconds
        clock = Clock()
        class Probe:
            until_values = []
            def __call__(self):
                clock.sleep(5)
                return healthy()
            def until(self, deadline):
                self.until_values.append(deadline)
                clock.sleep(min(5, max(0, deadline - clock.now)))
                return healthy()
        class Child:
            started_at = 0
            code = None
            signal_at = None
            identity_value = Identity(200, 100, 100, 'birth')
            def identity(self): return self.identity_value
            def poll(self): return self.code
            def send_signal(self, number, expected):
                self.signal_at = clock.now
                self.code = -number
        probe, child = Probe(), Child()
        result = supervise(child, Budget(), probe, clock, lambda event: None)
        self.assertEqual(probe.until_values[0], 1200)
        self.assertEqual(child.signal_at, 1200)
        self.assertEqual(result['cancel_reason'], 'deadline')

    def test_post_exit_measurement_time_is_not_counted_as_child_runtime(self):
        class Clock:
            now = 1199
            def monotonic(self): return self.now
            def sleep(self, seconds): self.now += seconds
        clock = Clock()
        class Child:
            started_at = 0
            def identity(self): return Identity(200, 100, 100, 'birth')
            def poll(self): return 0
        def probe():
            clock.sleep(5)
            return healthy()
        result = supervise(Child(), Budget(), probe, clock, lambda event: None)
        self.assertEqual(result['exit_code'], 0)
        self.assertIsNone(result['cancel_reason'])


if __name__ == '__main__':
    unittest.main()
