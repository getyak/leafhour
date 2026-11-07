"""Bounded offline mechanics for the separately admitted hosted diagnostic.

This module does not admit or trigger a workflow, contact a provider, or inspect
an SDK/device. The collector must reuse its Budget and persist snapshot() when
crossing process boundaries. Only explicitly spawned process groups are owned.
"""
from collections.abc import Mapping
import json
import math
import os
from pathlib import Path
import re
import selectors
import signal
import stat
import subprocess
import time

GIB = 1024 ** 3
DEVELOPER_DIR = '/Applications/Xcode_26.6.app/Contents/Developer'
OUTPUT_LIMIT = 512 * 1024
EVIDENCE_LIMIT = 32 * 1024 ** 2
RECEIPT_HEADROOM = 32768
SAFE_ENV = ('PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL')
_UPLOADER_INPUTS = frozenset(('INPUT_IF-NO-FILES-FOUND', 'INPUT_INCLUDE-HIDDEN-FILES',
                            'INPUT_RETENTION-DAYS', 'INPUT_COMPRESSION-LEVEL'))
_ERROR_CODES = frozenset('invalid_stamp invalid_final_stamp invalid_stop_stamp invalid_cancel_stamp '
    'clock_unknown global_deadline final_deadline work_deadline work_closed invalid_phase '
    'invalid_command_duration invalid_root_or_poll unknown_evidence_directory resource_unknown '
    'resource_floor evidence_limit command_deadline invalid_environment receipt_limit '
    'group_probe_unknown reaped_group_unknown owned_group_unknown invalid_command receipt_exists '
    'nonzero_exit cancelled command_unknown receipt_unknown output_limit diagnostic_unknown'.split())


class DiagnosticError(RuntimeError):
    """A stable classification; external exception/output text is never added."""

    def __init__(self, code):
        super().__init__(code if isinstance(code, str) and code in _ERROR_CODES else 'diagnostic_unknown')


def _number(value):
    return type(value) in (int, float) and math.isfinite(value)


