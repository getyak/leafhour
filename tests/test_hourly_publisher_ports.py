import json
import subprocess
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

from tools.hourly_publisher.ports import GitPort, RuntimePort, ServerClock, continuous_time, valid_ci, exclusive_policy, target_matches, ref_request, protection_ready
from tools.hourly_publisher.state import GateError
from tools.hourly_publisher import ports as port_module

SHA = 'a' * 40
BINDING = {'repository': 'getyak/leafhour', 'team': 'team_nMU4o8gjejVzBhcnMfqgUQbJ', 'project': 'prj_synthetic', 'branch': 'production', 'url': 'https://leafhour.com', 'projectName': 'synthetic', 'teamSlug': '3293172751nss-1526s-projects'}


class PortTest(unittest.TestCase):
    def test_dual_pin_seed_request_keeps_main_separate_from_legacy(self):
        main = 'b' * 40
        request = ref_request('R_synthetic', SHA, '0' * 40, create=True, expected_main=main)
        self.assertEqual(request['variables']['input']['refUpdates'], [
            {'name': 'refs/heads/main', 'beforeOid': main, 'afterOid': main, 'force': False},
            {'name': 'refs/heads/production', 'beforeOid': '0' * 40, 'afterOid': SHA, 'force': False},
        ])

    def synthetic_stage(self):
        port = RuntimePort.__new__(RuntimePort)
        port.binding = BINDING
        main = 'b' * 40
        port.inspect = lambda **kwargs: {'source': main, 'remote': None, 'ready': True, 'green': False}
        def git(*args):
            if args[0] == 'rev-list':
                return main
            policy = {'**': False, 'production': True} if args[-1].startswith(main) else {'**': False, 'main': True}
            return json.dumps({'git': {'deploymentEnabled': policy}})
        port.git = git
        good = {'id': 5, 'head_sha': SHA, 'head_branch': 'main', 'event': 'push', 'status': 'completed', 'conclusion': 'success', 'path': '.github/workflows/ci.yml', 'head_repository': {'full_name': 'getyak/leafhour'}}
        port.github = lambda endpoint: {'workflow_runs': [good], 'statuses': [{'context': 'Vercel', 'state': 'success', 'target_url': 'https://vercel.com/3293172751nss-1526s-projects/synthetic/id'}]}
        detail = {'id': 'dpl_synthetic', 'projectId': BINDING['project'], 'ownerId': BINDING['team'], 'target': 'production', 'readyState': 'READY', 'ready': 100,
                  'gitSource': {'type': 'github', 'repoId': 1415706040, 'ref': 'main', 'sha': SHA}}
        port.provider = lambda endpoint: detail
        port.inventory = lambda: [{'id': 'dpl_synthetic', 'source': SHA, 'ref': 'main', 'state': 'READY'}]
        return port, detail

    def test_main_can_differ_from_live_legacy_and_have_pending_ci(self):
        port, detail = self.synthetic_stage()
        with patch('tools.hourly_publisher.ports.public_health', return_value=True):
            stage = port.staging('b' * 40, SHA, 'dpl_synthetic')
        self.assertTrue(stage['ready'])
        self.assertTrue(stage['green'])
        self.assertFalse(stage['mainGreen'])
        for change in [{'ownerId': 'other'}, {'projectId': 'other'}, {'target': 'preview'}, {'readyState': 'BUILDING'}, {'gitSource': {'type': 'github', 'repoId': 1, 'ref': 'main', 'sha': SHA}}]:
            port.provider = lambda endpoint: {**detail, **change}
            with patch('tools.hourly_publisher.ports.public_health', return_value=True):
                self.assertFalse(port.staging('b' * 40, SHA, 'dpl_synthetic')['ready'])

    def test_pending_legacy_request_is_not_closed_by_empty_active_inventory(self):
        port, _ = self.synthetic_stage()
        original = port.github
        port.github = lambda endpoint: {'statuses': [{'context': 'Vercel', 'state': 'pending', 'target_url': 'https://vercel.com/3293172751nss-1526s-projects/synthetic/id'}]} if '/status?' in endpoint else original(endpoint)
        with patch('tools.hourly_publisher.ports.public_health', return_value=True):
            self.assertFalse(port.staging('b' * 40, SHA, 'dpl_synthetic')['ready'])

    def test_bootstrap_requires_home_and_anonymous_session_health_too(self):
        port, _ = self.synthetic_stage()
        with patch('tools.hourly_publisher.ports.public_release', return_value=SHA), patch('tools.hourly_publisher.ports.urllib.request.build_opener', side_effect=OSError('synthetic outage')):
            self.assertFalse(port.staging('b' * 40, SHA, 'dpl_synthetic')['ready'])

    def test_creating_seed_without_separate_main_pin_is_rejected(self):
        with self.assertRaises(GateError):
            ref_request('R_synthetic', SHA, '0' * 40, create=True)

    def test_inventory_follows_all_pages_and_rejects_unknown_states_and_bad_cursors(self):
        port = RuntimePort.__new__(RuntimePort)
        port.binding, port.clock = BINDING, lambda: 100
        def record(identity, state='READY'):
            return {'uid': identity, 'state': state, 'meta': {'githubCommitSha': SHA, 'githubCommitRef': 'main'}}
        calls = []
        def page(endpoint):
            calls.append(endpoint)
            return {'deployments': [record('dpl_second')], 'pagination': {'next': None}} if '&until=90' in endpoint else {'deployments': [record('dpl_first')], 'pagination': {'next': 90}}
        port.provider = page
        self.assertEqual([row['id'] for row in port.inventory()], ['dpl_first', 'dpl_second'])
        self.assertEqual(len(calls), 2)
        for state in ['BUILDING', 'QUEUED', 'INITIALIZING', 'unknown', None]:
            port.provider = lambda endpoint: {'deployments': [record('dpl_bad', state)], 'pagination': {'next': None}}
            with self.assertRaises(GateError):
                port.inventory()
        port.provider = lambda endpoint: {'deployments': [], 'pagination': {'next': 90}}
        with self.assertRaises(GateError):
            port.inventory()

    def test_late_or_duplicate_deployment_freezes_the_original_journal(self):
        from tools.hourly_publisher.state import Journal, WINDOW
        with tempfile.TemporaryDirectory() as root:
            base = [{'id': 'dpl_original', 'source': SHA, 'ref': 'main', 'state': 'READY'}]
            journal = Journal.create(Path(root)/'state.sqlite3', BINDING, SHA, 0,
                                     bootstrap={'legacy': SHA, 'deployment': 'dpl_original', 'inventory': base, 'cutoverMain': 'b' * 40})
            port = RuntimePort.__new__(RuntimePort)
            port.journal, port.clock = journal, lambda: WINDOW
            port.inventory = lambda: base
            port.legacy_requests_settled = lambda main, legacy: True
            port.guard_inventory('b' * 40)
            port.inventory = lambda: base + [{'id': 'dpl_late', 'source': 'b' * 40, 'ref': 'main', 'state': 'READY'}]
            with self.assertRaises(GateError):
                port.guard_inventory('b' * 40)
            self.assertEqual(journal.status()['blocked'], 'deployment-inventory-drift')
            self.assertEqual(journal.bootstrap()['receipt']['legacy'], SHA)

    def test_runtime_prepare_and_push_freeze_reopened_unknown_legacy_receipt(self):
        from tools.hourly_publisher.state import Journal
        for action in ('prepare', 'push'):
            with self.subTest(action=action), tempfile.TemporaryDirectory() as root:
                port = RuntimePort.__new__(RuntimePort)
                port.binding = {**BINDING, 'publisherLogin': 'existing-publisher'}
                main = 'b' * 40
                class Clock:
                    repository = {'full_name': 'getyak/leafhour', 'permissions': {'push': True}, 'node_id': 'R_synthetic'}
                    def __call__(self): return 100
                port.clock, port.gh, port.lock_fd = Clock(), 'synthetic-gh', None
                base = [{'id': 'dpl_original', 'source': SHA, 'ref': 'main', 'state': 'READY'}]
                port.journal = Journal.create(Path(root)/'state.sqlite3', BINDING, SHA, 100,
                    bootstrap={'legacy': SHA, 'deployment': 'dpl_original', 'inventory': base, 'cutoverMain': main})
                port.inventory = lambda: base
                port.remote = lambda optional=False: SHA
                def git(*args):
                    if args[0] == 'rev-parse' or args[0] == 'rev-list': return main
                    if args[0] == 'show':
                        return json.dumps({'git': {'deploymentEnabled': {'**': False, 'main': True} if args[-1].startswith(SHA) else {'**': False, 'production': True}}})
                    return ''
                port.git = git
                good = {'id': 5, 'head_sha': main, 'head_branch': 'main', 'event': 'push', 'status': 'completed', 'conclusion': 'success', 'path': '.github/workflows/ci.yml', 'head_repository': {'full_name': 'getyak/leafhour'}}
                def github(endpoint):
                    if '/git/ref/' in endpoint: return {'object': {'sha': main}}
                    if '/status?' in endpoint: return {'statuses': [{'context': 'Vercel', 'state': 'pending', 'target_url': 'https://vercel.com/3293172751nss-1526s-projects/synthetic/id'}]}
                    return {'workflow_runs': [good]}
                port.github = github
                def provider(endpoint):
                    if '/domains/' in endpoint: return {'name': 'leafhour.com', 'verified': True}
                    if '/v9/projects/' in endpoint:
                        return {'id': BINDING['project'], 'name': BINDING['projectName'], 'accountId': BINDING['team'], 'link': {'type': 'github', 'org': 'getyak', 'repo': 'leafhour', 'repoId': 1415706040, 'deployHooks': [], 'productionBranch': 'production'}}
                    return {'deployments': [], 'pagination': {'next': None}}
                port.provider = provider
                rule = {'pattern': 'production', 'blocksCreations': True, 'requiresStrictStatusChecks': True, 'bypassForcePushAllowances': {'totalCount': 0, 'pageInfo': {'hasNextPage': False}}, 'bypassPullRequestAllowances': {'totalCount': 0, 'pageInfo': {'hasNextPage': False}}, 'allowsForcePushes': False, 'allowsDeletions': False, 'isAdminEnforced': True, 'restrictsPushes': True, 'requiresStatusChecks': True, 'requiresApprovingReviews': False, 'requiredStatusCheckContexts': ['CI gate'], 'pushAllowances': {'nodes': [{'actor': {'__typename': 'User', 'login': 'existing-publisher'}}], 'pageInfo': {'hasNextPage': False}}}
                writes = []
                def command(args, **kwargs):
                    if 'input_data' in kwargs:
                        writes.append(kwargs['input_data'])
                        return json.dumps({'data': {'updateRefs': {'clientMutationId': None}}})
                    return json.dumps({'data': {'viewer': {'login': 'existing-publisher'}, 'repository': {'branchProtectionRules': {'nodes': [rule], 'pageInfo': {'hasNextPage': False}}}}})
                with patch('tools.hourly_publisher.ports.command', side_effect=command), patch('tools.hourly_publisher.ports.public_release', return_value=SHA):
                    try:
                        port.prepare() if action == 'prepare' else port.push(main, SHA)
                    except GateError:
                        pass
                    else:
                        self.fail('reopened legacy unknown must block the actual runtime ' + action)
                self.assertEqual(writes, [])
                self.assertEqual(port.journal.status()['blocked'], 'legacy-request-unknown')

    def test_sleep_aware_os_clock_selection_and_unsupported_host_fail_closed(self):
        with patch('tools.hourly_publisher.ports.sys.platform', 'darwin'), patch('tools.hourly_publisher.ports.time.clock_gettime', return_value=42) as clock:
            self.assertEqual(continuous_time(), 42)
            clock.assert_called_once_with(__import__('time').CLOCK_MONOTONIC_RAW)
        with patch('tools.hourly_publisher.ports.sys.platform', 'linux'), patch('tools.hourly_publisher.ports.time.CLOCK_BOOTTIME', 77, create=True), patch('tools.hourly_publisher.ports.time.clock_gettime', return_value=43) as clock:
            self.assertEqual(continuous_time(), 43)
            clock.assert_called_once_with(77)
        with patch('tools.hourly_publisher.ports.sys.platform', 'unsupported'):
            with self.assertRaises(GateError):
                continuous_time()

    def test_actual_observer_recognizes_team_quota_failure_but_not_team_success(self):
        port = RuntimePort.__new__(RuntimePort)
        port.binding = BINDING
        port.remote = lambda: SHA
        for target, state, expected in [
            ('https://vercel.com/3293172751nss-1526s-projects?upgradeToPro=build-rate-limit', 'failure', 'failure'),
            ('https://vercel.com/3293172751nss-1526s-projects', 'error', 'error'),
            ('https://vercel.com/3293172751nss-1526s-projects', 'success', 'pending'),
            ('https://vercel.com/3293172751nss-1526s-projects/synthetic/id', 'success', 'success'),
            ('https://vercel.com/other-team', 'failure', 'pending'),
        ]:
            def github(endpoint):
                self.assertEqual(endpoint, '/commits/' + SHA + '/status?per_page=100')
                return {'statuses': [{'context': 'Vercel', 'state': state, 'target_url': target}]}
            port.github = github
            with patch('tools.hourly_publisher.ports.public_release', return_value=None):
                self.assertEqual(port.observe(SHA), (SHA, expected, None))
    def test_service_clock_uses_monotonic_elapsed_and_rejects_unbounded_response(self):
        response = 'HTTP/2.0 200 OK\ndate: Thu, 01 Jan 1970 00:01:40 GMT\n\n{}'
        with patch('tools.hourly_publisher.ports.command', return_value=response), patch('tools.hourly_publisher.ports.continuous_time', side_effect=[0, 1, 10]):
            clock = ServerClock()
            self.assertEqual(clock(), 109)
        with patch('tools.hourly_publisher.ports.command', return_value=response), patch('tools.hourly_publisher.ports.continuous_time', side_effect=[0, 31]):
            with self.assertRaises(GateError):
                ServerClock()

    def test_machine_suspend_expires_an_old_request_clock(self):
        response = 'HTTP/2.0 200 OK\ndate: Thu, 01 Jan 1970 00:01:40 GMT\n\n{}'
        with patch('tools.hourly_publisher.ports.command', return_value=response), patch('tools.hourly_publisher.ports.continuous_time', side_effect=[0, 1, 7201]):
            clock = ServerClock()
            with self.assertRaises(GateError):
                clock()
    def test_production_rule_never_broadens_the_existing_push_identity_or_ci_gate(self):
        rule = {'pattern': 'production', 'blocksCreations': True, 'requiresStrictStatusChecks': True, 'bypassForcePushAllowances': {'totalCount': 0, 'pageInfo': {'hasNextPage': False}}, 'bypassPullRequestAllowances': {'totalCount': 0, 'pageInfo': {'hasNextPage': False}}, 'allowsForcePushes': False, 'allowsDeletions': False,
                'isAdminEnforced': True, 'restrictsPushes': True, 'requiresStatusChecks': True,
                'requiredStatusCheckContexts': ['CI gate'], 'requiresApprovingReviews': False,
                'pushAllowances': {'nodes': [{'actor': {'__typename': 'User', 'login': 'existing-publisher'}}], 'pageInfo': {'hasNextPage': False}}}
        self.assertTrue(protection_ready([rule], 'existing-publisher'))
        for change in [{'allowsForcePushes': True}, {'allowsDeletions': True}, {'isAdminEnforced': False}, {'restrictsPushes': False}, {'requiresStatusChecks': False}, {'requiredStatusCheckContexts': []}, {'pushAllowances': {'nodes': [], 'pageInfo': {'hasNextPage': False}}}]:
            self.assertFalse(protection_ready([{**rule, **change}], 'existing-publisher'))
        self.assertFalse(protection_ready([rule], 'different-user'))
    def test_rule_readback_rejects_creation_strictness_or_bypass_drift(self):
        rule = {'pattern': 'production', 'blocksCreations': True, 'requiresStrictStatusChecks': True, 'bypassForcePushAllowances': {'totalCount': 0, 'pageInfo': {'hasNextPage': False}}, 'bypassPullRequestAllowances': {'totalCount': 0, 'pageInfo': {'hasNextPage': False}}, 'allowsForcePushes': False, 'allowsDeletions': False,
                'isAdminEnforced': True, 'restrictsPushes': True, 'requiresStatusChecks': True,
                'requiresApprovingReviews': False, 'requiredStatusCheckContexts': ['CI gate'],
                'pushAllowances': {'nodes': [{'actor': {'__typename': 'User', 'login': 'existing-publisher'}}], 'pageInfo': {'hasNextPage': False}}}
        self.assertTrue(protection_ready([rule], 'existing-publisher'))
        for change in [{'blocksCreations': False}, {'requiresStrictStatusChecks': False},
                       {'bypassForcePushAllowances': {'totalCount': 1}},
                       {'bypassPullRequestAllowances': {'totalCount': 0, 'pageInfo': {'hasNextPage': True}}}]:
            with self.subTest(change=change):
                self.assertFalse(protection_ready([{**rule, **change}], 'existing-publisher'))

    def test_atomic_request_checks_current_main_and_expected_production_without_force(self):
        request = ref_request('R_synthetic', SHA, 'b' * 40)
        updates = request['variables']['input']['refUpdates']
        self.assertEqual(updates, [
            {'name': 'refs/heads/main', 'beforeOid': SHA, 'afterOid': SHA, 'force': False},
            {'name': 'refs/heads/production', 'beforeOid': 'b' * 40, 'afterOid': SHA, 'force': False},
        ])
        self.assertEqual(request['variables']['input']['repositoryId'], 'R_synthetic')
    def test_latest_ci_attempt_must_be_completed_success_on_current_main(self):
        good = {'id': 5, 'run_attempt': 1, 'head_sha': SHA, 'head_branch': 'main', 'event': 'push', 'status': 'completed', 'conclusion': 'success', 'path': '.github/workflows/ci.yml', 'head_repository': {'full_name': 'getyak/leafhour'}}
        self.assertTrue(valid_ci([good], SHA))
        for change in [{'conclusion': 'failure'}, {'status': 'in_progress'}, {'event': 'pull_request'}, {'head_branch': 'feature'}, {'head_repository': {'full_name': 'other/repo'}}, {'path': '.github/workflows/other.yml'}]:
            self.assertFalse(valid_ci([{**good, **change}], SHA))
        self.assertFalse(valid_ci([good, {**good, 'id': 6, 'conclusion': 'failure'}], SHA))
        self.assertFalse(valid_ci([], SHA))

    def test_only_one_enabled_production_branch_is_exclusive(self):
        self.assertTrue(exclusive_policy({'git': {'deploymentEnabled': {'**': False, 'production': True}}}))
        for enabled in [True, False, {'**': False, 'main': True}, {'**': False, 'production': True, 'main': True}, {'production': True}, {'**': False, 'production': True, 'preview-*': True}]:
            self.assertFalse(exclusive_policy({'git': {'deploymentEnabled': enabled}}))

    def test_project_domain_repository_and_production_branch_all_match(self):
        project = {'id': BINDING['project'], 'accountId': BINDING['team'], 'name': 'synthetic', 'link': {'type': 'github', 'org': 'getyak', 'repo': 'leafhour', 'repoId': 1415706040, 'deployHooks': [], 'productionBranch': 'production'}}
        domain = {'name': 'leafhour.com', 'verified': True}
        self.assertTrue(target_matches(project, domain, BINDING))
        for change in [{'id': 'prj_other'}, {'accountId': 'team_other'}, {'paused': True}, {'link': {**project['link'], 'productionBranch': 'main'}}]:
            self.assertFalse(target_matches({**project, **change}, domain, BINDING))
        for change in [{'name': 'other.example'}, {'verified': False}, {'gitBranch': 'preview'}, {'redirect': 'other.example'}]:
            self.assertFalse(target_matches(project, {**domain, **change}, BINDING))

    def test_real_git_push_fast_forwards_once_and_refuses_rewrite(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            def git(*args, cwd=None):
                return subprocess.check_output(['git', *args], cwd=cwd, stderr=subprocess.DEVNULL, text=True).strip()
            remote, work, bare = root/'remote.git', root/'work', root/'mirror.git'
            git('init', '--bare', '-q', str(remote)); git('init', '-q', str(work))
            git('config', 'user.name', 'Synthetic', cwd=work); git('config', 'user.email', 'synthetic@example.invalid', cwd=work)
            (work/'file').write_text('one'); git('add', '.', cwd=work); git('commit', '-qm', 'one', cwd=work)
            (work/'vercel.json').write_text(json.dumps({'git': {'deploymentEnabled': {'**': False, 'production': True}}}))
            git('add', 'vercel.json', cwd=work); git('commit', '-qm', 'old hourly policy', cwd=work)
            first = git('rev-parse', 'HEAD', cwd=work)
            git('remote', 'add', 'origin', str(remote), cwd=work); git('push', '-q', 'origin', 'HEAD:main', 'HEAD:production', cwd=work)
            (work/'file').write_text('two')
            (work/'vercel.json').write_text(json.dumps({'git': {'deploymentEnabled': {'**': False, 'main': True}}}))
            git('commit', '-qam', 'two', cwd=work)
            second = git('rev-parse', 'HEAD', cwd=work); git('push', '-q', 'origin', 'HEAD:main', cwd=work)
            git('clone', '--bare', '-q', str(remote), str(bare))
            # Transport itself accepts only a checked bare mirror. The runtime
            # adds the fixed public-origin validation before constructing it.
            port = GitPort(bare, 'production')
            port.push(second, first)
            self.assertEqual(port.remote(), second)
            port.push(second, first)  # uncertain ACK retry is a no-op, not another update
            self.assertEqual(port.remote(), second)
            with self.assertRaises(GateError):
                port.push(first, second)
            # Simulate GitHub's documented atomic beforeOid transaction with
            # real Git ref transactions, including a main change at the server.
            (work/'file').write_text('three'); git('commit', '-qam', 'three', cwd=work)
            third = git('rev-parse', 'HEAD', cwd=work)
            (work/'file').write_text('four'); git('commit', '-qam', 'four', cwd=work)
            fourth = git('rev-parse', 'HEAD', cwd=work); git('push', '-q', 'origin', 'HEAD:main', cwd=work)
            transaction = f'start\nverify refs/heads/main {third}\nupdate refs/heads/production {third} {second}\nprepare\ncommit\n'
            result = subprocess.run(['git', 'update-ref', '--stdin'], cwd=remote, input=transaction, text=True, capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(git('rev-parse', 'refs/heads/production', cwd=remote), second)
            self.assertEqual(git('rev-parse', 'refs/heads/main', cwd=remote), fourth)
            port.git('fetch', '--no-tags', 'origin', 'main')
            runtime = RuntimePort.__new__(RuntimePort)
            runtime.repository, runtime.gh, runtime.lock_fd = bare, 'synthetic-gh', None
            runtime.journal = object()  # this test isolates actual atomic Git transport
            runtime.guard_inventory = lambda main: None
            class Clock:
                repository = {'node_id': 'R_synthetic'}
                def __call__(self):
                    return 0
            runtime.clock = Clock()
            attempted = [third]
            def ci(endpoint):
                self.assertIn('head_sha=' + attempted[0], endpoint)
                return {'workflow_runs': [{'id': 5, 'run_attempt': 1, 'head_sha': attempted[0], 'head_branch': 'main', 'event': 'push', 'status': 'completed', 'conclusion': 'success', 'path': '.github/workflows/ci.yml', 'head_repository': {'full_name': 'getyak/leafhour'}}]}
            runtime.github = ci
            real_command = port_module.command
            calls = []
            def rpc(args, cwd=None, **kwargs):
                if args[0] != 'synthetic-gh':
                    return real_command(args, cwd=cwd, **kwargs)
                self.assertEqual(args, ['synthetic-gh', 'api', 'graphql', '--input', '-'])
                updates = json.loads(kwargs['input_data'])['variables']['input']['refUpdates']
                self.assertTrue(all(item['force'] is False for item in updates))
                self.assertEqual([item['name'] for item in updates], ['refs/heads/main', 'refs/heads/production'])
                self.assertEqual(updates[0]['beforeOid'], updates[0]['afterOid'])
                calls.append(updates[1]['afterOid'])
                text = f"start\nverify refs/heads/main {updates[0]['beforeOid']}\nupdate refs/heads/production {updates[1]['afterOid']} {updates[1]['beforeOid']}\nprepare\ncommit\n"
                result = subprocess.run(['git','update-ref','--stdin'], cwd=remote, input=text, text=True, capture_output=True)
                return json.dumps({'data': {'updateRefs': {'clientMutationId': None}}} if result.returncode == 0 else {'errors': [{'type': 'STALE_REF'}]})
            with patch('tools.hourly_publisher.ports.command', side_effect=rpc):
                with self.assertRaises(GateError):
                    runtime.push(third, second)
                self.assertEqual(git('rev-parse', 'refs/heads/production', cwd=remote), second)
                attempted[0] = fourth
                runtime.push(fourth, second)
                self.assertEqual(git('rev-parse', 'refs/heads/production', cwd=remote), fourth)
            self.assertEqual(calls, [third, fourth])


if __name__ == '__main__':
    unittest.main()
