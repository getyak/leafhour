"""Nonpublishing two-phase cutover. Unknown operations never resend."""
from .state import GateError, Journal, sha


class Cutover:
    def __init__(self, journal, port, clock):
        self.journal, self.port, self.clock = journal, port, clock
        self.receipt = journal.bootstrap()['receipt']

    @staticmethod
    def initialize(path, binding, port, clock, main, legacy, deployment):
        stage = port.staging(main, legacy, deployment)
        if stage['remote'] is not None or not stage['ready'] or not stage['green']:
            raise GateError('init requires main-off, healthy settled legacy, original main tracking and no seed')
        receipt = {'legacy': legacy, 'deployment': deployment, 'inventory': stage['inventory'], 'cutoverMain': main}
        return Journal.create(path, binding, legacy, clock(), bootstrap=receipt)

    def pins(self, main, legacy, deployment):
        sha(main), sha(legacy)
        if legacy != self.receipt['legacy'] or deployment != self.receipt['deployment']:
            raise GateError('legacy handover is immutable; do not silently select a new seed')

    def stage(self, main, legacy, deployment, branch='main'):
        self.pins(main, legacy, deployment)
        result = self.port.staging(main, legacy, deployment, production_branch=branch)
        if not result['ready'] or not result['green'] or result['inventory'] != self.receipt['inventory']:
            raise GateError('legacy health, inventory or exclusive chain changed; reconcile before continuing')
        return result

    def seed(self, main, legacy, deployment):
        self.pins(main, legacy, deployment)
        if 'seed' in self.journal.bootstrap()['operations']:
            return self.reconcile_seed()
        stage = self.stage(main, legacy, deployment)
        if stage['remote'] is not None:
            raise GateError('seed exists without this journal intent; do not adopt it')
        self.journal.arm_operation('seed', {'main': main, 'legacy': legacy, 'deployment': deployment}, self.clock())
        self.journal.check_identity()
        try:
            self.port.seed(main, legacy)
        except Exception:
            # Even an API error is not generally proof of atomic rejection.
            # Keep the durable intent and reconcile, never classify by text.
            pass
        return self.reconcile_seed()

    def reconcile_seed(self):
        if 'seed' not in self.journal.bootstrap()['operations']:
            raise GateError('no durable seed intent to reconcile')
        remote = self.port.remote(optional=True)
        if remote is None:
            return {'status': 'seed-uncertain'}
        if remote != self.receipt['legacy']:
            self.journal.freeze('bootstrap-ref-drift', self.clock())
            raise GateError('unexpected seed ref; stop for controlled recovery')
        if self.port.inventory() != self.receipt['inventory']:
            self.journal.freeze('bootstrap-inventory-drift', self.clock())
            raise GateError('seed caused or coincided with an extra request; stop')
        self.journal.confirm_operation('seed', self.clock())
        return {'status': 'seed-confirmed-nonpublishing', 'source': remote}

    def tracking_intent(self, main, legacy, deployment):
        stage = self.stage(main, legacy, deployment)
        if stage['remote'] != legacy:
            raise GateError('confirm the original seed before Branch Tracking')
        self.journal.arm_operation('tracking', {'main': main, 'legacy': legacy, 'deployment': deployment}, self.clock())
        return {'status': 'tracking-intent-recorded', 'operation': 'Save Branch Tracking only; never Deploy'}

    def tracking_confirm(self, main, legacy, deployment):
        if 'tracking' not in self.journal.bootstrap()['operations']:
            raise GateError('Branch Tracking requires its original durable intent')
        stage = self.stage(main, legacy, deployment, branch='production')
        if stage['remote'] != legacy:
            raise GateError('seed changed during Branch Tracking')
        self.journal.confirm_operation('tracking', self.clock())
        return {'status': 'tracking-confirmed-nonpublishing'}

    def ready_to_enable(self, main, legacy, deployment):
        if any(self.journal.bootstrap()['operations'].get(kind, {}).get('state') != 'confirmed'
               for kind in ('seed', 'tracking')):
            raise GateError('all bootstrap outcomes must settle before enable')
        if self.journal.requested_sources():
            # Re-enabling a used publisher is handled by runtime guards; it
            # must never bootstrap a different healthy baseline.
            raise GateError('used publisher must use runtime readiness, not bootstrap')
        self.stage(main, legacy, deployment, branch='production')
