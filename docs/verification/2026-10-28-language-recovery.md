# Visible initial-language recovery

Base: `efddb9b`, the merged recording-led reading/homepage update. During its live cold-cache acceptance, the selected-language loader failed and `#ui-first-paint-error` was observed inside `#library-view` with a hidden ancestor on the public homepage. The visible shelf remained at its loading placeholder. This failure-host bug existed before the homepage redesign.

`showUiStartFailure` now selects an available visible host from the book page, library and homepage, skipping nodes hidden themselves or by an ancestor, then falls back to the body. The shared classic first-paint script is regenerated from the same source. The language deadline, chosen locale, owner-initialization block, retry destination and account/data access remain unchanged. This does not make a failed catalogue load a successful initialization or release fallback-language owners.

Two new unit cases failed against the old host selection. All 73 affected first-paint/locale tests pass after the fix. The independent reviewer reran 12 relevant checks and verified the generated/source script identity, with no blocking findings.

The [browser receipt](2026-10-28-language-recovery/browser.json) deliberately blocks the Simplified Chinese catalogue on the homepage, library and reader. In all three cases the native error is visible in the current view, its retry link retains the original URL, and reloading after removing the forced failure recovers the selected language. The [homepage failure screenshot](2026-10-28-language-recovery/home-failure.png) is an isolated local anonymous specimen, not a production screenshot or a user account. No model calls or real-account records.

The remaining test boundary is explicit: the added unit fixtures exercise hidden candidates; a separate fixture with a visible candidate inside a hidden ancestor is not added. The implementation checks native `closest('[hidden]')`; this branch is source-reviewed. Physical-device and screen-reader speech acceptance remain outside these Chromium checks.

Full current-head CI and matching Production acceptance remain delivery gates. The main redesign is PR237; this small recovery follow-up is tracked by its own PR and final delivery receipt.
