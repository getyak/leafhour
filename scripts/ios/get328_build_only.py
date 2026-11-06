#!/usr/bin/env python3
"""GET-328 one-attempt build controller. Default mode is an offline plan.

Real execution is only for a coordinator-granted native window. This program
never installs or launches an app, erases a device, or signals a foreign PID.
"""
from __future__ import annotations

import argparse
from dataclasses import asdict, dataclass
import fcntl
import hashlib
import json
import multiprocessing
import os
from pathlib import Path
import plistlib
import re
import shutil
import signal
import stat
import subprocess
import sys
import time
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_only_budget import Budget, Identity, supervise

REPO = Path(__file__).resolve().parents[2]
TOOLS = Path('/Users/cubxxw/.local/bin')
SESSION = TOOLS / 'dev-ios-session'
GUARD = TOOLS / 'dev-storage-guard'
QA_ID = 'org.leafhour.get328.acceptance20261107'
VALID_STATES = ('Booted', 'Shutdown')
ARTIFACT_PARENT = Path('/private/tmp')


class AdmissionRefused(RuntimeError):
    """A measured refusal before any build leader exists, not unknown exit."""


class NoSessionAdmissionRefused(AdmissionRefused):
    """Measured refusal before selection, lease, or any native observation."""


def inherited_role(environment):
    held = environment.get('IOS_AUTOMATION_LOCK_HELD') == 'true'
    pid = (environment.get('DEV_IOS_SESSION_PID') or '').strip()
    session = (environment.get('DEV_IOS_SESSION_ID') or '').strip()
    claimed = held or bool(pid) or bool(session)
    if not claimed:
        return False
    if not held or not pid.isdigit() or int(pid) <= 1 or not session:
        raise RuntimeError('Incomplete inherited native session claim; never scrub it to start another')
    return True


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.' + uuid.uuid4().hex)
    with temporary.open('x', encoding='utf-8') as handle:
        os.chmod(temporary, 0o600)
        json.dump(value, handle, indent=2, sort_keys=True)
        handle.write('\n')
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)
    descriptor = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def digest(path):
    path = Path(path)
    before = path.stat()
    value = hashlib.sha256()
    with path.open('rb') as handle:
        for data in iter(lambda: handle.read(1024 * 1024), b''):
            value.update(data)
    after = path.stat()
    if (before.st_ino, before.st_size, before.st_mtime_ns) != (after.st_ino, after.st_size, after.st_mtime_ns):
        raise RuntimeError('Input changed while hashing: ' + str(path))
    return value.hexdigest()


@dataclass(frozen=True)
class Request:
    expected_head: str
    udid: str
    evidence: Path
    products: Path


def build_command(request, sdk):
    return [sdk.get('xcodebuild_path', '/usr/bin/xcodebuild'),
            '-project', str(REPO / 'apps/ios/Leafhour.xcodeproj'),
            '-scheme', 'LeafhourGET328CurrentAcceptance', '-configuration', 'GET328Acceptance',
            '-destination', 'platform=iOS Simulator,id=' + request.udid,
            '-derivedDataPath', str(request.products / 'DerivedData'),
            '-resultBundlePath', str(request.evidence / 'build-for-testing.xcresult'),
            '-jobs', '2', '-parallel-testing-enabled', 'NO', 'CODE_SIGNING_ALLOWED=NO',
            'LEAFHOUR_BUNDLE_ID=' + QA_ID, 'ENABLE_PREVIEWS=NO',
            'CLANG_MODULE_CACHE_PATH=' + str(request.products / 'ModuleCache.noindex'),
            'build-for-testing']


