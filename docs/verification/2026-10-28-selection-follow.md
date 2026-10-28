# Reading quotation follows the selected passage

User request: choosing the corresponding passage should switch the quotation attached to an unsent question. This change accompanies the homepage scroll-motion work in PR239.

## Implemented behavior

The open reading conversation follows explicit paragraph and text-range selection. It waits for the final excerpt assignment, uses the existing typed quote validator and keeps the question, source focus and passage tools. It does not send a question or reopen a closed conversation. An active selection is captured before workspace opening dismisses passage tools.

During a pending answer, uncertain recovery or scope update, the submitted quotation stays frozen. The latest candidate waits in memory until editable. Account/book changes, explicit quotation/removal, ordinary or native close, reset and disposal discard queued candidates. Historical source-return links retain their original passage.

## Validation

Behavior tests were observed failing before implementation. A duplicate-selection test then exposed cancellation of a deferred context GET; the final implementation checks the actual current quote and passage instead of invalidating identical work. Independent review reproduced a native-close queue leak. Its regression was observed failing before the native-close cleanup was added. The final affected suite passes **129/129** across chat UI/state, reader adapter, typed quotes and input contracts.

Browser verification used a disposable local synthetic identity and shared public Alice text, with model generators disabled. At a measured CSS viewport of 1280×900, selecting p00009 replaced the composer quote, retained the unsent Chinese question, left focus on p00009 and kept passage tools visible. The observed chat request was one GET for p00009; no chat POST occurred. At 390×844, keyboard selection of p00011 followed by keyboard opening of the conversation attached p00011 and retained the same question in the modal layout. Local unavailable-assistant copy is expected with the generator disabled; this does not attest model availability. The temporary cookie and viewport overrides were cleared afterwards.

[Desktop evidence](2026-10-28-selection-follow/desktop.jpg), [narrow-layout evidence](2026-10-28-selection-follow/mobile.jpg), [measured state and request observations](2026-10-28-selection-follow/browser.json).

The screenshot surfaces used 150% browser zoom. Final captures use the complete physical viewport and its current scroll offset, so the right-hand desktop conversation and the fixed narrow-layout dialog are included; an initial capture clipped them. Measurements above are CSS viewport dimensions. No image content was edited.

Fresh independent review initially passed 94 owner/adapter tests and identified the native-close issue above. The reviewer then confirmed its fix, reran the expanded 95 owner/adapter tests successfully and reported no remaining review blocker. Runtime/build/release checks and real pinned copy lint pass. No real account, private notes, cloud records or model requests were used. Physical touch selection, Safari and screen-reader speech remain unverified. Current-head CI, merge and exact Production acceptance remain separate delivery gates.