class Budget:
    def __init__(self, stamp, clock=time.monotonic):
        self.clock = clock
        self.stopped = False
        self.stop_reason = None
        self.cancel_signal = None
        if not isinstance(stamp, Mapping) or type(stamp.get('schema_version')) is not int or stamp['schema_version'] != 1:
            raise DiagnosticError('invalid_stamp')
        self.start = stamp.get('started_monotonic')
        self.work_end = stamp.get('work_deadline_monotonic')
        self.end = stamp.get('deadline_monotonic')
        self.initial_free_bytes = stamp.get('initial_free_bytes')
        if not (all(_number(v) for v in (self.start, self.work_end, self.end))
                and self.start >= 0 and self.work_end == self.start + 240 and self.end == self.start + 330
                and type(self.initial_free_bytes) is int and self.initial_free_bytes >= 8 * GIB):
            raise DiagnosticError('invalid_stamp')
        self._last_now = stamp.get('observed_monotonic', self.start)
        if not _number(self._last_now) or self._last_now < self.start:
            raise DiagnosticError('invalid_stamp')
        self.final_start = stamp.get('final_started_monotonic')
        self.final_end = stamp.get('final_deadline_monotonic')
        if self.final_start is not None:
            if not (_number(self.final_start) and self.start <= self.final_start < self.end
                    and _number(self.final_end) and self.final_end == min(self.final_start + 90, self.end)):
                raise DiagnosticError('invalid_final_stamp')
        elif self.final_end is not None:
            raise DiagnosticError('invalid_final_stamp')
        stopped = stamp.get('stopped', False)
        reason = stamp.get('stop_reason')
        cancelled = stamp.get('cancel_signal')
        if (type(stopped) is not bool or (stopped and not (isinstance(reason, str) and reason))
                or (not stopped and (reason is not None or cancelled is not None))):
            raise DiagnosticError('invalid_stop_stamp')
        if cancelled is not None and (type(cancelled) is not int or cancelled <= 0):
            raise DiagnosticError('invalid_cancel_stamp')
        self.stopped, self.stop_reason, self.cancel_signal = stopped, reason, cancelled
        self.now()

    def now(self):
        try:
            now = self.clock()
        except Exception:
            self.stop('clock_unknown')
            raise DiagnosticError('clock_unknown') from None
        if not _number(now) or now < self._last_now:
            self.stop('clock_unknown')
            raise DiagnosticError('clock_unknown')
        self._last_now = now
        return now

    def stop(self, reason):
        if not self.stopped:
            self.stopped = True
            self.stop_reason = reason if isinstance(reason, str) and 0 < len(reason) <= 128 else 'unknown'

    def cancel(self, signum, frame=None):
        if self.cancel_signal is None:
            self.cancel_signal = int(signum)
        self.stop('cancelled')

    def begin_final(self):
        if self.final_start is None:
            now = self.now()
            if now >= self.end:
                self.stop('global_deadline')
                raise DiagnosticError('global_deadline')
            self.final_start = now
            self.final_end = min(now + 90, self.end)
        return self.final_end

    def check(self, final=False):
        if type(final) is not bool:
            self.stop('invalid_phase')
            raise DiagnosticError('invalid_phase')
        boundary = self.begin_final() if final else self.work_end
        now = self.now()
        if now >= min(boundary, self.end):
            self.stop('final_deadline' if final else 'work_deadline')
            raise DiagnosticError('final_deadline' if final else 'work_deadline')
        if not final and (self.stopped or self.final_start is not None):
            raise DiagnosticError(self.stop_reason or 'work_closed')
        return now

    def _plan(self, seconds, final=False):
        if not _number(seconds) or not 0 < seconds <= 20:
            self.stop('invalid_command_duration')
            raise DiagnosticError('invalid_command_duration')
        now = self.check(final)
        horizon = min(now + seconds, self.final_end if final else self.work_end, self.end)
        span = horizon - now
        # All termination and receipt work fits INSIDE the command/phase/global
        # horizon. Short test/remaining windows receive proportional reserves.
        receipt_tail = min(.1, span * .05)
        stop_tail = min(2., span * .4)
        return horizon - receipt_tail - stop_tail, horizon - receipt_tail, horizon

    def deadline(self, seconds, final=False):
        return self._plan(seconds, final)[0]

    def snapshot(self):
        return dict(schema_version=1, started_monotonic=self.start,
                    work_deadline_monotonic=self.work_end, deadline_monotonic=self.end,
                    initial_free_bytes=self.initial_free_bytes,
                    observed_monotonic=self._last_now,
                    final_started_monotonic=self.final_start, final_deadline_monotonic=self.final_end,
                    stopped=self.stopped, stop_reason=self.stop_reason, cancel_signal=self.cancel_signal)


