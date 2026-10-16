# Squirrel companion verification

Scope: optional current-book companion, five-minute foreground reading interval, existing IM and locally animated squirrel. This record separates deterministic checks, isolated browser interaction, actual provider calls and hosted delivery.

## Automated checks

On Node 22.22.0, after integrating the latest main branch, the final authorization race fix and keyboard viewport repair, `npm run verify:deploy` passed: 734 tests passed, zero failed, one platform-specific test skipped. The isolated official reading runtime initialized (928 files, 9.0 MB) without a model request. The hosted build passed (157 files, nine registered media assets), as did the 347-file software release allowlist and private-content exclusion checks.

The suite covers foreground versus background time, five-minute cooldown and newly observed material, bounded canonical sources, no future-text/private-note access, AI-only history, account isolation, consent revisions, duplicate claims, cross-instance cancellation, invalid references, silence and quotas. A deferred authorization test first reproduced a model dispatch after another instance disabled companion; moving authorization before the final durable consent check made that regression pass.

An independent whole-branch reviewer reproduced and then verified fixes for pending-bubble expiry during notes, idle reading-session renewal, and cancellation while awaiting admission. The last follow-up ran all 11 service tests independently and reported no remaining blocking findings.

The existing audio cancellation test used two fixed sleeps and failed only under full-suite load. Its assertions remain intact; it now uses the existing terminal-state polling helper. Production audio behavior did not change.

## Provider evidence

Two explicitly bounded calls used the existing official DSH runtime, with no tools or retries. The first supplied frontmatter; the second supplied actual opening story paragraphs from the public Alice sample. Both returned valid source-linked messages. The second referenced the heat, the daisy chain and the rabbit from the supplied text. Estimated reservations were CNY 0.00893 and 0.010004; these are reservations, not confirmed provider bills. No real-account records or test-book uploads were created.

These samples prove the provider path runs. They do not establish long-term conversational quality or that proactive messages improve reading.

## Browser and delivery evidence

Browser interaction uses an isolated local store and synthetic local authentication. Its message generator returns an explicitly labeled fixture; it is separate from the actual-provider checks above. Local native browser execution exposed a Window timer receiver error, which was fixed and covered by a regression test.

The actual local reading clock produced a bubble after sustained reading across visible paragraphs. Ignoring it collapsed the bubble. Opening the existing conversation showed its AI-only message and preserved an unfinished draft. Continuing the draft produced a second turn. Reader scroll position remained exactly 622 px before and after opening. A fresh isolated reading session also verified clicking the visible bubble: the exact AI message opened in the existing IM, the unfinished draft remained intact, and reader scroll stayed at 1007 px. Closing companion removed its active pill.

Two native frame samples 500 ms apart measured body translations of -0.531503 and -0.882109 px, proving movement rather than just animation declarations. With reduced motion enabled, the browser reported zero active animations. At 390 px and 320 px, document scroll width matched viewport width. The settled narrow conversation retained an opaque readable surface and visible composer.

The final theme check caught a bubble text token mismatch. It now uses the shared ink token. Browser-computed colors were RGB 40/46/42 on white in paper mode and RGB 232/236/232 on RGB 36/40/38 in night mode. Hosted build and release checks passed again after this CSS-only repair.

Shrinking an already focused conversation to a 400 px viewport exposed an obscured composer. A regression test first failed, then passed after adjusting only the conversation frame scroll position. The browser retest measured the input bottom at 331.59 px in a 400 px viewport after scrolling the frame by 78 px, with no horizontal overflow. Independent follow-up review passed all 23 chat UI tests without new blockers.

The headless browser kept the first page visible and focused after opening a second tab. This does not constitute background-tab proof. Hidden/blur cancellation is covered by the isolated motion lifecycle and reading-clock tests; a real-device mobile keyboard and an actual background tab remain separate environment checks.

Hosted delivery is tracked in [PR 50](https://github.com/getyak/leafhour/pull/50), its CI checks and the main-branch Production workflow. The production smoke requires the exact deployed source commit, companion modules/styles, anonymous authentication boundaries and representative reader/library routes. A passing build alone is not a production receipt; the final delivery status is recorded on the PR after those checks.
