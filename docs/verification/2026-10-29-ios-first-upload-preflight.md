# First iOS upload preparation — 2026-10-29

PR #240 was synchronized normally with main `21e5fdcd6f87d90c39b8c2fbcf067090197e8256`, producing `9fc927c8dde00faa6ead076629bb85bc01dad7bb`. All four CI jobs passed in [run 40807064204](https://github.com/getyak/leafhour/actions/runs/40807064204). This proves source/simulator checks, not a signed upload.

An independent review found one Important release prerequisite: the existing Xcode project named `AppIcon` without an asset catalog. This change adds an opaque 1024×1024 RGB PNG generated from the existing Leafhour mark and paper color, records the asset catalog in the generated project, and rejects exported IPAs lacking compiled icon metadata, PNGs or `Assets.car`. The source PNG test failed before the resource existed; the project-resource test also failed before the project was regenerated.

The review's Minor diagnostic issue is also addressed: failed altool submissions emit only bounded allowlisted error codes and fixed categories. Raw messages, credential-like strings, userInfo and raw transport logs remain excluded. Independent Apple polling and the prohibition on duplicate submission are unchanged.

Local validation after these fixes: 88 Node tests in `tests/ios-*.test.mjs`, 6 Python release/signing tests and Bash syntax checks passed. PNG dimensions/color type and the rendered existing brand mark were checked. The project was regenerated with XcodeGen; no local application build or archive was started. The updated commit still requires its own CI before merge.

The protected `testflight` environment and six credential names were independently checked before release preparation. No secret values are recorded here. Automatic publication and signing refresh remain off. Apple processing, external beta review, tester invitation and real installation must each be recorded from actual results; this preflight record does not claim them.
