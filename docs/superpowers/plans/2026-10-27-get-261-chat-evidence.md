# GET-261: Reading chat stays beside the book

Scope: current `getyak/leafhour`, starting at `32662f87e112ef36445b250d633ccf0d51b65861`. Preserve the delivered Quiet Reading entry, first-paint skeleton, single locale owner, billing/privacy boundaries and existing chat recovery. No provider calls or book regeneration.

1. Keep chat closed until the existing Ask AI entry is used. Retain the floating desktop workspace, persisted resize preference and unchanged paragraph geometry. On narrow screens, retain a visible portion of the book above the modal sheet; use the available viewport when a keyboard or landscape screen leaves little height.
2. Put completed-answer references and tool history behind one native evidence disclosure. Keep citation layers, draft flags and passage links. A failed lookup qualifies the answer outside the disclosure, including when a long answer is folded. Do not add an empty disclosure.
3. Move the current-passage disclosure to More. Keep source/literal/interpretive selection, explicit missing translations, source navigation and nested Escape focus return. Preserve account/book scope, unsaved drafts, failed sends, pricing, stop and retry controls.
4. Verify affected state/DOM tests, fixed copy tools, unchanged runtime/build budgets and the packaged browser at four locales, desktop/tablet/phone/short viewports, keyboard/touch and reduced motion. Keep synthetic failure fixtures distinct from production account evidence.
5. Independently review, resolve confirmed P0/P1, deliver one linked PR, read back exact-head CI/merge, same-commit Production and default-account interactions, then mark Linear complete. A real delivery block retains In Progress and recoverable work.
