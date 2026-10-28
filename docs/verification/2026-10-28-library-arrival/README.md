# Book-first library and daily arrival — 2026-10-28

Scope: book cards first, personal data second, no inline calendar or daily inbox, one factual daily recap beside the existing reading companion. The existing calendar URL and sharing remain available. Onboarding preferences now open with the chat the reader chooses to open, rather than opening the chat over the shelf at arrival.

## Evidence

- `node --test tests/library-arrival*.test.mjs tests/library-lazy.test.mjs tests/library-portability.test.mjs tests/library-data*.test.mjs tests/library-room.test.mjs tests/reading-journal-dashboard.test.mjs tests/library-profile-shell.test.mjs tests/ui-locale-a-remaining.test.mjs tests/ui-locale-portal.test.mjs`: 82 tests passed, zero failed.
- `tests/local-instance.test.mjs`: 5 passed after registering the new modules in the release allowlist. No personal directory was used.
- Build, public asset check, release allowlist export and release provenance check passed. Copy export and the real pinned Vale/textlint tools passed; pre-existing copy debt remains documented.
- Fresh review found and verified fixes for metadata shelf positions, readable-but-full browser storage, and time incorrectly attributed to an abbreviated book list. Each has a regression test that failed before its fix. A focused review of the later archive-loading boundary found no actionable issues; its 47 relevant tests and loading/cancellation probes passed.
- First full local sweep exposed the release allowlist omission and old extracted-controller fixtures that needed the new state bindings and metadata route. Those were corrected and their suites rerun. An oversized transfer and an unrelated companion-locale case passed on isolated reruns. The subsequent full sweep and current-commit CI are separate delivery gates; this note does not claim their completion.

`browser.json` records a real headless Chrome run against an isolated temporary local book and recorded 18-minute interval, not this user's reading history. The run injected 1600 ms delay into personal hydration: the shelf appeared before it completed. Timing is local evidence, not a production speed promise. It verified a partial card window, focus preservation, 390 px layout, a bubble inside viewport bounds, no automatic calendar/daily-inbox request, same-day reload deduplication, calendar navigation, and no page errors. Archive compression was absent before an explicit data-file action and loaded afterward. Temporary book/record files were removed after the run.

[Desktop](desktop.png), [mobile](mobile.png), [calendar](calendar.png). Mobile screenshots wait for the existing responsive transition to settle. The recap has no continuous animation, timeout or focus takeover. Real Safari, VoiceOver, a physical phone and a historical production-user recap have not been validated by these local checks.

## Data and copy checks

The arrival response is an allowlist built from the authenticated account's current, unarchived index and records. It returns no note/question text, original passages, session intervals or credentials. It merges overlapping intervals, clips yesterday using the requested time zone, distinguishes tracked/estimated/manual duration and uses actual interval end times for the last reading record. It does not infer comprehension or yesterday's display mode from today's saved position. No paid model is called to restate recorded facts.

The current `docs/writing.md` and `lieflat-less-ai-tone` rules were read before composing visible Chinese copy. These short labels and recap sentences are below the essay detection threshold; they were checked sentence by sentence before and after the minimal factual correction. No detection percentage or author-origin claim is fabricated. The correction replaced a duration tied to two displayed titles with a total-only sentence; other claims, source names and date qualifiers were retained. No rejected structural heuristics were applied. Four locale key sets and existing values remain aligned.

Production merge, deploy and same-commit verification are tracked by the associated PR and deployment checks. Local screenshots are not production acceptance evidence.
