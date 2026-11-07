#!/usr/bin/env python3
"""Read-only diagnostic mechanics. Importing this module runs no probe or API."""
import argparse
import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import platform
import plistlib
import re
import signal
import stat
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

from hosted_get328_diagnostic_core import Budget, Runner, DiagnosticError, DEVELOPER_DIR
import hosted_get328_diagnostic_admission as admission

MAX_BYTES = 32 * 1024**2
UPLOADER_SHA256 = '0165b8a75330f3228f2c7a234b4ff8a107b9139c2b519147f4c8e9fe99b262d8'
UPLOADER_BYTES = 5051718
SAFE_SYSTEM_ENV = ('PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL')
PUBLIC_CONTEXT_ENV = (
    'GITHUB_ACTIONS', 'RUNNER_ENVIRONMENT', 'RUNNER_OS', 'RUNNER_ARCH',
    'ImageOS', 'ImageVersion', 'GITHUB_EVENT_NAME', 'GITHUB_REPOSITORY', 'GITHUB_REPOSITORY_ID',
    'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'GITHUB_SHA', 'GITHUB_REF',
    'GITHUB_JOB', 'GITHUB_WORKFLOW_SHA', 'GITHUB_WORKFLOW_REF',
    'GITHUB_ACTOR', 'GITHUB_ACTOR_ID', 'GITHUB_TRIGGERING_ACTOR',
    'GITHUB_WORKSPACE', 'RUNNER_TEMP', 'GET328_GRANT_COMMENT_ID',
    'GET328_GRANT_ISSUER_ID')


def require(value, classification):
    if not value:
        raise ValueError(classification)


def read_regular(path, limit=128*1024, *, owned=False):
    path = Path(path)
    before = path.lstat()
    require(stat.S_ISREG(before.st_mode) and before.st_size <= limit, 'bounded regular file required')
    if owned:
        require(path.is_absolute() and path.resolve() == path and before.st_nlink == 1
                and before.st_uid == os.getuid(), 'owned output required')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        opened = os.fstat(fd)
        require((opened.st_dev, opened.st_ino, opened.st_size) ==
                (before.st_dev, before.st_ino, before.st_size), 'file changed before read')
        raw = bytearray()
        while len(raw) <= limit:
            part = os.read(fd, min(65536, limit+1-len(raw)))
            if not part: break
            raw.extend(part)
        after = os.fstat(fd)
        require(len(raw) <= limit and (after.st_size, after.st_mtime_ns) ==
                (opened.st_size, opened.st_mtime_ns), 'file changed or exceeded read bound')
        return bytes(raw)
    finally:
        os.close(fd)


def save(path, value):
    raw = (json.dumps(value, sort_keys=True, ensure_ascii=True) + '\n').encode()
    require(len(raw) <= 2*1024**2, 'receipt bound exceeded')
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, 'wb') as out:
        out.write(raw); out.flush(); os.fsync(out.fileno())


def validate_host(env, *, system=None, machine=None):
    require((system or platform.system()) == 'Darwin'
            and (machine or platform.machine()) == 'x86_64', 'host identity unknown')
    expected = {'GITHUB_ACTIONS':'true', 'RUNNER_ENVIRONMENT':'github-hosted',
                'RUNNER_OS':'macOS', 'RUNNER_ARCH':'X64', 'ImageOS':'macos26',
                'ImageVersion':'20260824.0517.1', 'DEVELOPER_DIR':DEVELOPER_DIR}
    require(all(env.get(k) == v for k,v in expected.items()), 'exact hosted image required')


