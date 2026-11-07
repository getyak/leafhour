"""Synthetic admission fixtures only; no Actions, SDK, network, or native calls."""
import copy
from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime, timezone
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import unittest
from unittest.mock import patch


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
        self.history = dict(complete=True, total_count=1, workflow_runs=[dict(
            id=2001, head_sha=CONTROL, head_branch=REF.removeprefix('refs/heads/'),
            event='push', run_attempt=1, actor={'login': 'synthetic-authorized', 'id': 1001},
            triggering_actor={'login': 'synthetic-authorized', 'id': 1001},
            path=WORKFLOW + '@' + REF, created_at=timestamp(NOW - 60))])

    def validate(self, **changes):
        args = dict(env=self.env, event=self.event, grant=self.comment,
                    now_epoch=NOW, history=self.history)
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
            path = Path(temp) / 'get328-hosted'
            self.make_root(path)
            event_path = Path(temp) / 'event.json'
            event_path.write_text(json.dumps(self.event))
            output = Path(temp) / 'github-output'
            env = {**self.env, 'GITHUB_EVENT_PATH': str(event_path), 'GITHUB_OUTPUT': str(output)}
            raw_comment = json.dumps(self.comment, indent=2).encode()
            raw_history = json.dumps({k: v for k, v in self.history.items() if k != 'complete'}).encode()
            with patch.dict(os.environ, env, clear=True), \
                    patch.object(admission.time, 'time', return_value=NOW), \
                    patch.object(admission.time, 'monotonic', return_value=100), \
                    patch.object(admission, 'fetch_json', side_effect=[
                        (self.comment, raw_comment, ''),
                        (json.loads(raw_history), raw_history, '')]) as fetch:
                self.assertEqual(self.run_cli(['--root', str(path)]), 0)
            receipt = json.loads((path / 'receipts/admission.json').read_text())
            self.assertIs(receipt['allowed'], True)
            self.assertEqual((path / 'receipts/grant-comment.json').read_bytes(), raw_comment)
            self.assertEqual((path / 'receipts/history.json').read_bytes(), raw_history)
            self.assertIn('allowed=true', output.read_text())
            self.assertTrue(all(call.args[0].startswith('https://api.github.com/repos/getyak/leafhour/')
                                for call in fetch.call_args_list))

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
