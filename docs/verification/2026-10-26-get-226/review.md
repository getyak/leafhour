# Independent review

Base: `c529ddae882aeae4ec1d70400eccfc00e77ccd18`. Reviewed implementation bytes are bound by [fingerprints.json](fingerprints.json), all **13/13 matched** after the follow-up. The reviewer independently ran **28/28** targeted tests, including location, reader cleanup and release-import checks. No unresolved P0/P1/P2 remained.

The first review found a P2: long named front/back matter was copied in full into the persistent reading pill without a height bound. A real 320px/200% browser regression failed before the fix. The two-column single-line disclosure preserves the complete DOM/accessibility text and the existing Contents path while bounding visible text. The same replay reduced the pill from **1442.45px to 60.39px**, with previous/next page pointer hit checks passing. The reviewer read both reports and screenshots and closed the P2.

Additional independent probes covered continuous chapter changes, unloaded and empty chapters, a short chapter, BFCache pagehide/pageshow, teardown and idempotent listener release. The review confirmed no added reading writes, private content fetches, overlay registry, Escape/F handler or conceal timer. The original fixed asset budgets remained intact: JS 327547/327680 bytes and CSS 204608/204800 bytes.

An early full host run exposed the inherited test's chapter-ordinal assumption. A later run exposed a release scanner interpreting an embedded test string as a relative executable import; the test now extracts the actual deferred-import statement without that ambiguous literal. These failures were fixed and retained separately. The review does not substitute for subsequent complete host gates, real native input, exact-head CI or production acceptance.

A final read-only follow-up confirmed the sole later product difference was the paging-clearance breakpoint from 600px to 1023px. Chromium/WebKit landscape probes passed at 800×390, and all 13 final fingerprints matched. No new P0/P1/P2 was found.
