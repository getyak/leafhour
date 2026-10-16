# Squirrel companion verification

Scope: optional current-book companion, five-minute foreground reading interval, existing IM and locally animated squirrel. This record separates deterministic checks, isolated browser interaction, actual provider calls and hosted delivery.

## Automated checks

On Node 22.22.0, after integrating the latest main branch and the final authorization race fix, `npm run verify:deploy` passed: 733 tests passed, zero failed, one platform-specific test skipped. The isolated official reading runtime initialized (928 files, 9.0 MB) without a model request. The hosted build passed (157 files, nine registered media assets), as did the 347-file software release allowlist and private-content exclusion checks.

The suite covers foreground versus background time, five-minute cooldown and newly observed material, bounded canonical sources, no future-text/private-note access, AI-only history, account isolation, consent revisions, duplicate claims, cross-instance cancellation, invalid references, silence and quotas. A deferred authorization test first reproduced a model dispatch after another instance disabled companion; moving authorization before the final durable consent check made that regression pass.

An independent whole-branch reviewer reproduced and then verified fixes for pending-bubble expiry during notes, idle reading-session renewal, and cancellation while awaiting admission. The last follow-up ran all 11 service tests independently and reported no remaining blocking findings.

The existing audio cancellation test used two fixed sleeps and failed only under full-suite load. Its assertions remain intact; it now uses the existing terminal-state polling helper. Production audio behavior did not change.

## Provider evidence

Two explicitly bounded calls used the existing official DSH runtime, with no tools or retries. The first supplied frontmatter; the second supplied actual opening story paragraphs from the public Alice sample. Both returned valid source-linked messages. The second referenced the heat, the daisy chain and the rabbit from the supplied text. Estimated reservations were CNY 0.00893 and 0.010004; these are reservations, not confirmed provider bills. No real-account records or test-book uploads were created.

These samples prove the provider path runs. They do not establish long-term conversational quality or that proactive messages improve reading.

## Browser and delivery evidence

Browser interaction uses an isolated local store and synthetic local authentication. Its message generator returns an explicitly labeled fixture; it is separate from the actual-provider checks above. Local native browser execution exposed a Window timer receiver error, which was fixed and covered by a regression test.

Final interaction results and hosted delivery receipts are recorded below after verification.
