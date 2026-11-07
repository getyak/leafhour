"""Inactive-by-default host entry; does not install/authorize a scheduler."""
import argparse
import fcntl
import json
import os
import stat
import sqlite3
from pathlib import Path

from .bootstrap import Cutover
from .controller import Publisher
from .ports import RuntimePort, ServerClock
from .state import GateError, Journal, sha


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['status', 'check', 'check-stage', 'seed', 'init', 'reconcile-seed', 'tracking-intent', 'tracking-confirm', 'enable', 'disable', 'tick', 'recover-failure'])
    parser.add_argument('--config', required=True, type=Path)
    parser.add_argument('--state', required=True, type=Path)
    parser.add_argument('--expected-main', help='Full explicitly approved current main SHA')
    parser.add_argument('--expected-legacy-source', help='Full immutable healthy legacy SHA')
    parser.add_argument('--legacy-deployment', help='Exact original healthy legacy deployment ID')
    args = parser.parse_args(argv)
    lock = None
    try:
        bootstrap_actions = ('check-stage', 'init', 'seed', 'tracking-intent', 'tracking-confirm')
        supplied = (args.expected_main, args.expected_legacy_source, args.legacy_deployment)
        if args.action in bootstrap_actions or (args.action == 'enable' and any(supplied)):
            if not all(supplied):
                raise GateError('bootstrap requires --expected-main, --expected-legacy-source and --legacy-deployment')
            sha(args.expected_main), sha(args.expected_legacy_source)
        elif any(supplied):
            raise GateError('dual pins are only valid for bootstrap and first enable')
        config = json.loads(args.config.read_text())
        if set(config) - {'binding', 'mirror', 'gh', 'vercel'}:
            raise GateError('configuration contains unsupported fields; credentials do not belong here')
        args.state.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        lock_path = str(args.state) + '.lock'
        lock = os.open(lock_path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        info = os.fstat(lock)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_mode & 0o077:
            raise GateError('publisher process lock must be private')
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print(json.dumps({'status': 'busy'}))
            return 0
        if args.action in ('check-stage', 'init'):
            clock = ServerClock(config.get('gh', 'gh'))
            port = RuntimePort(config, clock, lock)
            if args.action == 'check-stage':
                stage = port.staging(*supplied)
                print(json.dumps({'status': 'stage-ready' if stage['ready'] and stage['green'] else 'unready', **stage}))
                return 0
            Cutover.initialize(args.state, config['binding'], port, clock, *supplied)
            print(json.dumps({'status': 'initialized-inactive-before-seed'}))
            return 0
        journal = Journal(args.state, config['binding'])
        state = journal.status()
        if args.action == 'status':
            result = {key: state[key] for key in ['enabled', 'blocked', 'cooldown', 'attempt']}
            result['bootstrap'] = None
            if journal.bootstrap_receipt is not None:
                bootstrap = journal.bootstrap()
                result['bootstrap'] = {key: bootstrap['receipt'][key] for key in ('legacy', 'deployment')}
                result['bootstrap']['operations'] = {kind: {key: operation[key] for key in ('state', 'requested')}
                    for kind, operation in bootstrap['operations'].items()}
            print(json.dumps(result))
            return 0
        if args.action == 'tick' and not state['enabled'] and not state['attempt']:
            print(json.dumps({'status': 'inactive'}))
            return 0
        if args.action == 'disable':
            journal.disable(state['clock'])
            print(json.dumps({'status': 'disabled'}))
            return 0
        clock = ServerClock(config.get('gh', 'gh'))
        port = RuntimePort(config, clock, lock)
        port.journal = journal
        if args.action in ('seed', 'reconcile-seed', 'tracking-intent', 'tracking-confirm'):
            cutover = Cutover(journal, port, clock)
            result = cutover.reconcile_seed() if args.action == 'reconcile-seed' else getattr(cutover, args.action.replace('-', '_'))(*supplied)
            print(json.dumps(result))
            return 1 if result['status'] == 'seed-uncertain' else 0
        publisher = Publisher(journal, port, clock)
        if args.action == 'check':
            snapshot = port.prepare()
            result = {'status': 'ready' if snapshot.valid() else 'unready', 'source': snapshot.source, 'remote': snapshot.remote}
        elif args.action == 'enable':
            bootstrap = journal.bootstrap()
            if not journal.requested_sources():
                if not all(supplied):
                    raise GateError('first enable requires explicit main and immutable legacy pins')
                Cutover(journal, port, clock).ready_to_enable(*supplied)
            elif any(operation['state'] != 'confirmed' for operation in bootstrap['operations'].values()):
                raise GateError('bootstrap outcome unresolved')
            publisher.enable()
            result = {'status': 'enabled-with-hour-hold'}
        elif args.action == 'recover-failure':
            publisher.recover_failure()
            result = {'status': 'failure-acknowledged-with-existing-cooldown'}
        else:
            result = publisher.tick()
        print(json.dumps(result))
        return 0
    except GateError as error:
        print(json.dumps({'status': 'blocked', 'reason': str(error)}))
        return 1
    except (OSError, ValueError, TypeError, KeyError, AttributeError, sqlite3.Error):
        # Do not serialize CLI stderr, API payloads, environment or credentials.
        print(json.dumps({'status': 'blocked', 'reason': 'preflight or durable state failed; use the reviewed recovery checklist'}))
        return 1
    finally:
        if lock is not None:
            os.close(lock)


if __name__ == '__main__':
    raise SystemExit(main())
