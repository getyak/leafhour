#!/usr/bin/env python3
"""Read-only, fail-closed admission for one GET-328 hosted window.

The pure validator trusts only the explicitly pinned public comment issuer.
The CLI makes bounded anonymous GitHub reads; it never triggers Actions, writes
GitHub state, starts a process, or inspects an SDK/device.
"""
from __future__ import annotations

import argparse
from collections.abc import Mapping
from datetime import datetime
import hashlib
import json
import math
import os
from pathlib import Path
import re
import stat
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

REPOSITORY = 'getyak/leafhour'
REPOSITORY_ID = 1415706040
SOURCE_SHA = '3869043f6a5cb492ee1a777d9a247d1df7d71041'
SOURCE_TREE = '396d83fe5a8231cc14b0a76ff4348ceb2aeb71a9'
WORKFLOW_PATH = '.github/workflows/get328-seven-once.yml'
SCOPE = 'GET-328-hosted-original-seven'
CASES = ('normal-38', 'normal-41', 'normal-54', 'ax5-38', 'ax5-41', 'ax5-54', 'pdf73')
RUNTIME = dict(runner_label='macos-26-intel', arch='x86_64', xcode_version='26.6',
               xcode_build='17F113', sdk='26.5', runtime='26.5')
LIMITS = dict(job_seconds=4200, bootstrap_seconds=600, build_seconds=1200,
              seven_seconds=1800, cleanup_seconds=120, package_seconds=60,
              upload_seconds=180, final_reserve_seconds=360,
              upload_max_bytes=268435456, start_free_bytes=8 * 1024 ** 3,
              stop_free_bytes=3 * 1024 ** 3, scratch_max_bytes=4 * 1024 ** 3)
REF_PATTERN = re.compile(r'refs/heads/codex/get-328-seven-once/([0-9a-f]{40})/([0-9a-f]{32})')
API_ROOT = 'https://api.github.com/repos/' + REPOSITORY
MAX_RESPONSE_BYTES = 1024 * 1024


def _require(value, message):
    if not value:
        raise ValueError(message)


def _identifier(value, field, encoded=False):
    if encoded:
        _require(isinstance(value, str) and re.fullmatch(r'[1-9][0-9]{0,19}', value),
                 'Missing or invalid ' + field)
        return int(value)
    _require(type(value) is int and value > 0, 'Missing or invalid ' + field)
    return value


def _utc(value, field):
    _require(isinstance(value, str) and re.fullmatch(
        r'[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z', value),
        'Invalid whole-second UTC timestamp: ' + field)
    try:
        return int(datetime.fromisoformat(value[:-1] + '+00:00').timestamp())
    except ValueError as error:
        raise ValueError('Invalid UTC timestamp: ' + field) from error


def _exact_dict(value, expected, field):
    _require(type(value) is dict and set(value) == set(expected), 'Incomplete ' + field)
    _require(all(type(value[key]) is type(want) and value[key] == want
                 for key, want in expected.items()), 'Unapproved ' + field)


def _json(raw):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            _require(key not in result, 'Duplicate JSON key')
            result[key] = value
        return result

    def invalid_constant(unused):
        raise ValueError('Nonfinite JSON value')

    return json.loads(raw, object_pairs_hook=unique, parse_constant=invalid_constant)