def parse_upload_outputs(path, run_id):
    require(type(run_id) is int and run_id > 0, 'invalid run identity')
    raw = read_regular(path, 8192, owned=True)
    require(raw.endswith(b'\n'), 'incomplete uploader output')
    lines = raw.decode('utf-8', errors='strict').splitlines()
    result = {}; index = 0
    while index < len(lines):
        line = lines[index]; index += 1
        if not line: continue
        if '<<' in line:
            key, delimiter = line.split('<<', 1)
            require(re.fullmatch(r'[A-Za-z0-9_-]{1,128}', delimiter), 'invalid output delimiter')
            require(index+1 < len(lines) and lines[index+1] == delimiter, 'incomplete output block')
            value = lines[index]; index += 2
        else:
            require('=' in line, 'unknown output encoding')
            key,value = line.split('=',1)
        require(key in {'artifact-id','artifact-digest','artifact-url'} and key not in result,
                'duplicate or extra output key')
        require(value and not any(ord(c) < 32 or ord(c) == 127 for c in value), 'unsafe output value')
        result[key] = value
    require(set(result) == {'artifact-id','artifact-digest','artifact-url'}, 'missing upload receipt')
    require(re.fullmatch(r'[1-9][0-9]{0,19}', result['artifact-id']), 'invalid artifact identity')
    require(re.fullmatch('[a-f0-9]{64}', result['artifact-digest']), 'invalid artifact digest')
    expected = 'https://github.com/getyak/leafhour/actions/runs/'+str(run_id)+'/artifacts/'+result['artifact-id']
    require(result['artifact-url'] == expected, 'upload URL binding mismatch')
    return dict(id=int(result['artifact-id']), digest=result['artifact-digest'], url=expected)


def probe_environment(env):
    result = {k:env[k] for k in SAFE_SYSTEM_ENV+PUBLIC_CONTEXT_ENV if k in env}
    result['DEVELOPER_DIR'] = DEVELOPER_DIR
    return result


def upload_environment(env, output_path, artifact_dir, run_id):
    token = env.get('ACTIONS_RUNTIME_TOKEN'); endpoint = env.get('ACTIONS_RESULTS_URL')
    require(type(token) is str and 0 < len(token) <= 16384
            and not any(ord(c)<32 or ord(c)==127 for c in token), 'existing artifact capability unavailable')
    require(type(endpoint) is str, 'artifact results endpoint unavailable')
    parsed = urllib.parse.urlsplit(endpoint)
    require(parsed.scheme == 'https' and parsed.hostname is not None
            and parsed.hostname.endswith('.actions.githubusercontent.com')
            and parsed.username is None and parsed.password is None
            and parsed.port in (None,443) and not parsed.query and not parsed.fragment,
            'untrusted artifact endpoint')
    require(env.get('GITHUB_REPOSITORY') == 'getyak/leafhour'
            and env.get('GITHUB_RUN_ID') == str(run_id)
            and env.get('GITHUB_SERVER_URL') == 'https://github.com', 'upload context mismatch')
    result = {k:env[k] for k in SAFE_SYSTEM_ENV if k in env}
    result.update(ACTIONS_RUNTIME_TOKEN=token, ACTIONS_RESULTS_URL=endpoint,
                  GITHUB_REPOSITORY='getyak/leafhour', GITHUB_RUN_ID=str(run_id),
                  GITHUB_SERVER_URL='https://github.com', GITHUB_OUTPUT=str(output_path))
    result.update({'INPUT_NAME':f'get328-environment-{run_id}-attempt-1',
                   'INPUT_PATH':str(artifact_dir), 'INPUT_IF-NO-FILES-FOUND':'error',
                   'INPUT_OVERWRITE':'false', 'INPUT_INCLUDE-HIDDEN-FILES':'false',
                   'INPUT_RETENTION-DAYS':'3', 'INPUT_COMPRESSION-LEVEL':'6'})
    return result


def evidence_policy():
    # Each call has a private module dictionary. The canonical imported helper
    # and every legacy controller keep their original 256MiB constants.
    path = Path(__file__).with_name('hosted_get328_evidence.py')
    spec = importlib.util.spec_from_file_location('_get328_diagnostic_evidence_policy', path)
    require(spec is not None and spec.loader is not None, 'evidence helper unavailable')
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    module.MAX_BYTES = MAX_BYTES
    module.TIMEOUT_SECONDS = 20
    return module


def package_bounded(source, output, *, deadline):
    try:
        return evidence_policy().package_evidence(Path(source), Path(output), deadline=deadline)
    except Exception:
        raise ValueError('bounded diagnostic package rejected') from None


def verify_package(archive, manifest, destination, expected_sha256):
    require(type(expected_sha256) is str and re.fullmatch('[a-f0-9]{64}', expected_sha256),
            'trusted manifest digest required')
    raw = read_regular(manifest, MAX_BYTES, owned=True)
    require(hashlib.sha256(raw).hexdigest() == expected_sha256, 'trusted manifest digest mismatch')
    require(Path(archive).lstat().st_size + len(raw) <= MAX_BYTES, 'diagnostic archive exceeds32MiB')
    return evidence_policy().verify_download(Path(archive), Path(manifest), Path(destination))


