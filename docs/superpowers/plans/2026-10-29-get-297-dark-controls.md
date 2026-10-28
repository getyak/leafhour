# GET-297: legible native dark controls

The current static green (61,102,79) has a measured 2.60:1 contrast against the current native dark sheet (28,28,30). The user authorized autonomous iOS craft improvements. This small second batch retains the original green in light appearances and uses a lighter semantic text/icon accent (181,205,189) in dark appearances, approximately 10.07:1 against that sheet.

Making every green lighter would also lighten prominent button backgrounds and reduce white-label contrast. Keep the original green as a separate filled-action color with an explicit white label; only the semantic foreground/tint adapts. No data, navigation, target-size or motion change is needed.

- [x] Build unsigned native source with an isolated app ID.
- [x] Inspect an empty library and its prominent import action in light and dark system appearances.
- [x] Import a bounded public-domain text through OfflineLibrary and inspect the reader's night toolbar/settings and paper controls.
- [x] Restore the original host appearance, preserve screenshots and measured contrast; retain physical-device and TestFlight limits.
- [ ] Independent review, linked PR, latest-head CI, normal merge and release follow-up.

Basis: https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html and the first batch's current-run native screenshot. These ratios cover specified solid foreground/background pairs, not full accessibility compliance.