def _context(env, event):
    _require(isinstance(env, Mapping) and type(event) is dict, 'Missing event/environment')
    _require(env.get('GITHUB_REPOSITORY') == REPOSITORY, 'Unexpected repository')
    _require(env.get('GITHUB_REPOSITORY_ID') == str(REPOSITORY_ID), 'Unexpected repository identity')
    _require(env.get('GITHUB_EVENT_NAME') == 'push', 'Only the dedicated push event is admitted')
    repo = event.get('repository')
    _require(type(repo) is dict and repo.get('full_name') == REPOSITORY
             and repo.get('private') is False and type(repo.get('id')) is int
             and repo['id'] == REPOSITORY_ID, 'Repository is not the exact public source')
    _require(event.get('created') is True and event.get('deleted') is False
             and event.get('forced') is False, 'Only a new nonforced branch is admitted')
    ref = env.get('GITHUB_REF')
    match = REF_PATTERN.fullmatch(ref) if isinstance(ref, str) else None
    _require(match is not None and event.get('ref') == ref, 'Unapproved one-use ref')
    controller, nonce = match.groups()
    _require(event.get('after') == controller == env.get('GITHUB_SHA')
             == env.get('GITHUB_WORKFLOW_SHA'), 'Controller/workflow SHA binding changed')
    workflow_ref = REPOSITORY + '/' + WORKFLOW_PATH + '@' + ref
    _require(env.get('GITHUB_WORKFLOW_REF') == workflow_ref, 'Workflow ref binding changed')
    actor = env.get('GITHUB_ACTOR')
    _require(isinstance(actor, str) and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9-]{0,38}', actor),
             'Invalid actor login')
    actor_id = _identifier(env.get('GITHUB_ACTOR_ID'), 'actor id', encoded=True)
    sender = event.get('sender')
    _require(type(sender) is dict and sender.get('login') == actor
             and _identifier(sender.get('id'), 'sender id') == actor_id, 'Push sender differs from actor')
    _require(env.get('GITHUB_TRIGGERING_ACTOR') == actor, 'Triggering actor differs')
    _require(env.get('GITHUB_RUN_ATTEMPT') == '1', 'A grant never authorizes a re-run')
    run_id = _identifier(env.get('GITHUB_RUN_ID'), 'run id', encoded=True)
    _require(env.get('RUNNER_ENVIRONMENT') == 'github-hosted'
             and env.get('RUNNER_OS') == 'macOS' and env.get('RUNNER_ARCH') == 'X64',
             'Only the approved standard hosted Intel environment is admitted')
    return dict(repository=REPOSITORY, controller_sha=controller, nonce=nonce, ref=ref,
                workflow_ref=workflow_ref, branch=ref.removeprefix('refs/heads/'),
                run_id=run_id, actor={'login': actor, 'id': actor_id},
                grant_comment_id=_identifier(env.get('GET328_GRANT_COMMENT_ID'),
                                             'pinned grant comment id', encoded=True),
                grant_issuer_id=_identifier(env.get('GET328_GRANT_ISSUER_ID'),
                                            'pinned grant issuer id', encoded=True))


def _run_identity(context, run, field):
    _require(type(run) is dict, 'Missing ' + field)
    _require(_identifier(run.get('id'), field + ' id') == context['run_id']
             and type(run.get('run_attempt')) is int and run['run_attempt'] == 1,
             field + ' does not identify this first attempt')
    workflow_id = _identifier(run.get('workflow_id'), field + ' workflow id')
    _require(run.get('workflow_url') == API_ROOT + '/actions/workflows/' + str(workflow_id),
             field + ' workflow URL differs from the fixed public repository')
    for key in ('repository', 'head_repository'):
        repo = run.get(key)
        _require(type(repo) is dict and repo.get('full_name') == REPOSITORY
                 and repo.get('private') is False and type(repo.get('id')) is int
                 and repo['id'] == REPOSITORY_ID, field + ' repository differs: ' + key)
    _require(run.get('head_sha') == context['controller_sha']
             and run.get('head_branch') == context['branch'] and run.get('event') == 'push',
             field + ' belongs to another head/ref/event')
    _require(run.get('path') in (WORKFLOW_PATH, WORKFLOW_PATH + '@' + context['branch'],
                                WORKFLOW_PATH + '@' + context['ref']),
             field + ' belongs to another workflow')
    for key in ('actor', 'triggering_actor'):
        actor = run.get(key)
        _require(type(actor) is dict and actor.get('login') == context['actor']['login']
                 and _identifier(actor.get('id'), field + ' actor id') == context['actor']['id'],
                 field + ' actor differs: ' + key)
    _utc(run.get('created_at'), field + '.created_at')
    return dict(workflow_id=workflow_id, run_created_at=run['created_at'])


def validate_current_run(env, event, current_run):
    """Bind the public current-run response before using its numeric workflow ID."""
    context = _context(env, event)
    return {**context, **_run_identity(context, current_run, 'Current run')}