def inventory_runtime_files(roots, *, deadline, clock=time.monotonic, emit=None):
    def check():
        require(type(deadline) in (int,float) and clock() < deadline, 'inventory deadline reached')
    def event(value):
        if emit is not None: emit(value)
    check()
    require(0 < len(roots) <= 33, 'runtime root bound exceeded')
    canonical = [Path(p).resolve() for p in roots]
    result = {'coverage':'explicit candidate roots only', 'roots':[], 'runtimes':[]}
    seen = set(); entries = 0
    for root in roots:
        check(); root = Path(root)
        item = {'path':str(root), 'exists':root.exists()}; result['roots'].append(item); event({'root':item})
        if not item['exists']: continue
        require(root.is_dir(), 'runtime root is not a directory')
        children = sorted(root.iterdir())
        entries += len(children); require(entries <= 256, 'runtime entry bound exceeded')
        for candidate in children:
            check()
            if not candidate.name.endswith('.simruntime'): continue
            bundle = candidate.resolve(strict=True)
            require(any(bundle.is_relative_to(p) for p in canonical), 'runtime bundle escaped roots')
            if bundle in seen: continue
            seen.add(bundle); require(len(seen) <= 16, 'runtime bundle bound exceeded')
            raw = read_regular(bundle/'Contents/Info.plist', 64*1024)
            info = plistlib.loads(raw)
            require(type(info) is dict, 'invalid runtime plist')
            item = {'bundle_path':str(bundle), 'info_sha256':hashlib.sha256(raw).hexdigest(),
                    'info_raw_base64':base64.b64encode(raw).decode(),
                    'identifier':info.get('CFBundleIdentifier'),
                    'version':info.get('CFBundleShortVersionString'),
                    'cache_headers':[], 'architectures_observed':[], 'architecture_status':'unproven'}
            for arch in ('x86_64','x86_64h','arm64','arm64e'):
                check()
                cache = bundle/'Contents/Resources/RuntimeRoot/System/Library/dyld'/('dyld_shared_cache_'+arch)
                if not cache.exists(): continue
                require(cache.resolve().is_relative_to(bundle), 'cache escaped runtime bundle')
                before = cache.lstat(); require(stat.S_ISREG(before.st_mode), 'cache is not a regular file')
                fd = os.open(cache, os.O_RDONLY|os.O_NOFOLLOW)
                try:
                    opened = os.fstat(fd); prefix = os.read(fd,4096); after = os.fstat(fd)
                finally: os.close(fd)
                require((before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns) ==
                        (after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns), 'cache changed during read')
                require(prefix[:16].startswith(b'dyld_v1') and arch.encode() in prefix[:16],
                        'runtime cache header does not establish named architecture')
                item['cache_headers'].append({'path':str(cache),'bytes':opened.st_size,
                    'prefix_base64':base64.b64encode(prefix).decode(),
                    'prefix_sha256':hashlib.sha256(prefix).hexdigest()})
                item['architectures_observed'].append(arch)
            if item['architectures_observed']: item['architecture_status'] = 'observed-header-only'
            result['runtimes'].append(item); event({'runtime':item})
    check(); return result


def execute_probe_plan(runner, probes, *, env=None, after=None):
    result = []
    for name, argv, output_limit in probes:
        if runner.budget.stopped or runner.budget.final_start is not None:
            result.append({'name':name, 'status':'not-run'}); continue
        try:
            code,text = runner.run(argv, name, 20, env=env, output_limit=output_limit)
            if after is not None: after(name,text)
            result.append({'name':name, 'status':'observed', 'raw_exit':code})
        except BaseException as error:
            runner.budget.stop('probe_unknown'); runner.budget.begin_final()
            result.append({'name':name, 'status':'unknown', 'error_class':type(error).__name__})
    return result


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, newurl):
        return None


