# GET-164 implementation plan

1. Add regression tests for an ID-only provider response selecting a later complete sentence, exact Unicode source offsets, bounded candidate construction and failure recovery. Observe failures before implementation.
2. Implement local candidate construction and strict response resolution in `server/gift-quote.mjs`; keep existing full-book and submitted-pool validation. Adapt only built-in-provider fixtures to the new protocol, preserving injected-generator and legacy receipt tests.
3. Add whitelisted, non-sensitive diagnostic categories and connect hosted portal logging. Test containment and absence of source, keys, receipts or raw exception text.
4. Run focused quotation, composition and gift tests plus release policy. Record actual checks and limits in a verification note. Do not run paid models, publish gifts or mark the issue complete.
5. Parent performs independent review, applicable full verification, normal main synchronization, current-head CI/deployment and production acceptance before merge/Linear closure.
