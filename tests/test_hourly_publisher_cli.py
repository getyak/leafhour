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


class Stage:
    ready = True
    def staging(self):
        return {'ready': self.ready, 'green': True, 'source': SOURCE, 'remote': SOURCE}
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

    def invoke(self, action):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            result = main([action, *self.args])
        return result, json.loads(out.getvalue())

    def test_bootstrap_requires_healthy_legacy_stage_and_stays_disabled(self):
        port = Stage()
        with patch('tools.hourly_publisher.cli.ServerClock', return_value=lambda: 100), patch('tools.hourly_publisher.cli.RuntimePort', return_value=port):
            code, result = self.invoke('init')
        self.assertEqual(code, 0)
        self.assertEqual(result['status'], 'initialized-inactive')
        self.assertEqual(Journal(self.state, BINDING).status()['enabled'], 0)

    def test_paused_or_incorrect_stage_cannot_create_state(self):
        port = Stage(); port.ready = False
        with patch('tools.hourly_publisher.cli.ServerClock', return_value=lambda: 100), patch('tools.hourly_publisher.cli.RuntimePort', return_value=port):
            self.assertEqual(self.invoke('init')[0], 1)
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
