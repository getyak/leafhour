# GET-297: readable native dark controls

The native accent was a fixed RGB(61,102,79). Against the current dark sheet's sampled RGB(28,28,30), its solid-color contrast is approximately 2.60:1. Small green actions were difficult to read in night mode.

The semantic text/icon accent now retains that original value in light appearances and resolves to RGB(181,205,189) in dark appearances, approximately 10.07:1 against the same solid background. The filled import action retains the original green and an explicit white label, approximately 6.54:1. A lighter text color is deliberately not reused as a white-labelled button fill. These pair calculations do not establish full accessibility compliance on every material surface. [W3C contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).

## Native validation

Unsigned build and two focused native UI probes passed on the existing Primary iPhone / iPhone 17 Pro / iOS 26.5. All device operations used `dev-ios-session` and the isolated `org.leafhour.craft297` development app. The original system appearance was restored after light/dark/light checks. The reader fixture is a bounded public-domain excerpt imported through OfflineLibrary; no account data, private notes or model service was accessed.

| Step | Result |
| --- | --- |
| Empty library, system dark | Icons use the light semantic accent; the import action keeps its readable green fill and white text |
| Same library, system light | Existing light accent retained; native import picker opens and cancels successfully |
| Reader, night | Settings, directory/search/records controls and record-sheet return remain readable and operable |
| Reader, paper | Original green returns; the reading text, navigation and target sizes are unchanged |

The current batch was tested from main `0c646f4`, with the exact native hashes in [evidence.json](evidence.json). The separate GET-296 preferences/appearance PR is not claimed as part of this run. Its immediate sheet-theme behavior remains independently recorded in PR #242. Any later base synchronization must be recorded separately rather than calling these older screenshots a fresh run.

Independent read-only review found no confirmed issue in the semantic provider or its consumers. Only the existing prominent import button needed the separate fill token; other direct uses are text, icons and decorative cover marks. The temporary UI probes add no production hook and their exact source/results are retained with local evidence.

[Dark library](screenshots/01-library-dark.png) · [Light library](screenshots/02-library-light.png) · [Night settings](screenshots/03-settings-night.png) · [Night controls](screenshots/04-controls-night.png) · [Paper settings](screenshots/05-settings-paper.png).

Every retained image was inspected. Disabled controls remain visibly disabled; screenshots and specified color pairs are not a VoiceOver, high-contrast, maximum Dynamic Type or real-device accessibility certification. Compact/iPad and physical TestFlight installation/update remain outside this small source-and-simulator acceptance.

## Combined-source follow-up

After PR #242 merged as `2e340c8`, this branch synchronized that main commit without conflicts. The combined native build and two focused probes passed: GET-296 preview/units/reset/cold-night persistence, and GET-297 night settings/progress/records/paper controls. The combined hashes are recorded separately in evidence.json. [Combined night preview](screenshots/06-combined-night-preview.png) is a fresh screenshot of that integrated source; the earlier empty-library captures remain explicitly scoped to the earlier color run.