class Runner:
    def __init__(self, root, budget, sample=None, poll=.02):
        self.root = Path(root)
        self.budget = budget
        self.poll = poll
        self.launched = 0
        if not (_number(poll) and .001 <= poll <= 1 and self.root.is_absolute()
                and self.root.is_dir() and not self.root.is_symlink() and self.root.stat().st_uid == os.getuid()):
            self.fail('invalid_root_or_poll')
        for name in ('logs', 'receipts'):
            path = self.root / name
            path.mkdir(exist_ok=True, mode=0o700)
            if path.is_symlink() or not path.is_dir() or path.stat().st_uid != os.getuid():
                self.fail('unknown_evidence_directory')
        self.sample = sample if sample is not None else self.resources

    def fail(self, reason):
        self.budget.stop(reason)
        raise DiagnosticError(reason)

    def resources(self):
        """Measure only the owned root using no-follow directory descriptors."""
        scan_end = min(self.budget.end, self.budget.now() + 1)
        total = 0
        def walk(descriptor):
            nonlocal total
            for name in os.listdir(descriptor):
                if self.budget.now() >= scan_end:
                    raise DiagnosticError('resource_unknown')
                info = os.stat(name, dir_fd=descriptor, follow_symlinks=False)
                if stat.S_ISLNK(info.st_mode):
                    continue
                if stat.S_ISDIR(info.st_mode):
                    child = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=descriptor)
                    try:
                        current = os.fstat(child)
                        if (current.st_dev, current.st_ino) != (info.st_dev, info.st_ino):
                            raise DiagnosticError('resource_unknown')
                        walk(child)
                    finally:
                        os.close(child)
                elif stat.S_ISREG(info.st_mode):
                    total += info.st_size
                else:
                    raise DiagnosticError('resource_unknown')
        fd = os.open(self.root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            walk(fd)
            volume = os.fstatvfs(fd)
            free = volume.f_bavail * volume.f_frsize
        finally:
            os.close(fd)
        return free, total, total

    def _sample(self):
        try:
            values = self.sample()
            if not (type(values) in (tuple, list) and len(values) == 3
                    and all(type(v) is int and v >= 0 for v in values)):
                raise DiagnosticError('resource_unknown')
        except Exception:
            self.fail('resource_unknown')
        free, scratch, evidence = values
        if free <= 3 * GIB or max(scratch, self.budget.initial_free_bytes - free) >= 4 * GIB:
            self.fail('resource_floor')
        if evidence >= EVIDENCE_LIMIT - RECEIPT_HEADROOM:
            self.fail('evidence_limit')
        return free, scratch, evidence

    def _within(self, deadline):
        if self.budget.now() >= deadline:
            self.fail('command_deadline')

    def _remaining(self, deadline):
        remaining = deadline - self.budget.now()
        if remaining <= 0:
            self.fail('command_deadline')
        return remaining

    @staticmethod
    def _environment(extra=None):
        result = {key: os.environ[key] for key in SAFE_ENV if key in os.environ}
        result['DEVELOPER_DIR'] = DEVELOPER_DIR
        if extra is not None:
            if not isinstance(extra, Mapping):
                raise DiagnosticError('invalid_environment')
            for key, value in extra.items():
                if not (isinstance(key, str) and (re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', key)
                                                or key in _UPLOADER_INPUTS)
                        and isinstance(value, str) and '\0' not in value
                        and (key != 'DEVELOPER_DIR' or value == DEVELOPER_DIR)):
                    raise DiagnosticError('invalid_environment')
                result[key] = value
        return result

    def _save(self, path, value, deadline):
        self._within(deadline)
        raw = (json.dumps(value, sort_keys=True, indent=2) + '\n').encode()
        if len(raw) > 16384:
            self.fail('receipt_limit')
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(descriptor, 'wb') as handle:
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())

    def group_members(self, pgid, deadline):
        """A bounded, read-only ps helper; never chooses a group to signal."""
        self._within(deadline)
        probe = None
        selector = selectors.DefaultSelector()
        data = bytearray()
        execute_end = min(self.budget.now() + .25, deadline - .02)
        try:
            self._within(execute_end)
            probe = subprocess.Popen(['/bin/ps', '-axo', 'pid=,pgid=,stat='],
                stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                env=self._environment(), start_new_session=True, bufsize=0)
            os.set_blocking(probe.stdout.fileno(), False)
            selector.register(probe.stdout, selectors.EVENT_READ)
            eof = False
            while not (eof and probe.poll() is not None):
                self._within(execute_end)
                for key, unused in selector.select(min(self.poll, max(0, execute_end - self.budget.now()))):
                    block = os.read(key.fd, min(8192, 65537 - len(data)))
                    if block:
                        data.extend(block)
                        if len(data) > 65536:
                            raise DiagnosticError('group_probe_unknown')
                    else:
                        eof = True
                        selector.unregister(key.fileobj)
            if probe.returncode != 0:
                raise DiagnosticError('group_probe_unknown')
            members = {}
            for line in data.decode('ascii').splitlines():
                parts = line.split()
                if len(parts) != 3 or not parts[0].isdigit() or not parts[1].isdigit():
                    raise DiagnosticError('group_probe_unknown')
                if int(parts[1]) == pgid:
                    members[int(parts[0])] = parts[2]
            return members
        except Exception:
            self.budget.stop('group_probe_unknown')
            raise DiagnosticError('group_probe_unknown') from None
        finally:
            selector.close()
            if probe is not None:
                if probe.returncode is None and self.budget.now() < deadline:
                    try:
                        self._within(deadline)
                        os.killpg(probe.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    try:
                        probe.wait(timeout=self._remaining(deadline))
                    except (subprocess.TimeoutExpired, DiagnosticError):
                        self.budget.stop('group_probe_unknown')
                if probe.stdout is not None:
                    probe.stdout.close()

    def stop_owned(self, child, deadline):
        """No ps/wait/signal after the same reserved absolute stop deadline."""
        self._within(deadline)
        if child.poll() is not None:
            if self.group_members(child.pid, deadline):
                self.fail('reaped_group_unknown')
            return
        try:
            for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGKILL):
                self._within(deadline)
                if child.returncode is not None or os.getpgid(child.pid) != child.pid:
                    self.fail('owned_group_unknown')
                self._within(deadline)
                try:
                    os.killpg(child.pid, sig)
                except ProcessLookupError:
                    pass
                until = min(deadline - .03, self.budget.now() + min(.15, (deadline - self.budget.now()) / 4))
                while self.budget.now() < until:
                    members = self.group_members(child.pid, deadline)
                    if not members or (set(members) == {child.pid} and members[child.pid].startswith('Z')):
                        self._within(deadline)
                        child.wait(timeout=self._remaining(deadline))
                        if self.group_members(child.pid, deadline):
                            self.fail('reaped_group_unknown')
                        return
                    time.sleep(min(self.poll, max(0, until - self.budget.now())))
            self._within(deadline)
            child.wait(timeout=self._remaining(deadline))
            if self.group_members(child.pid, deadline):
                self.fail('reaped_group_unknown')
        except Exception:
            # An unknown ps result never licenses another probe or another
            # numeric group after reap. An unreaped, still-owned group may be
            # killed once within the existing deadline, without claiming proof.
            if child.returncode is None and self.budget.now() < deadline:
                try:
                    if os.getpgid(child.pid) == child.pid:
                        self._within(deadline)
                        os.killpg(child.pid, signal.SIGKILL)
                        child.wait(timeout=self._remaining(deadline))
                except (ProcessLookupError, subprocess.TimeoutExpired, DiagnosticError):
                    pass
            self.fail('owned_group_unknown')

    def run(self, argv, name, seconds=20, *, final=False, cwd=None, env=None,
            output_limit=OUTPUT_LIMIT, allow_failure=False, capture=True):
        if not (isinstance(name, str) and re.fullmatch(r'[A-Za-z0-9_.-]{1,80}', name)
                and type(capture) is bool and (capture or final is True)
                and type(output_limit) is int and 0 < output_limit <= OUTPUT_LIMIT
                and isinstance(argv, (list, tuple)) and argv
                and all(isinstance(v, (str, Path)) for v in argv)):
            self.fail('invalid_command')
        argv = [str(v) for v in argv]
        if len(json.dumps(argv).encode()) > 8192:
            self.fail('invalid_command')
        try:
            child_env = self._environment(env)
        except DiagnosticError:
            self.fail('invalid_environment')
        self.budget.check(final)
        active_end, stop_end, horizon = self.budget._plan(seconds, final)
        unused_free, unused_scratch, evidence = self._sample()
        self.budget.check(final)
        cap = min(output_limit, EVIDENCE_LIMIT - RECEIPT_HEADROOM - evidence)
        owner = self.root / 'receipts' / (name + '-owner.json')
        command = self.root / 'receipts' / (name + '-command.json')
        logfile = self.root / 'logs' / (name + '.log')
        if any(path.exists() or path.is_symlink() for path in (owner, command, logfile)):
            self.fail('receipt_exists')
        record = dict(started=False, raw_exit=None, reaped=False, group_absent=False, partial=False,
                      output_policy='bounded-capture' if capture else 'discarded-provider-sensitive',
                      deadline_monotonic=horizon, active_deadline_monotonic=active_end,
                      stop_deadline_monotonic=stop_end)
        if capture:
            record['argv'] = argv
        child = None
        log = None
        selector = selectors.DefaultSelector()
        output = bytearray()
        problem = None
        try:
            self._within(active_end)
            if capture:
                log = logfile.open('xb')
            # Resource sampling and opening the log may deliver cancellation.
            # Recheck the shared stop state at the actual spawn boundary.
            if self.budget.check(final) >= active_end:
                self.fail('command_deadline')
            child = subprocess.Popen(argv, cwd=cwd, env=child_env, stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE if capture else subprocess.DEVNULL,
                stderr=subprocess.STDOUT if capture else subprocess.DEVNULL,
                start_new_session=True, bufsize=0)
            self.launched += 1
            record.update(started=True, pid=child.pid, pgid=child.pid, started_monotonic=self.budget.now())
            self._save(owner, record, active_end)
            eof = not capture
            if capture:
                os.set_blocking(child.stdout.fileno(), False)
                selector.register(child.stdout, selectors.EVENT_READ)
            while True:
                self.budget.check(final)
                self._sample()
                self._within(active_end)
                code = child.poll()
                if code is not None and eof:
                    break
                if capture:
                    events = selector.select(min(self.poll, max(0, active_end - self.budget.now())))
                    for key, unused in events:
                        block = os.read(key.fd, min(16384, cap - len(output) + 1))
                        if not block:
                            eof = True
                            selector.unregister(key.fileobj)
                            continue
                        take = block[:cap - len(output)]
                        output.extend(take)
                        log.write(take)
                        log.flush()
                        if len(output) >= cap:
                            record['partial'] = True
                            self.fail('output_limit')
                else:
                    time.sleep(min(self.poll, max(0, active_end - self.budget.now())))
            # Preserve raw zero when post-exit measurement fails. A caller
            # opting into observed nonzero still cannot start new work.
            if child.returncode != 0:
                self.budget.stop('nonzero_exit')
            self._sample()
            self._within(active_end)
            if child.returncode == 0:
                self.budget.check(final)
            elif not allow_failure:
                raise DiagnosticError('nonzero_exit')
        except BaseException as error:
            if isinstance(error, KeyboardInterrupt):
                self.budget.cancel(signal.SIGINT)
                problem = 'cancelled'
            else:
                problem = str(error) if isinstance(error, DiagnosticError) else 'command_unknown'
            self.budget.stop(problem)
        finally:
            selector.close()
            if child is not None:
                try:
                    self.stop_owned(child, stop_end)
                    record['group_absent'] = True
                except Exception:
                    problem = 'owned_group_unknown'
                    self.budget.stop(problem)
                record.update(raw_exit=child.returncode, reaped=child.returncode is not None)
                if child.stdout is not None:
                    child.stdout.close()
            if log is not None:
                log.close()
            record.update(finished_monotonic=self.budget.now())
            if capture:
                record['output_bytes'] = len(output)
            if problem is not None:
                record['error'] = problem
            try:
                self._save(command, record, horizon)
            except Exception:
                self.budget.stop('receipt_unknown')
                problem = 'receipt_unknown'
        if problem is not None:
            raise DiagnosticError(problem)
        return record['raw_exit'], output.decode('utf-8', errors='replace') if capture else ''
