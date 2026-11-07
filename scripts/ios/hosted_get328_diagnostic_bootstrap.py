"""Exclusive, no-post source bootstrap for a separately admitted diagnostic.

Importing this module performs no IO or process operation. The generated first
workflow step includes this exact source after the exact bounded core source.
"""
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shutil
import signal
import stat
import time
import uuid

from hosted_get328_diagnostic_core import Budget, DiagnosticError, Runner

UPLOADER_REF = 'ea165f8d65b6e75b540449e92b4886f43607fa02'
UPLOADER_BYTES = 5051718
UPLOADER_SHA256 = '0165b8a75330f3228f2c7a234b4ff8a107b9139c2b519147f4c8e9fe99b262d8'
CONTROLLER_FILES = (
    'scripts/ios/hosted_get328_diagnostic_core.py',
    'scripts/ios/hosted_get328_diagnostic_admission.py',
    'scripts/ios/hosted_get328_diagnostic.py',
    'scripts/ios/hosted_get328_evidence.py',
    '.github/actions/get328-diagnostic/action.yml',
    '.github/actions/get328-diagnostic/index.cjs',
)
_DIR_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW


def _require(value, reason):
    if not value:
        raise DiagnosticError(reason)


def _canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def _directory(path):
    """Open the actual directory through a no-symlink component chain."""
    path = Path(path)
    _require(path.is_absolute() and '..' not in path.parts, 'invalid_directory')
    fd = os.open('/', _DIR_FLAGS)
    try:
        for part in path.parts[1:]:
            child = os.open(part, _DIR_FLAGS, dir_fd=fd)
            os.close(fd); fd = child
        _require(os.fstat(fd).st_uid == os.getuid(), 'foreign_directory')
        return fd
    except BaseException:
        os.close(fd)
        raise


def _exclusive_directory(parent, name):
    fd = _directory(parent)
    try:
        os.mkdir(name, mode=0o700, dir_fd=fd)
        child = os.open(name, _DIR_FLAGS, dir_fd=fd)
        try:
            _require(os.fstat(child).st_uid == os.getuid(), 'foreign_directory')
        finally:
            os.close(child)
    finally:
        os.close(fd)
    return Path(parent) / name


def _write_json(path, value):
    raw = _canonical(value) + b'\n'
    fd = _directory(path.parent)
    try:
        out = os.open(path.name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=fd)
        with os.fdopen(out, 'wb') as stream:
            stream.write(raw)
    finally:
        os.close(fd)
    return hashlib.sha256(raw).hexdigest()


def _append_ready_output(path):
    path = Path(path)
    parent = _directory(path.parent)
    try:
        fd = os.open(path.name, os.O_WRONLY | os.O_APPEND | os.O_NOFOLLOW, dir_fd=parent)
        with os.fdopen(fd, 'wb') as stream:
            info = os.fstat(stream.fileno())
            _require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid() and info.st_nlink == 1,
                     'output_file_unknown')
            stream.write(b'ready=true\n')
    finally:
        os.close(parent)


def _context(env, event):
    exact = dict(GITHUB_REPOSITORY='getyak/leafhour', GITHUB_REPOSITORY_ID='1415706040',
        GITHUB_EVENT_NAME='push', GITHUB_JOB='diagnose', GITHUB_ACTOR='kubbot',
        GITHUB_ACTOR_ID='124379614', GITHUB_TRIGGERING_ACTOR='kubbot', GITHUB_RUN_ATTEMPT='1',
        GET328_GRANT_COMMENT_ID='6703465445', GET328_GRANT_ISSUER_ID='124379614',
        RUNNER_ENVIRONMENT='github-hosted', RUNNER_OS='macOS', RUNNER_ARCH='X64',
        ImageOS='macos26', ImageVersion='20260824.0517.1',
        DEVELOPER_DIR='/Applications/Xcode_26.6.app/Contents/Developer')
    _require(all(type(env.get(k)) is str and env[k] == v for k, v in exact.items()), 'unapproved_environment')
    _require(platform.system() == 'Darwin' and platform.machine() == 'x86_64', 'unapproved_host')
    repo, sender = event.get('repository'), event.get('sender')
    _require(type(repo) is dict and repo.get('full_name') == 'getyak/leafhour'
             and type(repo.get('id')) is int and repo['id'] == 1415706040
             and repo.get('private') is False, 'unapproved_repository')
    _require(type(sender) is dict and sender.get('login') == 'kubbot'
             and type(sender.get('id')) is int and sender['id'] == 124379614, 'unapproved_sender')
    _require(event.get('created') is True and event.get('deleted') is False
             and event.get('forced') is False, 'unapproved_push')
    ref = env.get('GITHUB_REF', '')
    match = re.fullmatch(r'refs/heads/codex/get-328-environment-once/([0-9a-f]{40})/([0-9a-f]{32})', ref)
    _require(match is not None and event.get('ref') == ref, 'unapproved_ref')
    head = match.group(1)
    _require(event.get('after') == head == env.get('GITHUB_SHA') == env.get('GITHUB_WORKFLOW_SHA'), 'unapproved_head')
    _require(env.get('GITHUB_WORKFLOW_REF') == 'getyak/leafhour/.github/workflows/get328-environment-once.yml@' + ref,
             'unapproved_workflow')
    _require(re.fullmatch(r'[1-9][0-9]{0,19}', env.get('GITHUB_RUN_ID', '')) is not None, 'invalid_run_id')


