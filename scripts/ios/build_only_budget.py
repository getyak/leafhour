"""Injectable supervision of one owned child; no native or global process APIs."""
from dataclasses import dataclass
import signal


@dataclass(frozen=True)
class Identity:
    pid: int
    ppid: int
    pgid: int
    birth: str


@dataclass(frozen=True)
class Budget:
    seconds: float = 1200
    max_new_bytes: int = 3 * 1024 ** 3
    min_free_bytes: int = int(10.5 * 1024 ** 3)
    poll_seconds: float = 1
    term_grace: float = 10
    kill_grace: float = 5


def supervise(child, budget, probe, clock, emit, cancelled=lambda: None):
    """Limits are sampled cancellation triggers, not kernel disk quotas.

    The child implementation must revalidate its outstanding Popen identity at
    each signal boundary. Never substitute an arbitrary PID or signal a group.
    """
    result = dict(exit_code=None, cancel_reason=None, leader_exited=False,
                  identity_verified=False, blocked=False)
    started = getattr(child, 'started_at', clock.monotonic())
    try:
        identity = child.identity()
        if not isinstance(identity, Identity) or min(identity.pid, identity.ppid, identity.pgid) <= 1 or not identity.birth:
            raise RuntimeError('Missing owned child identity')
        result['identity_verified'] = True
    except Exception as error:
        result['blocked'] = True
        try:
            code = child.poll()
            if code is not None:
                result.update(exit_code=code, leader_exited=True)
        except Exception:
            pass
        emit(dict(event='identity_error', error=str(error)))
        return result

    def sample(after_exit=False):
        try:
            # Real observations supply one aggregate bound for their entire
            # probe chain. A synchronous per-command timeout is insufficient.
            values = probe.until(started + budget.seconds) if not after_exit and hasattr(probe, 'until') else probe()
            if any(type(values.get(key)) is not int or values[key] < 0 for key in ('free_bytes', 'artifact_bytes')):
                raise RuntimeError('Invalid space measurement')
            emit(dict(event='sample', elapsed_seconds=clock.monotonic() - started, **values))
            if values.get('source_unchanged', True) is not True:
                return 'source_changed'
            if values['free_bytes'] <= budget.min_free_bytes:
                return 'free_space'
            if values['artifact_bytes'] >= budget.max_new_bytes:
                return 'artifact_budget'
        except Exception as error:
            emit(dict(event='monitor_error', error=str(error)))
            return 'monitor_error'
        return None

    while True:
        try:
            code = child.poll()
        except Exception as error:
            result['blocked'] = True
            emit(dict(event='exit_unknown', error=str(error)))
            return result
        observed_at = clock.monotonic()
        observed = sample(after_exit=code is not None)
        if observed in ('source_changed', 'monitor_error'):
            result['blocked'] = True
        reason = ('signal' if cancelled() is not None else
                  'deadline' if (observed_at if code is not None else clock.monotonic()) - started >= budget.seconds else observed)
        if code is not None:
            result.update(exit_code=code, leader_exited=True, cancel_reason=reason)
            return result
        if reason:
            result['cancel_reason'] = reason
            result['blocked'] = result['blocked'] or reason in ('source_changed', 'monitor_error')
            emit(dict(event='cancel', reason=reason, elapsed_seconds=clock.monotonic() - started))
            break
        clock.sleep(min(budget.poll_seconds, max(0.001, budget.seconds - (clock.monotonic() - started))))

    # An externally signalled session owner has its own 10s escalation window.
    # Keep our leader grace shorter; interrupted finalization remains untrusted.
    term_grace = min(budget.term_grace, 2) if reason == 'signal' else budget.term_grace
    kill_grace = min(budget.kill_grace, 1) if reason == 'signal' else budget.kill_grace
    for number, grace in ((signal.SIGTERM, term_grace), (signal.SIGKILL, kill_grace)):
        try:
            if child.poll() is None:
                if child.identity() != identity:
                    raise RuntimeError('Owned child identity no longer matches')
                child.send_signal(number, identity)
                emit(dict(event='leader_signal_requested', signal=number, pid=identity.pid))
        except Exception as error:
            result.update(blocked=True, identity_verified=False)
            emit(dict(event='signal_refused', error=str(error)))
            return result
        until = clock.monotonic() + grace
        while True:
            code = child.poll()
            if code is not None:
                result.update(exit_code=code, leader_exited=True)
                final_issue = sample(after_exit=True)
                if final_issue in ('source_changed', 'monitor_error'):
                    result.update(blocked=True, post_cancel_issue=final_issue)
                return result
            if clock.monotonic() >= until:
                break
            clock.sleep(min(budget.poll_seconds, until - clock.monotonic()))
    result['blocked'] = True
    emit(dict(event='exit_unknown', pid=identity.pid))
    return result
