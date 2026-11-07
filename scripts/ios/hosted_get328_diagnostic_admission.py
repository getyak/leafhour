"""Pure admission for one bounded GET-328 hosted environment diagnostic.

No network, filesystem, process, SDK, or device operations occur here, including
on import. The controlled caller fetches the returned URLs anonymously, saves
raw request/response evidence, and adds complete=True only for an unfiltered,
unpaginated whole response (no Link header). A supplied complete flag is that
caller's attestation; this module cannot independently observe the HTTP fetch.
"""
from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime
import json
import math
import re
from types import MappingProxyType
from urllib.parse import urlencode


REPOSITORY = 'getyak/leafhour'
REPOSITORY_ID = 1415706040
WORKFLOW_PATH = '.github/workflows/get328-environment-once.yml'
SCOPE = 'GET-328-hosted-environment-diagnostic'
ACTOR_LOGIN = 'kubbot'
ACTOR_ID = 124379614
COMMENT_ID = 6703465445
JOB = 'diagnose'
DEVELOPER_DIR = '/Applications/Xcode_26.6.app/Contents/Developer'
API_ROOT = 'https://api.github.com/repos/' + REPOSITORY
RUNTIME = MappingProxyType(dict(
    runner_label='macos-26-intel', machine='x86_64', image_os='macos26',
    image_version='20260824.0517.1', xcode_version='26.6', xcode_build='17F113',
    sdk='26.5', target_runtime='26.5'))
LIMITS = MappingProxyType(dict(
    job_seconds=330, work_seconds=240, final_seconds=90, command_seconds=20,
    artifact_max_bytes=33554432, retention_days=3, start_free_bytes=8589934592,
    stop_free_bytes=3221225472, scratch_max_bytes=4294967296))
PROBES = ('identity', 'runtime-files', 'tool-help', 'first-launch-status',
          'service-status', 'bounded-service-log', 'owned-processes')
CORE_FIELDS = frozenset((
    'schema_version', 'scope', 'repository', 'controller_sha', 'actor', 'runtime',
    'limits', 'probes', 'cases', 'read_only', 'status', 'consumed', 'nonce', 'ref',
    'consumed_at', 'expires_at'))
REF_PATTERN = re.compile(
    r'refs/heads/codex/get-328-environment-once/([0-9a-f]{40})/([0-9a-f]{32})')


def _require(condition, message):
    if not condition:
        raise ValueError(message)


def _identifier(value, field, *, encoded=False):
    if encoded:
        _require(type(value) is str and re.fullmatch(r'[1-9][0-9]{0,19}', value),
                 'Missing or invalid ' + field)
        return int(value)
    _require(type(value) is int and value > 0, 'Missing or invalid ' + field)
    return value


def _utc(value, field):
    _require(type(value) is str and re.fullmatch(
        r'[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z', value),
        'Invalid whole-second UTC timestamp: ' + field)
    try:
        return int(datetime.fromisoformat(value[:-1] + '+00:00').timestamp())
    except (ValueError, OverflowError) as error:
        raise ValueError('Invalid UTC timestamp: ' + field) from error


def _exact_dict(value, expected, field):
    _require(type(value) is dict and set(value) == set(expected), 'Incomplete ' + field)
    _require(all(type(value[key]) is type(want) and value[key] == want
                 for key, want in expected.items()), 'Unapproved ' + field)


def decode_json(raw):
    """Decode JSON while rejecting duplicates and all nonfinite numbers."""
    _require(type(raw) in (str, bytes, bytearray), 'JSON must be encoded text')

    def unique(pairs):
        result = {}
        for key, value in pairs:
            _require(key not in result, 'Duplicate JSON key')
            result[key] = value
        return result

    def finite_float(token):
        value = float(token)
        _require(math.isfinite(value), 'Nonfinite JSON value')
        return value

    def invalid_constant(unused):
        raise ValueError('Nonfinite JSON value')

    return json.loads(raw, object_pairs_hook=unique, parse_float=finite_float,
                      parse_constant=invalid_constant)


def _repository(value, field):
    _require(type(value) is dict and value.get('full_name') == REPOSITORY
             and value.get('private') is False
             and _identifier(value.get('id'), field + ' id') == REPOSITORY_ID,
             'Not the exact public repository: ' + field)


def _actor(value, field):
    _require(type(value) is dict and value.get('login') == ACTOR_LOGIN
             and _identifier(value.get('id'), field + ' id') == ACTOR_ID,
             'Not the fixed authorized actor: ' + field)


