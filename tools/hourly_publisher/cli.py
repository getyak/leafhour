"""Inactive-by-default host entry; does not install/authorize a scheduler."""
import argparse
import fcntl
import json
import os
import stat
import sqlite3
from pathlib import Path

from .controller import Publisher
from .ports import RuntimePort, ServerClock
from .state import GateError, Journal, sha


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['status', 'check', 'check-stage', 'seed', 'init', 'enable', 'disable', 'tick', 'recover-failure'])
    parser.add_argument('--config', required=True, type=Path)
    parser.add_argument('--state', required=True, type=Path)
    parser.add_argument('--expected-source', help='Full approved legacy SHA; required for seed/init')
    args = parser.parse_args(argv)
    lock = None
    try:
        if args.action in ('seed', 'init') and args.expected_source is None:
            raise GateError('seed/init require --expected-source from the approved legacy handover')
        if args.expected_source is not None:
            sha(args.expected_source)
            if args.action not in ('check-stage', 'seed', 'init'):
                raise GateError('expected-source is only valid for legacy bootstrap')
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
        if args.action in ('check-stage', 'seed', 'init'):
            clock = ServerClock(config.get('gh', 'gh'))
            port = RuntimePort(config, clock, lock)
            stage = port.staging()
            if args.expected_source is not None and (stage['source'] != args.expected_source
                    or stage['remote'] not in (None, args.expected_source)):
                raise GateError('legacy main or seed changed from the approved expected source')
            if args.action == 'check-stage':
                print(json.dumps({'status': 'stage-ready' if stage['ready'] and stage['green'] else 'unready', **stage}))
                return 0
            if not stage['ready'] or not stage['green']:
                raise GateError('bootstrap only while verified legacy main is healthy; current production chain cannot reset state')
            if args.action == 'seed':
                print(json.dumps(port.seed(args.expected_source)))
                return 0
            if not stage['remote']:
                raise GateError('verify the disabled production seed before initializing')
            port.git('merge-base', '--is-ancestor', stage['remote'], stage['source'])
            Journal.create(args.state, config['binding'], stage['remote'], clock())
            print(json.dumps({'status': 'initialized-inactive'}))
            return 0
        journal = Journal(args.state, config['binding'])
        state = journal.status()
        if args.action == 'status':
            print(json.dumps({key: state[key] for key in ['enabled', 'blocked', 'cooldown', 'attempt']}))
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
        publisher = Publisher(journal, port, clock)
        if args.action == 'check':
            snapshot = port.prepare()
            result = {'status': 'ready' if snapshot.valid() else 'unready', 'source': snapshot.source, 'remote': snapshot.remote}
        elif args.action == 'enable':
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
