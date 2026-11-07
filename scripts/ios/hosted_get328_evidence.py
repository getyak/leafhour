"""Bounded, stdlib-only transport for one hosted GET-328 evidence directory.

Archives only logs/results/products/receipts/fixture, including hidden files.
The manifest binds the exact uploaded tar, every payload hash, mode and link.
`complete` describes the supplied report; this module cannot establish a test
pass, device acceptance or permission to run. Partial reports are retained whole.
No SDK, process, network, account, signing or release operation is performed.
"""
from contextlib import contextmanager
from collections import deque
import hashlib
import json
import math
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import tarfile
import time
import unicodedata

MAX_BYTES = 256 * 1024 ** 2
TIMEOUT_SECONDS = 60
CHUNK_BYTES = 1024 ** 2
ROOTS = frozenset(('logs', 'results', 'products', 'receipts', 'fixture'))


class EvidenceError(ValueError):
    pass


def _check(deadline):
    if time.monotonic() >= deadline:
        raise EvidenceError('Evidence operation exceeded its single 60-second deadline')


def _signature(info):
    return (info.st_dev, info.st_ino, info.st_mode, info.st_size,
            info.st_mtime_ns, info.st_ctime_ns, info.st_nlink)


def _path(name):
    if (not isinstance(name, str) or not name or '\\' in name
            or any(ord(char) < 32 or ord(char) == 127 for char in name)):
        raise EvidenceError('Unsafe archive path')
    path = PurePosixPath(name)
    if path.is_absolute() or name != str(path) or '..' in path.parts or path.parts[0] not in ROOTS:
        raise EvidenceError('Archive path escapes the exact allowlist: ' + name)
    return path


def _mode(value):
    if type(value) is not int or not 0 <= value <= 0o777:
        raise EvidenceError('Unsafe or invalid permissions')
    return value


@contextmanager
def _regular(path, deadline):
    _check(deadline)
    before = path.lstat()
    if not stat.S_ISREG(before.st_mode) or before.st_size > MAX_BYTES:
        raise EvidenceError('Expected a bounded regular file: ' + path.name)
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor, 'rb') as handle:
        if _signature(os.fstat(handle.fileno())) != _signature(before):
            raise EvidenceError('File changed before opening: ' + path.name)
        yield handle
        _check(deadline)
        if (_signature(os.fstat(handle.fileno())) != _signature(before)
                or _signature(path.lstat()) != _signature(before)):
            raise EvidenceError('File changed while being read: ' + path.name)


def _hash_stream(handle, deadline, expected_size=None):
    digest = hashlib.sha256(); count = 0
    while True:
        _check(deadline)
        chunk = handle.read(CHUNK_BYTES)
        if not chunk:
            break
        count += len(chunk)
        if count > MAX_BYTES or (expected_size is not None and count > expected_size):
            raise EvidenceError('Payload exceeds its declared byte budget')
        digest.update(chunk)
    if expected_size is not None and count != expected_size:
        raise EvidenceError('Payload byte count differs')
    return digest.hexdigest(), count


def _hash_file(path, deadline):
    with _regular(path, deadline) as handle:
        return _hash_stream(handle, deadline)


def _json(raw):
    def pairs(items):
        value = {}
        for key, item in items:
            if key in value:
                raise EvidenceError('Duplicate JSON key')
            value[key] = item
        return value
    def invalid(value):
        raise EvidenceError('Invalid JSON number: ' + value)
    try:
        return json.loads(raw, object_pairs_hook=pairs, parse_constant=invalid)
    except (UnicodeError, json.JSONDecodeError) as error:
        raise EvidenceError('Invalid evidence JSON') from error


def _json_stream(handle, deadline):
    chunks = []; count = 0
    while True:
        _check(deadline)
        data = handle.read(CHUNK_BYTES)
        if not data: break
        count += len(data)
        if count > MAX_BYTES: raise EvidenceError('Evidence JSON exceeds budget')
        chunks.append(data)
    raw = b''.join(chunks)
    return _json(raw), hashlib.sha256(raw).hexdigest(), len(raw)


def _read_json(path, deadline):
    with _regular(path, deadline) as handle:
        return _json_stream(handle, deadline)


def _link_components(name, target):
    if (not isinstance(target, str) or not target or target.startswith('/') or '\\' in target
            or any(ord(char) < 32 or ord(char) == 127 for char in target)):
        raise EvidenceError('Unsafe symbolic link')
    # Preserve every component. POSIX expands an intermediate symlink BEFORE
    # interpreting a following '..'; lexical normalization would be unsafe.
    return list(PurePosixPath(name).parent.parts) + target.split('/')


