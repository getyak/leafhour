"""Narrow existing-credential adapters. Only Git ref advance mutates a server."""
import json
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.parse import quote, urlparse

from .controller import Snapshot
from .state import GateError, sha

REPOSITORY = 'getyak/leafhour'
TEAM = 'team_nMU4o8gjejVzBhcnMfqgUQbJ'
REPOSITORY_ID = 1415706040
URL = 'https://leafhour.com'
ORIGINS = ('https://github.com/getyak/leafhour.git', 'git@github.com:getyak/leafhour.git')
RULE_QUERY = '''query { viewer { login } repository(owner:"getyak",name:"leafhour") {
  ref(qualifiedName:"refs/heads/main") { branchProtectionRule { requiredStatusCheckContexts } }
  branchProtectionRules(first:100) { nodes { pattern allowsForcePushes allowsDeletions isAdminEnforced restrictsPushes
    requiresStatusChecks requiredStatusCheckContexts requiresApprovingReviews blocksCreations requiresStrictStatusChecks
    bypassForcePushAllowances(first:1) { totalCount pageInfo { hasNextPage } }
    bypassPullRequestAllowances(first:1) { totalCount pageInfo { hasNextPage } }
    pushAllowances(first:100) { nodes { actor { __typename ... on User { login } ... on Team { slug } ... on App { slug } } } pageInfo { hasNextPage } }
  } pageInfo { hasNextPage } }
} }'''


def command(args, cwd=None, timeout=25, input_data=None, pass_fds=()):
    try:
        result = subprocess.run(args, cwd=cwd, input=input_data, stdin=None if input_data is not None else subprocess.DEVNULL, capture_output=True,
                                text=True, timeout=timeout, check=True,
                                pass_fds=pass_fds,
                                env={**__import__('os').environ, 'GIT_TERMINAL_PROMPT': '0'})
        return result.stdout.strip()
    except (OSError, subprocess.SubprocessError):
        # CLI stderr and API bodies may contain account details. Never copy
        # them into a release receipt, exception or scheduler log.
        raise GateError('credential, command or transport unavailable; no automatic retry') from None


def ref_request(repository_id, source, base, create=False, expected_main=None):
    sha(source)
    if create and expected_main is None:
        raise GateError('seed requires a separate expected main pin')
    main = sha(expected_main) if expected_main is not None else source
    if not (create is True and base == '0' * 40):
        sha(base)
    if not isinstance(repository_id, str) or not re.fullmatch(r'[A-Za-z0-9_=-]{3,128}', repository_id):
        raise GateError('invalid repository node identity')
    return {
        'query': 'mutation($input:UpdateRefsInput!){updateRefs(input:$input){clientMutationId}}',
        'variables': {'input': {'repositoryId': repository_id, 'refUpdates': [
            {'name': 'refs/heads/main', 'beforeOid': main, 'afterOid': main, 'force': False},
            {'name': 'refs/heads/production', 'beforeOid': base, 'afterOid': source, 'force': False},
        ]}},
    }


def valid_ci(runs, source):
    candidates = [run for run in runs if run.get('head_sha') == source]
    if not candidates:
        return False
    run = max(candidates, key=lambda item: (int(item.get('id', 0)), int(item.get('run_attempt', 0))))
    return (run.get('head_branch') == 'main' and run.get('event') == 'push'
            and run.get('status') == 'completed' and run.get('conclusion') == 'success'
            and run.get('path') == '.github/workflows/ci.yml'
            and run.get('head_repository', {}).get('full_name') == REPOSITORY)


def protection_ready(rules, actor, main_checks=()):
    matches = [rule for rule in rules if rule.get('pattern') == 'production']
    if len(matches) != 1:
        return False
    rule = matches[0]
    allowances = rule.get('pushAllowances') or {}
    principals = [item.get('actor') for item in allowances.get('nodes', [])]
    no_bypass = all(rule.get(field, {}).get('totalCount') == 0
                    and rule.get(field, {}).get('pageInfo', {}).get('hasNextPage') is False
                    for field in ('bypassForcePushAllowances', 'bypassPullRequestAllowances'))
    return (rule.get('allowsForcePushes') is False and rule.get('allowsDeletions') is False
            and rule.get('isAdminEnforced') is True and rule.get('restrictsPushes') is True
            and rule.get('requiresStatusChecks') is True and rule.get('requiresApprovingReviews') is False
            and rule.get('blocksCreations') is True and rule.get('requiresStrictStatusChecks') is True and no_bypass
            and set(main_checks).union({'CI gate'}) <= set(rule.get('requiredStatusCheckContexts') or [])
            and not allowances.get('pageInfo', {}).get('hasNextPage')
            and principals == [{'__typename': 'User', 'login': actor}])


