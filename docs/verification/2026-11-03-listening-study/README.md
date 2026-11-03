# Selectable bilingual listening and quiet Chat — November 3

## Implemented

Native listening reuses the reading paper, font pairing, size and line spacing. A continuous lazy chapter transcript uses one native selectable text view per paragraph, with actual speech sentence/word paint and glyph-based sentence seeking. Long press and native Copy remain available across sentences. Original and selected literal/interpretive translation align by paragraph, with no fabricated sentence correspondence. Missing/stale translations remain labeled; the profile-scoped comparison switch does not change the spoken language.

Bottom controls offer reading, chapters, comparison and shared appearance. They hide after five idle seconds during playback; pause, manual browsing, selection, VoiceOver, settings and speed holds keep them available. Manual browsing/selection pins the displayed chapter; translation fallback in one paragraph cannot replace the transcript's chosen layer. The native follower respects manual navigation, selection, VoiceOver and Reduce Motion. Long-hold speed rises gradually to at most 5×, restoring the original rate on release/cancellation/pause/background/dismissal and leaving the saved rate unchanged.

Reading now has explicit previous/next chapter actions. Side page-tap regions include the top and bottom corners; previously those 44-point strips opened tools, although the same side in the middle turned a page. Center taps retain tool disclosure. Links, native held selection, VoiceOver activation and PDF zoom keep their protections. Existing rapid-turn animation queuing is retained.

Chat uses a lightly outlined 16-point composer and a quieter send action. The pending quote is a compact expandable context strip; saved citations use a leading rule. Assistant Markdown stays outside bubbles. Removing an excerpt leaves a short current-paragraph label without repeating the submitted quote in the composer.

## Investigation and review

- A new corner-region test reproduced four mismatches before changing the page action resolver.
- Native seek tests exposed an invalid surrogate-half offset; source scalar round-trip validation now rejects it before interrupting audio. Stale snapshots and mismatched layers are rejected too.
- The first listening UI run exposed an 18×5-point ellipsis hit region. A full 44-point label hit shape fixed control reveal; the subsequent listening UI flow passed.
- The first expanded-quote UI run exposed a hidden current-paragraph label after removal. The fix retains only the attribution label, avoiding duplicate quotes while a reply streams; both cases are covered by tests.
- Independent static review found cross-sentence selection, pinned chapter/layer, VoiceOver following and speed-hold idle-hide issues. All were addressed. A nonblocking narrow-width spacing observation was also addressed by reducing the transport gap to 12 points. Review did not operate the simulator or claim physical acceptance.

## Validation

All artifacts use `/tmp/leafhour-listening-study/` and the existing dedicated Leafhour Cross Device Sync simulator (iOS 26.4, Xcode 26.4). No signing changes, real-account records, uploaded books or paid-model calls were used. Unit tests use temporary directories and URLProtocol fixtures; UI tests use the existing explicitly allowed `org.leafhour.quiet.testing` synthetic fixture.

- Core: 325 tests, 2 existing selected-sample skips, zero failures.
- Host iOS release contracts: 100 tests, zero failures. Python release/icon contracts: 9 tests, zero failures. Archive/upload shell syntax passed.
- Final full native pass: 302 tests, 2 selected-sample skips, zero failures. After the last lazy-projection and 44-point touch-target cleanup, all 40 affected native tests and the full bilingual listening UI flow passed again. Sentence tokenization and hashing are cached lazily per visible paragraph rather than performed for every paragraph on chapter entry.
- Listening UI: selectable original/comparison, explicit sentence seek, no-autoplay comparison toggle, hide/reveal while audio continues, native selection, portrait/landscape, 0.5–5× settings, temporary hold restoration, pause/background. Rapid double tap reached page 3 without selection. Selection-to-Chat returned to the same book. Five UI methods passed in the verified run; the three affected quote-removal, bilingual idle-hide and chapter-roundtrip methods also passed after the final quote fix. The final bilingual flow passed once more after lazy projection and touch-target cleanup.

Simulator speech probes do not prove audible real-device quality. Full VoiceOver interaction, physical installation/update and retained user data require device acceptance. CI, source merge, production publishing, Apple processing and tester availability are recorded separately in the delivery result; no preview or manual second deployment chain was created.
