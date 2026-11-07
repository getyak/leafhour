"""Synthetic, offline admission cases; guards precede all module imports."""
from contextlib import ExitStack, contextmanager
import copy
from datetime import datetime, timezone
import importlib.util
import io
import json
from pathlib import Path
import socket
import subprocess
import unittest
from unittest.mock import patch
import urllib.request


ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / 'scripts/ios/hosted_get328_diagnostic_admission.py'
CONTROL = 'a' * 40
NONCE = 'b' * 32
REF = 'refs/heads/codex/get-328-environment-once/' + CONTROL + '/' + NONCE
BRANCH = REF.removeprefix('refs/heads/')
WORKFLOW = '.github/workflows/get328-environment-once.yml'
API = 'https://api.github.com/repos/getyak/leafhour'
ACTOR = {'login': 'kubbot', 'id': 124379614}
NOW = 1794031200
RUNTIME = dict(runner_label='macos-26-intel', machine='x86_64', image_os='macos26',
               image_version='20260824.0517.1', xcode_version='26.6',
               xcode_build='17F113', sdk='26.5', target_runtime='26.5')
LIMITS = dict(job_seconds=330, work_seconds=240, final_seconds=90, command_seconds=20,
              artifact_max_bytes=33554432, retention_days=3,
              start_free_bytes=8589934592, stop_free_bytes=3221225472,
              scratch_max_bytes=4294967296)
PROBES = ['identity', 'runtime-files', 'tool-help', 'first-launch-status',
          'service-status', 'bounded-service-log', 'owned-processes']


@contextmanager
def deny_effects():
    """Any attempted network/native process, including a swallowed error, fails."""
    attempts = []

    def denied(*args, **kwargs):
        attempts.append('forbidden external operation')
        raise AssertionError('No API, socket, process, SDK, or native calls in host tests')

    with ExitStack() as stack:
        for target in ('urllib.request.urlopen', 'urllib.request.OpenerDirector.open',
                       'socket.create_connection', 'socket.getaddrinfo',
                       'socket.socket.connect', 'socket.socket.connect_ex',
                       'subprocess.Popen', 'os.system'):
            stack.enter_context(patch(target, side_effect=denied))
        yield attempts
    if attempts:
        raise AssertionError('An external operation was attempted under the deny guard')


def load_module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


with deny_effects():
    admission = load_module(MODULE, 'get328_diagnostic_under_test') if MODULE.is_file() else None


def timestamp(epoch):
    return datetime.fromtimestamp(epoch, timezone.utc).isoformat().replace('+00:00', 'Z')


