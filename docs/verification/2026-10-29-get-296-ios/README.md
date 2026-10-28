# GET-296: native reading preferences

2026-10-29, Asia/Shanghai. [GET-296](https://linear.app/getyak/issue/GET-296) remains In Progress for the wider optimization window. [Research and proposals](../../design/2026-10-29-ios-craft/README.md) separate documentation research from observed behavior.

## Delivered behavior

Reading settings now preview a bounded excerpt of the actual current source with the existing serif size and spacing. The preview's stable height prevents controls moving as font size changes. Visible values include pt units; native slider accessibility values include spoken units. Restore defaults changes only font size and line spacing, preserving theme, position and personal records. PDF settings show fixed-page zoom guidance instead of ineffective font controls.

Theme changes inside an already-open sheet now update the sheet's own appearance. The reader and its panels resolve system appearance from the presenting library, outside their own presentation overrides. This fixes a confirmed white-on-light preview after night-to-paper changes and the stale dark appearance after night-to-system changes. No new stored preference or migration is required.

## Actual checks

Unsigned native builds and **three focused native UI probes passed** against the final native source hashes in [evidence.json](evidence.json). All iOS commands acquired the shared `dev-ios-session` guard, reused the existing Primary iPhone / iPhone 17 Pro / iOS 26.5, and used the isolated unsigned `org.leafhour.craft296` app. No shared simulator was erased or replaced.

| Step | Result |
| --- | --- |
| 1. Open reading settings | Current source excerpt visible in half and expanded native sheets; baseline captured before edits |
| 2. Adjust text | Font slider changes the preview and exposes its value in points; screenshots show 33pt versus the default 22pt |
| 3. Reset and relaunch | Reset returns size/spacing to 22pt/9pt, disables itself at defaults, preserves night mode; cold relaunch retains those values |
| 4. Open a real PDF | Fixed-page guidance and theme remain; no font/spacing sliders, preview or typography reset; Continue Reading returns to PDF |
| 5. Change theme while presented | Night-to-system and paper render legibly; with system selected and the sheet held open, host light → dark → light updates the same sheet; the original host appearance was restored |

Independent read-only review covered all four changed Swift files, scoped theme propagation, preview sizing, state retention and PDF behavior. No confirmed finding remains. The requested live OS-appearance transition was then checked in the third probe.

The probes used a 3,500-character public-domain excerpt derived from the repository's `catalog/alice.txt` and a one-page PDF derivative through the normal `OfflineLibrary` import service. These are bounded preference fixtures, not complete EPUB/PDF compatibility acceptance. No fixture was bundled in production, no real account data was read, and no model call was made. The temporary probe methods were removed from the checked-in test file after their source and results were preserved; there are no test-only application entry points.

## Screenshots

- [Before, medium sheet](screenshots/01-preferences-before.png)
- [System appearance after leaving night mode](screenshots/02-system-theme.png)
- [Adjusted preview](screenshots/03-adjusted-preview.png)
- [PDF settings](screenshots/04-pdf-settings.png)
- [Open sheet follows OS dark](screenshots/05-system-dark-live.png)
- [Same sheet follows OS light](screenshots/06-system-light-live.png)

The before image is a medium sheet; some after images use the expanded detent so all controls can be inspected. These are functional and visual observations, not a same-detent pixel comparison. Every retained image was inspected. Earlier grouping-locator failure and rejected contrast snapshots remain with the local raw results; a passing interaction assertion alone was not treated as visual acceptance.

## Remaining boundaries

Maximum Dynamic Type, compact iPhone, iPad/split view, full VoiceOver and hardware-keyboard interactions were not accepted in this batch. Physical devices, TestFlight upload/distribution/update and complete GET-276 acceptance remain separate. Saved reading anchors/notes retain the same state path; this batch does not establish a new long-book or sync acceptance result.

The approximately half-hourly continuation requested through 2026-10-30 12:00 is **not installed**: this session did not expose a usable native automation tool. The current source batch and future proposal ledger must not be described as proof that unattended overnight execution is active. No automation file or cron workaround was created.