def context(env, event):
    """Bind the exact new push and fixed runner context before any API read."""
    _require(isinstance(env, Mapping) and type(event) is dict, 'Missing environment/event')
    exact_env = dict(
        GITHUB_REPOSITORY=REPOSITORY, GITHUB_REPOSITORY_ID=str(REPOSITORY_ID),
        GITHUB_EVENT_NAME='push', GITHUB_JOB=JOB, GITHUB_ACTOR=ACTOR_LOGIN,
        GITHUB_ACTOR_ID=str(ACTOR_ID), GITHUB_TRIGGERING_ACTOR=ACTOR_LOGIN,
        GITHUB_RUN_ATTEMPT='1', GET328_GRANT_COMMENT_ID=str(COMMENT_ID),
        GET328_GRANT_ISSUER_ID=str(ACTOR_ID), RUNNER_ENVIRONMENT='github-hosted',
        RUNNER_OS='macOS', RUNNER_ARCH='X64', ImageOS=RUNTIME['image_os'],
        ImageVersion=RUNTIME['image_version'], DEVELOPER_DIR=DEVELOPER_DIR)
    for key, want in exact_env.items():
        _require(type(env.get(key)) is str and env[key] == want, 'Unapproved environment: ' + key)
    _repository(event.get('repository'), 'event.repository')
    _actor(event.get('sender'), 'event.sender')
    _require(event.get('created') is True and event.get('deleted') is False
             and event.get('forced') is False, 'Only a new nonforced branch push is admitted')
    ref = env.get('GITHUB_REF')
    match = REF_PATTERN.fullmatch(ref) if type(ref) is str else None
    _require(match is not None and event.get('ref') == ref, 'Unapproved one-use ref')
    controller_sha, nonce = match.groups()
    _require(event.get('after') == controller_sha == env.get('GITHUB_SHA')
             == env.get('GITHUB_WORKFLOW_SHA'), 'Controller/workflow/event SHA binding changed')
    workflow_ref = REPOSITORY + '/' + WORKFLOW_PATH + '@' + ref
    _require(env.get('GITHUB_WORKFLOW_REF') == workflow_ref, 'Workflow ref binding changed')
    run_id = _identifier(env.get('GITHUB_RUN_ID'), 'run id', encoded=True)
    return dict(repository=REPOSITORY, controller_sha=controller_sha, nonce=nonce,
                ref=ref, branch=ref.removeprefix('refs/heads/'), workflow_ref=workflow_ref,
                run_id=run_id, actor=dict(login=ACTOR_LOGIN, id=ACTOR_ID), job=JOB,
                grant_comment_id=COMMENT_ID, grant_issuer_id=ACTOR_ID,
                current_run_url=API_ROOT + '/actions/runs/' + str(run_id),
                grant_comment_url=API_ROOT + '/issues/comments/' + str(COMMENT_ID))


def _run_identity(identity, run, field):
    _require(type(run) is dict, 'Missing ' + field)
    _require(_identifier(run.get('id'), field + ' id') == identity['run_id']
             and type(run.get('run_attempt')) is int and run['run_attempt'] == 1,
             field + ' does not identify this first attempt')
    workflow_id = _identifier(run.get('workflow_id'), field + ' workflow id')
    _require(run.get('workflow_url') == API_ROOT + '/actions/workflows/' + str(workflow_id),
             field + ' workflow URL differs from the fixed public repository')
    for key in ('repository', 'head_repository'):
        _repository(run.get(key), field + '.' + key)
    for key in ('actor', 'triggering_actor'):
        _actor(run.get(key), field + '.' + key)
    _require(run.get('head_sha') == identity['controller_sha']
             and run.get('head_branch') == identity['branch'] and run.get('event') == 'push',
             field + ' belongs to another head/ref/event')
    _require(run.get('path') in (WORKFLOW_PATH, WORKFLOW_PATH + '@' + identity['branch'],
                                WORKFLOW_PATH + '@' + identity['ref']),
             field + ' belongs to another workflow')
    _utc(run.get('created_at'), field + '.created_at')
    return dict(workflow_id=workflow_id, run_created_at=run['created_at'])


def validate_current_run(env, event, current_run):
    """Bind a raw current run before exposing its numeric workflow history URL."""
    identity = context(env, event)
    bound = _run_identity(identity, current_run, 'Current run')
    _require(current_run.get('status') == 'in_progress' and 'conclusion' in current_run
             and current_run['conclusion'] is None, 'Current run is not actively executing')
    query = urlencode(dict(branch=identity['branch'], per_page=100, page=1))
    return dict(**identity, **bound,
                history_url=API_ROOT + '/actions/workflows/' + str(bound['workflow_id']) + '/runs?' + query,
                jobs_url=API_ROOT + '/actions/runs/' + str(identity['run_id']) + '/jobs?per_page=100&page=1')