class DiagnosticAdmissionTests(unittest.TestCase):
    def setUp(self):
        self.enterContext(deny_effects())
        self.assertIsNotNone(admission, 'diagnostic admission module has not been implemented')
        self.env = dict(GITHUB_REPOSITORY='getyak/leafhour', GITHUB_REPOSITORY_ID='1415706040',
                        GITHUB_EVENT_NAME='push', GITHUB_ACTOR='kubbot',
                        GITHUB_ACTOR_ID='124379614', GITHUB_TRIGGERING_ACTOR='kubbot',
                        GITHUB_RUN_ID='2001', GITHUB_RUN_ATTEMPT='1', GITHUB_SHA=CONTROL,
                        GITHUB_REF=REF, GITHUB_WORKFLOW_SHA=CONTROL, GITHUB_JOB='diagnose',
                        GITHUB_WORKFLOW_REF='getyak/leafhour/' + WORKFLOW + '@' + REF,
                        RUNNER_ENVIRONMENT='github-hosted', RUNNER_OS='macOS', RUNNER_ARCH='X64',
                        ImageOS='macos26', ImageVersion='20260824.0517.1',
                        DEVELOPER_DIR='/Applications/Xcode_26.6.app/Contents/Developer',
                        GET328_GRANT_COMMENT_ID='6703465445', GET328_GRANT_ISSUER_ID='124379614')
        self.event = dict(ref=REF, after=CONTROL, created=True, deleted=False, forced=False,
                          repository={'full_name': 'getyak/leafhour', 'private': False, 'id': 1415706040},
                          sender=copy.deepcopy(ACTOR))
        self.body = dict(schema_version=1, scope='GET-328-hosted-environment-diagnostic',
                         repository='getyak/leafhour', controller_sha=CONTROL,
                         actor=copy.deepcopy(ACTOR), runtime=copy.deepcopy(RUNTIME),
                         limits=copy.deepcopy(LIMITS), probes=list(PROBES), cases=[], read_only=True,
                         status='consumed', consumed=True, nonce=NONCE, ref=REF,
                         consumed_at=timestamp(NOW - 120), expires_at=timestamp(NOW + 3600))
        self.grant = dict(id=6703465445, user=copy.deepcopy(ACTOR),
                          url=API + '/issues/comments/6703465445',
                          created_at=timestamp(NOW - 300), updated_at=timestamp(NOW - 120),
                          body=json.dumps(self.body))
        self.current_run = dict(id=2001, run_attempt=1, workflow_id=5001,
                                workflow_url=API + '/actions/workflows/5001',
                                head_sha=CONTROL, head_branch=BRANCH, event='push',
                                path=WORKFLOW, actor=copy.deepcopy(ACTOR),
                                triggering_actor=copy.deepcopy(ACTOR),
                                repository=copy.deepcopy(self.event['repository']),
                                head_repository=copy.deepcopy(self.event['repository']),
                                created_at=timestamp(NOW - 60), status='in_progress', conclusion=None)
        self.history = dict(complete=True, total_count=1,
                            workflow_runs=[copy.deepcopy(self.current_run)])
        self.jobs = dict(complete=True, total_count=1, jobs=[dict(
            id=3001, run_id=2001, name='diagnose', status='in_progress', conclusion=None,
            labels=['macos-26-intel'], runner_id=4001, runner_name='GitHub Actions 42')])

    def validate(self, **changes):
        args = dict(env=self.env, event=self.event, grant=self.grant, now_epoch=NOW,
                    history=self.history, current_run=self.current_run, jobs=self.jobs)
        args.update(changes)
        return admission.validate_admission(**args)

    def body_grant(self, **changes):
        return {**self.grant, 'body': json.dumps({**self.body, **changes})}

    def test_exact_consumed_public_grant_admits_diagnostics_without_ui_cases(self):
        result = self.validate()
        self.assertIs(result['allowed'], True)
        self.assertEqual(result['scope'], 'GET-328-hosted-environment-diagnostic')
        self.assertEqual(result['cases'], [])
        self.assertIs(result['read_only'], True)
        self.assertEqual(result['probes'], PROBES)
        self.assertEqual(result['runtime'], RUNTIME)
        self.assertEqual(result['limits'], LIMITS)
        self.assertEqual(result['actor'], ACTOR)
        self.assertEqual(result['controller_sha'], CONTROL)
        self.assertEqual(result['workflow_id'], 5001)
        self.assertEqual(result['job_id'], 3001)
        self.assertEqual(result['grant_comment_id'], 6703465445)
        self.assertNotIn('source_sha', result)

    def test_context_provides_only_current_run_before_numeric_workflow_binding(self):
        result = admission.context(self.env, self.event)
        self.assertEqual(result['current_run_url'], API + '/actions/runs/2001')
        self.assertEqual(result['grant_comment_url'], API + '/issues/comments/6703465445')
        self.assertNotIn('history_url', result)
        result = admission.validate_current_run(self.env, self.event, self.current_run)
        self.assertEqual(result['workflow_id'], 5001)
        self.assertEqual(result['run_created_at'], timestamp(NOW - 60))
        self.assertEqual(result['history_url'], API + '/actions/workflows/5001/runs?branch='
                         'codex%2Fget-328-environment-once%2F' + CONTROL + '%2F' + NONCE + '&per_page=100&page=1')
        self.assertEqual(result['jobs_url'], API + '/actions/runs/2001/jobs?per_page=100&page=1')

    def test_context_rejects_nonnew_forced_deleted_and_nonpush_events(self):
        for key, value in [('created', False), ('created', 1), ('deleted', True),
                           ('deleted', 0), ('forced', True), ('forced', 'false')]:
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                self.validate(event={**self.event, key: value})
        for value in ('pull_request', 'workflow_dispatch', 'workflow_run'):
            with self.subTest(event=value), self.assertRaises(ValueError):
                self.validate(env={**self.env, 'GITHUB_EVENT_NAME': value})

    def test_main_oldseven_pr_tag_or_noncanonical_ref_cannot_enter(self):
        for ref in ('refs/heads/main', 'refs/pull/340/merge', 'refs/tags/replay',
                    REF.replace('environment-once', 'seven-once'), REF + '/x',
                    REF.replace(NONCE, 'b' * 31), REF.replace(CONTROL, 'A' * 40)):
            with self.subTest(ref=ref), self.assertRaises(ValueError):
                self.validate(env={**self.env, 'GITHUB_REF': ref}, event={**self.event, 'ref': ref})

    def test_every_workflow_event_and_head_binding_is_required(self):
        for key, value in [('GITHUB_SHA', 'c' * 40), ('GITHUB_WORKFLOW_SHA', 'c' * 40),
                           ('GITHUB_WORKFLOW_REF', 'getyak/leafhour/' + WORKFLOW + '@refs/heads/main'),
                           ('GITHUB_JOB', 'build')]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.validate(env={**self.env, key: value})
        for key, value in [('after', 'c' * 40), ('ref', 'refs/heads/main')]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.validate(event={**self.event, key: value})

    def test_actor_sender_and_channel_are_fixed_in_code_not_self_selected(self):
        for key, value in [('GITHUB_ACTOR', 'other'), ('GITHUB_ACTOR_ID', '1'),
                           ('GITHUB_ACTOR_ID', True), ('GITHUB_TRIGGERING_ACTOR', 'other'),
                           ('GET328_GRANT_COMMENT_ID', '6702281018'),
                           ('GET328_GRANT_ISSUER_ID', '1')]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.validate(env={**self.env, key: value})
        for sender in ({'login': 'other', 'id': 124379614}, {'login': 'kubbot', 'id': True},
                       {'login': 'kubbot', 'id': '124379614'}):
            with self.subTest(sender=sender), self.assertRaises(ValueError):
                self.validate(event={**self.event, 'sender': sender})
        env = {**self.env, 'GITHUB_ACTOR': 'other', 'GITHUB_ACTOR_ID': '888',
               'GITHUB_TRIGGERING_ACTOR': 'other', 'GET328_GRANT_ISSUER_ID': '888'}
        with self.assertRaises(ValueError):
            admission.context(env, {**self.event, 'sender': {'login': 'other', 'id': 888}})

    def test_environment_and_repository_must_be_exact_public_intel_image(self):
        for key, value in [('RUNNER_ENVIRONMENT', 'self-hosted'), ('RUNNER_OS', 'Linux'),
                           ('RUNNER_ARCH', 'ARM64'), ('ImageOS', 'macos15'),
                           ('ImageVersion', '20260824.0517.2'), ('DEVELOPER_DIR', '/Applications/Xcode.app'),
                           ('GITHUB_REPOSITORY', 'other/leafhour'), ('GITHUB_REPOSITORY_ID', True)]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.validate(env={**self.env, key: value})
        for key, value in [('id', True), ('id', '1415706040'), ('private', True),
                           ('private', 0), ('full_name', 'other/leafhour')]:
            with self.subTest(repo=key, value=value), self.assertRaises(ValueError):
                self.validate(event={**self.event, 'repository': {**self.event['repository'], key: value}})

    def test_replayed_or_unknown_run_identity_cannot_enter(self):
        for key, value in [('GITHUB_RUN_ATTEMPT', '2'), ('GITHUB_RUN_ATTEMPT', 1),
                           ('GITHUB_RUN_ID', '0'), ('GITHUB_RUN_ID', '02001'),
                           ('GITHUB_RUN_ID', True), ('GITHUB_RUN_ID', 'unknown')]:
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                self.validate(env={**self.env, key: value})

    def test_missing_environment_or_event_fields_are_not_defaulted(self):
        for key in self.env:
            with self.subTest(env=key), self.assertRaises(ValueError):
                self.validate(env={k: v for k, v in self.env.items() if k != key})
        for key in self.event:
            with self.subTest(event=key), self.assertRaises(ValueError):
                self.validate(event={k: v for k, v in self.event.items() if k != key})

    def test_current_run_numeric_id_workflow_head_event_and_timestamp_are_bound_first(self):
        for key, value in [('id', True), ('id', 2002), ('run_attempt', True), ('run_attempt', 2),
                           ('workflow_id', True), ('workflow_id', '5001'), ('workflow_id', 0),
                           ('workflow_url', API + '/actions/workflows/other'),
                           ('head_sha', 'c' * 40), ('head_branch', 'main'), ('event', 'workflow_dispatch'),
                           ('status', 'completed'), ('status', 'queued'), ('conclusion', 'failure'),
                           ('path', WORKFLOW + '@refs/heads/main'), ('path', WORKFLOW + '.extra'),
                           ('created_at', '2026-11-07T05:00:00.1Z')]:
            with self.subTest(field=key, value=value):
                run = {**self.current_run, key: value}
                with self.assertRaises(ValueError):
                    admission.validate_current_run(self.env, self.event, run)
                with self.assertRaises(ValueError):
                    self.validate(current_run=run)
        for key in self.current_run:
            with self.subTest(missing=key), self.assertRaises(ValueError):
                self.validate(current_run={k: v for k, v in self.current_run.items() if k != key})
        with self.assertRaises(ValueError):
            self.validate(current_run=None)

    def test_current_run_repositories_and_both_actors_bind_numeric_ids(self):
        for field in ('repository', 'head_repository'):
            for key, value in [('id', True), ('id', 1), ('private', 0), ('private', True),
                               ('full_name', 'other/leafhour')]:
                run = copy.deepcopy(self.current_run)
                run[field][key] = value
                with self.subTest(field=field, key=key), self.assertRaises(ValueError):
                    self.validate(current_run=run)
        for field in ('actor', 'triggering_actor'):
            for key, value in [('id', True), ('id', 1), ('login', 'other')]:
                run = copy.deepcopy(self.current_run)
                run[field][key] = value
                with self.subTest(field=field, key=key), self.assertRaises(ValueError):
                    self.validate(current_run=run)

    def test_rich_api_metadata_and_all_three_exact_path_forms_are_accepted(self):
        for path in (WORKFLOW, WORKFLOW + '@' + BRANCH, WORKFLOW + '@' + REF):
            run = copy.deepcopy(self.current_run)
            run['path'] = path
            run['actor'].update(node_id='synthetic', type='User')
            run['repository'].update(node_id='synthetic')
            with self.subTest(path=path):
                self.assertIs(self.validate(current_run=run)['allowed'], True)

    def test_comment_id_exact_url_and_fixed_author_reject_substitution(self):
        for key, value in [('id', True), ('id', 6702281018),
                           ('url', API + '/issues/comments/6702281018'),
                           ('url', 'https://api.github.com/repos/other/repo/issues/comments/6703465445'),
                           ('user', {'login': 'kubbot', 'id': True}),
                           ('user', {'login': 'other', 'id': 124379614})]:
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                self.validate(grant={**self.grant, key: value})

    def test_pending_unconsumed_wrong_scope_and_boolean_schema_are_rejected(self):
        for key, value in [('schema_version', True), ('schema_version', 2),
                           ('scope', 'GET-328-hosted-original-seven'), ('status', 'pending'),
                           ('consumed', False), ('consumed', 1), ('read_only', False), ('read_only', 1)]:
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                self.validate(grant=self.body_grant(**{key: value}))

    def test_public_core_has_exact_keys_no_execution_or_approval_pointer_extensions(self):
        for key in self.body:
            body = {k: v for k, v in self.body.items() if k != key}
            with self.subTest(missing=key), self.assertRaises(ValueError):
                self.validate(grant={**self.grant, 'body': json.dumps(body)})
        for key, value in [('approval_sha256', 'c' * 64), ('source_sha', 'c' * 40),
                           ('commands', ['xcrun', 'simctl', 'boot']), ('retry', False)]:
            with self.subTest(extra=key), self.assertRaises(ValueError):
                self.validate(grant=self.body_grant(**{key: value}))

    def test_grant_controller_actor_nonce_ref_and_repository_cannot_drift(self):
        for key, value in [('repository', 'other/leafhour'), ('controller_sha', 'c' * 40),
                           ('nonce', 'c' * 32), ('ref', 'refs/heads/main'),
                           ('actor', {'login': 'kubbot', 'id': True}),
                           ('actor', {**ACTOR, 'extra': 'wrong'}),
                           ('actor', {'login': 'other', 'id': 124379614})]:
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                self.validate(grant=self.body_grant(**{key: value}))

    def test_runtime_envelope_is_exact_and_cannot_admit_fallback_arch_image_or_sdk(self):
        for key in RUNTIME:
            for value in ('unapproved', None):
                with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                    self.validate(grant=self.body_grant(runtime={**RUNTIME, key: value}))
            with self.subTest(missing=key), self.assertRaises(ValueError):
                self.validate(grant=self.body_grant(runtime={k: v for k, v in RUNTIME.items() if k != key}))
        with self.assertRaises(ValueError):
            self.validate(grant=self.body_grant(runtime={**RUNTIME, 'fallback': '18.5'}))

    def test_limits_are_exact_including_bool_int_alias_and_unapproved_extra_keys(self):
        for key, value in LIMITS.items():
            for replacement in (value + 1, float(value), True):
                with self.subTest(key=key, value=replacement), self.assertRaises(ValueError):
                    self.validate(grant=self.body_grant(limits={**LIMITS, key: replacement}))
        for limits in ({k: v for k, v in LIMITS.items() if k != 'command_seconds'},
                       {**LIMITS, 'retries': 1}):
            with self.subTest(limits=limits), self.assertRaises(ValueError):
                self.validate(grant=self.body_grant(limits=limits))

    def test_probes_cannot_expand_reorder_duplicate_or_become_ui_cases(self):
        for probes in (PROBES[:-1], PROBES[::-1], [*PROBES, 'boot'],
                       [*PROBES[:-1], PROBES[0]], 'identity'):
            with self.subTest(probes=probes), self.assertRaises(ValueError):
                self.validate(grant=self.body_grant(probes=probes))
        for cases in (['normal-38'], None, {}, ''):
            with self.subTest(cases=cases), self.assertRaises(ValueError):
                self.validate(grant=self.body_grant(cases=cases))

    def test_body_decoder_rejects_duplicate_keys_nonfinite_and_float_overflow(self):
        for raw in ('{"a":1,"a":2}', '{"a":{"x":1,"x":2}}', '{"a":NaN}',
                    '[Infinity]', '{"a":-Infinity}', '{"a":1e999}', 'not json'):
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                admission.decode_json(raw)
        self.assertEqual(admission.decode_json(b'{"finite":1.25,"nested":[true,null]}'),
                         {'finite': 1.25, 'nested': [True, None]})

    def test_invalid_or_oversized_comment_json_cannot_reach_core_validation(self):
        for raw in ('null', '[]', 'true', '"text"', '{"x":1,"x":2}', 'x' * 16385):
            with self.subTest(raw=raw[:30]), self.assertRaises(ValueError):
                self.validate(grant={**self.grant, 'body': raw})
        with self.assertRaises(ValueError):
            self.validate(grant={**self.grant, 'body': b'{}'})

    def test_whole_utc_timestamp_contract_covers_grant_comment_and_both_run_copies(self):
        for section, field in [('body', 'consumed_at'), ('body', 'expires_at'),
                               ('grant', 'created_at'), ('grant', 'updated_at'),
                               ('current', 'created_at'), ('history', 'created_at')]:
            for replacement in ('2026-11-07T05:00:00.000Z', '2026-11-07T05:00:00+00:00',
                                '2026-02-30T05:00:00Z', '2026-11-07T05:00:60Z', True):
                grant, current, history = map(copy.deepcopy, (self.grant, self.current_run, self.history))
                if section == 'body':
                    grant['body'] = json.dumps({**self.body, field: replacement})
                elif section == 'grant':
                    grant[field] = replacement
                elif section == 'current':
                    current[field] = replacement
                else:
                    history['workflow_runs'][0][field] = replacement
                with self.subTest(section=section, field=field, value=replacement), self.assertRaises(ValueError):
                    self.validate(grant=grant, current_run=current, history=history)

    def test_same_second_or_post_run_comment_publication_is_rejected(self):
        for updated in (NOW - 60, NOW - 59, NOW + 1):
            with self.subTest(updated=updated), self.assertRaises(ValueError):
                self.validate(grant={**self.grant, 'updated_at': timestamp(updated)})
        self.assertIs(self.validate(grant={**self.grant, 'updated_at': timestamp(NOW - 61)})['allowed'], True)

    def test_expiry_is_strict_fractional_now_and_two_hour_lifetime_are_bounded(self):
        self.assertIs(self.validate(grant=self.body_grant(expires_at=timestamp(NOW + 1)),
                                    now_epoch=NOW + .999)['allowed'], True)
        for now in (NOW + 1, True, float('nan'), float('inf'), -float('inf')):
            with self.subTest(now=now), self.assertRaises(ValueError):
                self.validate(grant=self.body_grant(expires_at=timestamp(NOW + 1)), now_epoch=now)
        self.assertIs(self.validate(grant=self.body_grant(expires_at=timestamp(NOW - 120 + 7200)))['allowed'], True)
        for expires in (NOW - 120 + 7201, NOW - 120, NOW - 121):
            with self.subTest(expires=expires), self.assertRaises(ValueError):
                self.validate(grant=self.body_grant(expires_at=timestamp(expires)))

    def test_comment_and_consumption_causality_cannot_be_reversed_or_future_dated(self):
        for grant in ({**self.grant, 'created_at': timestamp(NOW - 119)},
                      {**self.grant, 'updated_at': timestamp(NOW - 121)},
                      self.body_grant(consumed_at=timestamp(NOW + 1))):
            with self.subTest(grant=grant), self.assertRaises(ValueError):
                self.validate(grant=grant)
        with self.assertRaises(ValueError):
            self.validate(now_epoch=NOW - 61)

    def test_incomplete_unknown_duplicate_or_prior_history_is_rejected(self):
        for history in (None, {}, {**self.history, 'complete': False},
                        {**self.history, 'complete': 1}, {**self.history, 'total_count': True},
                        {**self.history, 'workflow_runs': []}, {**self.history, 'total_count': 2},
                        {**self.history, 'total_count': 2, 'workflow_runs': [self.current_run, self.current_run]}):
            with self.subTest(history=history), self.assertRaises(ValueError):
                self.validate(history=history)

    def test_history_identity_cannot_hide_another_head_event_workflow_or_attempt(self):
        for key, value in [('id', 2002), ('run_attempt', 2), ('head_sha', 'c' * 40),
                           ('head_branch', 'main'), ('event', 'workflow_dispatch'),
                           ('workflow_id', 5002), ('created_at', timestamp(NOW - 59))]:
            run = {**self.current_run, key: value}
            if key == 'workflow_id':
                run['workflow_url'] = API + '/actions/workflows/5002'
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.validate(history={**self.history, 'workflow_runs': [run]})

    def test_jobs_must_be_complete_one_exact_current_diagnose_with_assigned_intel_runner(self):
        job = self.jobs['jobs'][0]
        for jobs in (None, {}, {**self.jobs, 'complete': False}, {**self.jobs, 'complete': 1},
                     {**self.jobs, 'total_count': True}, {**self.jobs, 'jobs': []},
                     {**self.jobs, 'total_count': 2, 'jobs': [job, job]}):
            with self.subTest(jobs=jobs), self.assertRaises(ValueError):
                self.validate(jobs=jobs)
        for key, value in [('id', True), ('run_id', True), ('run_id', 2002), ('name', 'prepare'),
                           ('status', 'queued'), ('status', 'completed'), ('conclusion', 'success'),
                           ('labels', ['macos-26-intel', 'self-hosted']), ('labels', ['macos-26']),
                           ('runner_id', True), ('runner_id', 0), ('runner_name', ''), ('runner_name', None)]:
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                self.validate(jobs={**self.jobs, 'jobs': [{**job, key: value}]})
        for key in job:
            with self.subTest(missing=key), self.assertRaises(ValueError):
                self.validate(jobs={**self.jobs, 'jobs': [{k: v for k, v in job.items() if k != key}]})

    def test_validation_does_not_mutate_inputs_or_expose_shared_mutable_envelopes(self):
        values = [self.env, self.event, self.grant, self.current_run, self.history, self.jobs]
        before = copy.deepcopy(values)
        result = self.validate()
        self.assertEqual(values, before)
        result['runtime']['sdk'] = '18.5'
        result['limits']['job_seconds'] = 9999
        result['probes'].append('boot')
        result['cases'].append('normal-38')
        self.assertEqual(self.validate()['runtime'], RUNTIME)
        self.assertEqual(self.validate()['probes'], PROBES)
        self.assertEqual(self.validate()['cases'], [])

    def test_loading_old_and_new_modules_in_both_orders_has_no_external_side_effects(self):
        old_path = ROOT / 'scripts/ios/hosted_get328_admission.py'
        for sequence in ((old_path, MODULE), (MODULE, old_path)):
            output = io.StringIO()
            with self.subTest(sequence=sequence), patch('sys.stdout', output), patch('sys.stderr', output):
                modules = [load_module(path, 'offline_order_' + str(i)) for i, path in enumerate(sequence)]
                diagnostic = modules[sequence.index(MODULE)]
                self.assertIs(diagnostic.validate_admission(
                    self.env, self.event, self.grant, NOW, self.history,
                    current_run=self.current_run, jobs=self.jobs)['allowed'], True)
            self.assertEqual(output.getvalue(), '')


if __name__ == '__main__':
    unittest.main()