def perform_build(ops, request, budget=Budget()):
    """Run inside an already verified real session; injectable offline boundaries."""
    if (request.evidence / 'report.json').exists():
        raise RuntimeError('Refusing to overwrite a previous attempt report')
    request.evidence.mkdir(parents=True, exist_ok=True)
    request.products.mkdir(parents=True, exist_ok=True)
    report = dict(status='blocked', returncode=70, build_exit_code=None, build_started=False,
                  cancellation=None, next_attempt_allowed=False, errors=[],
                  admission_refused=False,
                  restoration=dict(entry=None, final=None, ok=False))
    build = None
    source = sdk = None

    def event(value):
        with (request.evidence / 'monitor.jsonl').open('a', encoding='utf-8') as handle:
            handle.write(json.dumps(value, sort_keys=True) + '\n')
            handle.flush()

    def owned():
        context = ops.verify_session(request.udid)
        if context.get('valid') is not True or context.get('udid') != request.udid:
            raise RuntimeError('No exact owned Primary session')
        return context

    try:
        report['session_context'] = owned()
        if ops.cancelled() is not None:
            raise RuntimeError('Signal received before build admission')
        entry = ops.device_state(request.udid)
        if entry not in VALID_STATES:
            raise RuntimeError('Unknown entry device state')
        report['restoration']['entry'] = entry
        atomic_json(request.evidence / 'entry-state.json', dict(udid=request.udid, state=entry,
                                                              session=report['session_context']))
        source = ops.source_snapshot(request.expected_head)
        if source.get('head') != request.expected_head or source.get('clean') is not True:
            raise RuntimeError('Pinned clean source does not match')
        sdk = ops.sdk_snapshot()
        report.update(source_before=source, sdk_before=sdk)
        atomic_json(request.evidence / 'source-sdk-before.json', dict(source=source, sdk=sdk))
        sample = ops.sample()
        if sample.get('source_unchanged', True) is not True:
            raise RuntimeError('Source changed during admission')
        if sample['free_bytes'] <= budget.min_free_bytes or sample['artifact_bytes'] >= budget.max_new_bytes:
            raise AdmissionRefused('Resource admission threshold reached before spawn')
        owned()
        if not ops.group_quiescent():
            raise RuntimeError('Session child group is not quiescent before build')
        if ops.cancelled() is not None:
            raise RuntimeError('Signal received before spawn')
        command = build_command(request, sdk)
        report['command'] = command
        atomic_json(request.evidence / 'command.json', command)
        child = ops.spawn_build(command, request.evidence / 'build.log')
        report['build_started'] = True
        build = supervise(child, budget, getattr(ops, 'budget_probe', ops.sample), ops.clock, event, ops.cancelled)
        report.update(build_exit_code=build['exit_code'], cancellation=build['cancel_reason'], build=build)
    except AdmissionRefused as error:
        report['admission_refused'] = True
        report['admission_reason'] = str(error)
    except Exception as error:
        report['errors'].append(str(error))
    finally:
        entry = report['restoration']['entry']
        safe_for_provenance = False
        try:
            if entry is not None:
                if report['build_started'] and (not build or not build['leader_exited']
                                               or not build['identity_verified']):
                    raise RuntimeError('Build leader exit/identity is unknown; defer to session owner teardown')
                owned()
                if not ops.group_quiescent():
                    raise RuntimeError('Descendants remain; owner teardown must finish before final state is known')
                state = ops.device_state(request.udid)
                if state not in VALID_STATES:
                    raise RuntimeError('Unknown device state before restore')
                if state != entry:
                    ops.restore_device(request.udid, entry)
                final = ops.device_state(request.udid)
                report['restoration']['final'] = final
                if final != entry or not ops.group_quiescent():
                    raise RuntimeError('Entry device state or group quiescence not restored')
                report['restoration']['ok'] = True
                safe_for_provenance = True
        except Exception as error:
            report['errors'].append('Restoration: ' + str(error))
        try:
            if not safe_for_provenance:
                report['provenance_deferred'] = 'Leader exit, ownership or session quiescence is unproven; return to owner teardown'
            elif source is not None:
                report['source_after'] = ops.source_snapshot(request.expected_head)
                if report['source_after'] != source:
                    raise RuntimeError('Source changed across the build')
            if safe_for_provenance and sdk is not None:
                report['sdk_after'] = ops.sdk_snapshot()
                if report['sdk_after'] != sdk:
                    raise RuntimeError('SDK changed across the build')
            complete = bool(build and build['exit_code'] == 0 and not build['cancel_reason'])
            if safe_for_provenance:
                report['products'] = ops.product_snapshot(request.products, complete)
        except Exception as error:
            report['errors'].append('Provenance/products: ' + str(error))
        safe = (build is not None and build['leader_exited'] and build['identity_verified']
                and not build['blocked'] and report['restoration']['ok'] and not report['errors'])
        # External owner interruption can escalate before finally completes.
        if build and build['cancel_reason'] == 'signal':
            safe = False
        if safe:
            code = build['exit_code']
            report['status'] = 'succeeded' if code == 0 and not build['cancel_reason'] else 'failed'
            report['next_attempt_allowed'] = True
            report['returncode'] = (124 if build['cancel_reason'] == 'deadline' else
                                    75 if build['cancel_reason'] else 128 - code if code < 0 else code)
        if report['admission_refused'] and not report['build_started'] and report['restoration']['ok'] and not report['errors']:
            report.update(status='failed', next_attempt_allowed=True, returncode=75)
        if ops.cancelled() is not None:
            report.update(status='blocked', next_attempt_allowed=False, returncode=70,
                          received_signal=ops.cancelled(), cancellation=report['cancellation'] or 'signal')
        atomic_json(request.evidence / 'report.json', report)
    return report