def _complete_single(value, collection, field):
    _require(type(value) is dict and value.get('complete') is True,
             field + ' is incomplete, paginated, or unavailable')
    records = value.get(collection)
    _require(type(records) is list and type(value.get('total_count')) is int
             and value['total_count'] == len(records) == 1,
             field + ' must contain exactly one complete current record')
    return records[0]


def _job(identity, jobs):
    job = _complete_single(jobs, 'jobs', 'Jobs')
    _require(type(job) is dict, 'Missing current diagnose job')
    job_id = _identifier(job.get('id'), 'job id')
    _require(_identifier(job.get('run_id'), 'job run id') == identity['run_id'],
             'Job belongs to a different run')
    _require(job.get('name') == JOB and job.get('status') == 'in_progress'
             and 'conclusion' in job and job['conclusion'] is None,
             'Not the active diagnose job')
    _require(type(job.get('labels')) is list and job['labels'] == [RUNTIME['runner_label']],
             'Job is not exclusively the approved Intel runner label')
    _identifier(job.get('runner_id'), 'allocated runner id')
    _require(type(job.get('runner_name')) is str and bool(job['runner_name'].strip()),
             'No actual runner has been assigned')
    return job_id


def validate_admission(env, event, grant, now_epoch, history, *, current_run, jobs):
    """Return a bounded diagnostic admission or raise ValueError; never fetch.

    complete=True in history/jobs attests that the controlled caller used the
    exact returned URLs without hidden head/event filtering and without Link
    pagination. History is a replay fence, never a replacement consumption ledger.
    """
    identity = validate_current_run(env, event, current_run)
    _require(type(now_epoch) in (int, float) and math.isfinite(now_epoch), 'Unknown current time')
    _require(type(grant) is dict, 'Missing public grant comment')
    _require(_identifier(grant.get('id'), 'comment id') == COMMENT_ID,
             'Comment differs from the fixed diagnostic channel')
    _actor(grant.get('user'), 'comment author')
    _require(grant.get('url') == identity['grant_comment_url'], 'Comment URL differs')
    raw_body = grant.get('body')
    _require(type(raw_body) is str and len(raw_body.encode('utf-8')) <= 16384,
             'Missing or oversized grant body')
    try:
        body = decode_json(raw_body)
    except (ValueError, TypeError, UnicodeError) as error:
        raise ValueError('Grant body must be valid JSON') from error
    _require(type(body) is dict and set(body) == CORE_FIELDS, 'Grant must have the exact diagnostic core')
    _require(type(body['schema_version']) is int and body['schema_version'] == 1,
             'Unsupported grant schema')
    _require(body['scope'] == SCOPE and body['status'] == 'consumed'
             and body['consumed'] is True and body['read_only'] is True,
             'Grant is not an externally consumed read-only diagnostic')
    for key in ('repository', 'controller_sha', 'nonce', 'ref'):
        _require(body[key] == identity[key], 'Grant binding differs: ' + key)
    _exact_dict(body['actor'], identity['actor'], 'authorized actor')
    _exact_dict(body['runtime'], RUNTIME, 'runtime scope')
    _exact_dict(body['limits'], LIMITS, 'resource/time limits')
    _require(type(body['probes']) is list and body['probes'] == list(PROBES),
             'Grant must authorize only the exact diagnostic probes in order')
    _require(type(body['cases']) is list and body['cases'] == [], 'Diagnostic grant cannot authorize UI cases')
    consumed = _utc(body['consumed_at'], 'consumed_at')
    expires = _utc(body['expires_at'], 'expires_at')
    created = _utc(grant.get('created_at'), 'comment.created_at')
    updated = _utc(grant.get('updated_at'), 'comment.updated_at')
    _require(created <= consumed <= updated <= now_epoch < expires,
             'Grant is expired, future-dated, or not durably published')
    _require(0 < expires - consumed <= 7200, 'Grant lifetime exceeds the approved two hours')
    history_run = _complete_single(history, 'workflow_runs', 'Run history')
    history_identity = _run_identity(identity, history_run, 'History run')
    _require(history_identity == dict(workflow_id=identity['workflow_id'],
                                      run_created_at=identity['run_created_at']),
             'Current run and history disagree on workflow identity or creation time')
    run_created = _utc(identity['run_created_at'], 'current_run.created_at')
    _require(updated < run_created <= now_epoch,
             'Comment must be published before the run creation whole second')
    job_id = _job(identity, jobs)
    return dict(allowed=True, schema_version=1, **identity, job_id=job_id, scope=SCOPE,
                runtime=dict(RUNTIME), limits=dict(LIMITS), probes=list(PROBES), cases=[],
                read_only=True, consumed_at=body['consumed_at'], expires_at=body['expires_at'])
