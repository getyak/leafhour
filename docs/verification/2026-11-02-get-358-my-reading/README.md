# GET-358: My Reading

The third iOS tab now opens 我的阅读 with overview, calendar and notes. Its avatar opens the existing settings. The approved reading-handbook concept is implemented using adaptive paper surfaces, a seven-day book-spine chart, source-linked notes and native daily navigation.

## Interaction

Book spines rise once with a short stagger and gently compress on press. Section selection uses a sliding underline and selection feedback; date and note details use native navigation. A long press offers the day's time and an explicit open action. Reduce Motion removes scale and stagger. Targets are at least 44 pt; the calendar and chart can scroll horizontally in very narrow windows. Search supports the keyboard Search action and retains its query across tabs.

Account and device records have separate scopes. Cloud totals are not added to device copies. Local intervals use millisecond precision, union overlaps and split at actual calendar boundaries. DST days use their real length. Undated drafts stay undated. A version and passage must match before returning to source. An abandoned source task cannot open a reader later.

## Actual local validation

- LeafhourCore: 251 tests passed, 0 failed, 0 skipped, including eight journal cases covering midnight, overlap, the previous month, DST, fractional intervals, missing monthly data, note attribution and source identity.
- Initial app regression: 235 executed, 234 passed and one existing platform/availability skip. Two existing settings/Chat UI regressions passed.
- Final affected LibraryRecordsTests: 26 passed, including month-cache recovery, late owner/scope responses, pagination preservation, cancelled source navigation and corrupt local records remaining unknown.
- Final JournalUITests: 5 passed on the shared Primary iPhone (iPhone 17 Pro, iOS 26.5). Covers overview/day/month navigation, notes/search/source return, settings and retained search, initial error, and maximum accessibility text.
- Host checks: 65 passed across native design interaction, private delivery and vendor checks.
- Native app and test bundles built successfully with an isolated Debug bundle `org.leafhour.get358.testing`. The fixture is allowlisted only for Debug; records are synthetic and use no real account or paid provider.

Screenshots are actual Simulator captures in `screenshots/`, not generated mockups. The account name and content in the captures are explicitly synthetic.

## First-pass failures and corrections

- The first Core journal test run failed because the new type did not yet exist, then the initial four tests passed. A later added regression had an unmatched test literal; corrected before the full 251-test pass.
- The first UI batch's five cases failed because its new launch helper did not handle the existing quiet reader-resume behavior. Reused the established arrival/return pattern; this was a test setup correction, not evidence that the initial batch passed.
- The next UI batch passed three and failed two. Native context-menu wrapping removed the spine's accessibility identity, and a container identifier hid calendar-control identifiers. Moved the accessibility label/identity outside the menu and removed the container identifier; all five final cases passed.
- The first native run was started before the newly added UI file was in the generated project. It is counted only as existing app/settings/Chat regression. XcodeGen was rerun, and the later five-test executions explicitly ran JournalUITests.

## Independent review

An independent read-only review found no P0/P1 and seven P2 issues. All were addressed: pagination reset, abandoned source navigation, 25-hour day validation, fractional time rounding, time-zone cache invalidation, false empty device records, and targets below 44 pt. Regression tests and final UI checks cover the corrected behavior.

## Remaining acceptance boundaries

Physical iPhone feel, VoiceOver completion, real-account data continuity, a separate compact/iPad Simulator run and an actual tester installation are not established by these local tests. Reduced-motion branching is implemented; no system-setting end-to-end result is claimed. CI, merge and Apple processing are recorded separately after delivery.
