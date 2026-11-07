"""Offline inventory deadline tests: fake SDK/API, plus tiny owned Python children.

No Xcode, CoreSimulator, provider, lease, or device command is executed.
"""
from contextlib import ExitStack
import json
import os
from pathlib import Path
from types import SimpleNamespace
import sys
import tempfile
import time
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/ios'))
import hosted_get328 as driver
import hosted_get328_admission as admission


class StopAfterInitialInventory(RuntimeError):
    """The fake boundary stops prepare before fixture copying or device creation."""


class StopAtPrepareEntry(RuntimeError):
    """Capture the phase deadline before any SDK/API command can start."""


class InventoryDeadlineTests(unittest.TestCase):
    def controller(self, root):
        # Constructor/admission/host checks have separate tests. Exercise the
        # real prepare/cmd/sim methods with only their external runner replaced.
        controller = driver.Controller.__new__(driver.Controller)
        controller.root = root
        controller.source = root / 'source'
        controller.source.mkdir()
        controller.budget = driver.Budget(
            {'started_monotonic': 100, 'deadline_monotonic': 4300}, clock=lambda: 100)
        controller.s = SimpleNamespace(phase_deadline=None, run=mock.Mock())
        return controller

    def test_prepare_initial_read_only_inventory_uses_180_seconds_once_each(self):
        with tempfile.TemporaryDirectory(prefix='get328-inventory-test-') as temp:
            root = Path(temp)
            controller = self.controller(root)
            sdk = root / 'synthetic-sdk'
            (sdk / 'usr/lib').mkdir(parents=True)
            (sdk / 'usr/lib/libSystem.tbd').write_text('targets: [ x86_64-ios-simulator ]\n')
            runtime = root / 'Synthetic.simruntime'
            dyld = runtime / 'Contents/Resources/RuntimeRoot/System/Library/dyld'
            dyld.mkdir(parents=True)
            (dyld / 'dyld_shared_cache_x86_64').write_bytes(b'dyld_v1  x86_64'.ljust(16, b'\0'))
            runtimes = {'runtimes': [{'version': '26.5', 'isAvailable': True,
                         'identifier': 'com.apple.CoreSimulator.SimRuntime.iOS-26-5',
                         'bundlePath': str(runtime)}]}
            jobs = {'total_count': 1, 'jobs': [{'labels': ['macos-26-intel'],
                    'status': 'in_progress', 'runner_name': 'synthetic-runner'}]}

            def command(argv, name, seconds, **kwargs):
                fixed = {'prepare-source-head': driver.SOURCE_SHA,
                         'prepare-controller-head': 'a' * 40,
                         'prepare-source-clean': '', 'prepare-controller-clean': '',
                         'prepare-source-tree': driver.SOURCE_TREE,
                         'xcode-version': 'Xcode 26.6\nBuild version 17F113',
                         'sdk-version': '26.5', 'sdk-path': str(sdk)}
                if name in fixed:
                    return 0, fixed[name]
                if argv == ['xcrun', 'simctl', 'list', 'runtimes', '--json']:
                    return 0, json.dumps(runtimes)
                if argv == ['xcrun', 'simctl', 'list', 'devices', '--json']:
                    raise StopAfterInitialInventory('synthetic inventory boundary')
                raise AssertionError('Unexpected external command: ' + repr(argv))

            controller.s.run.side_effect = command
            env = {'GITHUB_RUN_ID': '99', 'GITHUB_SHA': 'a' * 40,
                   'ImageOS': 'macos26', 'ImageVersion': 'synthetic-image', 'RUNNER_ARCH': 'X64'}
            with ExitStack() as stack:
                stack.enter_context(mock.patch.dict(os.environ, env))
                stack.enter_context(mock.patch.object(driver.time, 'monotonic', return_value=100))
                stack.enter_context(mock.patch.object(driver.shutil, 'disk_usage',
                                                     return_value=SimpleNamespace(free=9 * driver.GIB)))
                stack.enter_context(mock.patch.object(driver.platform, 'machine', return_value='x86_64'))
                fetch = stack.enter_context(mock.patch('hosted_get328_admission.fetch_json',
                        return_value=(jobs, json.dumps(jobs).encode(), '')))
                with self.assertRaises(StopAfterInitialInventory):
                    controller.prepare()
            fetch.assert_called_once_with(admission.API_ROOT + '/actions/runs/99/jobs?per_page=100')
            calls = controller.s.run.call_args_list
            inventory = [call for call in calls if call.args[0][:3] == ['xcrun', 'simctl', 'list']]
            self.assertEqual(len(inventory), 2)
            for kind, name in (('runtimes', 'runtimes'), ('devices', 'initial-devices')):
                with self.subTest(kind=kind):
                    matching = [call for call in inventory if call.args[0][3] == kind]
                    self.assertEqual(len(matching), 1)
                    self.assertEqual(matching[0].args,
                                     (['xcrun', 'simctl', 'list', kind, '--json'], name, 180))
                    self.assertFalse(matching[0].kwargs.get('cleanup', False))
            self.assertEqual(controller.s.phase_deadline, 430)
            self.assertFalse((root / 'receipts/create-intent.json').exists())
            self.assertFalse(any(call.args[0][:3] == ['xcrun', 'simctl', 'create'] for call in calls))

    def capture_prepare_deadline(self, now, expected):
        with tempfile.TemporaryDirectory(prefix='get328-prepare-entry-') as temp:
            controller = self.controller(Path(temp))
            controller.budget = driver.Budget(
                {'started_monotonic': 100, 'deadline_monotonic': 4300}, clock=lambda: now)
            with mock.patch.object(driver.time, 'monotonic', return_value=now), \
                    mock.patch.object(controller, 'identities', side_effect=StopAtPrepareEntry) as identities, \
                    mock.patch('hosted_get328_admission.fetch_json') as fetch:
                with self.assertRaises(StopAtPrepareEntry):
                    controller.prepare()
            identities.assert_called_once_with('prepare')
            fetch.assert_not_called()
            controller.s.run.assert_not_called()
            self.assertEqual(controller.s.phase_deadline, expected)
            # A valid prepare window's 600-second bootstrap is already earlier
            # than this fixed job's 3840-second new-work boundary. Test the
            # global clamp separately on the generic Supervisor, without
            # constructing an invalid Budget to force prepare past bootstrap.
            self.assertLess(controller.budget.start + 600, controller.budget.end - 360)

    def test_prepare_entry_reserves_30_seconds_before_the_six_minute_step_timeout(self):
        self.capture_prepare_deadline(now=100, expected=430)

    def test_prepare_entry_uses_an_earlier_remaining_bootstrap_deadline(self):
        self.capture_prepare_deadline(now=500, expected=700)

    def assert_child_clamped(self, *, bootstrap_remaining=None, reserve_remaining=None,
                             phase_remaining=None):
        with tempfile.TemporaryDirectory(prefix='get328-deadline-child-') as temp:
            root = Path(temp)
            now = time.monotonic()
            if bootstrap_remaining is not None:
                began = now - 600 + bootstrap_remaining
            elif reserve_remaining is not None:
                began = now - (4200 - 360) + reserve_remaining
            else:
                began = now
            budget = driver.Budget({'started_monotonic': began, 'deadline_monotonic': began + 4200})
            supervisor = driver.Supervisor(root, budget,
                sample=lambda: (9 * driver.GIB, 0), poll=.01)
            supervisor.phase_deadline = (budget.start + 600 if bootstrap_remaining is not None
                                         else now + (phase_remaining if phase_remaining is not None else 180))
            started = time.monotonic()
            with self.assertRaises(driver.SafetyError):
                supervisor.run([sys.executable, '-c', 'import time; time.sleep(5)'],
                               'synthetic-inventory', 180)
            elapsed = time.monotonic() - started
            receipt = json.loads((root / 'receipts/synthetic-inventory-command.json').read_text())
            self.assertTrue(receipt['started'])
            self.assertTrue(receipt['reaped'])
            self.assertTrue(receipt['group_absent'])
            self.assertIsNotNone(receipt['raw_exit'])
            self.assertIn('error', receipt)
            self.assertEqual(supervisor.launched, 1)
            self.assertLess(elapsed, 2.5, '180 seconds must not replace the earlier shared deadline')

    def test_180_second_inventory_is_clamped_by_remaining_bootstrap(self):
        self.assert_child_clamped(bootstrap_remaining=.2)

    def test_180_second_inventory_is_clamped_by_an_earlier_phase_deadline(self):
        self.assert_child_clamped(phase_remaining=.2)

    def test_supervisor_180_seconds_is_clamped_by_global_six_minute_reserve(self):
        self.assert_child_clamped(reserve_remaining=.3)

    def test_cleanup_inventory_keeps_30_seconds_and_120_second_phase(self):
        with tempfile.TemporaryDirectory(prefix='get328-cleanup-boundary-') as temp:
            root = Path(temp)
            controller = self.controller(root)
            (root / 'receipts').mkdir()
            udid = '00000000-0000-0000-0000-000000000001'
            (root / 'receipts/device-owner.json').write_text(json.dumps({'udid': udid}))
            controller.s.run.side_effect = [(0, ''), (0, ''), (0, '{"devices":{}}')]
            with mock.patch.object(driver.time, 'monotonic', return_value=100):
                controller.cleanup()
            calls = controller.s.run.call_args_list
            self.assertEqual(len(calls), 3)
            self.assertEqual(calls[-1].args,
                             (['xcrun', 'simctl', 'list', 'devices', '--json'], 'cleanup-device-readback', 30))
            self.assertTrue(all(call.args[2] == 30 and call.kwargs.get('cleanup') is True for call in calls))
            self.assertEqual(controller.s.phase_deadline, 220)


if __name__ == '__main__':
    unittest.main()