def _manifest(manifest):
    wanted = [('controller', p) for p in CONTROLLER_FILES] + [('uploader', 'dist/upload/index.js')]
    _require(type(manifest) is list and len(manifest) == len(wanted), 'invalid_source_manifest')
    for item, (scope, path) in zip(manifest, wanted):
        _require(type(item) is dict and set(item) == {'scope', 'path', 'bytes', 'sha256'}
                 and item['scope'] == scope and item['path'] == path
                 and type(item['bytes']) is int and 0 < item['bytes'] <= 8 * 1024**2
                 and type(item['sha256']) is str and re.fullmatch(r'[0-9a-f]{64}', item['sha256']), 'invalid_source_manifest')
    _require(manifest[-1]['bytes'] == UPLOADER_BYTES and manifest[-1]['sha256'] == UPLOADER_SHA256,
             'unapproved_uploader')


def _source_parents(workspace):
    roots = {name: _exclusive_directory(workspace, name) for name in ('controller', 'uploader')}
    for scope, relative in [('controller', p) for p in CONTROLLER_FILES] + [('uploader', 'dist/upload/index.js')]:
        parent = roots[scope]
        for part in Path(relative).parts[:-1]:
            candidate = parent / part
            if not candidate.exists():
                _exclusive_directory(parent, part)
            fd = _directory(candidate); os.close(fd)
            parent = candidate
    return roots


def _download(item, target, url, runner, budget, name, receipt):
    budget.check()
    parent = _directory(target.parent)
    temporary = '.get328-source-' + uuid.uuid4().hex + '.partial'
    try:
        out = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=parent)
        original = os.fstat(out); os.close(out)
        remaining = budget.deadline(20) - budget.now()
        _require(remaining > 0, 'source_deadline')
        path = target.parent / temporary
        # --disable is deliberately the first curl option: no user curlrc,
        # credentials, proxies, redirects or retry settings can be inherited.
        argv = ['/usr/bin/curl', '--disable', '--silent', '--show-error', '--fail-with-body',
                '--proto', '=https', '--noproxy', '*', '--connect-timeout', str(min(5., remaining)),
                '--max-time', str(remaining), '--max-filesize', str(item['bytes']),
                '--write-out', '%{http_code}', '--output', str(path), url]
        code, status_text = runner.run(argv, name, 20, env={})
        budget.check()
        _require(code == 0 and status_text == '200', 'source_http_unknown')
        fd = os.open(temporary, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=parent)
        with os.fdopen(fd, 'rb') as stream:
            before = os.fstat(stream.fileno())
            _require(stat.S_ISREG(before.st_mode) and before.st_uid == os.getuid() and before.st_nlink == 1
                     and (before.st_dev, before.st_ino) == (original.st_dev, original.st_ino)
                     and before.st_size == item['bytes'], 'source_file_unknown')
            digest = hashlib.sha256(); size = 0
            while True:
                budget.check()
                block = stream.read(64 * 1024)
                if not block:
                    break
                size += len(block)
                _require(size <= item['bytes'], 'source_size_changed')
                digest.update(block)
            after = os.fstat(stream.fileno())
            _require((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns)
                     == (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns), 'source_changed')
        actual = digest.hexdigest()
        receipt.update(actual_bytes=size, actual_sha256=actual)
        _require(size == item['bytes'] and actual == item['sha256'], 'source_digest_mismatch')
        budget.check()
        # link() supplies atomic no-clobber publication; rename() could overwrite.
        os.link(temporary, target.name, src_dir_fd=parent, dst_dir_fd=parent, follow_symlinks=False)
        os.unlink(temporary, dir_fd=parent)
        published = os.stat(target.name, dir_fd=parent, follow_symlinks=False)
        _require(stat.S_ISREG(published.st_mode) and published.st_nlink == 1
                 and (published.st_dev, published.st_ino) == (original.st_dev, original.st_ino), 'source_publish_unknown')
        receipt['published'] = True
        return receipt
    finally:
        os.close(parent)