def validate_admission(env, event, grant, now_epoch, history, *, current_run):
    """Validate raw public comment + complete run history, or raise ValueError.

    A consumed comment is external authorization, not a runner-created grant.
    History is an additional replay fence; it is not a permanent consumption
    ledger and must never be used to recreate a missing coordinator record.
    """
    context = validate_current_run(env, event, current_run)
    _require(type(now_epoch) in (int, float) and math.isfinite(now_epoch), 'Unknown current time')
    _require(type(grant) is dict, 'Missing public grant comment')
    _require(_identifier(grant.get('id'), 'comment id') == context['grant_comment_id'],
             'Comment differs from the pinned grant')
    author = grant.get('user')
    _require(type(author) is dict and _identifier(author.get('id'), 'comment author id')
             == context['grant_issuer_id'], 'Comment was not written by the approved issuer')
    _require(grant.get('url') == API_ROOT + '/issues/comments/' + str(context['grant_comment_id']),
             'Comment does not belong to the pinned public repository')
    raw_body = grant.get('body')
    _require(isinstance(raw_body, str) and len(raw_body.encode('utf-8')) <= 16384,
             'Missing or oversized grant body')
    try:
        body = _json(raw_body)
    except (ValueError, TypeError) as error:
        raise ValueError('Grant body must be one JSON object') from error
    _require(type(body) is dict and type(body.get('schema_version')) is int
             and body['schema_version'] == 1, 'Unsupported grant schema')
    _require(body.get('scope') == SCOPE and body.get('status') == 'consumed'
             and body.get('consumed') is True, 'Grant is pending or has not been externally consumed')
    for key in ('repository', 'controller_sha', 'nonce', 'ref'):
        _require(body.get(key) == context[key], 'Grant binding differs: ' + key)
    _exact_dict(body.get('actor'), context['actor'], 'authorized actor')
    _require(body.get('source_sha') == SOURCE_SHA and body.get('source_tree') == SOURCE_TREE,
             'App/test source must remain the immutable 386 source')
    _require(type(body.get('cases')) is list and body['cases'] == list(CASES),
             'Grant must authorize exactly the original seven in order')
    _exact_dict(body.get('runtime'), RUNTIME, 'runtime scope')
    _exact_dict(body.get('limits'), LIMITS, 'resource/time limits')
    consumed = _utc(body.get('consumed_at'), 'consumed_at')
    expires = _utc(body.get('expires_at'), 'expires_at')
    created = _utc(grant.get('created_at'), 'comment.created_at')
    updated = _utc(grant.get('updated_at'), 'comment.updated_at')
    _require(created <= consumed <= updated <= now_epoch < expires,
             'Grant is expired, future-dated, or not durably published')
    _require(type(history) is dict and history.get('complete') is True,
             'Run history is incomplete or unavailable')
    runs = history.get('workflow_runs')
    _require(type(runs) is list and type(history.get('total_count')) is int
             and history['total_count'] == len(runs) == 1,
             'The exact grant ref must have one candidate run and no previous attempt')
    history_identity = _run_identity(context, runs[0], 'History run')
    _require(history_identity == dict(workflow_id=context['workflow_id'],
                                      run_created_at=context['run_created_at']),
             'Current run and history disagree on workflow identity or creation time')
    run_created = _utc(context['run_created_at'], 'current_run.created_at')
    _require(updated < run_created <= now_epoch,
             'Comment must be durably published before the run creation second')
    return dict(allowed=True, schema_version=1, **context, source_sha=SOURCE_SHA,
                source_tree=SOURCE_TREE, scope=SCOPE, cases=list(CASES), runtime=dict(RUNTIME),
                limits=dict(LIMITS), expires_at=body['expires_at'], consumed_at=body['consumed_at'])


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def fetch_json(url, timeout=5):
    """One bounded anonymous read from the fixed public API; no retries/redirects."""
    _require(url.startswith(API_ROOT + '/'), 'Only the fixed public GitHub API is allowed')
    request = urllib.request.Request(url, headers={
        'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'leafhour-get328-read-only-admission'})
    opener = urllib.request.build_opener(_NoRedirect())
    with opener.open(request, timeout=timeout) as response:
        raw = response.read(MAX_RESPONSE_BYTES + 1)
        _require(len(raw) <= MAX_RESPONSE_BYTES, 'Public API response exceeded its bound')
        try:
            value = _json(raw)
        except (ValueError, UnicodeError) as error:
            raise ValueError('Public API returned invalid JSON') from error
        return value, raw, response.headers.get('Link', '')


def _exclusive(path, raw):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, 'wb') as handle:
        handle.write(raw)
        handle.flush()
        os.fsync(handle.fileno())


def _start(root, context, now_monotonic):
    _require(root.is_absolute() and root.is_dir() and not root.is_symlink()
             and root.stat().st_uid == os.getuid(), 'No exact owned root exists')
    path = root / 'start.json'
    info = path.lstat()
    _require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid(), 'Unknown start receipt')
    _require(info.st_size <= 16384, 'Oversized start receipt')
    start = _json(path.read_bytes())
    _require(type(start) is dict and type(start.get('schema_version')) is int
             and start['schema_version'] == 1, 'Invalid start receipt schema')
    for key in ('repository', 'controller_sha', 'ref', 'run_id'):
        _require(type(start.get(key)) is type(context[key]) and start[key] == context[key],
                 'Start receipt binding differs: ' + key)
    _require(type(start.get('run_attempt')) is int and start['run_attempt'] == 1, 'Start attempt differs')
    began = start.get('started_monotonic')
    _require(type(began) in (int, float) and math.isfinite(began), 'Unknown monotonic origin')
    _require(start.get('deadline_monotonic') == began + LIMITS['job_seconds']
             and start.get('bootstrap_deadline_monotonic') == began + LIMITS['bootstrap_seconds']
             and start.get('stop_new_work_monotonic') == began + LIMITS['job_seconds'] - LIMITS['final_reserve_seconds'],
             'Global/phase deadlines changed')
    _require(began <= now_monotonic < start['bootstrap_deadline_monotonic'], 'Bootstrap deadline elapsed')
    return start


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, required=True)
    args = parser.parse_args(argv)
    receipts = None
    try:
        # Root ownership is checked before preserving any untrusted API material.
        root = args.root
        _require(root.is_absolute() and root.is_dir() and not root.is_symlink()
                 and root.stat().st_uid == os.getuid(), 'No exact owned root exists')
        target = root / 'receipts'
        if target.exists():
            _require(target.is_dir() and not target.is_symlink()
                     and target.stat().st_uid == os.getuid(), 'Unknown receipt directory')
        else:
            target.mkdir(mode=0o700)
        receipts = target
        _require(not (receipts / 'admission.json').exists(), 'Admission has already been recorded')
        event = _json(Path(os.environ['GITHUB_EVENT_PATH']).read_bytes())
        context = _context(os.environ, event)
        _start(root, context, time.monotonic())
        current_run, raw_current_run, _ = fetch_json(API_ROOT + '/actions/runs/' + str(context['run_id']))
        _exclusive(receipts / 'current-run.json', raw_current_run)
        _start(root, context, time.monotonic())
        context = validate_current_run(os.environ, event, current_run)
        grant, raw_grant, _ = fetch_json(API_ROOT + '/issues/comments/' + str(context['grant_comment_id']))
        _exclusive(receipts / 'grant-comment.json', raw_grant)
        _start(root, context, time.monotonic())
        query = urllib.parse.urlencode(dict(branch=context['branch'], per_page=100, page=1))
        history, raw_history, link = fetch_json(
            API_ROOT + '/actions/workflows/' + str(context['workflow_id']) + '/runs?' + query)
        _exclusive(receipts / 'history.json', raw_history)
        _start(root, context, time.monotonic())
        _require(type(history) is dict, 'Public run history is not an object')
        result = validate_admission(os.environ, event, grant, time.time(),
                                    {**history, 'complete': not bool(link)}, current_run=current_run)
        _start(root, context, time.monotonic())
        result.update(admitted_monotonic=time.monotonic(),
                      current_run_sha256=hashlib.sha256(raw_current_run).hexdigest(),
                      grant_comment_sha256=hashlib.sha256(raw_grant).hexdigest(),
                      history_sha256=hashlib.sha256(raw_history).hexdigest())
        _exclusive(receipts / 'admission.json', (json.dumps(result, sort_keys=True, indent=2) + '\n').encode())
        if os.environ.get('GITHUB_OUTPUT'):
            with Path(os.environ['GITHUB_OUTPUT']).open('a', encoding='utf-8') as output:
                output.write('allowed=true\n')
        print(json.dumps({'allowed': True, 'run_id': result['run_id'], 'source_sha': SOURCE_SHA}))
        return 0
    except Exception as error:
        failure = dict(allowed=False, error=str(error), schema_version=1)
        if receipts is not None and receipts.is_dir() and not receipts.is_symlink():
            try:
                _exclusive(receipts / 'admission.json', (json.dumps(failure, sort_keys=True) + '\n').encode())
            except OSError:
                pass  # Never replace the original outcome or someone else's file.
        print(json.dumps(failure), file=sys.stderr)
        return 78


if __name__ == '__main__':
    sys.exit(main())
