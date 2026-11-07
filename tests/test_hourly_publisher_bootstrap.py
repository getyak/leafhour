import json
import shutil
import tempfile
import unittest
from pathlib import Path

from tools.hourly_publisher.bootstrap import Cutover
from tools.hourly_publisher.controller import Publisher, Snapshot
from tools.hourly_publisher.state import GateError, Journal, WINDOW

L, M, N = (letter * 40 for letter in 'abc')
D = 'dpl_synthetic'
BINDING = {'repository': 'getyak/leafhour', 'project': 'prj_synthetic'}
BASE = [{'id': D, 'source': L, 'ref': 'main', 'state': 'READY'}]


class Port:
    def __init__(self):
        self.main, self.ref, self.branch = M, None, 'main'
        self.ready, self.green, self.records = True, True, BASE.copy()
        self.calls, self.timeout, self.accept = [], False, True

    def inventory(self):
        return self.records

    def staging(self, main, legacy, deployment, production_branch='main'):
        return {'source': self.main, 'remote': self.ref, 'inventory': self.records,
                'ready': self.ready and main == self.main and legacy == L and deployment == D and self.branch == production_branch,
                'green': self.green, 'mainGreen': False}

    def remote(self, optional=False):
        return self.ref

    def seed(self, main, legacy):
        self.calls.append((main, legacy))
        if self.accept:
            self.ref = legacy
        if self.timeout:
            raise GateError('synthetic lost reply')

    def prepare(self):
        return Snapshot(self.main, self.ref, self.ready, False)


class BootstrapTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'state.sqlite3'
        self.now, self.port = 100, Port()
        self.clock = lambda: self.now

    def init(self):
        self.j = Cutover.initialize(self.path, BINDING, self.port, self.clock, M, L, D)
        self.c = Cutover(self.j, self.port, self.clock)

    def test_initializes_before_seed_disabled_and_pins_legacy_not_main(self):
        self.init()
        self.assertEqual(self.j.status()['enabled'], 0)
        self.assertEqual(self.j.status()['expected_ref'], L)
        self.assertIsNone(self.port.ref)
        self.assertEqual(self.j.bootstrap()['receipt']['legacy'], L)
        self.port.main = N
        self.assertEqual(self.c.seed(N, L, D)['status'], 'seed-confirmed-nonpublishing')
        self.assertEqual(self.port.calls, [(N, L)])

    def test_ref_or_existing_state_cannot_be_adopted_or_reset(self):
        self.port.ref = L
        with self.assertRaises(GateError):
            self.init()
        self.port.ref = None
        self.init()
        with self.assertRaises((GateError, FileExistsError)):
            self.init()
        with self.assertRaises(GateError):
            self.c.seed(M, N, D)
        self.assertEqual(self.port.calls, [])

    def test_unknown_seed_survives_restart_and_hours_without_resending(self):
        self.init()
        self.port.timeout, self.port.accept = True, False
        self.assertEqual(self.c.seed(M, L, D)['status'], 'seed-uncertain')
        self.now += 10 * WINDOW
        restarted = Cutover(Journal(self.path, BINDING), self.port, self.clock)
        self.port.main = N
        self.assertEqual(restarted.seed(N, L, D)['status'], 'seed-uncertain')
        self.assertEqual(len(self.port.calls), 1)
        self.assertEqual(self.j.bootstrap()['operations']['seed']['payload']['main'], M)
        with self.assertRaises(GateError):
            self.j.enable(self.now)
        self.port.ref = L
        self.assertEqual(restarted.reconcile_seed()['status'], 'seed-confirmed-nonpublishing')
        self.assertEqual(len(self.port.calls), 1)

    def test_intent_is_fsynced_before_external_effect_and_old_db_restore_is_detected(self):
        self.init()
        backup = self.path.with_suffix('.backup')
        shutil.copyfile(self.path, backup)
        def seed(main, legacy):
            self.assertEqual(Journal(self.path, BINDING).bootstrap()['operations']['seed']['state'], 'uncertain')
            witness = Path(str(self.path) + '.witness').read_text()
            self.assertIn('"operation": "seed"', witness)
            self.port.ref = legacy
        self.port.seed = seed
        self.c.seed(M, L, D)
        shutil.copyfile(backup, self.path)
        with self.assertRaises(GateError):
            Journal(self.path, BINDING)

    def test_tracking_unknown_blocks_enable_and_confirm_starts_new_full_hold(self):
        self.init()
        self.c.seed(M, L, D)
        with self.assertRaises(GateError):
            self.c.tracking_intent(M, L, D)
        self.now += WINDOW
        self.c.tracking_intent(M, L, D)
        self.now += WINDOW
        with self.assertRaises(GateError):
            self.c.ready_to_enable(M, L, D)
        with self.assertRaises(GateError):
            self.c.tracking_intent(M, L, D)
        self.port.branch = 'production'
        self.c.tracking_confirm(M, L, D)
        self.c.ready_to_enable(M, L, D)
        Publisher(self.j, self.port, self.clock).enable()
        self.assertEqual(self.j.status()['cooldown'], self.now + WINDOW)
        self.now += WINDOW
        self.assertEqual(Publisher(self.j, self.port, self.clock).tick()['status'], 'unready')

    def test_late_legacy_or_unknown_inventory_never_enables_or_changes_legacy(self):
        self.init()
        self.port.records = BASE + [{'id': 'dpl_late', 'source': N, 'ref': 'main', 'state': 'READY'}]
        with self.assertRaises(GateError):
            self.c.seed(M, L, D)
        self.assertEqual(self.port.calls, [])
        self.assertEqual(self.j.bootstrap()['receipt']['legacy'], L)


if __name__ == '__main__':
    unittest.main()