def read_public_api(url):
    require(type(url) is str and len(url) <= 2048
            and url.startswith(admission.API_ROOT+'/'), 'only the fixed public repository API is allowed')
    relative = url[len(admission.API_ROOT):]
    allowed = (re.fullmatch(r'/actions/runs/[1-9][0-9]{0,19}', relative)
               or relative == '/issues/comments/'+str(admission.COMMENT_ID)
               or re.fullmatch(r'/actions/runs/[1-9][0-9]{0,19}/jobs\?per_page=100&page=1', relative)
               or re.fullmatch(r'/actions/workflows/[1-9][0-9]{0,19}/runs\?branch=codex%2Fget-328-environment-once%2F[0-9a-f]{40}%2F[0-9a-f]{32}&per_page=100&page=1', relative))
    require(allowed, 'API endpoint is outside diagnostic admission')
    validate_host(os.environ)
    request = urllib.request.Request(url, headers={'Accept':'application/vnd.github+json',
        'User-Agent':'Leafhour-GET328-bounded-diagnostic', 'X-GitHub-Api-Version':'2022-11-28'})
    opener = urllib.request.build_opener(NoRedirect())
    try:
        response = opener.open(request, timeout=10)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        raw = response.read(128*1024+1)
        return {'url':url,'status':response.code,'link':response.headers.get('Link'),
                'body_complete':len(raw) <= 128*1024,
                'raw_body_base64':base64.b64encode(raw).decode('ascii')}


def fetch_api(runner, url, name, env):
    try:
        _,text = runner.run([sys.executable,'-B',str(Path(__file__).resolve()),
                            'api-read','--url',url], 'api-'+name, 20,
                           env=probe_environment(env), output_limit=512*1024)
        wrapper = admission.decode_json(text)
        require(type(wrapper) is dict and set(wrapper) ==
                {'url','status','link','body_complete','raw_body_base64'}, 'API wrapper is incomplete')
        raw = base64.b64decode(wrapper['raw_body_base64'], validate=True)
        require(len(raw) <= 128*1024+1, 'API body exceeds bound')
        path = runner.root/'receipts'/(name+'.json')
        fd = os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
        with os.fdopen(fd,'wb') as out:out.write(raw);out.flush();os.fsync(out.fileno())
        complete = (wrapper['url'] == url and type(wrapper['status']) is int
                    and wrapper['status'] == 200 and wrapper['body_complete'] is True
                    and wrapper['link'] in (None,''))
        save(runner.root/'receipts'/(name+'-http.json'), {'requested_url':url,
             'returned_url':wrapper['url'],'http_status':wrapper['status'],'link':wrapper['link'],
             'body_complete':wrapper['body_complete'],'complete':complete,
             'raw_body_sha256':hashlib.sha256(raw).hexdigest()})
        require(complete, 'API unavailable, redirected, incomplete or paginated')
        return admission.decode_json(raw)
    except BaseException:
        runner.budget.stop('api_unknown')
        raise


def _read_json(path, limit=128*1024):
    return admission.decode_json(read_regular(path,limit))


def _hash_source(path, deadline):
    require(Path(path).is_file() and not Path(path).is_symlink(), 'source is not regular')
    digest = hashlib.sha256(); total = 0
    with Path(path).open('rb') as source:
        while block := source.read(1024*1024):
            require(time.monotonic() < deadline, 'source verification deadline')
            total += len(block);require(total <= 8*1024**2, 'source bound exceeded');digest.update(block)
    return total,digest.hexdigest()


