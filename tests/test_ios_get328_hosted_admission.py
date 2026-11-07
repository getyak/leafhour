"""Synthetic admission fixtures only; no Actions, SDK, network, or native calls."""
import copy
from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime, timezone
import importlib.util
import hashlib
import io
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, patch
from urllib.parse import parse_qs, urlsplit


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    'hosted_get328_admission', ROOT / 'scripts/ios/hosted_get328_admission.py')
admission = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = admission
SPEC.loader.exec_module(admission)

SOURCE = '3869043f6a5cb492ee1a777d9a247d1df7d71041'
TREE = '396d83fe5a8231cc14b0a76ff4348ceb2aeb71a9'
CONTROL = 'a' * 40
NONCE = 'b' * 32
REF = 'refs/heads/codex/get-328-seven-once/' + CONTROL + '/' + NONCE
WORKFLOW = '.github/workflows/get328-seven-once.yml'
NOW = 1794031200
CASES = ['normal-38', 'normal-41', 'normal-54', 'ax5-38', 'ax5-41', 'ax5-54', 'pdf73']
RUNTIME = dict(runner_label='macos-26-intel', arch='x86_64', xcode_version='26.6',
               xcode_build='17F113', sdk='26.5', runtime='26.5')
LIMITS = dict(job_seconds=4200, bootstrap_seconds=600, build_seconds=1200,
              seven_seconds=1800, cleanup_seconds=120, package_seconds=60,
              upload_seconds=180, final_reserve_seconds=360,
              upload_max_bytes=268435456, start_free_bytes=8 * 1024 ** 3,
              stop_free_bytes=3 * 1024 ** 3, scratch_max_bytes=4 * 1024 ** 3)


def timestamp(epoch):
    return datetime.fromtimestamp(epoch, timezone.utc).isoformat().replace('+00:00', 'Z')