class RunLatch:
    """Task-only durable gate, separate from the native-session lock."""
    def __init__(self, path):
        self.path = Path(path)
        self.handle = None

    def __enter__(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.handle = self.path.with_suffix(self.path.suffix + '.lock').open('a+')
        try:
            fcntl.flock(self.handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            if self.path.exists():
                state = json.loads(self.path.read_text())
                if not isinstance(state, dict) or state.get('status') != 'ready':
                    raise RuntimeError('Previous attempt is running/blocked/unknown; preserve its evidence')
        except Exception as error:
            self.handle.close()
            self.handle = None
            raise RuntimeError('Build-only retry gate is not ready: ' + str(error))
        return self

    def begin(self, attempt_id, evidence, products):
        atomic_json(self.path, dict(status='running', attempt_id=attempt_id,
                                   evidence=str(evidence), products=str(products), controller_pid=os.getpid()))

    def finish(self, report, session_returncode, readback_state, roots_clear, fence_stable=True):
        restore = report.get('restoration', {})
        build = report.get('build', {})
        known_leader = (report.get('build_exit_code') is not None and build.get('leader_exited') is True
                        and build.get('identity_verified') is True and build.get('blocked') is False
                        and build.get('exit_code') == report.get('build_exit_code'))
        known_refusal = (report.get('admission_refused') is True and report.get('build_started') is False
                         and report.get('build_exit_code') is None and not build
                         and report.get('status') == 'failed' and report.get('returncode') == 75)
        safe = (report.get('status') in ('succeeded', 'failed') and report.get('next_attempt_allowed') is True
                and (known_leader or known_refusal) and restore.get('ok') is True
                and not report.get('errors') and not report.get('received_signal')
                and restore.get('entry') in VALID_STATES and restore.get('final') == restore.get('entry')
                and readback_state == restore.get('entry') and roots_clear is True and fence_stable is True
                and session_returncode == report.get('returncode', report.get('build_exit_code'))
                and (report.get('status') != 'succeeded' or report.get('build_exit_code') == 0))
        previous = json.loads(self.path.read_text())
        final = dict(previous, status='ready' if safe else 'blocked', result=report,
                     session_returncode=session_returncode, readback_state=readback_state,
                     roots_clear=roots_clear, fence_stable=fence_stable)
        atomic_json(self.path, final)
        return final

    def finish_without_session(self, report, roots_clear, source_unchanged):
        # This path cannot attest to SDK/device state: neither was observed.
        # The outer controller alone can assert that it never started a lease.
        fields = {'status', 'returncode', 'admission_refused', 'no_session_started', 'build_started',
                  'build_exit_code', 'next_attempt_allowed', 'errors', 'admission_reason'}
        safe = (set(report).issubset(fields) and report.get('no_session_started') is True and report.get('build_started') is False
                and report.get('build_exit_code') is None and not report.get('build')
                and report.get('admission_refused') is True and report.get('status') == 'failed'
                and report.get('returncode') == 75 and report.get('next_attempt_allowed') is True
                and not report.get('errors') and not report.get('received_signal')
                and 'restoration' not in report and 'session_context' not in report
                and roots_clear is True and source_unchanged is True)
        previous = json.loads(self.path.read_text())
        final = dict(previous, status='ready' if safe else 'blocked', result=report,
                     session_started=False, roots_clear=roots_clear, source_unchanged=source_unchanged)
        atomic_json(self.path, final)
        return final

    def __exit__(self, *unused):
        if self.handle:
            fcntl.flock(self.handle, fcntl.LOCK_UN)
            self.handle.close()


def command_output(args, timeout=5, allowed=(0,)):
    """Bound every host/native observation; never use a shell or print env."""
    process = subprocess.run([str(a) for a in args], cwd=REPO, stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE, text=True, timeout=timeout)
    if process.returncode not in allowed:
        raise RuntimeError('Probe failed: ' + str(args[0]) + ' (exit ' + str(process.returncode) + ')')
    return process


def process_identity(pid):
    text = command_output(['/bin/ps', '-p', str(pid), '-o', 'pid=', '-o', 'ppid=',
                           '-o', 'pgid=', '-o', 'lstart=']).stdout.strip()
    values = text.split(None, 3)
    if len(values) != 4:
        raise RuntimeError('Cannot prove process identity')
    return Identity(int(values[0]), int(values[1]), int(values[2]), values[3])


def ancestor(pid, expected):
    seen = set()
    for _ in range(64):
        if pid == expected:
            return True
        if pid <= 1 or pid in seen:
            return False
        seen.add(pid)
        pid = process_identity(pid).ppid
    return False


def allocated_bytes(roots, timeout=2):
    """Account only owned roots, lstat/no-follow, deduplicating hard links."""
    deadline = time.monotonic() + timeout
    seen = set()

    def walk(fd):
        total = 0
        with os.scandir(fd) as entries:
            for entry in entries:
                if time.monotonic() >= deadline:
                    raise RuntimeError('Artifact accounting probe exceeded its bound')
                try:
                    info = entry.stat(follow_symlinks=False)
                    key = (info.st_dev, info.st_ino)
                    if key in seen:
                        continue
                    seen.add(key)
                    total += info.st_blocks * 512
                    if stat.S_ISDIR(info.st_mode):
                        child = os.open(entry.name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
                        try:
                            total += walk(child)
                        finally:
                            os.close(child)
                except FileNotFoundError:
                    continue  # A removed in-progress temporary is not a partial scan.
        return total

    total = 0
    for root in roots:
        fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            info = os.fstat(fd)
            if (info.st_dev, info.st_ino) not in seen:
                seen.add((info.st_dev, info.st_ino))
                total += info.st_blocks * 512 + walk(fd)
        finally:
            os.close(fd)
    return total


class OwnedBuild:
    def __init__(self, command, log_path):
        self.output = Path(log_path).open('xb')
        self.parent = os.getpid()
        self.group = os.getpgrp()
        self.birth = None
        self.started_at = time.monotonic()
        try:
            # Inherit the real session's child PGID. Only dev-ios-session owns
            # group teardown; this controller never calls killpg or setsid.
            self.process = subprocess.Popen(command, cwd=REPO, stdout=self.output,
                                            stderr=subprocess.STDOUT)
        except Exception:
            self.output.close()
            raise

    def identity(self):
        value = process_identity(self.process.pid)
        if value.ppid != self.parent or value.pgid != self.group:
            raise RuntimeError('Build leader left its verified parent/session group')
        if self.birth is not None and value.birth != self.birth:
            raise RuntimeError('Build PID identity changed')
        self.birth = value.birth
        return value

    def poll(self):
        code = self.process.poll()
        if code is not None and not self.output.closed:
            self.output.flush()
            self.output.close()
        return code

    def send_signal(self, number, expected):
        if self.poll() is not None:
            return
        if self.identity() != expected:
            raise RuntimeError('Refusing a signal to an unproven build leader')
        self.process.send_signal(number)


def devices():
    data = json.loads(command_output(['/usr/bin/xcrun', 'simctl', 'list', 'devices', 'available', '--json']).stdout)
    return {d['udid']: d for group in data['devices'].values() for d in group}


def _probe_entry(function, connection):
    # A resource helper must terminate normally on cancellation instead of
    # inheriting the build controller's cooperative signal handler.
    signal.signal(signal.SIGTERM, signal.SIG_DFL)
    signal.signal(signal.SIGINT, signal.SIG_DFL)
    try:
        connection.send(dict(value=function()))
    except Exception as error:
        connection.send(dict(error=str(error)))
    finally:
        connection.close()


class BudgetedProbe:
    """One aggregate bound across all probes, not one timeout per subprocess.

    A deadline-expired sample is explicitly labelled cached with its ORIGINAL
    measurement time. It can only trigger deadline cancellation; it cannot
    invent a new healthy measurement. After leader exit, take a fresh sample.
    """
    def __init__(self, function):
        self.function = function
        self.last = None
        self.last_process = None

    def __call__(self):
        return self.until(time.monotonic() + 3, deadline_sample=False)

    def until(self, deadline, deadline_sample=True):
        end = min(deadline, time.monotonic() + 3)
        process = None
        receive = send = None
        timed_out = False
        try:
            if end <= time.monotonic():
                timed_out = True
            else:
                context = multiprocessing.get_context('fork')
                receive, send = context.Pipe(duplex=False)
                process = context.Process(target=_probe_entry, args=(self.function, send))
                self.last_process = process
                process.start()
                send.close()
                if not receive.poll(max(0, end - time.monotonic())):
                    timed_out = True
                else:
                    result = receive.recv()
                    if 'error' in result:
                        raise RuntimeError('Resource observation failed: ' + result['error'])
                    self.last = dict(result['value'], measured_at=time.monotonic(), fresh=True)
                    return dict(self.last)
        finally:
            if receive is not None:
                receive.close()
            if send is not None:
                send.close()
            if process is not None:
                process.join(timeout=0.05)
                if process.is_alive():
                    process.terminate()  # Only this exact helper created by us.
                    process.join(timeout=0.05)
                if process.is_alive():
                    process.kill()
                    process.join(timeout=0.1)
                if process.is_alive():
                    raise RuntimeError('Own resource helper exit is unknown')
        if timed_out and deadline_sample and time.monotonic() >= deadline and self.last is not None:
            return dict(self.last, fresh=False, deadline_reached=True)
        raise RuntimeError('Resource probe has no fresh bounded measurement')


def session_fence():
    lock = Path(os.environ.get('IOS_AUTOMATION_LOCK_FILE', '/tmp/ios-automation.xcodebuild.lock'))
    metadata = Path(str(lock) + '.session.json')
    if not lock.exists() and not metadata.exists():
        return None
    if not lock.exists() or not metadata.exists():
        raise RuntimeError('Incomplete native session fence')
    info = json.loads(metadata.read_text())
    owner = int(lock.read_text().strip())
    if info.get('pid') != owner:
        raise RuntimeError('Native lock and metadata disagree')
    return dict(owner_pid=owner, session_id=info.get('session_id'), udid=info.get('udid'),
                lock_inode=lock.stat().st_ino, metadata_hash=digest(metadata))


class RealOps:
    def __init__(self, config, request):
        self.config, self.request = config, request
        self.clock = time
        self.received_signal = None
        self.spawned = False
        self.pinned_source = None
        self.pinned_sdk = None
        self.root_ids = {str(p): (p.stat().st_dev, p.stat().st_ino) for p in (request.evidence, request.products)}
        self.budget_probe = BudgetedProbe(self._sample_now)

    def cancelled(self):
        return self.received_signal

    def verify_session(self, udid):
        if udid != self.request.udid:
            raise RuntimeError('Device argument differs from this attempt request')
        if digest(SESSION) != self.config.get('session_tool_hash'):
            raise RuntimeError('Session helper bytes changed since admission')
        if os.environ.get('DEV_IOS_PROFILE') != 'primary' or os.environ.get('IOS_SIMULATOR_ID') != udid:
            raise RuntimeError('Missing exact inherited Primary selection')
        result = command_output([SESSION, 'is-owner', '--profile', 'primary', '--udid', udid])
        if result.stdout.strip() != 'true':
            raise RuntimeError('Native session inheritance is not genuine')
        fence = session_fence()
        if not fence or fence['udid'] != udid or fence['session_id'] != os.environ.get('DEV_IOS_SESSION_ID'):
            raise RuntimeError('Native ownership metadata changed')
        outer = Identity(**self.config['outer_identity'])
        if not ancestor(os.getpid(), outer.pid) or process_identity(outer.pid) != outer:
            raise RuntimeError('The single-use outer controller is no longer a live ancestor')
        return dict(fence, valid=True, inherited=self.config['inherited'])

    def device_state(self, udid):
        value = devices().get(udid)
        if value is None:
            raise RuntimeError('Selected existing Primary disappeared')
        return value['state']

    def source_snapshot(self, expected_head):
        head = command_output(['git', 'rev-parse', 'HEAD']).stdout.strip()
        clean = not command_output(['git', 'status', '--porcelain']).stdout.strip()
        paths = command_output(['git', 'ls-files', 'apps/ios', 'scripts/ios/get328_build_only.py',
                                'scripts/ios/build_only_budget.py']).stdout.splitlines()
        hashes = {}
        for path in paths:
            value = REPO / path
            if value.is_symlink():
                raise RuntimeError('Unreviewed source symlink: ' + path)
            hashes[path] = digest(value)
        data = dict(head=head, clean=clean, inputs=hashes)
        data['fingerprint'] = hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()
        if head != expected_head or not clean:
            raise RuntimeError('Expected clean source head changed')
        if self.pinned_source is None:
            self.pinned_source = data
        return data

    def sdk_snapshot(self):
        for key in ('XCODE_XCCONFIG_FILE', 'SWIFT_EXEC', 'CC', 'CXX', 'TOOLCHAINS', 'SDKROOT'):
            if os.environ.get(key):
                raise RuntimeError('Unadmitted build environment override: ' + key)
        developer = Path(self.config['developer_dir']).resolve()
        active = (Path(os.environ['DEVELOPER_DIR']).resolve() if os.environ.get('DEVELOPER_DIR') else
                  Path(command_output(['/usr/bin/xcode-select', '-p']).stdout.strip()).resolve())
        if active != developer:
            raise RuntimeError('Admitted developer directory is not the exact active root')
        if os.environ.get('DEVELOPER_DIR') and Path(os.environ['DEVELOPER_DIR']).resolve() != developer:
            raise RuntimeError('Inherited DEVELOPER_DIR differs from admitted SDK')
        sdk = Path(command_output(['/usr/bin/xcrun', '--sdk', 'iphonesimulator', '--show-sdk-path']).stdout.strip()).resolve()
        paths = {}
        for tool in ('xcodebuild', 'swiftc'):
            path = Path(command_output(['/usr/bin/xcrun', '--find', tool]).stdout.strip()).resolve()
            if developer not in path.parents:
                raise RuntimeError('Resolved tool is outside admitted developer directory')
            paths[tool] = dict(path=str(path), sha256=digest(path))
        if developer not in sdk.parents:
            raise RuntimeError('Resolved Simulator SDK is outside admitted developer directory')
        data = dict(developer_dir=str(developer), sdk='iphonesimulator', sdk_path=str(sdk), tools=paths,
                    sdk_version=command_output(['/usr/bin/xcrun', '--sdk', 'iphonesimulator', '--show-sdk-version']).stdout.strip(),
                    xcode_version=command_output([paths['xcodebuild']['path'], '-version']).stdout.strip(),
                    xcodebuild_path=paths['xcodebuild']['path'])
        data['fingerprint'] = hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()
        self.pinned_sdk = data
        return data

    def _validate_roots(self):
        for path, identity in self.root_ids.items():
            value = Path(path).lstat()
            if not stat.S_ISDIR(value.st_mode) or (value.st_dev, value.st_ino) != identity:
                raise RuntimeError('An owned artifact root was replaced')

    def sample(self):
        self._validate_roots()
        return self.budget_probe()

    def _sample_now(self):
        self._validate_roots()
        # Read-only identity checks; no copied environment can maintain a run
        # after its genuine session or outer ancestor goes away.
        self.verify_session(self.request.udid)
        return dict(free_bytes=shutil.disk_usage('/System/Volumes/Data').free,
                    artifact_bytes=allocated_bytes([self.request.evidence, self.request.products]),
                    source_unchanged=command_output(['git', 'rev-parse', 'HEAD']).stdout.strip() == self.request.expected_head
                    and not command_output(['git', 'status', '--porcelain']).stdout.strip())

    def group_quiescent(self):
        probe = subprocess.Popen(['/bin/ps', '-axo', 'pid=,pgid='], stdout=subprocess.PIPE,
                                 stderr=subprocess.PIPE, text=True)
        try:
            text, error = probe.communicate(timeout=3)
        except BaseException:
            try:
                probe.kill()  # Own outstanding Popen, never a PID/group fallback.
                probe.communicate(timeout=1)
            finally:
                for stream in (getattr(probe, 'stdout', None), getattr(probe, 'stderr', None)):
                    if stream is not None:
                        stream.close()
            raise
        if probe.returncode != 0 or error:
            raise RuntimeError('Cannot verify session child group quiescence')
        members = [int(row.split()[0]) for row in text.splitlines()
                   if len(row.split()) == 2 and int(row.split()[1]) == os.getpgrp()
                   and int(row.split()[0]) not in (os.getpid(), probe.pid)]
        return not members

    def spawn_build(self, command, log_path):
        # A valid inherited lease can be shared by an ancestor controller. It
        # does not authorize overlapping a sibling's native compiler.
        active = command_output(['/bin/ps', '-axo', 'pid=,comm=']).stdout.splitlines()
        if any(Path(row.split(None, 1)[1]).name in ('xcodebuild', 'swift-frontend', 'swiftc', 'clang', 'clang++')
               for row in active if len(row.split(None, 1)) == 2):
            raise RuntimeError('Another native compiler is active; refusing to overlap')
        self.spawned = True
        return OwnedBuild(command, log_path)

    def restore_device(self, udid, entry):
        self.verify_session(udid)
        if entry not in VALID_STATES:
            raise RuntimeError('Unknown restoration target')
        command_output(['/usr/bin/xcrun', 'simctl', 'boot' if entry == 'Booted' else 'shutdown', udid])
        until = time.monotonic() + 8
        while time.monotonic() < until:
            self.verify_session(udid)
            if self.device_state(udid) == entry:
                return
            time.sleep(0.2)
        raise RuntimeError('Device restoration did not settle to entry state')

    def product_snapshot(self, products, complete):
        files = {}
        for path in products.rglob('*'):
            if path.is_symlink():
                continue
            if path.is_file() and (path.suffix == '.xctestrun' or path.name in ('Leafhour', 'LeafhourUITests', 'Info.plist')):
                files[str(path)] = dict(size=path.stat().st_size, sha256=digest(path))
        apps = list(products.glob('DerivedData/Build/Products/*/Leafhour.app/Info.plist'))
        if complete:
            if len(apps) != 1 or not any(p.endswith('.xctestrun') for p in files):
                raise RuntimeError('Complete app/test-run products are missing')
            info = plistlib.loads(apps[0].read_bytes())
            if info.get('CFBundleIdentifier') != QA_ID or not (apps[0].parent / 'Leafhour').is_file():
                raise RuntimeError('Built app does not have the exact QA identity/executable')
            if not any(Path(p).name == 'LeafhourUITests' for p in files):
                raise RuntimeError('Built UI test plugin is missing')
        return dict(complete=complete, files=files)


STATE_ROOT = Path('/Users/cubxxw/.local/share/leafhour-reading-evidence/get328-build-only')


def registered_root(label):
    output = command_output([GUARD, 'new-artifact', label], timeout=20).stdout.strip()
    root = Path(output)
    if not root.is_absolute() or root.resolve() != root or root.parent != ARTIFACT_PARENT:
        raise RuntimeError('Artifact registration returned an unexpected path')
    if not root.name.startswith('ai-test-' + label + '.') or not root.is_dir() or any(root.iterdir()):
        raise RuntimeError('Registered artifact root is not fresh/empty')
    return root


def validate_config(path, expected_digest):
    path = Path(path)
    if path.is_symlink() or not stat.S_ISREG(path.lstat().st_mode) or path.stat().st_uid != os.getuid():
        raise RuntimeError('Invalid private run configuration')
    if digest(path) != expected_digest:
        raise RuntimeError('Single-use configuration digest changed')
    config = json.loads(path.read_text())
    evidence, products = Path(config['evidence']), Path(config['products'])
    for root, label in ((evidence, 'GET-328-build-only-evidence'), (products, 'GET-328-build-only-products')):
        if root.resolve() != root or root.parent != ARTIFACT_PARENT or not root.name.startswith('ai-test-' + label + '.'):
            raise RuntimeError('Run configuration is not bound to exact task artifacts')
    if path.parent != evidence or evidence == products:
        raise RuntimeError('Run configuration/artifact binding changed')
    for name in ('get328_build_only.py', 'build_only_budget.py'):
        if digest(Path(__file__).parent / name) != config['controller_hashes'][name]:
            raise RuntimeError('Controller source differs from admitted bytes')
    if digest(SESSION) != config['session_tool_hash']:
        raise RuntimeError('The native-session protocol changed after admission')
    ledger = json.loads((STATE_ROOT / 'ledger.json').read_text())
    if (ledger.get('status') != 'running' or ledger.get('attempt_id') != config['attempt_id']
        or ledger.get('controller_pid') != config['outer_identity']['pid']
        or ledger.get('config_digest') != expected_digest):
        raise RuntimeError('No matching durable outer running intent')
    outer = Identity(**config['outer_identity'])
    if not ancestor(os.getpid(), outer.pid) or process_identity(outer.pid) != outer:
        raise RuntimeError('Run configuration does not belong to a live outer ancestor')
    # The claim cannot be replayed, even while its outer ancestor still lives.
    claim = evidence / 'worker.started'
    with claim.open('x') as handle:
        os.chmod(claim, 0o600)
        handle.write(expected_digest + '\n')
        handle.flush()
        os.fsync(handle.fileno())
    return config, Request(config['expected_head'], config['udid'], evidence, products)


def worker(path, expected_digest):
    config, request = validate_config(path, expected_digest)
    ops = RealOps(config, request)
    previous = {}
    for number in (signal.SIGINT, signal.SIGTERM):
        previous[number] = signal.getsignal(number)
        signal.signal(number, lambda signum, frame: setattr(ops, 'received_signal', signum))
    try:
        return perform_build(ops, request)['returncode']
    finally:
        for number, handler in previous.items():
            signal.signal(number, handler)


def references_clear(products, evidence):
    clear = True
    for label, root in (('product', products), ('evidence', evidence)):
        result = command_output(['/usr/sbin/lsof', '-Fpcn', '+D', str(root)], timeout=5, allowed=(0, 1))
        (evidence / (label + '-references.txt')).write_text(result.stdout + result.stderr)
        clear = clear and result.returncode == 1 and not result.stdout.strip() and not result.stderr.strip()
    return clear


def execute_live(expected_head, developer_dir):
    if sys.platform != 'darwin' or not re.fullmatch('[a-f0-9]{40}', expected_head or ''):
        raise RuntimeError('Real execution requires this Mac and an exact reviewed source SHA')
    if not developer_dir or not Path(developer_dir).is_absolute():
        raise RuntimeError('Admit an exact developer directory before execution')
    inherited = inherited_role(os.environ)  # No stale claim scrubbing or native probes first.
    if command_output(['git', 'rev-parse', 'HEAD']).stdout.strip() != expected_head or command_output(['git', 'status', '--porcelain']).stdout.strip():
        raise RuntimeError('Expected clean source SHA is not current')
    origin = command_output(['git', 'remote', 'get-url', 'origin']).stdout.strip().removesuffix('.git')
    if origin not in ('https://github.com/getyak/leafhour', 'git@github.com:getyak/leafhour'):
        raise RuntimeError('Build source is not the authorized public repository')
    with RunLatch(STATE_ROOT / 'ledger.json') as latch:
        evidence = registered_root('GET-328-build-only-evidence')
        products = registered_root('GET-328-build-only-products')
        attempt = uuid.uuid4().hex
        latch.begin(attempt, evidence, products)
        # State remains running/blocked after any exception or forced exit.
        try:
            for action in ('resources', 'audit'):
                result = command_output([GUARD, action], timeout=30, allowed=(0, 2))
                (evidence / (action + '.txt')).write_text(result.stdout + result.stderr)
                atomic_json(evidence / (action + '-exit.json'), dict(returncode=result.returncode))
            pause = Path('/Users/cubxxw/.agent-pause')
            atomic_json(evidence / 'pause-marker.json', dict(exists=pause.exists(),
                        sha256=digest(pause) if pause.is_file() else None,
                        policy='Recorded advisory; current task thresholds are 3 GiB / 10.5 GiB, never old 30/40 GiB'))
            free = shutil.disk_usage('/System/Volumes/Data').free
            atomic_json(evidence / 'admission-space.json', dict(free_bytes=free, min_free_bytes=Budget().min_free_bytes))
            if free <= Budget().min_free_bytes:
                raise NoSessionAdmissionRefused('Insufficient Data free space before session selection')
            udid = command_output([SESSION, 'select', '--profile', 'primary']).stdout.strip()
            if not re.fullmatch('[A-Fa-f0-9-]{36}', udid):
                raise RuntimeError('Existing Primary selection is invalid')
            config = dict(attempt_id=attempt, expected_head=expected_head, udid=udid,
                          evidence=str(evidence), products=str(products), developer_dir=str(Path(developer_dir).resolve()),
                          outer_identity=asdict(process_identity(os.getpid())), inherited=inherited,
                          session_tool_hash=digest(SESSION),
                          controller_hashes={name: digest(Path(__file__).parent / name)
                                             for name in ('get328_build_only.py', 'build_only_budget.py')})
            path = evidence / 'run-config.json'
            atomic_json(path, config)
            config_hash = digest(path)
            ledger = json.loads(latch.path.read_text())
            atomic_json(latch.path, dict(ledger, config_digest=config_hash))
            command = [str(SESSION), 'run', '--profile', 'primary', '--udid', udid,
                       '--reason', 'GET-328-build-only', '--timeout', '0', '--',
                       sys.executable, str(Path(__file__).resolve()), '--worker', str(path), '--config-sha', config_hash]
            atomic_json(evidence / 'session-command.json', command)
            pending_signal = []
            with (evidence / 'session.log').open('xb') as log:
                session = subprocess.Popen(command, cwd=REPO, stdout=log, stderr=subprocess.STDOUT)
                saved = {}

                def interrupt(number, frame):
                    if not pending_signal:
                        pending_signal.append(number)
                        # This outstanding Popen is our own direct session
                        # child. Its guard forwards only to its owned group.
                        session.send_signal(number)

                for number in (signal.SIGINT, signal.SIGTERM):
                    saved[number] = signal.getsignal(number)
                    signal.signal(number, interrupt)
                try:
                    code = session.wait()  # Guard holds its lease until group teardown is proven.
                finally:
                    for number, handler in saved.items():
                        signal.signal(number, handler)
            report = json.loads((evidence / 'report.json').read_text())
            fence_before = session_fence()
            context = report.get('session_context', {})
            expected_fence = (fence_before and fence_before['owner_pid'] == context.get('owner_pid')
                              and fence_before['session_id'] == context.get('session_id')) if inherited else fence_before is None
            state = None
            clear = False
            if expected_fence:
                # Read-only observation after handoff; never restore outside
                # the owning child. A successor makes this inconclusive.
                state = devices().get(udid, {}).get('state')
                clear = references_clear(products, evidence)
            fence_after = session_fence()
            stable = bool(expected_fence and fence_before == fence_after and not pending_signal
                          and digest(SESSION) == config['session_tool_hash']
                          and command_output(['git', 'rev-parse', 'HEAD']).stdout.strip() == expected_head
                          and not command_output(['git', 'status', '--porcelain']).stdout.strip())
            final = latch.finish(report, code, state, clear, fence_stable=stable)
            atomic_json(evidence / 'outer-final.json', final)
            outer_code = code if final['status'] == 'ready' else 70
            print(json.dumps(dict(evidence=str(evidence), products=str(products), status=final['status'],
                                  build_status=report['status'], returncode=outer_code, session_returncode=code)))
            return outer_code
        except NoSessionAdmissionRefused as error:
            report = dict(status='failed', returncode=75, admission_refused=True,
                          no_session_started=True, build_started=False, build_exit_code=None,
                          next_attempt_allowed=True, errors=[], admission_reason=str(error))
            clear = unchanged = False
            try:
                unchanged = (command_output(['git', 'rev-parse', 'HEAD']).stdout.strip() == expected_head
                             and not command_output(['git', 'status', '--porcelain']).stdout.strip())
                clear = references_clear(products, evidence)
            except Exception as probe_error:
                report['errors'].append('No-session refusal readback: ' + str(probe_error))
            report['next_attempt_allowed'] = bool(clear and unchanged and not report['errors'])
            atomic_json(evidence / 'report.json', report)
            final = latch.finish_without_session(report, clear, unchanged)
            atomic_json(evidence / 'outer-final.json', final)
            outer_code = 75 if final['status'] == 'ready' else 70
            print(json.dumps(dict(evidence=str(evidence), products=str(products), status=final['status'],
                                  build_status='not-started', returncode=outer_code)))
            return outer_code
        except BaseException as error:
            previous = json.loads(latch.path.read_text())
            atomic_json(latch.path, dict(previous, status='blocked', error=str(error)))
            atomic_json(evidence / 'outer-failure.json', dict(error=str(error), build_or_cleanup='unknown', next_attempt_allowed=False))
            raise


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--plan', action='store_true')
    mode.add_argument('--execute', action='store_true')
    mode.add_argument('--worker', help=argparse.SUPPRESS)
    parser.add_argument('--expected-head')
    parser.add_argument('--expected-developer-dir')
    parser.add_argument('--config-sha', help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    if args.worker:
        return worker(args.worker, args.config_sha)
    if args.execute:
        return execute_live(args.expected_head, args.expected_developer_dir)
    print(json.dumps(dict(mode='offline-plan', native_execution=False, budget=asdict(Budget()),
                         scheme='LeafhourGET328CurrentAcceptance', jobs=2,
                         execution='--execute --expected-head <reviewed SHA> --expected-developer-dir <verified path>',
                         artifacts='fresh registered evidence/products per attempt',
                         cleanup='No automatic cleanup; preserve Products for the later seven-case window')))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        print('GET-328 build-only refused: ' + str(error), file=sys.stderr)
        sys.exit(70)