def validate_source_closure(root, uploader, env, budget):
    ready = _read_json(root/'receipts/bootstrap-ready.json')
    raw = read_regular(root/'receipts/bootstrap-source.json',128*1024)
    proof = admission.decode_json(raw)
    require(ready['ready'] is True and proof['complete'] is True
            and ready['run_id'] == env['GITHUB_RUN_ID']
            and ready['controller_sha'] == proof['controller_sha'] == env['GITHUB_SHA'],
            'source proof binding mismatch')
    require(hashlib.sha256(raw).hexdigest() == ready['source_proof_sha256'], 'source proof changed')
    require(ready['source_manifest_sha256'] == proof['source_manifest_sha256'], 'source manifest changed')
    first_stamp = _read_json(root/'start.json')
    require(first_stamp.get('source_manifest_sha256') == proof['source_manifest_sha256'],
            'first stamp source manifest changed')
    canonical = json.dumps(proof['manifest'],sort_keys=True,separators=(',',':')).encode()
    require(hashlib.sha256(canonical).hexdigest() == proof['source_manifest_sha256'], 'manifest bytes unknown')
    workspace = Path(env['GITHUB_WORKSPACE']).resolve()
    controller = workspace/'controller'
    require(Path(ready['controller_root']) == controller and Path(__file__).resolve().parents[2] == controller,
            'wrong controller closure')
    require(Path(ready['uploader_entry']) == Path(uploader) == workspace/'uploader/dist/upload/index.js',
            'wrong pinned upload entry')
    required = {'scripts/ios/hosted_get328_diagnostic_core.py',
                'scripts/ios/hosted_get328_diagnostic_admission.py',
                'scripts/ios/hosted_get328_diagnostic.py', 'scripts/ios/hosted_get328_evidence.py',
                '.github/actions/get328-diagnostic/action.yml', '.github/actions/get328-diagnostic/index.cjs'}
    assets = proof['assets'];require(type(assets) is list and len(assets) == 7, 'source closure incomplete')
    require({a['path'] for a in assets if a['scope']=='controller'} == required,
            'unexpected controller source')
    budget.check(); deadline = min(time.monotonic()+20,budget.work_end,budget.end)
    for asset in assets:
        budget.check()
        if asset['scope'] == 'controller':
            target = controller/asset['path']
            expected_url = 'https://raw.githubusercontent.com/getyak/leafhour/'+env['GITHUB_SHA']+'/'+asset['path']
        else:
            require(asset['scope']=='uploader' and asset['path']=='dist/upload/index.js', 'unexpected uploader source')
            target = Path(uploader)
            expected_url = 'https://raw.githubusercontent.com/actions/upload-artifact/ea165f8d65b6e75b540449e92b4886f43607fa02/dist/upload/index.js'
        require(target.resolve()==target and str(target)==asset['destination']
                and asset['url']==expected_url and asset['published'] is True, 'source publication changed')
        size,digest = _hash_source(target,deadline)
        require(size == asset['actual_bytes'] == asset['expected_bytes']
                and digest == asset['actual_sha256'] == asset['expected_sha256'], 'source closure bytes changed')
        if asset['scope']=='uploader':
            require(size==UPLOADER_BYTES and digest==UPLOADER_SHA256
                    and ready['uploader_sha256']==digest, 'untrusted uploader bundle')
    budget.check()
    return ready


def _probe_admission(root, env):
    validate_host(env)
    expected = Path(env['RUNNER_TEMP']).resolve()/'get328-environment'
    require(Path(root)==expected and not Path(root).is_symlink(), 'wrong owned root')
    grant = _read_json(Path(root)/'receipts/admission.json')
    require(grant.get('allowed') is True and grant.get('read_only') is True
            and grant.get('scope')==admission.SCOPE and grant.get('cases')==[]
            and str(grant.get('run_id'))==env['GITHUB_RUN_ID']
            and grant.get('controller_sha')==env['GITHUB_SHA'], 'probe is not admitted')


def validate_start(start, snapshot, env):
    require(type(start) is dict and type(snapshot) is dict, 'first stamp missing')
    require(start.get('repository')==env['GITHUB_REPOSITORY']
            and type(start.get('run_id')) is str and start['run_id']==env['GITHUB_RUN_ID']
            and type(start.get('run_attempt')) is int and start['run_attempt']==1
            and start.get('controller_sha')==env['GITHUB_SHA'] and start.get('ref')==env['GITHUB_REF'],
            'first stamp belongs to another run')
    require(start.get('actor')=={'login':env['GITHUB_ACTOR'],'id':env['GITHUB_ACTOR_ID']}
            and start.get('image')=={k:env[k] for k in ('ImageOS','ImageVersion','RUNNER_ARCH')},
            'first stamp identity changed')
    for key in ('schema_version','started_monotonic','work_deadline_monotonic',
                'deadline_monotonic','initial_free_bytes'):
        require(key in start and key in snapshot and type(start[key]) is type(snapshot[key])
                and start[key]==snapshot[key], 'bootstrap clock changed')
    require(snapshot.get('stopped') is False, 'bootstrap work already stopped')
    for key in ('final_started_monotonic','final_deadline_monotonic','stop_reason','cancel_signal'):
        require(key in snapshot and snapshot[key] is None, 'bootstrap already final or cancelled')


