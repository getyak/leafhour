from dataclasses import dataclass
from .state import GateError, sha


@dataclass(frozen=True)
class Snapshot:
    source: str
    remote: str
    ready: bool
    green: bool

    def valid(self):
        sha(self.source), sha(self.remote)
        return self.ready is True and self.green is True


class Publisher:
    def __init__(self, journal, port, clock):
        self.journal, self.port, self.clock = journal, port, clock

    def enable(self):
        snap = self.port.prepare()
        if not snap.valid() or snap.remote != self.journal.status()['expected_ref']:
            raise GateError('replacement entry is not ready')
        self.journal.enable(self.clock())

    def tick(self):
        state = self.journal.status(self.clock())
        if state['attempt']:
            attempt = state['attempt']
            if attempt['state'] == 'prepared':
                if attempt['lease'] > self.clock():
                    return {'status': 'busy'}
                self.journal.abort(attempt['id'], self.clock())
            else:
                return self.journal.observe(attempt['id'], *self.port.observe(attempt['source']), self.clock())
        if not state['enabled']:
            return {'status': 'inactive'}
        if state['blocked']:
            return {'status': 'blocked'}
        if self.clock() < state['cooldown']:
            return {'status': 'cooldown', 'eligibleAt': state['cooldown']}
        snap = self.port.prepare()
        if not snap.valid():
            return {'status': 'unready'}
        decision = self.journal.reserve(snap.source, snap.remote, self.clock())
        if decision['status'] != 'reserved':
            return decision
        attempt = decision['attempt']
        # Recheck after reservation. A superseded candidate consumes no push.
        fresh = self.port.prepare()
        if fresh != snap or not fresh.valid():
            self.journal.abort(attempt, self.clock())
            return {'status': 'superseded'}
        self.journal.arm(attempt, self.clock())
        self.journal.check_identity()
        try:
            self.port.push(snap.source, snap.remote)
        except Exception:
            # A timeout is not proof that the remote ref was unchanged. Never
            # resend; a later read-only observation resolves it or stays blocked.
            pass
        return self.journal.observe(attempt, *self.port.observe(snap.source), self.clock())

    def recover_failure(self):
        snap = self.port.prepare()
        if not snap.valid():
            raise GateError('target has not recovered')
        self.journal.recover_failure(snap.remote, self.clock())