def _validate_entries(entries, deadline):
    if not isinstance(entries, list) or not entries:
        raise EvidenceError('An empty inventory is not evidence')
    by_path = {}; portable = set(); payload = 0
    extra = {'file': {'sha256'}, 'directory': set(), 'symlink': {'link_target'},
             'hardlink': {'link_target', 'sha256'}}
    for entry in entries:
        _check(deadline)
        if not isinstance(entry, dict) or entry.get('kind') not in extra:
            raise EvidenceError('Unsupported inventory entry')
        if set(entry) != {'path', 'kind', 'mode', 'bytes'} | extra[entry['kind']]:
            raise EvidenceError('Unknown or missing inventory fields')
        name = str(_path(entry['path']))
        folded = unicodedata.normalize('NFC', name).casefold()
        if name in by_path or folded in portable:
            raise EvidenceError('Duplicate or non-portable path collision')
        by_path[name] = entry; portable.add(folded)
        _mode(entry['mode'])
        size = entry['bytes']
        if type(size) is not int or size < 0 or size > MAX_BYTES:
            raise EvidenceError('Invalid payload size')
        if entry['kind'] in ('directory', 'symlink') and size:
            raise EvidenceError('A non-file entry cannot contain bytes')
        if entry['kind'] in ('file', 'hardlink'):
            if not isinstance(entry['sha256'], str) or not re.fullmatch('[0-9a-f]{64}', entry['sha256']):
                raise EvidenceError('Invalid payload hash')
        if entry['kind'] == 'file': payload += size
        if payload > MAX_BYTES: raise EvidenceError('Evidence payload exceeds 256 MiB; nothing was clipped')
    for name, entry in by_path.items():
        _check(deadline)
        parts = PurePosixPath(name).parts
        if len(parts) == 1 and entry['kind'] != 'directory':
            raise EvidenceError('Allowlisted roots must be real directories')
        for n in range(1, len(parts)):
            if by_path.get('/'.join(parts[:n]), {}).get('kind') != 'directory':
                raise EvidenceError('A parent is absent or is a link/non-directory')
        if entry['kind'] == 'hardlink':
            target = by_path.get(str(_path(entry['link_target'])), {})
            if target.get('kind') != 'file' or any(target.get(key) != entry[key] for key in ('mode', 'bytes', 'sha256')):
                raise EvidenceError('Hard link does not name its exact regular payload')
    def resolve(name, target):
        pending = deque(_link_components(name, target)); resolved = []; expansions = 0
        while pending:
            _check(deadline)
            part = pending.popleft()
            if part in ('', '.'): continue
            if part == '..':
                if not resolved: raise EvidenceError('Symbolic link escapes the archive')
                resolved.pop(); continue
            current = '/'.join(resolved + [part]); node = by_path.get(current)
            if node is None: raise EvidenceError('Dangling symbolic link')
            if node['kind'] == 'symlink':
                expansions += 1
                if expansions > 40: raise EvidenceError('Symbolic link cycle or excessive indirection')
                expanded = _link_components(current, node['link_target'])
                pending.extendleft(reversed(expanded)); resolved = []
            else:
                resolved.append(part)
                if pending and node['kind'] != 'directory':
                    raise EvidenceError('Symbolic link crosses a non-directory')
        _path('/'.join(resolved))
    for name, entry in by_path.items():
        if entry['kind'] == 'symlink':
            resolve(name, entry['link_target'])
    return by_path, payload


