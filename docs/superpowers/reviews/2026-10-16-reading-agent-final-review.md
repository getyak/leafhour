# Reading Agent final whole-branch review

Reviewed range: `192a4e3598713808ace28d54f7f18f67f74572e5..02771cd`. Date: 2026-10-16.

Final verdict at `e520fa8`: **PASS**. The single P1 from the initial whole-branch review is resolved by the scoped re-review below. No other actionable P0/P1/P2 finding was established across the reviewed domain tools, runtime/bridge, service integration, UI, and build/release changes. Subsequent main-branch integration and release verification remain separate gates.

## Initial P1 — Restrict continuation offsets to their paragraph and commit visibility only for successful results (resolved)

Location: `server/reading-agent-tools.mjs:48` and `server/reading-agent-tools.mjs:51` (reviewed commit `02771cd`; result handling at line 72).

On a chapter continuation request, `first` resets for subsequent paragraphs, but the `start` expression still applies `args.charOffset` to each subsequent paragraph's first layer. If the next paragraph is shorter than the continuation offset, the entire page returns `UNAVAILABLE`. If it is longer, its opening text is silently skipped. This breaks normal whole-chapter reading whenever a long paragraph is followed by another paragraph and its final continuation page has room to continue.

The same failure exposes a source-provenance defect: `remember()` mutates the shared visible-text ledger while the page is still being assembled. The discarded page's tail is therefore eligible for `reader_cite`, although that text was never returned to the Agent. Verification checks the current source hash, so it cannot distinguish this undisclosed tail from successfully returned text.

Independent offline reproduction executed against `02771cd`, without model calls or persistence:

1. Supply one chapter with `p1.original = 'x'.repeat(9000) + 'UNSEEN_TAIL'` and `p2.original = 'Second paragraph.'`, with empty translations.
2. Call `reader_read_chapter({bookId:'b',chapterId:'c'})`. The result has `nextCursor.charOffset = 6350`; its text does not contain `UNSEEN_TAIL`.
3. Pass the returned `nextCursor` directly to `reader_read_chapter`. Actual result: `{error:{code:'UNAVAILABLE',message:'无法读取这项资料'}}`.
4. Call `reader_cite({bookId:'b',passageId:'p1',quote:'UNSEEN_TAIL'})`. Actual result: an accepted source reference with `/read?book=b&passage=p1`.

Required correction: apply the character offset only to the named continuation paragraph and layer. Stage visibility changes until the complete tool result passes size/cancellation/activity handling; failed results must not add visible ranges. Preserve already successful ranges, and avoid rollback of unrelated concurrent successful calls. Cover short and long following paragraphs, original and translated-layer continuations, and an explicit failure after staging a page. Assert every continuation is successful and reconstructs text without omission, rather than merely checking that a tail can subsequently be cited. The existing Unicode-tail test can pass because it omits that success assertion.

The controller has resumed the domain-tool implementer for this correction. Uncommitted edits appearing during review are not included in this baseline verdict; a scoped re-review of the completed correction is required.

## Accepted design and verified review boundaries

The review used the authoritative design, implementation plan, public design review, integration verification record, all three task review reports, progress ledger, project instructions and prerequisite briefs. Prior fixes and rulings remain accepted: natural native `finalResponse` chat, no mandatory grading or citation for opinions, metadata-only location, six whole history pairs within the byte bound, current-account tools, a shared 0.75 CNY reservation default, refusal before dispatch instead of mutating frozen SDK controls, runtime revocation, monotonic polling receipts, and long-answer container scrolling. The separate original-echo implementation remains outside the new chat path.

The supplied evidence records a fresh serial suite at `e9b8c0c` with 614 total / 613 passed / zero failed or cancelled / one Linux-only skip, and a focused UI run at `02771cd` with 50/50 passed. Earlier two deadline-cancelled build tests were separately resolved by an isolated 2/2 run. Those results were inspected, not repeated. Actual official-SDK greeting, full Alice-chapter preference, cross-chapter, recommendation and native search evidence was supplied by the controller; this reviewer made no paid calls and does not claim independently repeated live acceptance.

The controller owns final browser checks, the completed-fix verification, any subsequent main-branch integration, final build and deployment/source-commit checks. This review makes no claim of merged, published or production-accepted status. Only this review document was edited by the reviewer; no implementation changes or commits were made.


## Scoped correction re-review — `02771cd..e520fa8`

Spec compliance: **PASS**. Code correctness: **PASS**. The initial P1 is closed; no additional actionable finding was established in this correction. This verdict covers the original reviewed branch plus `e520fa8`, not the subsequent unrelated main-branch merge.

The continuation offset now requires `i === offset`, so it applies only to the named paragraph's selected first layer. Following paragraphs begin at character zero. Page/context/search ranges, citation references and recommendation candidates are staged per invocation. They are committed only after the result-size bound, completed-activity persistence and final signal check succeed. Visible ranges are merged into a clone of the current committed ledger before replacement; a merge exception cannot partially publish ranges. The final clone/merge/replace and reference/candidate additions contain no asynchronous boundary, so another successful invocation is not discarded by a later failing or aborted invocation. Errors and cancellation exit without publishing staged evidence.

Reviewed the implementation report's RED reproductions and focused GREEN result of 19/19 tests, including completion-callback and oversized-result failures. That already-passing suite was not repeated. Independently executed a distinct no-network probe covering four complete Unicode reconstructions: long original or long literal translation, each followed by either a short or long next paragraph. Every page returned successfully and reconstructed both paragraphs' original/literal text exactly. A paused failing read was interleaved with a successful read of another book: the failed text remained uncitable while the successful concurrent text remained citable. Failed and synchronously aborted recommendation completion callbacks both left the recommendation ledger empty. All probes passed; no model requests, cloud data writes, broad tests or builds were performed.

Only this review document was updated. The controller's verification document and active main-branch integration were not altered.
