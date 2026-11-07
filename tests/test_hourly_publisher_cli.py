import contextlib
import io
import json
import tempfile
import unittest
import os
import fcntl
import subprocess
import sys
from pathlib import Path
from unittest.mock import patch

from tools.hourly_publisher.cli import main
from tools.hourly_publisher.state import Journal

BINDING = {'repository': 'getyak/leafhour', 'project': 'prj_synthetic'}
SOURCE = 'a' * 40
MAIN = 'b' * 40
PINS = ['--expected-main', MAIN, '--expected-legacy-source', SOURCE, '--legacy-deployment', 'dpl_synthetic']


class Stage:
    ready = True
    def staging(self, *args, **kwargs):
        return {'ready': self.ready, 'green': True, 'source': MAIN, 'remote': None, 'inventory': []}
    def git(self, *args):
        return ''


class CliTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.config, self.state = root/'config.json', root/'state.sqlite3'
        self.config.write_text(json.dumps({'binding': BINDING, 'mirror': str(root/'mirror')}))
        self.args = ['--config', str(self.config), '--state', str(self.state)]

    def invoke(self, action, *extra):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            result = main([action, *self.args, *extra])
        return result, json.loads(out.getvalue())

    def test_offline_status_exposes_persisted_unknown_bootstrap_after_restart(self):
        journal = Journal.create(self.state, BINDING, SOURCE, 100,
            bootstrap={'legacy': SOURCE, 'deployment': 'dpl_synthetic', 'inventory': [], 'cutoverMain': MAIN})
        journal.arm_operation('seed', {'main': MAIN, 'legacy': SOURCE, 'deployment': 'dpl_synthetic'}, 100)
        with patch('tools.hourly_publisher.cli.ServerClock', side_effect=AssertionError('unexpected network')):
            code, result = self.invoke('status')
        self.assertEqual(code, 0)
        self.assertIn('bootstrap', result)
        self.assertEqual(result['bootstrap']['legacy'], SOURCE)
        self.assertEqual(result['bootstrap']['deployment'], 'dpl_synthetic')
        self.assertEqual(result['bootstrap']['operations']['seed'], {'state': 'uncertain', 'requested': 100})
        self.assertNotIn('payload', json.dumps(result))

    def test_release_allowlist_keeps_the_new_cli_import_available(self):
        files = json.loads((Path(__file__).resolve().parents[1]/'release-files.json').read_text())
        self.assertIn('tools/hourly_publisher/bootstrap.py', files)

    def test_bootstrap_requires_healthy_legacy_stage_and_stays_disabled(self):
        port = Stage()
        with patch('tools.hourly_publisher.cli.ServerClock', return_value=lambda: 100), patch('tools.hourly_publisher.cli.RuntimePort', return_value=port):
            code, result = self.invoke('init', *PINS)
        self.assertEqual(code, 0)
        self.assertEqual(result['status'], 'initialized-inactive-before-seed')
        self.assertEqual(Journal(self.state, BINDING).status()['enabled'], 0)

    def test_paused_or_incorrect_stage_cannot_create_state(self):
        port = Stage(); port.ready = False
        with patch('tools.hourly_publisher.cli.ServerClock', return_value=lambda: 100), patch('tools.hourly_publisher.cli.RuntimePort', return_value=port):
            self.assertEqual(self.invoke('init', *PINS)[0], 1)
        self.assertFalse(self.state.exists())

    def test_seed_and_init_require_a_pinned_source_before_network_or_state_creation(self):
        with patch('tools.hourly_publisher.cli.ServerClock', side_effect=AssertionError('unexpected network')):
            for action in ['seed', 'init']:
                code, result = self.invoke(action)
                self.assertEqual(code, 1)
                self.assertIn('expected-main', result['reason'])
        self.assertFalse(self.state.exists())
        self.assertFalse(Path(str(self.state) + '.lock').exists())

    def test_unhealthy_or_existing_seed_never_initializes(self):
        port = Stage()
        with patch.object(port, 'staging', return_value={'ready': True, 'green': True, 'source': MAIN, 'remote': SOURCE}), patch('tools.hourly_publisher.cli.ServerClock', return_value=lambda: 100), patch('tools.hourly_publisher.cli.RuntimePort', return_value=port):
            self.assertEqual(self.invoke('init', *PINS)[0], 1)
        self.assertFalse(self.state.exists())

    def test_inactive_tick_and_emergency_disable_do_not_need_network(self):
        journal = Journal.create(self.state, BINDING, SOURCE, 100)
        with patch('tools.hourly_publisher.cli.ServerClock', side_effect=AssertionError('unexpected network')):
            self.assertEqual(self.invoke('tick')[1]['status'], 'inactive')
            journal.enable(100)
            self.assertEqual(self.invoke('disable')[1]['status'], 'disabled')

    def test_inherited_lock_keeps_a_child_request_exclusive_after_parent_closes(self):
        lock_path = str(self.state) + '.lock'
        fd = os.open(lock_path, os.O_RDWR | os.O_CREAT, 0o600)
        fcntl.flock(fd, fcntl.LOCK_EX)
        child = subprocess.Popen([sys.executable, '-c', 'import sys; print("ready",flush=True); sys.stdin.read()'],
                                 stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, pass_fds=(fd,))
        self.addCleanup(lambda: child.poll() is None and child.kill())
        self.assertEqual(child.stdout.readline().strip(), 'ready')
        os.close(fd)
        self.assertEqual(self.invoke('status')[1]['status'], 'busy')
        child.communicate('', timeout=5)