def exclusive_policy(config):
    enabled = config.get('git', {}).get('deploymentEnabled')
    return (isinstance(enabled, dict) and enabled.get('**') is False
            and enabled.get('production') is True
            and set(enabled) <= {'**', 'production', 'main'}
            and enabled.get('main', False) is False)


def target_matches(project, domain, binding, production_branch='production'):
    link = project.get('link') or {}
    return (project.get('id') == binding['project'] and project.get('accountId') == TEAM
            and project.get('name') == binding['projectName'] and project.get('paused') is not True
            and link.get('type') == 'github' and link.get('org') == 'getyak' and link.get('repo') == 'leafhour'
            and link.get('repoId') == REPOSITORY_ID and link.get('productionBranch') == production_branch
            and link.get('deployHooks') == []
            and domain.get('name') == 'leafhour.com' and domain.get('verified') is True
            and not domain.get('redirect') and domain.get('gitBranch') in (None, production_branch)
            and not domain.get('customEnvironmentId'))


def continuous_time():
    # Python's macOS monotonic() uses mach_absolute_time, which excludes system
    # suspend. A sleeping Mac must expire an armed worker's source/clock lease.
    if sys.platform == 'darwin' and hasattr(time, 'CLOCK_MONOTONIC_RAW'):
        return time.clock_gettime(time.CLOCK_MONOTONIC_RAW)
    if sys.platform.startswith('linux') and hasattr(time, 'CLOCK_BOOTTIME'):
        return time.clock_gettime(time.CLOCK_BOOTTIME)
    raise GateError('a suspend-aware clock is required on this host')


class GitPort:
    def __init__(self, repository, branch):
        self.repository = Path(repository)
        if branch != 'production' or self.git('rev-parse', '--is-bare-repository') != 'true':
            raise GateError('publisher requires its own bare mirror and fixed production branch')

    def git(self, *args):
        return command(['git', '-c', 'core.hooksPath=/dev/null', *args], cwd=self.repository)

    def remote(self, optional=False):
        result = self.git('ls-remote', 'origin', 'refs/heads/production').split()
        if optional and not result:
            return None
        if len(result) != 2 or result[1] != 'refs/heads/production':
            raise GateError('production seed ref is missing or ambiguous')
        return sha(result[0])

    def push(self, source, base):
        sha(source), sha(base)
        remote = self.remote()
        if remote == source:
            return
        if remote != base:
            raise GateError('remote changed after reservation')
        self.git('merge-base', '--is-ancestor', base, source)
        # Normal Git push already uses the advertised old OID in its update.
        # No force flag, no branch rewrites, no Vercel create/redeploy API.
        self.git('push', '--porcelain', 'origin', source + ':refs/heads/production')


class ServerClock:
    """UTC from an authenticated GitHub response, then monotonic elapsed time.

    A response is accepted only within a measured <=30s round trip. WINDOW's
    extra60s covers that bounded latency and HTTP Date whole-second rounding
    across independent processes/boots; local wall-clock adjustments do not
    make an eligible interval shorter.
    """
    def __init__(self, gh='gh'):
        before = continuous_time()
        raw = command([gh, 'api', '--include', '-H', 'Cache-Control: no-cache', '/repos/' + REPOSITORY])
        self.started = continuous_time()
        if self.started - before > 30:
            raise GateError('clock response exceeded bounded round trip')
        headers, separator, body = raw.replace('\r\n', '\n').partition('\n\n')
        match = re.search(r'^date:\s*(.+)$', headers, re.I | re.M)
        if not separator or not match or not re.match(r'HTTP/\S+ 200\b', headers):
            raise GateError('trusted server clock is missing')
        try:
            value = parsedate_to_datetime(match[1].strip())
            if value.tzinfo is None or value.utcoffset() != timezone.utc.utcoffset(value):
                raise ValueError()
            self.epoch = value.timestamp()
            self.repository = json.loads(body)
        except (ValueError, TypeError):
            raise GateError('invalid server clock or repository receipt') from None

    def __call__(self):
        elapsed = continuous_time() - self.started
        if elapsed < 0 or elapsed > 120:
            raise GateError('clock snapshot expired; retry read-only preflight')
        return self.epoch + elapsed


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def public_release():
    try:
        request = urllib.request.Request(URL + '/release.json', headers={'Cache-Control': 'no-cache'})
        with urllib.request.build_opener(NoRedirect).open(request, timeout=10) as response:
            result = json.loads(response.read(16385))
            return sha(result.get('sourceCommit'))
    except (OSError, ValueError, GateError):
        return None