class HostedAdmissionTests(unittest.TestCase):
    def setUp(self):
        self.env = dict(GITHUB_REPOSITORY='getyak/leafhour', GITHUB_REPOSITORY_ID='1415706040',
                        GITHUB_EVENT_NAME='push', GITHUB_ACTOR='synthetic-authorized',
                        GITHUB_ACTOR_ID='1001', GITHUB_TRIGGERING_ACTOR='synthetic-authorized',
                        GITHUB_RUN_ID='2001', GITHUB_RUN_ATTEMPT='1', GITHUB_SHA=CONTROL,
                        GITHUB_REF=REF, GITHUB_WORKFLOW_SHA=CONTROL,
                        GITHUB_WORKFLOW_REF='getyak/leafhour/' + WORKFLOW + '@' + REF,
                        RUNNER_ENVIRONMENT='github-hosted', RUNNER_OS='macOS', RUNNER_ARCH='X64',
                        GET328_GRANT_COMMENT_ID='3001', GET328_GRANT_ISSUER_ID='4001')
        self.event = dict(ref=REF, after=CONTROL, created=True, deleted=False, forced=False,
                          repository={'full_name': 'getyak/leafhour', 'private': False, 'id': 1415706040},
                          sender={'login': 'synthetic-authorized', 'id': 1001})
        self.body = dict(schema_version=1, scope='GET-328-hosted-original-seven',
                         status='consumed', consumed=True, repository='getyak/leafhour',
                         actor={'login': 'synthetic-authorized', 'id': 1001},
                         controller_sha=CONTROL, source_sha=SOURCE, source_tree=TREE,
                         runtime=copy.deepcopy(RUNTIME), limits=copy.deepcopy(LIMITS),
                         cases=list(CASES), nonce=NONCE, ref=REF,
                         consumed_at=timestamp(NOW - 120), expires_at=timestamp(NOW + 3600))
        self.comment = dict(id=3001, user={'id': 4001, 'login': 'synthetic-approver'},
                            url='https://api.github.com/repos/getyak/leafhour/issues/comments/3001',
                            created_at=timestamp(NOW - 300), updated_at=timestamp(NOW - 120),
                            body=json.dumps(self.body))
        self.current_run = dict(
            id=2001, head_sha=CONTROL, head_branch=REF.removeprefix('refs/heads/'),
            event='push', run_attempt=1, actor={'login': 'synthetic-authorized', 'id': 1001},
            triggering_actor={'login': 'synthetic-authorized', 'id': 1001},
            path=WORKFLOW, created_at=timestamp(NOW - 60), workflow_id=5001,
            workflow_url='https://api.github.com/repos/getyak/leafhour/actions/workflows/5001',
            repository=copy.deepcopy(self.event['repository']),
            head_repository=copy.deepcopy(self.event['repository']),
            status='in_progress', conclusion=None)
        history_run = {**copy.deepcopy(self.current_run), 'path': WORKFLOW + '@' + REF}
        self.history = dict(complete=True, total_count=1, workflow_runs=[history_run])

    def validate(self, **changes):
        args = dict(env=self.env, event=self.event, grant=self.comment,
                    now_epoch=NOW, history=self.history, current_run=self.current_run)
        args.update(changes)
        return admission.validate_admission(**args)

    def body_comment(self, body):
        return {**self.comment, 'body': json.dumps(body)}

    def test_exact_consumed_public_grant_admits_one_bound_run(self):
        result = self.validate()
        self.assertIs(result['allowed'], True)
        self.assertEqual(result['run_id'], 2001)
        self.assertEqual(result['controller_sha'], CONTROL)
        self.assertEqual(result['source_sha'], SOURCE)
        self.assertEqual(result['source_tree'], TREE)
        self.assertEqual(result['nonce'], NONCE)
        self.assertEqual(result['grant_comment_id'], 3001)
        self.assertEqual(result['workflow_id'], 5001)

    def test_current_run_accepts_rich_api_metadata_and_only_exact_workflow_paths(self):
        for path in (WORKFLOW, WORKFLOW + '@' + REF,
                     WORKFLOW + '@' + REF.removeprefix('refs/heads/')):
            with self.subTest(path=path):
                run = copy.deepcopy(self.current_run)
                run['path'] = path
                for field in ('actor', 'triggering_actor'):
                    run[field].update(type='User', node_id='synthetic', site_admin=False)
                result = admission.validate_current_run(self.env, self.event, run)
                self.assertEqual(result['workflow_id'], 5001)
                self.assertEqual(result['run_id'], 2001)
                self.assertEqual(result['run_created_at'], self.current_run['created_at'])
                self.assertIs(self.validate(current_run=run)['allowed'], True)

    def test_current_run_identity_cannot_be_substituted_or_omitted(self):
        wrong = [('id', 2002), ('id', True), ('run_attempt', 2), ('run_attempt', True),
                 ('workflow_id', True), ('workflow_id', '5001'), ('workflow_id', 0),
                 ('workflow_id', -1), ('head_sha', 'c' * 40), ('head_branch', 'main'),
                 ('event', 'pull_request'), ('path', WORKFLOW + '.extra'),
                 ('path', WORKFLOW + '@refs/heads/main'),
                 ('workflow_url', 'https://api.github.com/repos/other/repo/actions/workflows/5001'),
                 ('workflow_url', self.current_run['workflow_url'] + '0')]
        for field, value in wrong:
            with self.subTest(field=field, value=value):
                run = {**self.current_run, field: value}
                with self.assertRaises(ValueError):
                    admission.validate_current_run(self.env, self.event, run)
                with self.assertRaises(ValueError):
                    self.validate(current_run=run)
        for field in ('id', 'run_attempt', 'workflow_id', 'workflow_url', 'head_sha',
                      'head_branch', 'event', 'path', 'created_at', 'repository',
                      'head_repository', 'actor', 'triggering_actor'):
            with self.subTest(missing=field):
                run = {key: value for key, value in self.current_run.items() if key != field}
                with self.assertRaises(ValueError):
                    admission.validate_current_run(self.env, self.event, run)
        with self.assertRaises(ValueError):
            self.validate(current_run=None)

    def test_current_run_repository_and_both_actor_identities_are_bound(self):
        for field in ('repository', 'head_repository'):
            for key, value in [('id', 1), ('id', True), ('private', True),
                               ('private', 0), ('full_name', 'other/leafhour')]:
                run = copy.deepcopy(self.current_run)
                run[field][key] = value
                with self.subTest(field=field, key=key, value=value), self.assertRaises(ValueError):
                    self.validate(current_run=run)
        for field in ('actor', 'triggering_actor'):
            for key, value in [('id', 999), ('id', True), ('login', 'other')]:
                run = copy.deepcopy(self.current_run)
                run[field][key] = value
                with self.subTest(field=field, key=key, value=value), self.assertRaises(ValueError):
                    self.validate(current_run=run)

    def test_current_run_is_required_by_the_pure_admission_api(self):
        with self.assertRaises(TypeError):
            admission.validate_admission(self.env, self.event, self.comment, NOW, self.history)

    def test_private_foreign_or_wrong_repository_identity_is_rejected(self):
        for key, value in [('private', True), ('private', 'false'), ('full_name', 'other/leafhour'),
                           ('id', 1), ('id', True)]:
            with self.subTest(key=key, value=value):
                event = copy.deepcopy(self.event)
                event['repository'][key] = value
                with self.assertRaises(ValueError):
                    self.validate(event=event)

    def test_only_created_nonforced_nondeleted_push_is_admitted(self):
        for key, value in [('created', False), ('created', 1), ('forced', True),
                           ('deleted', True), ('forced', 'false')]:
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                self.validate(event={**self.event, key: value})
        with self.assertRaises(ValueError):
            self.validate(env={**self.env, 'GITHUB_EVENT_NAME': 'workflow_dispatch'})

    def test_main_pr_tag_and_malformed_nonce_refs_are_rejected(self):
        for ref in ('refs/heads/main', 'refs/pull/1/merge', 'refs/tags/replay', REF + '/extra',
                    REF.replace(NONCE, 'pending'), REF.replace(NONCE, 'b' * 31)):
            with self.subTest(ref=ref), self.assertRaises(ValueError):
                self.validate(env={**self.env, 'GITHUB_REF': ref}, event={**self.event, 'ref': ref})

    def test_actor_login_id_sender_and_triggering_actor_are_all_bound(self):
        for key, value in [('GITHUB_ACTOR', 'other'), ('GITHUB_ACTOR_ID', '999'),
                           ('GITHUB_TRIGGERING_ACTOR', 'other')]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.validate(env={**self.env, key: value})
        for sender in ({'login': 'other', 'id': 1001}, {'login': 'synthetic-authorized', 'id': True}):
            with self.subTest(sender=sender), self.assertRaises(ValueError):
                self.validate(event={**self.event, 'sender': sender})

    def test_attempt_two_and_missing_or_invalid_run_identity_are_rejected(self):
        for key, value in [('GITHUB_RUN_ATTEMPT', '2'), ('GITHUB_RUN_ATTEMPT', ''),
                           ('GITHUB_RUN_ID', '0'), ('GITHUB_RUN_ID', 'not-a-run')]:
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                self.validate(env={**self.env, key: value})

    def test_ref_event_workflow_and_controller_hashes_must_all_match(self):
        for key in ('GITHUB_SHA', 'GITHUB_WORKFLOW_SHA'):
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.validate(env={**self.env, key: 'c' * 40})
        with self.assertRaises(ValueError):
            self.validate(event={**self.event, 'after': 'c' * 40})
        for value in ('getyak/leafhour/' + WORKFLOW + '@refs/heads/main',
                      'getyak/leafhour/.github/workflows/other.yml@' + REF):
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.validate(env={**self.env, 'GITHUB_WORKFLOW_REF': value})

    def test_pending_pins_cannot_authorize_a_comment(self):
        for key in ('GET328_GRANT_COMMENT_ID', 'GET328_GRANT_ISSUER_ID'):
            for value in ('PENDING', '0', '', 'true'):
                with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                    self.validate(env={**self.env, key: value})

    def test_comment_id_issuer_and_repository_url_cannot_be_self_declared_in_body(self):
        variants = [{**self.comment, 'id': 3002},
                    {**self.comment, 'user': {'id': 4002}},
                    {**self.comment, 'user': {'id': True}},
                    {**self.comment, 'url': 'https://api.github.com/repos/other/repo/issues/comments/3001'}]
        for comment in variants:
            with self.subTest(comment=comment), self.assertRaises(ValueError):
                self.validate(grant=comment)

    def test_unconsumed_pending_or_non_json_comment_is_rejected(self):
        for key, value in [('consumed', False), ('consumed', 'true'), ('status', 'pending'),
                           ('schema_version', 2), ('scope', 'all-tests')]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.validate(grant=self.body_comment({**self.body, key: value}))
        with self.assertRaises(ValueError):
            self.validate(grant={**self.comment, 'body': 'Approval pending; not JSON'})

    def test_source_tree_nonce_ref_and_controller_scope_are_fixed(self):
        for key, value in [('source_sha', 'c' * 40), ('source_tree', 'd' * 40),
                           ('controller_sha', 'c' * 40), ('nonce', 'c' * 32),
                           ('ref', 'refs/heads/main'), ('repository', 'other/repo')]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.validate(grant=self.body_comment({**self.body, key: value}))

    def test_missing_reordered_duplicate_or_extra_cases_cannot_expand_scope(self):
        for cases in (CASES[:-1], CASES[::-1], [*CASES[:-1], CASES[0]], [*CASES, 'observer']):
            with self.subTest(cases=cases), self.assertRaises(ValueError):
                self.validate(grant=self.body_comment({**self.body, 'cases': cases}))

    def test_runtime_and_every_resource_limit_are_exact_not_silent_fallbacks(self):
        for key in RUNTIME:
            body = copy.deepcopy(self.body)
            body['runtime'][key] = 'other'
            with self.subTest(runtime=key), self.assertRaises(ValueError):
                self.validate(grant=self.body_comment(body))
        for key, value in LIMITS.items():
            body = copy.deepcopy(self.body)
            body['limits'][key] = value + 1
            with self.subTest(limit=key), self.assertRaises(ValueError):
                self.validate(grant=self.body_comment(body))

    def test_expired_future_invalid_or_timezone_free_grants_are_rejected(self):
        for key, value in [('expires_at', timestamp(NOW)), ('consumed_at', timestamp(NOW + 1)),
                           ('expires_at', 'not-a-time'), ('consumed_at', '2026-11-07T05:00:00')]:
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                self.validate(grant=self.body_comment({**self.body, key: value}))

    def test_comment_edited_after_this_run_cannot_supply_retroactive_authorization(self):
        with self.assertRaises(ValueError):
            self.validate(grant={**self.comment, 'updated_at': timestamp(NOW - 1)})

    def test_causal_timestamps_require_canonical_whole_utc_seconds(self):
        for scope, field in [('body', 'consumed_at'), ('body', 'expires_at'),
                             ('comment', 'created_at'), ('comment', 'updated_at'),
                             ('history', 'created_at'), ('current', 'created_at')]:
            for suffix in ('.000Z', '+00:00'):
                with self.subTest(scope=scope, field=field, suffix=suffix):
                    comment = copy.deepcopy(self.comment)
                    history = copy.deepcopy(self.history)
                    current = copy.deepcopy(self.current_run)
                    if scope == 'body':
                        body = {**self.body, field: self.body[field][:-1] + suffix}
                        comment['body'] = json.dumps(body)
                    elif scope == 'comment':
                        comment[field] = comment[field][:-1] + suffix
                    elif scope == 'history':
                        run = history['workflow_runs'][0]
                        run[field] = run[field][:-1] + suffix
                    else:
                        current[field] = current[field][:-1] + suffix
                    with self.assertRaises(ValueError):
                        self.validate(grant=comment, history=history, current_run=current)

    def test_comment_update_in_the_run_creation_second_is_rejected(self):
        comment = {**self.comment, 'updated_at': self.history['workflow_runs'][0]['created_at']}
        with self.assertRaises(ValueError):
            self.validate(grant=comment)

    def test_one_second_publication_gap_and_fractional_now_keep_exact_expiry(self):
        comment = {**self.comment, 'updated_at': timestamp(NOW - 61)}
        grant = {**comment, 'body': json.dumps({**self.body, 'expires_at': timestamp(NOW + 1)})}
        self.assertIs(self.validate(grant=grant, now_epoch=NOW + 0.999)['allowed'], True)
        with self.assertRaises(ValueError):
            self.validate(grant=grant, now_epoch=NOW + 1)
        for now in (True, float('nan'), float('inf'), -float('inf')):
            with self.subTest(now=now), self.assertRaises(ValueError):
                self.validate(now_epoch=now)

    def test_invalid_calendar_and_nonzero_fractional_grant_times_are_rejected(self):
        for value in ('2026-02-30T04:00:00Z', '2026-11-07T04:00:60Z',
                      timestamp(NOW - 121)[:-1] + '.1Z',
                      timestamp(NOW - 121)[:-1] + '+01:00'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.validate(grant=self.body_comment({**self.body, 'consumed_at': value}))

    def test_incomplete_missing_paginated_or_duplicate_history_fails_closed(self):
        for history in (None, {}, {**self.history, 'complete': False},
                        {**self.history, 'total_count': 2},
                        {**self.history, 'workflow_runs': []},
                        {**self.history, 'total_count': 2,
                         'workflow_runs': [self.history['workflow_runs'][0],
                                           {**self.history['workflow_runs'][0], 'id': 2000}]}):
            with self.subTest(history=history), self.assertRaises(ValueError):
                self.validate(history=history)

    def test_history_must_identify_this_exact_run_and_workflow(self):
        for key, value in [('id', 2002), ('head_sha', 'c' * 40), ('head_branch', 'main'),
                           ('event', 'workflow_dispatch'), ('run_attempt', 2),
                           ('path', '.github/workflows/other.yml@' + REF)]:
            run = {**self.history['workflow_runs'][0], key: value}
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.validate(history={**self.history, 'workflow_runs': [run]})

    def test_current_run_and_history_must_agree_on_numeric_workflow_and_creation_time(self):
        for key, value in [('workflow_id', 5002), ('created_at', timestamp(NOW - 59))]:
            run = {**self.history['workflow_runs'][0], key: value}
            if key == 'workflow_id':
                run['workflow_url'] = run['workflow_url'].removesuffix('5001') + '5002'
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.validate(history={**self.history, 'workflow_runs': [run]})

    def test_real_api_actor_metadata_is_preserved_without_requiring_a_truncated_user_object(self):
        history = copy.deepcopy(self.history)
        for key in ('actor', 'triggering_actor'):
            history['workflow_runs'][0][key].update(
                type='User', node_id='synthetic-node',
                url='https://api.github.com/users/synthetic-authorized',
                avatar_url='https://avatars.githubusercontent.com/synthetic')
        self.assertIs(self.validate(history=history)['allowed'], True)

    def test_duplicate_json_grant_keys_cannot_hide_an_unconsumed_declaration(self):
        comment = {**self.comment, 'body': '{"consumed":false,' + self.comment['body'][1:]}
        with self.assertRaises(ValueError):
            self.validate(grant=comment)

    def test_self_hosted_or_wrong_runner_environment_cannot_admit(self):
        for key, value in [('RUNNER_ENVIRONMENT', 'self-hosted'), ('RUNNER_OS', 'Linux'),
                           ('RUNNER_ARCH', 'ARM64')]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.validate(env={**self.env, key: value})

    def make_root(self, path):
        path.mkdir(mode=0o700)
        start = dict(schema_version=1, repository='getyak/leafhour', run_id=2001,
                     run_attempt=1, controller_sha=CONTROL, ref=REF,
                     started_monotonic=10, deadline_monotonic=4210,
                     bootstrap_deadline_monotonic=610, stop_new_work_monotonic=3850,
                     started_at_epoch=NOW - 90)
        (path / 'start.json').write_text(json.dumps(start))
        return start

    def run_cli(self, argv):
        with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            return admission.main(argv)

    def cli_inputs(self, temp):
        root = Path(temp) / 'get328-hosted'
        self.make_root(root)
        event_path = Path(temp) / 'event.json'
        event_path.write_text(json.dumps(self.event))
        output = Path(temp) / 'github-output'
        env = {**self.env, 'GITHUB_EVENT_PATH': str(event_path), 'GITHUB_OUTPUT': str(output)}
        return root, env, output

    def api_responses(self, history=None, link=''):
        history = self.history if history is None else history
        public_history = {key: value for key, value in history.items() if key != 'complete'}
        return [(self.current_run, json.dumps(self.current_run, indent=2).encode() + b'\n', ''),
                (self.comment, json.dumps(self.comment, indent=4).encode() + b'\n', ''),
                (public_history, json.dumps(public_history).encode() + b'\n', link)]

    def stamp_source(self):
        path = ROOT / '.github/workflows/get328-seven-once.yml'
        text = path.read_text()
        match = re.search(r"(?ms)^          python3 - <<'PY'\n(.*?)^          PY$", text)
        self.assertIsNotNone(match, 'The pre-checkout stamp must remain an offline Python entry')
        return '\n'.join(line[10:] if line.startswith('          ') else line
                         for line in match.group(1).splitlines())

    def execute_stamp(self, temp, event=None):
        event_path = Path(temp) / 'event.json'
        event_path.write_text(json.dumps(self.event if event is None else event))
        env = {**self.env, 'GITHUB_EVENT_PATH': str(event_path), 'RUNNER_TEMP': temp,
               'GITHUB_OUTPUT': str(Path(temp) / 'github-output')}
        source = self.stamp_source()
        with patch.dict(os.environ, env, clear=True), \
                patch.object(admission.time, 'monotonic', return_value=10), \
                patch.object(admission.time, 'time', return_value=NOW), \
                redirect_stdout(io.StringIO()):
            exec(compile(source, 'get328-seven-once.yml:first-step', 'exec'), {'__name__': '__main__'})

    def test_real_precheckout_stamp_preserves_the_first_origin_and_global_reserve(self):
        with tempfile.TemporaryDirectory(prefix='get328-stamp-test-') as temp:
            self.execute_stamp(temp)
            root = Path(temp) / 'get328-hosted'
            start = json.loads((root / 'start.json').read_text())
            self.assertEqual(start['started_monotonic'], 10)
            self.assertEqual(start['deadline_monotonic'], 4210)
            self.assertEqual(start['bootstrap_deadline_monotonic'], 610)
            self.assertEqual(start['stop_new_work_monotonic'], 3850)
            self.assertEqual(start['controller_sha'], CONTROL)
            self.assertEqual(start['run_id'], 2001)
            self.assertIn('owned=true', (Path(temp) / 'github-output').read_text())

    def test_real_precheckout_stamp_never_reuses_an_existing_root(self):
        with tempfile.TemporaryDirectory(prefix='get328-stamp-test-') as temp:
            self.execute_stamp(temp)
            path = Path(temp) / 'get328-hosted/start.json'
            original = path.read_bytes()
            with self.assertRaises((FileExistsError, ValueError, SystemExit)):
                self.execute_stamp(temp)
            self.assertEqual(path.read_bytes(), original)

    def test_real_precheckout_stamp_refuses_noncreated_event_before_root_creation(self):
        with tempfile.TemporaryDirectory(prefix='get328-stamp-test-') as temp:
            with self.assertRaises((ValueError, SystemExit)):
                self.execute_stamp(temp, {**self.event, 'created': False})
            self.assertFalse((Path(temp) / 'get328-hosted').exists())

    def test_cli_preserves_raw_public_material_and_only_then_emits_allowed(self):
        with tempfile.TemporaryDirectory(prefix='get328-admission-test-') as temp:
            path, env, output = self.cli_inputs(temp)
            responses = self.api_responses()
            with patch.dict(os.environ, env, clear=True), \
                    patch.object(admission.time, 'time', return_value=NOW), \
                    patch.object(admission.time, 'monotonic', return_value=100), \
                    patch.object(admission, 'fetch_json', side_effect=responses) as fetch:
                self.assertEqual(self.run_cli(['--root', str(path)]), 0)
            receipt = json.loads((path / 'receipts/admission.json').read_text())
            self.assertIs(receipt['allowed'], True)
            self.assertEqual(receipt['workflow_id'], 5001)
            for name, response, digest_key in [
                    ('current-run.json', responses[0], 'current_run_sha256'),
                    ('grant-comment.json', responses[1], 'grant_comment_sha256'),
                    ('history.json', responses[2], 'history_sha256')]:
                self.assertEqual((path / 'receipts' / name).read_bytes(), response[1])
                self.assertEqual(receipt[digest_key], hashlib.sha256(response[1]).hexdigest())
            self.assertIn('allowed=true', output.read_text())
            urls = [call.args[0] for call in fetch.call_args_list]
            self.assertEqual(urls[:2], [admission.API_ROOT + '/actions/runs/2001',
                                        admission.API_ROOT + '/issues/comments/3001'])
            self.assertEqual(urlsplit(urls[2]).path,
                             '/repos/getyak/leafhour/actions/workflows/5001/runs')
            self.assertEqual(parse_qs(urlsplit(urls[2]).query),
                             {'branch': [REF.removeprefix('refs/heads/')],
                              'per_page': ['100'], 'page': ['1']})

    def test_cli_stops_after_invalid_current_run_and_preserves_its_original_bytes(self):
        with tempfile.TemporaryDirectory(prefix='get328-admission-test-') as temp:
            path, env, output = self.cli_inputs(temp)
            run = {**self.current_run, 'event': 'pull_request', 'path': '.github/workflows/ci.yml'}
            raw = json.dumps(run, indent=4).encode()
            with patch.dict(os.environ, env, clear=True), \
                    patch.object(admission.time, 'monotonic', return_value=100), \
                    patch.object(admission, 'fetch_json', return_value=(run, raw, '')) as fetch:
                self.assertEqual(self.run_cli(['--root', str(path)]), 78)
            self.assertEqual(fetch.call_count, 1)
            self.assertEqual(fetch.call_args.args[0], admission.API_ROOT + '/actions/runs/2001')
            self.assertEqual((path / 'receipts/current-run.json').read_bytes(), raw)
            self.assertFalse((path / 'receipts/grant-comment.json').exists())
            self.assertFalse((path / 'receipts/history.json').exists())
            self.assertFalse(output.exists())
            self.assertIs(json.loads((path / 'receipts/admission.json').read_text())['allowed'], False)

    def test_cli_same_branch_previous_different_head_is_not_filtered_out(self):
        history = copy.deepcopy(self.history)
        previous = {**history['workflow_runs'][0], 'id': 2000, 'head_sha': 'c' * 40,
                    'created_at': timestamp(NOW - 90), 'event': 'workflow_dispatch'}
        history['workflow_runs'].append(previous)
        history['total_count'] = 2
        with tempfile.TemporaryDirectory(prefix='get328-admission-test-') as temp:
            path, env, output = self.cli_inputs(temp)
            with patch.dict(os.environ, env, clear=True), \
                    patch.object(admission.time, 'time', return_value=NOW), \
                    patch.object(admission.time, 'monotonic', return_value=100), \
                    patch.object(admission, 'fetch_json', side_effect=self.api_responses(history)) as fetch:
                self.assertEqual(self.run_cli(['--root', str(path)]), 78)
            self.assertEqual(fetch.call_count, 3)
            self.assertEqual(set(parse_qs(urlsplit(fetch.call_args.args[0]).query)),
                             {'branch', 'per_page', 'page'})
            self.assertFalse(output.exists())

    def test_cli_each_read_failure_is_once_only_with_truthful_partial_receipts(self):
        errors = [TimeoutError('synthetic timeout'), ValueError('synthetic invalid JSON')]
        errors.extend(admission.urllib.error.HTTPError(admission.API_ROOT, code,
                      'synthetic HTTP refusal', {}, None) for code in (302, 403, 404, 429))
        for stage in range(3):
            for error in errors:
                with self.subTest(stage=stage, error=str(error)), \
                        tempfile.TemporaryDirectory(prefix='get328-admission-test-') as temp:
                    path, env, output = self.cli_inputs(temp)
                    responses = self.api_responses()
                    with patch.dict(os.environ, env, clear=True), \
                            patch.object(admission.time, 'time', return_value=NOW), \
                            patch.object(admission.time, 'monotonic', return_value=100), \
                            patch.object(admission, 'fetch_json',
                                         side_effect=responses[:stage] + [error]) as fetch:
                        self.assertEqual(self.run_cli(['--root', str(path)]), 78)
                    self.assertEqual(fetch.call_count, stage + 1)
                    for index, name in enumerate(('current-run.json', 'grant-comment.json', 'history.json')):
                        receipt = path / 'receipts' / name
                        self.assertEqual(receipt.exists(), index < stage)
                        if index < stage:
                            self.assertEqual(receipt.read_bytes(), responses[index][1])
                    self.assertIs(json.loads((path / 'receipts/admission.json').read_text())['allowed'], False)
                    self.assertFalse(output.exists())

    def test_cli_history_pagination_cannot_be_admitted_as_complete(self):
        with tempfile.TemporaryDirectory(prefix='get328-admission-test-') as temp:
            path, env, output = self.cli_inputs(temp)
            link = '<https://api.github.com/repos/getyak/leafhour/actions/workflows/5001/runs?page=2>; rel="next"'
            with patch.dict(os.environ, env, clear=True), \
                    patch.object(admission.time, 'time', return_value=NOW), \
                    patch.object(admission.time, 'monotonic', return_value=100), \
                    patch.object(admission, 'fetch_json', side_effect=self.api_responses(link=link)) as fetch:
                self.assertEqual(self.run_cli(['--root', str(path)]), 78)
            self.assertEqual(fetch.call_count, 3)
            self.assertFalse(output.exists())

    def test_cli_network_time_uses_the_existing_bootstrap_deadline_at_every_stage(self):
        for slow_stage in range(3):
            with self.subTest(stage=slow_stage), tempfile.TemporaryDirectory(prefix='get328-admission-test-') as temp:
                path, env, output = self.cli_inputs(temp)
                clock = {'now': 100, 'reads': 0}
                responses = self.api_responses()

                def read(unused_url):
                    stage = clock['reads']
                    clock['reads'] += 1
                    if stage == slow_stage:
                        clock['now'] = 610  # Exactly the original bootstrap deadline.
                    return responses[stage]

                with patch.dict(os.environ, env, clear=True), \
                        patch.object(admission.time, 'time', return_value=NOW), \
                        patch.object(admission.time, 'monotonic', side_effect=lambda: clock['now']), \
                        patch.object(admission, 'fetch_json', side_effect=read) as fetch:
                    self.assertEqual(self.run_cli(['--root', str(path)]), 78)
                self.assertEqual(fetch.call_count, slow_stage + 1)
                self.assertFalse(output.exists())
                self.assertIs(json.loads((path / 'receipts/admission.json').read_text())['allowed'], False)
                for index, name in enumerate(('current-run.json', 'grant-comment.json', 'history.json')):
                    self.assertEqual((path / 'receipts' / name).exists(), index <= slow_stage)

    def test_fetch_json_remains_one_bounded_anonymous_request(self):
        for raw in (b'{"id":2001}', b'{"id":1,"id":2}', b'{"id":NaN}', b'invalid',
                    b'x' * (admission.MAX_RESPONSE_BYTES + 1)):
            with self.subTest(prefix=raw[:40]):
                response = MagicMock()
                response.__enter__.return_value = response
                response.read.return_value = raw
                response.headers.get.return_value = ''
                opener = MagicMock()
                opener.open.return_value = response
                with patch.object(admission.urllib.request, 'build_opener', return_value=opener):
                    if raw == b'{"id":2001}':
                        self.assertEqual(admission.fetch_json(admission.API_ROOT + '/actions/runs/2001'),
                                         ({'id': 2001}, raw, ''))
                    else:
                        with self.assertRaises(ValueError):
                            admission.fetch_json(admission.API_ROOT + '/actions/runs/2001')
                opener.open.assert_called_once()
                request = opener.open.call_args.args[0]
                self.assertFalse(any(key.lower() == 'authorization' for key, unused in request.header_items()))
                self.assertEqual(opener.open.call_args.kwargs, {'timeout': 5})
                response.read.assert_called_once_with(admission.MAX_RESPONSE_BYTES + 1)

    def test_cli_pending_grant_or_expired_bootstrap_never_fetches_or_allows(self):
        for fault in ('pending', 'bootstrap-expired'):
            with self.subTest(fault=fault), tempfile.TemporaryDirectory(prefix='get328-admission-test-') as temp:
                path = Path(temp) / 'get328-hosted'
                self.make_root(path)
                event_path = Path(temp) / 'event.json'
                event_path.write_text(json.dumps(self.event))
                env = {**self.env, 'GITHUB_EVENT_PATH': str(event_path)}
                if fault == 'pending':
                    env['GET328_GRANT_COMMENT_ID'] = 'PENDING'
                with patch.dict(os.environ, env, clear=True), \
                        patch.object(admission.time, 'monotonic', return_value=700 if fault == 'bootstrap-expired' else 100), \
                        patch.object(admission, 'fetch_json') as fetch:
                    self.assertNotEqual(self.run_cli(['--root', str(path)]), 0)
                fetch.assert_not_called()
                self.assertIs(json.loads((path / 'receipts/admission.json').read_text())['allowed'], False)


if __name__ == '__main__':
    unittest.main()