def _collect(root, deadline):
    entries = []; signatures = {}; hardlinks = {}; payload = 0
    def visit(path, name):
        nonlocal payload
        _check(deadline); _path(name)
        info = path.lstat(); signatures[name] = _signature(info)
        entry = dict(path=name, mode=_mode(stat.S_IMODE(info.st_mode)), bytes=0)
        if stat.S_ISDIR(info.st_mode):
            entry['kind'] = 'directory'; entries.append(entry)
            for child in sorted(path.iterdir(), key=lambda value: value.name):
                visit(child, name + '/' + child.name)
        elif stat.S_ISREG(info.st_mode):
            key = (info.st_dev, info.st_ino)
            entry.update(kind='file', bytes=info.st_size)
            if key in hardlinks:
                target = hardlinks[key]
                entry.update(kind='hardlink', link_target=target['path'], sha256=target['sha256'])
            else:
                entry['sha256'], size = _hash_file(path, deadline)
                if size != info.st_size or _signature(path.lstat()) != signatures[name]:
                    raise EvidenceError('Source mutated during inventory')
                hardlinks[key] = entry; payload += size
            entries.append(entry)
        elif stat.S_ISLNK(info.st_mode):
            entry.update(kind='symlink', link_target=os.readlink(path)); entries.append(entry)
        else: raise EvidenceError('Special files are not evidence')
        if payload > MAX_BYTES: raise EvidenceError('Evidence payload exceeds 256 MiB; nothing was clipped')
    for child in sorted(root.iterdir(), key=lambda value: value.name):
        if child.name not in ROOTS: raise EvidenceError('Unexpected source root: ' + child.name)
        visit(child, child.name)
    _validate_entries(entries, deadline)
    return entries, signatures


def _status(entries, report):
    if not isinstance(report, dict) or report.get('status') not in ('complete', 'partial'):
        raise EvidenceError('receipts/report.json must explicitly declare complete or partial')
    if report['status'] == 'partial' and (not isinstance(report.get('partial_reason'), str) or not report['partial_reason'].strip()):
        raise EvidenceError('Partial evidence requires its reason')
    populated = {entry['path'].split('/')[0] for entry in entries
                 if entry['kind'] in ('file', 'hardlink') and entry['bytes'] > 0}
    missing = set(ROOTS) - populated
    if not any(entry['path'].startswith('products/') and entry['path'].endswith('.xctestrun')
               and entry['kind'] in ('file', 'hardlink') and entry['bytes'] > 0 for entry in entries):
        missing.add('products')
    if report['status'] == 'complete' and missing:
        raise EvidenceError('Complete evidence is missing actual body: ' + ', '.join(sorted(missing)))
    return report['status'], sorted(missing)


class _Writer:
    def __init__(self, raw, deadline): self.raw, self.deadline = raw, deadline
    def tell(self): return self.raw.tell()
    def write(self, data):
        _check(self.deadline)
        if self.raw.tell() + len(data) > MAX_BYTES:
            raise EvidenceError('Full tar exceeds 256 MiB; nothing was clipped')
        return self.raw.write(data)


class _Reader:
    def __init__(self, raw, deadline):
        self.raw, self.deadline = raw, deadline
        self.digest = hashlib.sha256(); self.count = 0
    def read(self, size):
        _check(self.deadline); data = self.raw.read(min(size, CHUNK_BYTES))
        self.count += len(data); self.digest.update(data)
        return data


def _write_tar(root, archive, entries, signatures, deadline):
    with archive.open('xb') as raw, tarfile.open(fileobj=_Writer(raw, deadline), mode='w', format=tarfile.PAX_FORMAT) as handle:
        for entry in entries:
            _check(deadline)
            info = tarfile.TarInfo(entry['path']); info.mode = entry['mode']
            info.uid = info.gid = info.mtime = 0
            info.uname = info.gname = ''
            info.type = {'file': tarfile.REGTYPE, 'directory': tarfile.DIRTYPE,
                         'symlink': tarfile.SYMTYPE, 'hardlink': tarfile.LNKTYPE}[entry['kind']]
            if entry['kind'] in ('symlink', 'hardlink'): info.linkname = entry['link_target']
            if entry['kind'] != 'file': handle.addfile(info); continue
            info.size = entry['bytes']; path = root / entry['path']
            with _regular(path, deadline) as source:
                if _signature(os.fstat(source.fileno())) != signatures[entry['path']]:
                    raise EvidenceError('Source changed before archiving')
                checked = _Reader(source, deadline); handle.addfile(info, checked)
                if checked.count != info.size or checked.digest.hexdigest() != entry['sha256']:
                    raise EvidenceError('Archived content changed')
        raw.flush(); os.fsync(raw.fileno())


