"""Offline checks for handing uncertain build teardown back to the session owner.

Only temporary evidence JSON is real. FakeOps supplies all child, device,
session, source, SDK, resource, and product observations.
"""

import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

from test_ios_get328_controller import FakeOps


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / 'scripts/ios/get328_build_only.py'
EXPECTED_HEAD = '1' * 40
UDID = '11111111-2222-3333-4444-555555555555'


def load_controller():
    if 'get328_build_only' in sys.modules:
        return sys.modules['get328_build_only']
    sys.path.insert(0, str(MODULE_PATH.parent))
    spec = importlib.util.spec_from_file_location('get328_build_only', MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class DeferredTeardownTests(unittest.TestCase):
    def setUp(self):
        self.controller = load_controller()
        self.directory = tempfile.TemporaryDirectory(prefix='leafhour-get328-teardown-')
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name)
        self.request = self.controller.Request(
            expected_head=EXPECTED_HEAD, udid=UDID,
            evidence=self.path / 'evidence', products=self.path / 'products')
        self.ops = FakeOps(self.controller.Identity, entry='Shutdown')
        spawn = self.ops.spawn_build

        def spawn_with_device_side_effect(command, log_path):
            child = spawn(command, log_path)
            self.ops.current_state = 'Booted'
            return child

        self.ops.spawn_build = spawn_with_device_side_effect

    def run_build(self):
        report = self.controller.perform_build(self.ops, self.request)
        self.assertIsInstance(report, dict)
        report_path = self.request.evidence / 'report.json'
        self.assertTrue(report_path.is_file(), 'Unknown teardown still needs a durable report')
        self.assertEqual(json.loads(report_path.read_text()), report)
        return report

    def assert_deferred_to_session_owner(self, report):
        self.assertEqual(report['status'], 'blocked')
        self.assertIs(report['build_started'], True)
        self.assertIs(report['next_attempt_allowed'], False)
        self.assertTrue(report.get('provenance_deferred'))
        self.assertIs(report['restoration']['ok'], False)
        self.assertEqual(self.ops.source_calls, 1,
                         'An uncertain live group must not trigger another source hash')
        self.assertEqual(self.ops.sdk_calls, 1,
                         'An uncertain live group must not trigger another SDK hash')
        self.assertEqual(self.ops.product_calls, [])
        self.assertEqual(self.ops.restored, [])
        self.assertEqual(self.ops.current_state, 'Booted')
        self.assertIsNone(report.get('source_after'))
        self.assertIsNone(report.get('sdk_after'))
        self.assertIsNone(report.get('products'))

    def test_unknown_live_child_identity_defers_provenance_and_device_restoration(self):
        self.ops.child.exit_at = None
        with patch.object(self.ops.child, 'identity',
                          side_effect=OSError('Synthetic unknown live child identity')):
            report = self.run_build()
        self.assert_deferred_to_session_owner(report)

    def test_unknown_live_child_exit_defers_provenance_and_device_restoration(self):
        self.ops.child.exit_at = None
        with patch.object(self.ops.child, 'poll',
                          side_effect=OSError('Synthetic unknown child exit')):
            report = self.run_build()
        self.assert_deferred_to_session_owner(report)

    def test_live_group_after_known_leader_exit_defers_expensive_provenance(self):
        self.ops.preflight_quiescent = True
        self.ops.quiescence_values = [False]
        report = self.run_build()
        self.assertEqual(report['build_exit_code'], 0)
        self.assert_deferred_to_session_owner(report)

    def test_unknown_final_group_observation_defers_expensive_provenance(self):
        self.ops.quiescence_error = OSError('Synthetic unknown descendant group')
        report = self.run_build()
        self.assertEqual(report['build_exit_code'], 0)
        self.assert_deferred_to_session_owner(report)

    def test_supervisor_exception_after_spawn_leaves_teardown_to_the_owner(self):
        self.ops.child.exit_at = None
        with patch.object(self.controller, 'supervise',
                          side_effect=RuntimeError('Synthetic supervisor failure after spawn')):
            report = self.run_build()
        self.assertEqual(len(self.ops.spawned), 1)
        self.assert_deferred_to_session_owner(report)


if __name__ == '__main__':
    unittest.main()
