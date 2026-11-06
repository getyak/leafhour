"""Durable single-host release gate. No credentials or book data belong here."""
import contextlib
import json
import math
import os
import re
import sqlite3
import stat
import uuid
from pathlib import Path

# Covers the <=30s trusted clock round trip plus Date rounding across workers.
# Never configurable below the user's rolling 3,600-second minimum.
WINDOW = 3660
ACTIVE = ('prepared', 'sending', 'uncertain', 'accepted')


class GateError(RuntimeError):
    pass


def sha(value):
    if not isinstance(value, str) or not re.fullmatch('[a-f0-9]{40}', value) or value == '0' * 40:
        raise GateError('invalid source commit')
    return value


class Journal:
    @classmethod
    def create(cls, path, binding, baseline, now):
        sha(baseline)
        if not math.isfinite(now) or now < 0:
            raise GateError('invalid clock')
        path = Path(path)
        if Path(str(path) + '.witness').exists():
            raise GateError('existing witness forbids resetting release history')
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        os.close(fd)
        with sqlite3.connect(path) as db:
            db.execute('PRAGMA synchronous=FULL')
            db.executescript('''
                CREATE TABLE control (id INTEGER PRIMARY KEY CHECK(id=1), binding TEXT,
                    enabled INTEGER, expected_ref TEXT, cooldown REAL, clock REAL, blocked TEXT);
                CREATE TABLE attempts (id TEXT PRIMARY KEY, source TEXT, base TEXT,
                    state TEXT, lease REAL, requested REAL, observed REAL);
                CREATE TABLE events (seq INTEGER PRIMARY KEY, at REAL, kind TEXT, attempt TEXT);
            ''')
            db.execute('INSERT INTO control VALUES (1, ?, 0, ?, ?, ?, NULL)',
                       (json.dumps(binding, sort_keys=True), baseline, now + WINDOW, now))
        info = path.lstat()
        with os.fdopen(os.open(str(path) + '.witness', os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w') as witness:
            witness.write(json.dumps({'inode': info.st_ino, 'device': info.st_dev, 'binding': binding}) + '\n')
            witness.flush()
            os.fsync(witness.fileno())
        return cls(path, binding)

    def __init__(self, path, binding):
        self.path = Path(path)
        self.witness = Path(str(path) + '.witness')
        self.binding = json.dumps(binding, sort_keys=True)
        try:
            header = json.loads(self.witness.read_text().splitlines()[0])
            self.identity, self.device = header['inode'], header['device']
            if json.dumps(header['binding'], sort_keys=True) != self.binding:
                raise GateError('journal witness target binding changed')
            with self.tx() as db:
                if db.execute('SELECT binding FROM control').fetchone()[0] != self.binding:
                    raise GateError('journal target binding changed')
        except (OSError, sqlite3.Error, ValueError, KeyError, IndexError) as error:
            raise GateError('journal unavailable; stop workers and use controlled offline recovery') from error

    def check_identity(self):
        try:
            info = self.path.lstat()
        except OSError as error:
            raise GateError('journal disappeared; stop workers for controlled recovery') from error
        if (not stat.S_ISREG(info.st_mode) or info.st_ino != self.identity
                or info.st_dev != self.device or info.st_nlink != 1 or info.st_mode & 0o077):
            raise GateError('journal replaced, linked or permissions are not private')

    def verify_witness(self, db):
        info = self.witness.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_mode & 0o077:
            raise GateError('release witness must remain private and independent')
        try:
            records = [json.loads(line) for line in self.witness.read_text().splitlines()]
            if (records[0]['inode'] != self.identity or records[0]['device'] != self.device
                    or json.dumps(records[0]['binding'], sort_keys=True) != self.binding):
                raise GateError('witness changed')
            for record in records[1:]:
                row = db.execute('SELECT source,requested FROM attempts WHERE id=?', (record['attempt'],)).fetchone()
                if not row or row['source'] != record['source'] or row['requested'] != record['at']:
                    raise GateError('restored journal lost an armed request; offline recovery required')
        except (ValueError, KeyError, IndexError) as error:
            raise GateError('damaged release witness; do not reset it') from error

    @contextlib.contextmanager
    def tx(self, now=None):
        self.check_identity()
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        try:
            db.execute('PRAGMA synchronous=FULL')
            db.execute('BEGIN IMMEDIATE')
            self.check_identity()
            self.verify_witness(db)
            if now is not None:
                if not math.isfinite(now) or now < 0:
                    raise GateError('invalid clock')
                if now < db.execute('SELECT clock FROM control').fetchone()[0]:
                    raise GateError('clock moved backwards; do not release')
                db.execute('UPDATE control SET clock=?', (now,))
            yield db
            self.check_identity()
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    @staticmethod
    def event(db, now, kind, attempt=None):
        db.execute('INSERT INTO events(at,kind,attempt) VALUES(?,?,?)', (now, kind, attempt))

    def status(self, now=None):
        with self.tx(now) as db:
            row = dict(db.execute('SELECT * FROM control').fetchone())
            active = db.execute("SELECT * FROM attempts WHERE state IN ('prepared','sending','uncertain','accepted') ORDER BY rowid DESC LIMIT 1").fetchone()
            row['attempt'] = dict(active) if active else None
            return row

    def enable(self, now):
        with self.tx(now) as db:
            row = db.execute('SELECT * FROM control').fetchone()
            if row['blocked'] or db.execute("SELECT 1 FROM attempts WHERE state IN ('prepared','sending','uncertain','accepted')").fetchone():
                raise GateError('resolve outstanding work before enable')
            db.execute('UPDATE control SET enabled=1, cooldown=max(cooldown,?)', (now + WINDOW,))
            self.event(db, now, 'enabled-with-hour-hold')

    def disable(self, now):
        with self.tx(now) as db:
            db.execute('UPDATE control SET enabled=0')
            db.execute("UPDATE attempts SET state='aborted' WHERE state='prepared'")
            self.event(db, now, 'disabled')

    def reserve(self, source, remote, now):
        sha(source), sha(remote)
        with self.tx(now) as db:
            row = db.execute('SELECT * FROM control').fetchone()
            if not row['enabled']:
                return {'status': 'inactive'}
            if row['blocked']:
                return {'status': 'blocked'}
            db.execute("UPDATE attempts SET state='aborted' WHERE state='prepared' AND lease<=?", (now,))
            if db.execute("SELECT 1 FROM attempts WHERE state IN ('prepared','sending','uncertain','accepted')").fetchone():
                return {'status': 'busy'}
            if remote != row['expected_ref']:
                db.execute("UPDATE control SET blocked='ref-drift'")
                self.event(db, now, 'ref-drift')
                return {'status': 'drift'}
            if source == remote:
                return {'status': 'unchanged'}
            if db.execute('SELECT 1 FROM attempts WHERE source=? AND requested IS NOT NULL', (source,)).fetchone():
                return {'status': 'already-attempted'}
            if now < row['cooldown']:
                return {'status': 'cooldown', 'eligibleAt': row['cooldown']}
            attempt = uuid.uuid4().hex
            db.execute("INSERT INTO attempts VALUES(?,?,?,'prepared',?,NULL,NULL)", (attempt, source, remote, now + 120))
            self.event(db, now, 'prepared', attempt)
            return {'status': 'reserved', 'attempt': attempt, 'source': source}

    def abort(self, attempt, now):
        with self.tx(now) as db:
            db.execute("UPDATE attempts SET state='aborted' WHERE id=? AND state='prepared'", (attempt,))
            self.event(db, now, 'superseded', attempt)

    def arm(self, attempt, now):
        with self.tx(now) as db:
            control = db.execute('SELECT * FROM control').fetchone()
            row = db.execute('SELECT * FROM attempts WHERE id=?', (attempt,)).fetchone()
            if not (row and row['state'] == 'prepared' and row['lease'] > now and control['enabled'] and not control['blocked']):
                raise GateError('stale or disabled reservation')
            db.execute("UPDATE attempts SET state='sending', requested=? WHERE id=?", (now, attempt))
            db.execute('UPDATE control SET cooldown=max(cooldown,?)', (now + WINDOW,))
            self.event(db, now, 'armed-before-push', attempt)
            # Independent fsynced intent is written before commit/side effect.
            # Restoring an older DB must never forget a possibly in-flight push.
            with self.witness.open('a') as witness:
                witness.write(json.dumps({'attempt': attempt, 'source': row['source'], 'at': now}) + '\n')
                witness.flush()
                os.fsync(witness.fileno())

    def observe(self, attempt, remote, provider, live, now):
        sha(remote)
        with self.tx(now) as db:
            row = db.execute('SELECT * FROM attempts WHERE id=?', (attempt,)).fetchone()
            if not row or row['state'] not in ACTIVE or row['state'] == 'prepared':
                raise GateError('invalid reconciliation state')
            state = row['state']
            if remote == row['source']:
                if state in ('sending', 'uncertain'):
                    db.execute('UPDATE control SET cooldown=max(cooldown,?), expected_ref=?', (now + WINDOW, remote))
                state = 'accepted'
                if provider in ('failure', 'error'):
                    state = 'failed'
                    db.execute("UPDATE control SET blocked='provider-failure'")
                elif provider == 'success' and live == row['source']:
                    state = 'succeeded'
            elif remote == row['base'] and state in ('sending', 'uncertain'):
                state = 'uncertain'
            else:
                db.execute("UPDATE control SET blocked='ref-drift'")
                return {'status': 'drift'}
            db.execute('UPDATE attempts SET state=?, observed=? WHERE id=?', (state, now, attempt))
            if state != row['state']:
                self.event(db, now, state, attempt)
            return {'status': state, 'source': row['source']}

    def recover_failure(self, expected_source, now):
        # No retry of the same failed source, no timer reset, no ambiguous-work bypass.
        with self.tx(now) as db:
            row = db.execute('SELECT * FROM control').fetchone()
            if row['blocked'] != 'provider-failure' or row['expected_ref'] != sha(expected_source):
                raise GateError('not a known provider failure')
            db.execute('UPDATE control SET blocked=NULL')
            self.event(db, now, 'provider-recovery-acknowledged')