@contextmanager
def _verified_tar(archive, value, deadline):
    if (not isinstance(value, dict) or set(value) != {'schema_version', 'archive', 'entries', 'status', 'missing_components'}
            or type(value['schema_version']) is not int or value['schema_version'] != 1):
        raise EvidenceError('Unknown evidence manifest schema')
    expected = value['archive']
    if (not isinstance(expected, dict) or set(expected) != {'filename', 'bytes', 'sha256'}
            or expected['filename'] != archive.name or type(expected['bytes']) is not int
            or expected['bytes'] < 0 or expected['bytes'] > MAX_BYTES):
        raise EvidenceError('Invalid tar identity')
    by_path, _ = _validate_entries(value['entries'], deadline)
    with _regular(archive, deadline) as raw:
        digest, size = _hash_stream(raw, deadline)
        if digest != expected['sha256'] or size != expected['bytes']:
            raise EvidenceError('Downloaded tar is not the same archived bytes')
        raw.seek(0)
        with tarfile.open(fileobj=raw, mode='r:') as handle:
            seen = set(); final_offset = 0
            for member in handle:
                _check(deadline); name = str(_path(member.name))
                if name in seen: raise EvidenceError('Duplicate tar member')
                seen.add(name); entry = by_path.get(name)
                kind = {tarfile.REGTYPE: 'file', tarfile.AREGTYPE: 'file', tarfile.DIRTYPE: 'directory',
                        tarfile.SYMTYPE: 'symlink', tarfile.LNKTYPE: 'hardlink'}.get(member.type)
                if (entry is None or kind != entry['kind'] or member.mode != entry['mode']
                        or member.sparse is not None or set(member.pax_headers) - {'path', 'linkpath'}):
                    raise EvidenceError('Tar type, permissions or inventory differs')
                wanted_size = entry['bytes'] if kind == 'file' else 0
                if member.size != wanted_size: raise EvidenceError('Tar payload size differs')
                if kind in ('symlink', 'hardlink') and member.linkname != entry['link_target']:
                    raise EvidenceError('Tar link differs from manifest')
                if kind == 'file':
                    content = handle.extractfile(member)
                    with content:
                        content_sha, _ = _hash_stream(content, deadline, member.size)
                    if content_sha != entry['sha256']: raise EvidenceError('Tar payload hash differs')
                final_offset = max(final_offset, member.offset_data + ((member.size + 511) // 512) * 512)
            if seen != set(by_path): raise EvidenceError('Tar omits inventory members')
            raw.seek(final_offset)
            padding = 0
            while True:
                _check(deadline); chunk = raw.read(CHUNK_BYTES)
                if not chunk: break
                if any(chunk): raise EvidenceError('Nonzero content follows the tar end')
                padding += len(chunk)
            if padding < 1024 or size % 512: raise EvidenceError('Truncated tar end')
            if by_path.get('receipts/report.json', {}).get('kind') not in ('file', 'hardlink'):
                raise EvidenceError('Partial and complete evidence both require the actual report')
            report_member = handle.getmember('receipts/report.json')
            with handle.extractfile(report_member) as report_file:
                report, _, _ = _json_stream(report_file, deadline)
            status, missing = _status(value['entries'], report)
            if value['status'] != status or value['missing_components'] != missing:
                raise EvidenceError('Completeness metadata differs from the archived report/body')
            yield handle, by_path
        raw.seek(0)
        if _hash_stream(raw, deadline) != (digest, size):
            raise EvidenceError('Tar changed during verification/extraction')


def _real_directory(path):
    if not path.is_absolute() or path.resolve() != path or not stat.S_ISDIR(path.lstat().st_mode):
        raise EvidenceError('Expected an exact real directory')


def package_evidence(root: Path, output: Path, *, deadline=None) -> dict:
    """Create a fresh output directory containing one full tar and its manifest."""
    local_deadline = time.monotonic() + TIMEOUT_SECONDS
    if deadline is not None:
        if type(deadline) not in (int, float) or not math.isfinite(deadline):
            raise EvidenceError('Unknown absolute packaging deadline')
        local_deadline = min(local_deadline, deadline)
    deadline = local_deadline
    _check(deadline)
    root, output = Path(root), Path(output)
    _real_directory(root); _real_directory(output.parent)
    if output == root or root in output.parents or output.exists() or output.is_symlink():
        raise EvidenceError('Output must be fresh and outside the evidence source')
    root_signature = _signature(root.lstat())
    entries, signatures = _collect(root, deadline)
    report, _, _ = _read_json(root / 'receipts/report.json', deadline)
    status, missing = _status(entries, report)
    output.mkdir(mode=0o700); output_identity = output.stat().st_ino
    archive, manifest = output / 'evidence.tar', output / 'evidence.manifest.json'
    try:
        _write_tar(root, archive, entries, signatures, deadline)
        final_entries, final_signatures = _collect(root, deadline)
        if entries != final_entries or signatures != final_signatures or root_signature != _signature(root.lstat()):
            raise EvidenceError('Source changed while archiving')
        archive_sha, archive_bytes = _hash_file(archive, deadline)
        value = dict(schema_version=1, archive=dict(filename=archive.name, sha256=archive_sha, bytes=archive_bytes),
                     entries=entries, status=status, missing_components=missing)
        raw = (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()
        if archive_bytes + len(raw) > MAX_BYTES:
            raise EvidenceError('Combined tar and manifest exceed 256 MiB; nothing was clipped')
        with _verified_tar(archive, value, deadline): pass
        _check(deadline)
        with manifest.open('xb') as handle:
            handle.write(raw); handle.flush(); os.fsync(handle.fileno())
        return dict(archive_path=str(archive), manifest_path=str(manifest), archive_sha256=archive_sha,
                    manifest_sha256=hashlib.sha256(raw).hexdigest(), archive_bytes=archive_bytes,
                    manifest_bytes=len(raw), total_bytes=archive_bytes + len(raw), status=status)
    except Exception as error:
        if output.is_dir() and not output.is_symlink() and output.stat().st_ino == output_identity:
            shutil.rmtree(output)
        if isinstance(error, EvidenceError): raise
        raise EvidenceError('Evidence packaging failed: ' + str(error)) from error


def verify_download(archive: Path, manifest: Path, dest: Path) -> dict:
    """Verify the same tar, then safely restore every member to a fresh directory."""
    deadline = time.monotonic() + TIMEOUT_SECONDS
    archive, manifest, dest = Path(archive), Path(manifest), Path(dest)
    _real_directory(dest.parent)
    if dest.exists() or dest.is_symlink(): raise EvidenceError('Download destination is not fresh')
    manifest_signature = _signature(manifest.lstat())
    value, manifest_sha, manifest_bytes = _read_json(manifest, deadline)
    if _signature(manifest.lstat()) != manifest_signature:
        raise EvidenceError('Download manifest changed before archive verification')
    if manifest_bytes + archive.lstat().st_size > MAX_BYTES:
        raise EvidenceError('Combined downloaded evidence exceeds 256 MiB')
    created = False; identity = None
    try:
        with _verified_tar(archive, value, deadline) as (handle, entries):
            dest.mkdir(mode=0o700); created = True; identity = dest.stat().st_ino
            for kind in ('directory', 'file', 'hardlink', 'symlink'):
                ordered = sorted(entries.values(), key=lambda item: (len(PurePosixPath(item['path']).parts), item['path']))
                for entry in ordered:
                    _check(deadline)
                    if entry['kind'] != kind: continue
                    path = dest / entry['path']
                    if kind == 'directory': path.mkdir(mode=0o700)
                    elif kind == 'file':
                        with handle.extractfile(handle.getmember(entry['path'])) as source, path.open('xb') as target:
                            while True:
                                _check(deadline); chunk = source.read(CHUNK_BYTES)
                                if not chunk: break
                                target.write(chunk)
                        path.chmod(entry['mode'])
                    elif kind == 'hardlink': os.link(dest / entry['link_target'], path, follow_symlinks=False)
                    else:
                        path.symlink_to(entry['link_target'])
                        if stat.S_IMODE(path.lstat().st_mode) != entry['mode']:
                            os.chmod(path, entry['mode'], follow_symlinks=False)
            for entry in sorted(entries.values(), key=lambda item: -len(PurePosixPath(item['path']).parts)):
                if entry['kind'] == 'directory': (dest / entry['path']).chmod(entry['mode'])
            observed, _ = _collect(dest, deadline)
            if {item['path']: item for item in observed} != entries:
                raise EvidenceError('Extracted path/content/mode/link inventory differs')
        if (_signature(manifest.lstat()) != manifest_signature
                or _hash_file(manifest, deadline) != (manifest_sha, manifest_bytes)):
            raise EvidenceError('Download manifest changed during verification/extraction')
        return dict(verified=True, destination=str(dest), status=value['status'],
                    archive_sha256=value['archive']['sha256'], manifest_sha256=manifest_sha,
                    entry_count=len(value['entries']), missing_components=value['missing_components'])
    except Exception as error:
        if created and dest.is_dir() and not dest.is_symlink() and dest.stat().st_ino == identity:
            shutil.rmtree(dest)
        if isinstance(error, EvidenceError): raise
        raise EvidenceError('Downloaded evidence verification failed: ' + str(error)) from error