def bootstrap(manifest, *, environ=None, clock=None, runner_factory=None):
    """Fetch a literal seven-file source closure, never admit or execute probes."""
    env = dict(os.environ if environ is None else environ)
    clock = time.monotonic if clock is None else clock
    runner_factory = Runner if runner_factory is None else runner_factory
    began = clock()  # The only origin; precedes host/context/source observations.
    root = None; budget = None; assets = []; previous = {}
    try:
        parent = Path(env['RUNNER_TEMP'])
        root = _exclusive_directory(parent, 'get328-environment')
        stamp = dict(schema_version=1, started_monotonic=began,
                     work_deadline_monotonic=began + 240, deadline_monotonic=began + 330,
                     initial_free_bytes=shutil.disk_usage(root).free,
                     repository=env.get('GITHUB_REPOSITORY'), run_id=env.get('GITHUB_RUN_ID'),
                     run_attempt=1, controller_sha=env.get('GITHUB_SHA'), ref=env.get('GITHUB_REF'),
                     actor=dict(login=env.get('GITHUB_ACTOR'), id=env.get('GITHUB_ACTOR_ID')),
                     image=dict(ImageOS=env.get('ImageOS'), ImageVersion=env.get('ImageVersion'), RUNNER_ARCH=env.get('RUNNER_ARCH')),
                     source_manifest_sha256=hashlib.sha256(_canonical(manifest)).hexdigest())
        _write_json(root / 'start.json', stamp)
        _exclusive_directory(root, 'receipts')
        budget = Budget(stamp, clock=clock)
        for sig in (signal.SIGINT, signal.SIGTERM):
            previous[sig] = signal.signal(sig, budget.cancel)
        budget.check()
        event_path = Path(env['GITHUB_EVENT_PATH'])
        _require(event_path.is_file() and not event_path.is_symlink() and event_path.stat().st_size <= 1024**2,
                 'event_unknown')
        event = json.loads(event_path.read_bytes())
        _context(env, event)
        _manifest(manifest)
        workspace = Path(env['GITHUB_WORKSPACE'])
        fd = _directory(workspace); os.close(fd)
        roots = _source_parents(workspace)
        runner = runner_factory(root, budget)
        for index, item in enumerate(manifest):
            budget.check()
            if item['scope'] == 'controller':
                url = 'https://raw.githubusercontent.com/getyak/leafhour/' + env['GITHUB_SHA'] + '/' + item['path']
            else:
                url = 'https://raw.githubusercontent.com/actions/upload-artifact/' + UPLOADER_REF + '/' + item['path']
            target = roots[item['scope']] / item['path']
            receipt = dict(scope=item['scope'], path=item['path'], url=url, destination=str(target),
                           expected_bytes=item['bytes'], expected_sha256=item['sha256'],
                           actual_bytes=None, actual_sha256=None, published=False)
            assets.append(receipt)
            _download(item, target, url, runner, budget, 'bootstrap-source-' + str(index), receipt)
        budget.check()
        source_sha = _write_json(root / 'receipts/bootstrap-source.json', dict(schema_version=1,
            complete=True, controller_sha=env['GITHUB_SHA'], source_manifest_sha256=stamp['source_manifest_sha256'],
            manifest=manifest, assets=assets))
        proof = dict(schema_version=1, ready=True, run_id=env['GITHUB_RUN_ID'], controller_sha=env['GITHUB_SHA'],
            source_manifest_sha256=stamp['source_manifest_sha256'], source_proof_sha256=source_sha,
            controller_root=str(roots['controller']), uploader_entry=str(roots['uploader'] / 'dist/upload/index.js'),
            uploader_sha256=UPLOADER_SHA256, budget_snapshot=budget.snapshot())
        budget.check()
        _append_ready_output(env['GITHUB_OUTPUT'])
        budget.check()
        _write_json(root / 'receipts/bootstrap-ready.json', proof)
        budget.check()
        return proof
    except BaseException as error:
        if budget is not None:
            budget.stop('bootstrap_failed')
        # Do not mutate a colliding root or extend an expired overall horizon.
        if root is not None and clock() < began + 330:
            try:
                receipts = root / 'receipts'
                if receipts.is_dir() and not receipts.is_symlink():
                    if not (receipts / 'bootstrap-source.json').exists():
                        _write_json(receipts / 'bootstrap-source.json', dict(schema_version=1, complete=False, assets=assets))
                    _write_json(receipts / 'bootstrap-failure.json', dict(ready=False, partial=True,
                        classification='bootstrap_failed', budget_snapshot=budget.snapshot() if budget else None))
            except OSError:
                pass
        if isinstance(error, DiagnosticError):
            raise
        raise DiagnosticError('bootstrap_failed') from None
    finally:
        for sig, handler in previous.items():
            signal.signal(sig, handler)
