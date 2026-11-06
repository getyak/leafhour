import concurrent.futures
import multiprocessing
import tempfile
import unittest
import shutil
import json
import subprocess
import sys
from pathlib import Path

from tools.hourly_publisher.state import Journal, GateError, WINDOW
from tools.hourly_publisher.controller import Publisher, Snapshot

A, B, C = (letter * 40 for letter in 'abc')
BINDING = {'repository': 'getyak/leafhour', 'team': 'team_nMU4o8gjejVzBhcnMfqgUQbJ', 'project': 'prj_synthetic', 'branch': 'production', 'url': 'https://leafhour.com'}


def contend(path):
    return Journal(path, BINDING).reserve(B, A, WINDOW)['status']


class FakePort:
    def __init__(self):
        self.source, self.remote, self.ready, self.green = B, A, True, True
        self.provider, self.live, self.pushes = 'pending', None, []
        self.error, self.after_snapshot = False, None

    def prepare(self):
        snap = Snapshot(self.source, self.remote, self.ready, self.green)
        if self.after_snapshot:
            self.after_snapshot(self)
        return snap

    def push(self, source, base):
        self.pushes.append(source)
        if self.error:
            raise RuntimeError('synthetic transport failure')
        self.remote = source

    def observe(self, source):
        return self.remote, self.provider, self.live


class PublisherTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = str(Path(self.temp.name) / 'publisher.sqlite3')
        self.now = 0
        self.j = Journal.create(self.path, BINDING, A, self.now)
        self.p = FakePort()
        self.pub = Publisher(self.j, self.p, lambda: self.now)

    def activate(self):
        self.pub.enable()
        self.now = WINDOW

    def finish(self):
        self.p.provider, self.p.live = 'success', self.p.remote
        return self.pub.tick()

    def test_inactive_controller_makes_no_network_or_push(self):
        self.p.prepare = lambda: self.fail('inactive preparation')
        self.assertEqual(self.pub.tick()['status'], 'inactive')

    def test_rolling_boundary_and_same_source_survive_restart(self):
        self.activate()
        self.assertEqual(self.pub.tick()['status'], 'accepted')
        self.finish()
        self.p.source = C
        self.now = 2 * WINDOW - 0.1
        restarted = Publisher(Journal(self.path, BINDING), self.p, lambda: self.now)
        self.assertEqual(restarted.tick()['status'], 'cooldown')
        self.now = 2 * WINDOW
        self.assertEqual(restarted.tick()['status'], 'accepted')
        self.assertEqual(self.p.pushes, [B, C])

    def test_fresh_enable_has_full_hour_hold(self):
        self.pub.enable()
        self.now = WINDOW - 1
        self.assertEqual(self.pub.tick()['status'], 'cooldown')
        self.assertEqual(self.p.pushes, [])

    def test_a_wall_clock_hour_boundary_never_replaces_3600_elapsed_seconds(self):
        self.pub.enable()
        self.now = 7199  # 01:59:59 on the synthetic UTC clock
        self.assertEqual(self.pub.tick()['status'], 'accepted')
        self.finish()
        self.p.source = C
        for instant in [7200, 10798]:  # new clock hour; then only3,599s elapsed
            self.now = instant
            self.assertEqual(self.pub.tick()['status'], 'cooldown')
        self.assertEqual(self.p.pushes, [B])
        self.now = 10859  # full3,600s plus the documented60s transport guard
        self.assertEqual(self.pub.tick()['status'], 'accepted')
        self.assertEqual(self.p.pushes, [B, C])

    def test_same_source_does_not_create_another_attempt(self):
        self.activate()
        self.pub.tick()
        self.finish()
        self.now += 2 * WINDOW
        self.assertEqual(self.pub.tick()['status'], 'unchanged')
        self.assertEqual(self.p.pushes, [B])

    def test_uncertain_push_never_retries_or_expires_by_time(self):
        self.activate()
        self.p.error = True
        self.assertEqual(self.pub.tick()['status'], 'uncertain')
        self.now += 10 * WINDOW
        self.assertEqual(self.pub.tick()['status'], 'uncertain')
        self.p.source = C
        self.assertEqual(self.pub.tick()['status'], 'uncertain')
        self.assertEqual(self.p.pushes, [B])

    def test_remote_receipt_resolves_crash_without_second_push(self):
        self.activate()
        attempt = self.j.reserve(B, A, self.now)['attempt']
        self.j.arm(attempt, self.now)
        self.p.remote = B  # the push succeeded, process died before recording
        self.now += 50
        self.assertEqual(self.pub.tick()['status'], 'accepted')
        self.finish()
        self.p.source = C
        self.now += WINDOW - 1
        self.assertEqual(self.pub.tick()['status'], 'cooldown')
        self.assertEqual(self.p.pushes, [])

    def test_prepared_expiry_and_disable_fence_stale_worker(self):
        self.activate()
        attempt = self.j.reserve(B, A, self.now)['attempt']
        self.now += 121
        replacement = self.j.reserve(C, A, self.now)['attempt']
        with self.assertRaises(GateError):
            self.j.arm(attempt, self.now)
        self.j.disable(self.now)
        with self.assertRaises(GateError):
            self.j.arm(replacement, self.now)

    def test_failure_keeps_cooldown_and_requires_explicit_recovery(self):
        self.activate()
        self.pub.tick()
        self.p.provider = 'failure'
        self.assertEqual(self.pub.tick()['status'], 'failed')
        self.now += 2 * WINDOW
        self.p.source = C
        self.assertEqual(self.pub.tick()['status'], 'blocked')
        self.assertEqual(self.p.pushes, [B])

    def test_clock_rollback_and_ref_drift_fail_closed(self):
        self.activate()
        self.pub.tick()
        self.finish()
        self.now -= 1
        with self.assertRaises(GateError):
            self.pub.tick()
        self.now += 2 * WINDOW
        self.p.remote = C
        self.assertEqual(self.pub.tick()['status'], 'drift')

    def test_stale_main_unready_target_and_red_ci_do_not_push(self):
        self.activate()
        for field in ['ready', 'green']:
            setattr(self.p, field, False)
            self.assertEqual(self.pub.tick()['status'], 'unready')
            setattr(self.p, field, True)
        self.p.after_snapshot = lambda port: setattr(port, 'source', C)
        self.assertEqual(self.pub.tick()['status'], 'superseded')
        self.assertEqual(self.p.pushes, [])

    def test_true_multiprocess_contention_has_one_reservation(self):
        self.activate()
        with concurrent.futures.ProcessPoolExecutor(4, mp_context=multiprocessing.get_context('spawn')) as pool:
            results = list(pool.map(contend, [self.path] * 8))
        self.assertEqual(results.count('reserved'), 1)

    def test_lost_or_rebound_state_cannot_silently_restart(self):
        with self.assertRaises(GateError):
            Journal(self.path, {**BINDING, 'project': 'prj_other'})
        Path(self.path).unlink()
        with self.assertRaises(GateError):
            self.pub.tick()

    def test_restored_old_database_is_rejected_even_by_a_new_process(self):
        self.activate()
        self.pub.tick()
        self.finish()
        backup = self.path + '.backup'
        shutil.copy2(self.path, backup)
        self.now += WINDOW
        attempt = self.j.reserve(C, B, self.now)['attempt']
        self.j.arm(attempt, self.now)
        # Copying an old backup in place keeps inode unchanged; the independent
        # armed-request witness must still catch the lost in-flight attempt.
        shutil.copyfile(backup, self.path)
        with self.assertRaises(GateError):
            Journal(self.path, BINDING)
        replacement = Path(self.path + '.replacement')
        shutil.copy2(backup, replacement)
        replacement.replace(self.path)
        with self.assertRaises(GateError):
            Journal(self.path, BINDING)

    def test_killed_worker_after_arming_remains_unknown_after_restart(self):
        self.activate()
        script = '''import json,os,sys
from tools.hourly_publisher.state import Journal,WINDOW
j=Journal(sys.argv[1],json.loads(sys.argv[2]))
a=j.reserve(sys.argv[3],sys.argv[4],WINDOW)['attempt'];j.arm(a,WINDOW)
os._exit(17)
'''
        result = subprocess.run([sys.executable, '-c', script, self.path, json.dumps(BINDING), B, A])
        self.assertEqual(result.returncode, 17)
        self.now += 5 * WINDOW
        restarted = Publisher(Journal(self.path, BINDING), self.p, lambda: self.now)
        self.assertEqual(restarted.tick()['status'], 'uncertain')
        self.assertEqual(self.p.pushes, [])

    def test_crash_between_witness_and_sql_commit_requires_offline_recovery(self):
        self.activate()
        script = '''import json,os,sys
from tools.hourly_publisher.state import Journal,WINDOW
j=Journal(sys.argv[1],json.loads(sys.argv[2]))
a=j.reserve(sys.argv[3],sys.argv[4],WINDOW)['attempt']
os.fsync=lambda fd:os._exit(18)
j.arm(a,WINDOW)
'''
        result = subprocess.run([sys.executable, '-c', script, self.path, json.dumps(BINDING), B, A])
        self.assertEqual(result.returncode, 18)
        with self.assertRaises(GateError):
            Journal(self.path, BINDING)


if __name__ == '__main__':
    unittest.main()
