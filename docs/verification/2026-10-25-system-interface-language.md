# System interface language

> Historical session report, archived on 2026-10-30. The implementation was recovered and strengthened in [GET-219 / PR #182](2026-10-26-system-interface-language.md). That version stores an explicit `system` value while preserving legacy null preferences as device delegation. The old null-account interpretation and delivery blockers below describe this earlier proposal and session; they are not the current compatibility contract.

Added a system option to the shared settings radios and reader native selector. New visitors default to system; existing explicit device/account choices remain intact. System resolves through the existing supported navigator language mapping and English fallback. It is a preference mode, never a fifth catalogue or URL language. Explicit system selection persists the device mode, removes the current URL override, and sends null through the existing account CAS API. A nonzero-revision null account choice restores system mode on another device. Generated links preserve that mode without freezing the device's effective language into their ui parameter.

Validation on 2026-10-25:

- 84 locale, system preference, native control, account client/browser/presentation tests passed.
- 37 transaction, navigation and graph tests passed.
- `npm run build:reader-runtime` passed (928 files, 9.0 MB; no model calls).
- `git diff --check` passed.
- Four HTTP account tests could not listen on 127.0.0.1 (EPERM); no real account data was written.
- No browser visual acceptance or production acceptance performed.

Delivery blocked in this execution environment: creating a git branch lock is denied (Operation not permitted); configured localhost proxy port 7897 is unreachable, direct github.com:443 is also unreachable, and local gh reports its stored login invalid. Other concurrent working-tree changes were preserved.
