# Native rotation baseline before changing reading width

This is a bounded diagnostic on unchanged application source from main `6db7336`, under [GET-296](https://linear.app/getyak/issue/GET-296). It implements no new reading-width or restoration behavior. The previous search change's main CI `40753765589` passed all three jobs, and its scoped GET-299 completion was read back separately.

## What was actually observed

One focused native UI probe searched for `waistcoat-pocket`, returned to the source, rotated portrait → landscape → portrait, asserted the reader's corresponding dimensions, and recorded screenshots plus live saved anchors. Two executions passed on the existing Primary iPhone / iPhone 17 Pro / iOS 26.5. The second execution corroborated an ambiguous app-level screenshot using a direct full-device capture.

| Stage | Chapter / passage | Saved Unicode-scalar offset |
| --- | --- | --- |
| Portrait before rotation | `text` / `text-2` | 370 |
| Landscape after settling | `text` / `text-2` | 353 |
| Portrait after settling | `text` / `text-2` | 353 |
| Separate landscape capture | `text` / `text-2` | 353 |

The same paragraph stayed visible, and the two portrait captures were visually comparable. The exact stored scalar anchor changed by 17. This is an observed small stored-anchor change, not proof of a severe jump or of the suspected immediate-scroll race. The probe deliberately allowed settled layout; it does not cover a rotation inside the 180 ms capture delay, continuous resizing, selected text, image attachments or a different type size. [Snapshots](anchor-snapshots.json) and [source hashes, run scope and limitations](evidence.json).

Only the task-owned app's bounded public-domain Alice fixture was read; its source fingerprint was checked before live state reads. No cloud account, private notes or model request was used. The temporary UI test was preserved with the raw evidence and restored out of the checked-in test file afterward. An initial attempt stopped because the harness cached a container path before Xcode moved the isolated app during installation. Its failure is retained and excluded from product conclusions; the corrected harness resolves the current container after the probe marker.

[Portrait before](screenshots/01-portrait-before.png) · [Full-device landscape](screenshots/02-landscape-device.png) · [Portrait after](screenshots/03-portrait-after.png). All were inspected. The direct device PNG preserves the physical panel orientation, so its landscape content appears sideways in a portrait-oriented viewer. An app-level landscape attachment with orientation metadata and a cropped/black viewer result was rejected as layout evidence; no pixels were edited or reconstructed.

## Design decision and next checks

Independent source review found that width is part of the attributed-text signature, so geometry changes can rebuild text, reread images and reset selection. The persisted reading anchor can lag scrolling by 180 ms; restoring it before the new layout is stable also has no generation/chapter guard. These are concrete source mechanisms requiring targeted runtime checks, beyond this settled-rotation result.

Prioritize the reflow lifecycle before adding a wide-screen column: retain an immediate in-memory visible anchor while keeping disk saves delayed; distinguish content from geometry changes; preserve valid selection and cached image attachments; discard obsolete asynchronous restores; keep explicit chapter/search navigation authoritative. Text and images should share one effective column width, while edge controls retain their full-width interaction area.

For a future wide-screen implementation, [UIKit readableContentGuide](https://developer.apple.com/documentation/uikit/uiview/readablecontentguide) offers a single-column width constrained by margins and Dynamic Type. Choose it or a measured alternative only after actual wide/narrow device observation. Verify just-scrolled rotation, repeated resizing, image boundaries, selection/quote identity and cold restoration. The current device guard permits one active simulator; the borrowed Primary remains protected, so no iPad or split-view acceptance was performed here.

No new app behavior, iPad acceptance, full accessibility certification, TestFlight release or website publication is established by this diagnostic.
