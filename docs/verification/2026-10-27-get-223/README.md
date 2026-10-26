# GET-223 annotation layout verification

Below 1400 CSS pixels, saved annotations now use compact passage markers. At wider widths readable gutter summaries return only where the book and open panels leave enough room. The existing toggle, source text, author attribution, saved notes, annotation generation states and privacy boundaries stay intact.

The annotation sheet reserves space for the bottom reading controls and uses the visible viewport when the keyboard or zoom changes the available height. Desktop chat and annotations occupy separate horizontal regions. On phones and narrow windows, an open annotation joins the conversation below its header with an independent scroll area; chat no longer covers it or makes it inert. Closing chat restores the annotation sheet and its unsent draft. Moving between desktop and mobile keeps focus in the same annotation editor.

## Evidence

- The initial real-account production probe used `test@cubxxw.com`, public-domain Alice and synthetic annotation GET responses. Page API writes, including companion observation, were intercepted before dispatch. The temporary session was revoked and read back. Production source was `de5651ef4c4a8666b4cc2616ba7ea3c7d64f9b3f`. Current main had already improved the original screenshot's desktop clipping, but 1280px still used both gutters. Baseline geometry is retained without account content or credentials.
- Full host suite with verified native PostgreSQL: **3512 passed, 0 failed, 1 existing macOS platform skip; 3513 total**. The first run's missing-Postgres failure and two database skips are preserved separately. The existing official Postgres.app 16.15 image was SHA256 checked (`2689dc64d6a02e0a66e4585616919060d8fbf5bb06886fccc05b7f87638bf081`), signature verified and mounted read-only. The isolated native database subset passed **13/13**.
- Final focus/lifecycle changes: **47/47** affected tests passed, independently repeated by the reviewer. No shared database, iOS Simulator or provider call was used.
- Packaged Chromium verification: **4/4** cases across EN/1280x800, zh-Hans/390x844 night, zh-Hant/320x740 with doubled annotation text, and JA/800x390 night. Checks include visible final annotation text, bottom scroll reachability, neighbor navigation, drafts, chat coexistence, mobile focus containment, 1280→1600→1280, maximum chat width, a 640x400 zoom-equivalent viewport, editing focus across both reparent directions, error/retry and Escape focus return.
- Fixed Vale 3.24.0, pinned textlint, copy canaries, runtime initialization and the public-build check pass. The initialized runtime contains 928 files / 9.0 MB and makes no model request. Final reader assets are **326449 / 327680 JS bytes** and **204655 / 204800 CSS bytes**; limits were preserved by consolidating overridden annotation CSS. Generated copy inventory changes contain source hashes and positions, with no product-copy rewrite.

## Independent review and delivery boundary

Native reviewer `/root/get223_review` confirmed one P2: moving the annotation between DOM parents lost the active editor. The fix preserves focus and moves the narrow layout notification before modal containment; the reviewer reproduced the repair across five breakpoint changes in real Chromium. No unresolved P0/P1/P2 remains. Final commit binding is retained on the PR.

Local synthetic fixtures establish layout, focus and recovery behavior. They are not real provider output, physical-device keyboard, Safari or screen-reader acceptance. Main CI, merge, Production source/assets and the post-merge real-account readback are separate release receipts; they must pass before GET-223 is Done. Persistent production notes are never seeded by this verifier.

To repeat local layout verification, provide an existing Playwright module, Chromium executable, packaged reader directory and an explicitly registered output directory to `tools/verify-annotation-layout.mjs`. It starts and closes only its own loopback server and browser. The reusable verifier never reads credentials.