def public_health(source):
    if public_release() != source:
        return False
    try:
        opener = urllib.request.build_opener(NoRedirect)
        for path in ('/', '/api/auth/session'):
            request = urllib.request.Request(URL + path, headers={'Cache-Control': 'no-cache'})
            with opener.open(request, timeout=10) as response:
                if response.status != 200:
                    return False
        return True
    except OSError:
        return False


class RuntimePort(GitPort):
    def __init__(self, config, clock, lock_fd=None):
        self.binding = config['binding']
        b = self.binding
        if (b.get('repository') != REPOSITORY or b.get('team') != TEAM or b.get('url') != URL
                or b.get('branch') != 'production' or not re.fullmatch(r'prj_[A-Za-z0-9]+', b.get('project', ''))
                or not re.fullmatch(r'[A-Za-z0-9_-]+', b.get('projectName', ''))
                or not re.fullmatch(r'[A-Za-z0-9-]+', b.get('publisherLogin', ''))
                or b.get('teamSlug') != '3293172751nss-1526s-projects'):
            raise GateError('verify the real project binding before installing this publisher')
        self.gh, self.vercel = config.get('gh', 'gh'), config.get('vercel', 'vercel')
        self.clock = clock
        self.lock_fd = lock_fd
        self.journal = None
        super().__init__(config['mirror'], 'production')
        if self.git('remote', 'get-url', 'origin') not in ORIGINS:
            raise GateError('mirror origin is not the approved public repository')

    def github(self, endpoint):
        return json.loads(command([self.gh, 'api', '-H', 'Cache-Control: no-cache', '/repos/' + REPOSITORY + endpoint]))

    def provider(self, endpoint):
        # Uses normal CLI authentication. Never extracts tokens or browser state.
        return json.loads(command([self.vercel, 'api', endpoint, '--method', 'GET']))

    def inspect(self, staged=False, guard=True):
        info = self.clock.repository
        if info.get('full_name') != REPOSITORY or info.get('permissions', {}).get('push') is not True:
            raise GateError('existing GitHub identity lacks verified repository push access')
        protection = json.loads(command([self.gh, 'api', 'graphql', '-f', 'query=' + RULE_QUERY]))
        repository = protection.get('data', {}).get('repository') or {}
        rules = repository.get('branchProtectionRules') or {}
        main_rule = (repository.get('ref') or {}).get('branchProtectionRule') or {}
        if (protection.get('errors') or rules.get('pageInfo', {}).get('hasNextPage')
                or protection.get('data', {}).get('viewer', {}).get('login') != self.binding['publisherLogin']
                or not protection_ready(rules.get('nodes', []), self.binding['publisherLogin'], main_rule.get('requiredStatusCheckContexts') or [])):
            raise GateError('production ref protection or existing push identity is not ready; do not broaden permissions')
        source = sha(self.github('/git/ref/heads/main')['object']['sha'])
        runs = self.github('/actions/workflows/ci.yml/runs?branch=main&event=push&head_sha=' + source + '&per_page=100')
        green = valid_ci(runs.get('workflow_runs', []), source)
        self.git('fetch', '--no-tags', 'origin', 'refs/heads/main:refs/remotes/origin/main')
        if self.git('rev-parse', 'refs/remotes/origin/main') != source:
            raise GateError('main advanced during source selection')
        config = json.loads(self.git('show', source + ':vercel.json'))
        b = self.binding
        suffix = '?teamId=' + quote(b['team'])
        project = self.provider('/v9/projects/' + quote(b['project']) + suffix)
        domain = self.provider('/v9/projects/' + quote(b['project']) + '/domains/leafhour.com' + suffix)
        quiet = True
        for state in ['INITIALIZING', 'BUILDING', 'QUEUED']:
            deployments = self.provider('/v6/deployments' + suffix + '&projectId=' + quote(b['project']) + '&state=' + state + '&limit=100')
            if not isinstance(deployments.get('deployments'), list) or deployments['deployments'] or deployments.get('pagination', {}).get('next'):
                quiet = False
        live = public_release()
        ready = (exclusive_policy(config) and target_matches(project, domain, b, 'main' if staged else 'production')
                 and quiet and live is not None)
        if not staged and guard:
            if self.journal is None:
                raise GateError('runtime requires the original two-phase journal')
            self.guard_inventory(source)
        return {'source': source, 'remote': self.remote(optional=staged), 'ready': ready, 'green': green}

    def prepare(self):
        return Snapshot(**self.inspect())

    def inventory(self):
        """Read every page; missing/active/unknown states never mean drained."""
        records, cursor, seen = {}, None, set()
        while True:
            self.clock()
            endpoint = ('/v6/deployments?teamId=' + quote(self.binding['team'])
                        + '&projectId=' + quote(self.binding['project']) + '&limit=100')
            if cursor is not None:
                endpoint += '&until=' + str(cursor)
            page = self.provider(endpoint)
            if not isinstance(page.get('deployments'), list) or not isinstance(page.get('pagination'), dict):
                raise GateError('deployment inventory is incomplete')
            for item in page['deployments']:
                identity = item.get('uid') or item.get('id')
                state = item.get('readyState') or item.get('state')
                git, meta = item.get('gitSource') or {}, item.get('meta') or {}
                source = sha(git.get('sha') or meta.get('githubCommitSha'))
                ref = git.get('ref') or meta.get('githubCommitRef')
                if not isinstance(identity, str) or not re.fullmatch(r'dpl_[A-Za-z0-9]+', identity) or not ref:
                    raise GateError('deployment identity/source is unknown')
                if state not in ('READY', 'ERROR', 'CANCELED'):
                    raise GateError('legacy deployments are active or unresolved')
                record = {'id': identity, 'source': source, 'ref': ref, 'state': state}
                if identity in records and records[identity] != record:
                    raise GateError('deployment inventory changed during pagination')
                records[identity] = record
            following = page['pagination'].get('next')
            if following is None:
                return sorted(records.values(), key=lambda item: item['id'])
            if (type(following) is not int or following < 0 or following in seen
                    or (cursor is not None and following >= cursor)):
                raise GateError('deployment inventory pagination is ambiguous')
            seen.add(following)
            cursor = following

    def legacy_requests_settled(self, main, legacy):
        # After main-off, inspect every formerly deployment-enabled main
        # commit since the pinned healthy legacy. An empty provider queue
        # cannot turn a missing/pending GitHub request receipt into success.
        sources = [legacy, *self.git('rev-list', '--first-parent', legacy + '..' + main).split()]
        for source in sources:
            sha(source)
            policy = json.loads(self.git('show', source + ':vercel.json')).get('git', {}).get('deploymentEnabled')
            main_off = (policy is False or (isinstance(policy, dict) and policy.get('**') is False
                        and policy.get('main', False) is False and set(policy) <= {'**', 'main', 'production'}))
            if source == legacy or not main_off:
                if self.provider_status(source) not in ('success', 'failure', 'error'):
                    return False
        return True

    def staging(self, expected_main, legacy, deployment, production_branch='main'):
        sha(expected_main), sha(legacy)
        if not isinstance(deployment, str) or not re.fullmatch(r'dpl_[A-Za-z0-9]+', deployment):
            raise GateError('pin the actual healthy legacy deployment')
        stage = self.inspect(staged=production_branch == 'main', guard=False)
        if stage['source'] != expected_main or stage['remote'] not in (None, legacy):
            raise GateError('main or seed drifted from the explicit dual pins')
        self.git('merge-base', '--is-ancestor', legacy, expected_main)
        policy = json.loads(self.git('show', legacy + ':vercel.json')).get('git', {}).get('deploymentEnabled')
        disabled = (policy is False or (isinstance(policy, dict) and policy.get('**') is False
                    and set(policy) <= {'**', 'main', 'production'} and policy.get('production', False) is False))
        detail = self.provider('/v13/deployments/' + quote(deployment) + '?teamId=' + quote(self.binding['team']))
        git = detail.get('gitSource') or {}
        healthy = (detail.get('id') == deployment and detail.get('projectId') == self.binding['project']
                   and detail.get('ownerId') == TEAM and detail.get('target') == 'production'
                   and detail.get('readyState') == 'READY' and type(detail.get('ready')) in (int, float)
                   and detail['ready'] > 0 and git.get('type') == 'github' and git.get('repoId') == REPOSITORY_ID
                   and git.get('ref') == 'main' and git.get('sha') == legacy)
        inventory = self.inventory()
        healthy = healthy and {'id': deployment, 'source': legacy, 'ref': 'main', 'state': 'READY'} in inventory
        runs = self.github('/actions/workflows/ci.yml/runs?branch=main&event=push&head_sha=' + legacy + '&per_page=100')
        main_green = stage['green']
        stage.update(legacy=legacy, deployment=deployment, inventory=inventory, mainGreen=main_green,
                     green=valid_ci(runs.get('workflow_runs', []), legacy),
                     ready=stage['ready'] and disabled and healthy and public_health(legacy)
                           and self.legacy_requests_settled(expected_main, legacy))
        return stage

    def seed(self, expected_main, legacy):
        # Cutover has already fsynced its intent. CAS validates both pins even
        # when normal main merges race this request. No implicit source choice.
        request = ref_request(self.clock.repository.get('node_id'), legacy, '0' * 40,
                              create=True, expected_main=expected_main)
        self.clock()
        result = json.loads(command([self.gh, 'api', 'graphql', '--input', '-'], input_data=json.dumps(request),
                                    pass_fds=() if self.lock_fd is None else (self.lock_fd,)))
        if result.get('errors') or not result.get('data', {}).get('updateRefs'):
            raise GateError('seed outcome not confirmed; reconcile without resending')

    def guard_inventory(self, main):
        handover = self.journal.bootstrap()['receipt']
        if not self.legacy_requests_settled(sha(main), handover['legacy']):
            self.journal.freeze('legacy-request-unknown', self.clock())
            raise GateError('a legacy request is missing or pending again; controlled recovery required')
        baseline = {item['id']: item for item in handover['inventory']}
        current = {item['id']: item for item in self.inventory()}
        requested = self.journal.requested_sources()
        counts = {}
        bad = any(current.get(key) != record for key, record in baseline.items())
        for key, record in current.items():
            if key in baseline:
                continue
            source = record['source']
            counts[source] = counts.get(source, 0) + 1
            bad = bad or record['ref'] != 'production' or source not in requested or counts[source] > 1
        if bad:
            self.journal.freeze('deployment-inventory-drift', self.clock())
            raise GateError('late legacy, missing receipt or extra deployment; controlled recovery required')

    def provider_status(self, source):
        sha(source)
        statuses = self.github('/commits/' + source + '/status?per_page=100').get('statuses', [])
        prefix = '/' + self.binding['teamSlug'] + '/' + self.binding['projectName'] + '/'
        provider = 'pending'
        for status in statuses:
            target = urlparse(status.get('target_url') or '')
            project_target = target.path.startswith(prefix)
            team_rejection = (target.path.rstrip('/') == '/' + self.binding['teamSlug']
                              and status.get('state') in ('failure', 'error'))
            if status.get('context') == 'Vercel' and target.scheme == 'https' and target.netloc == 'vercel.com' and (project_target or team_rejection):
                provider = status.get('state')
                break
        return provider

    def observe(self, source):
        return self.remote(), self.provider_status(source), public_release()

    def push(self, source, base):
        # Runtime uses server-side CAS, rather than relying on a client's
        # potentially stale ref advertisement. Both assertions are atomic.
        self.clock()  # expire a worker suspended after durable arming
        runs = self.github('/actions/workflows/ci.yml/runs?branch=main&event=push&head_sha=' + sha(source) + '&per_page=100')
        if not valid_ci(runs.get('workflow_runs', []), source):
            raise GateError('latest source CI is no longer successful')
        if getattr(self, 'journal', None) is None:
            raise GateError('runtime push requires the original journal')
        self.guard_inventory(source)
        self.git('merge-base', '--is-ancestor', sha(base), source)
        request = ref_request(self.clock.repository.get('node_id'), source, base)
        self.clock()
        result = json.loads(command([self.gh, 'api', 'graphql', '--input', '-'], input_data=json.dumps(request),
                                    pass_fds=() if self.lock_fd is None else (self.lock_fd,)))
        if result.get('errors') or not result.get('data', {}).get('updateRefs'):
            raise GateError('atomic ref update rejected; inspect existing protection without broadening access')