def run_hosted(root, uploader, node):
    env = os.environ
    validate_host(env)  # Must precede any path, Runner or native/API observation.
    root = Path(root)
    require(root == Path(env['RUNNER_TEMP']).resolve()/'get328-environment'
            and root.resolve()==root and root.is_dir(), 'wrong exclusive diagnostic root')
    start = _read_json(root/'start.json')
    ready = _read_json(root/'receipts/bootstrap-ready.json')
    snapshot = ready['budget_snapshot']
    validate_start(start,snapshot,env)
    budget = Budget(snapshot)
    budget.check()
    signal.signal(signal.SIGINT,budget.cancel);signal.signal(signal.SIGTERM,budget.cancel)
    runner = Runner(root,budget)
    save(root/'receipts/execution-start.json',{'run_id':env['GITHUB_RUN_ID'],
         'controller_sha':env['GITHUB_SHA'],'budget':budget.snapshot()})
    observations=[];failure=None
    try:
        validate_source_closure(root,uploader,env,budget)
        event = _read_json(Path(env['GITHUB_EVENT_PATH']),512*1024)
        context = admission.context(env,event)
        # Fail before native observations if the existing upload capability is
        # unavailable. Its values are held only in memory, never receipts.
        upload_environment(env,root/'uploader-output.txt',root.parent/'get328-environment-upload',context['run_id'])
        current = fetch_api(runner,context['current_run_url'],'current-run',env)
        context = admission.validate_current_run(env,event,current)
        grant = fetch_api(runner,context['grant_comment_url'],'grant-comment',env)
        history = fetch_api(runner,context['history_url'],'history',env)
        jobs = fetch_api(runner,context['jobs_url'],'allocated-job',env)
        admitted = admission.validate_admission(env,event,grant,time.time(),
            {**history,'complete':True},current_run=current,jobs={**jobs,'complete':True})
        save(root/'receipts/admission.json',admitted)
        worker = str(Path(__file__).resolve()); clean_env=probe_environment(env)
        xcode = DEVELOPER_DIR+'/usr/bin/xcodebuild'
        probes = [
            ('identity',[sys.executable,'-B',worker,'tool-files','--root',str(root)],512*1024),
            ('runtime-files',[sys.executable,'-B',worker,'runtime-files','--root',str(root)],512*1024),
            ('tool-help',[xcode,'-help'],512*1024),
            ('first-launch-status',[xcode,'-checkFirstLaunchStatus'],128*1024),
            ('service-status',['/bin/launchctl','print','gui/'+str(os.getuid())+'/com.apple.CoreSimulator.CoreSimulatorService'],128*1024),
            ('bounded-service-log',['/usr/bin/log','show','--last','5m','--style','json','--predicate',
                'process == "CoreSimulatorService" OR subsystem BEGINSWITH "com.apple.CoreSimulator"'],512*1024),
            ('owned-processes',['/bin/ps','-p',str(os.getpid()),'-o','pid=,ppid=,pgid=,stat=,comm='],32*1024),
        ]
        def gate(name,text):
            if name == 'tool-help':
                require(re.search(r'(?<!\S)-checkFirstLaunchStatus(?!\w)',text), 'status option unadvertised')
        observations = execute_probe_plan(runner,probes,env=clean_env,after=gate)
        if any(item['status']!='observed' for item in observations):failure='observation_unknown'
    except BaseException as error:
        budget.stop('diagnostic_unknown');failure=type(error).__name__
    finally:
        budget.begin_final()
        save(root/'receipts/final-start.json',budget.snapshot())
        save(root/'receipts/report.json',{'status':'partial',
             'partial_reason':'environment observations only; no App, fixture, Products or original seven',
             'diagnostic_status':'unknown' if failure or budget.stopped else 'observed',
             'failure_class':failure,'observations':observations,'cases_executed':0,'cases_total':7,
             'app_category_direct_readback':'unproved','budget':budget.snapshot()})
        finalize(runner,root,Path(uploader),Path(node),env)
    return 1 if failure or budget.stopped else 0


def freeze_evidence(root, budget):
    budget.check(final=True)
    snapshot=root/'snapshot';snapshot.mkdir(mode=0o700)
    deadline=min(time.monotonic()+20,budget.final_end,budget.end)
    count=0;copied=0
    def copy(directory,destination,depth=0):
        nonlocal count,copied
        require(depth<=4 and directory.is_dir() and not directory.is_symlink(), 'snapshot directory unknown')
        destination.mkdir(mode=0o700)
        for path in sorted(directory.iterdir()):
            budget.check(final=True);require(time.monotonic()<deadline, 'snapshot deadline reached')
            count+=1;require(count<=256, 'snapshot entry bound exceeded')
            info=path.lstat();target=destination/path.name
            if stat.S_ISDIR(info.st_mode):copy(path,target,depth+1)
            else:
                require(stat.S_ISREG(info.st_mode), 'snapshot cannot follow links or special files')
                raw=read_regular(path,8*1024**2);copied+=len(raw)
                require(copied<=8*1024**2, 'snapshot payload exceeds bounded collection')
                fd=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,stat.S_IMODE(info.st_mode)&0o777)
                with os.fdopen(fd,'wb') as out:out.write(raw);out.flush();os.fsync(out.fileno())
                require(time.monotonic()<deadline, 'snapshot copy completed late')
    for name in ('logs','receipts'):copy(root/name,snapshot/name)
    stamp=read_regular(root/'start.json',128*1024)
    fd=os.open(snapshot/'receipts/start.json',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'wb') as out:out.write(stamp);out.flush();os.fsync(out.fileno())
    budget.check(final=True)
    return snapshot


def finalize(runner, root, uploader, node, env):
    budget=runner.budget;budget.begin_final();budget.check(final=True)
    save(root/'receipts/finalization-start.json',budget.snapshot())
    snapshot=freeze_evidence(root,budget)
    output=root/'artifact'
    _,raw=runner.run([sys.executable,'-B',str(Path(__file__).resolve()),'package',
        '--root',str(root),'--source',str(snapshot),'--output',str(output)],
        'package',20,final=True,env=probe_environment(env),output_limit=64*1024)
    package=admission.decode_json(raw)
    require(type(package) is dict and package.get('archive_path')==str(output/'evidence.tar')
            and package.get('manifest_path')==str(output/'evidence.manifest.json'), 'package receipt path mismatch')
    require(type(package.get('total_bytes')) is int and 0<package['total_bytes']<=MAX_BYTES,
            'package receipt exceeds32MiB')
    require({p.name for p in output.iterdir()}=={'evidence.tar','evidence.manifest.json'}, 'unexpected upload payload')
    for name,field in [('evidence.tar','archive'),('evidence.manifest.json','manifest')]:
        budget.check(final=True)
        path=output/name;require(path.resolve()==path and not path.is_symlink(), 'upload payload escaped')
        expected=package.get(field+'_sha256');require(type(expected) is str and re.fullmatch('[a-f0-9]{64}',expected),
            'package digest missing')
        data=read_regular(path,MAX_BYTES)
        require(len(data)==package[field+'_bytes'] and hashlib.sha256(data).hexdigest()==expected,
                'package bytes changed')
    save(root/'receipts/package-result.json',package)
    print(json.dumps(package,sort_keys=True),flush=True)  # Trusted operator manifest receipt.
    output_file=root/'uploader-output.txt'
    # This control file is created AFTER the immutable snapshot. Unexpected
    # provider output is never included in a diagnostic payload or echoed.
    fd=os.open(output_file,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    os.close(fd)
    try:
        budget.check(final=True)
        size,digest=_hash_source(uploader,min(time.monotonic()+20,budget.final_end,budget.end))
        require(size==UPLOADER_BYTES and digest==UPLOADER_SHA256, 'uploader bytes changed')
        require(Path(node).is_absolute() and Path(node).resolve()==Path(node)
                and Path(node).name=='node' and Path(node).is_file() and os.access(node,os.X_OK),
                'runner Node entry unknown')
        clean=upload_environment(env,output_file,output,int(env['GITHUB_RUN_ID']))
        save(root/'receipts/upload-intent.json',{'single_invocation':True,
             'uploader_sha256':digest,'output_policy':'discarded-provider-sensitive','budget':budget.snapshot()})
        runner.run([str(node),str(uploader)],'upload',20,final=True,env=clean,capture=False)
        budget.check(final=True)
        artifact=parse_upload_outputs(output_file,int(env['GITHUB_RUN_ID']))
        save(root/'receipts/upload.json',{'status':'reported-uploaded','artifact':artifact,
             'provider_readback_still_required':True,'budget':budget.snapshot()})
        print(json.dumps({'reported_artifact':artifact},sort_keys=True),flush=True)
        return artifact
    except BaseException as error:
        budget.stop('upload_unknown')
        # No raw provider exception, stdout, env, output-file bytes or SAS value
        # is placed in logs/receipts. A valid-looking output after late exit0
        # does not prove a successful finalization.
        if budget.now()<min(budget.final_end,budget.end):
            save(root/'receipts/upload.json',{'status':'unknown','error_class':type(error).__name__,
                 'retry_authorized':False,'budget':budget.snapshot()})
        raise DiagnosticError('diagnostic_unknown') from None


def emit(value):
    print(json.dumps(value,sort_keys=True,ensure_ascii=True),flush=True)


def tool_files():
    contents=Path(DEVELOPER_DIR).parent
    version_raw=read_regular(contents/'version.plist',64*1024)
    version=plistlib.loads(version_raw)
    emit({'xcode_version_plist_base64':base64.b64encode(version_raw).decode(),
          'sha256':hashlib.sha256(version_raw).hexdigest()})
    require(version.get('CFBundleShortVersionString')=='26.6'
            and version.get('ProductBuildVersion')=='17F113', 'Xcode version mismatch')
    sdk=(Path(DEVELOPER_DIR)/'Platforms/iPhoneSimulator.platform/Developer/SDKs/iPhoneSimulator.sdk').resolve(strict=True)
    require(sdk.is_relative_to(Path(DEVELOPER_DIR)), 'SDK escaped selected toolchain')
    settings_raw=read_regular(sdk/'SDKSettings.plist',256*1024)
    settings=plistlib.loads(settings_raw)
    emit({'sdk_path':str(sdk),'sdk_settings_base64':base64.b64encode(settings_raw).decode(),
          'sha256':hashlib.sha256(settings_raw).hexdigest()})
    require(settings.get('Version')=='26.5', 'SDK version mismatch')
    tbd=read_regular(sdk/'usr/lib/libSystem.tbd',256*1024)
    emit({'sdk_tbd_base64':base64.b64encode(tbd).decode(),'sha256':hashlib.sha256(tbd).hexdigest()})
    require(b'x86_64-ios-simulator' in tbd, 'SDK Intel target unproved')
    emit({'complete':True,'meaning':'SDK targets only; no runtime compatibility claim'})


def runtime_files():
    base=Path('/Library/Developer/CoreSimulator')
    roots=[base/'Profiles/Runtimes']
    volumes=base/'Volumes'
    if volumes.exists():
        require(volumes.is_dir(), 'runtime volumes unknown')
        children=sorted(volumes.iterdir());require(len(children)<=32, 'runtime volume bound exceeded')
        for volume in children:
            if volume.is_dir() and not volume.is_symlink():
                roots.append(volume/'Library/Developer/CoreSimulator/Profiles/Runtimes')
    images=base/'Images/images.plist'
    if images.exists():
        raw=read_regular(images,128*1024)
        emit({'image_registration_path':str(images),'raw_base64':base64.b64encode(raw).decode(),
              'sha256':hashlib.sha256(raw).hexdigest()})
    result=inventory_runtime_files(roots,deadline=time.monotonic()+17,emit=emit)
    emit({'complete':True,'result':result})


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('stage',choices=['run','api-read','tool-files','runtime-files','package','verify-download'])
    parser.add_argument('--root',type=Path);parser.add_argument('--uploader',type=Path)
    parser.add_argument('--node',type=Path);parser.add_argument('--url')
    parser.add_argument('--source',type=Path);parser.add_argument('--output',type=Path)
    parser.add_argument('--archive',type=Path);parser.add_argument('--manifest',type=Path)
    parser.add_argument('--expected-manifest-sha256')
    args=parser.parse_args(argv)
    try:
        if args.stage=='verify-download':
            emit(verify_package(args.archive,args.manifest,args.root,args.expected_manifest_sha256));return 0
        if args.stage=='package':
            state=_read_json(args.root/'receipts/final-start.json')
            budget=Budget(state);budget.check(final=True)
            require(args.source==args.root/'snapshot' and args.output==args.root/'artifact', 'wrong package roots')
            emit(package_bounded(args.source,args.output,deadline=min(time.monotonic()+17,budget.final_end,budget.end)))
            return 0
        validate_host(os.environ)
        if args.stage=='run':
            require(args.root is not None and args.uploader is not None and args.node is not None,'run context missing')
            return run_hosted(args.root,args.uploader,args.node)
        if args.stage=='api-read':emit(read_public_api(args.url));return 0
        require(args.root is not None,'probe root missing');_probe_admission(args.root,os.environ)
        if args.stage=='tool-files':tool_files();return 0
        if args.stage=='runtime-files':runtime_files();return 0
    except BaseException as error:
        emit({'status':'unknown','classification':type(error).__name__,
              'no_new_probe_or_retry':True})
        return 1
    return 1


if __name__=='__main__':
    raise SystemExit(main())
