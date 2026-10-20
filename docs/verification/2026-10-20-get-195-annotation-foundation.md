# GET-195 annotation foundation checkpoint

This is a pure archive-model checkpoint, not a deployed annotation feature. No server/UI/MCP integration or product generation is accepted by this document.

The model keeps stable selected-text snapshots, independent user/AI messages and provenance, revisioned immutable operations, deletion tombstones and non-destructive restore merges. Its format/limits and remaining integration plan are in [`_briefs/reader-annotation-implementation.md`](../../_briefs/reader-annotation-implementation.md).

Independent first review found1P1 and5P2 despite15 original tests passing. Repair1 closed all six: field array limits precede allocation; historical options reject accessors/unknown shapes; explicit timestamps validate even on retries; checked revision increments; ISO/calendar validation; and merge ordering changes increment revision exactly once. No unresolved P0/P1/P2 remain in this two-file scope.

Final actual verification:21 model tests passed;8 unchanged independent counterexamples passed;28 existing typed-quote tests passed. Root reran the21+28 suite:49 passed,0 failed,0 skipped. Synthetic source/translation fixtures only; no network, real account/book or model call. The independent malformed-array probe intercepted attempted giant allocation instead of consuming unbounded memory.

Frozen SHA256:

- `app/reader-annotation-records.mjs`: `faa9738f285d12de8f066fdec4222d1cd7bafdbab97a1337c3fa30e19f162465`
- `tests/reader-annotation-records.test.mjs`: `a55a8210e39a9dfe03aaae14b4d04c8b252feef964949110195d7b2c1598706e`
- Independent final report: `d3251e0af3de756e45eac121377b166c251e70e03483df0c41873bbd594f8911`

The next backend batch must prove shared-CAS publication/cancellation/source-mutation ordering, not infer it from the pure model tests. CI/PR/merge/Production and the complete reader journey remain pending for GET-195.

## Historical citation contract correction

A later independent counterexample found a parent contract defect: after editing a cited translation, historical validation rejected old message source references and blocked unrelated archive operations. The implementation matched the earlier contract; that contract was too strict for saved historical content.

The corrected historical path preserves bounded, well-formed excerpt snapshots and actual passage ownership without claiming a current substring match. New message references and selected-text anchors still require current-source verification. No JSON shape changes, rewritten AI words, deleted references or regenerated answers are involved.

Actual regression:25 model plus28 quote tests passed (53 total,0 failed,0 skipped); six separate independent counterexamples passed, including edited/removed translations, strict new references, stale anchors, structural bounds and tombstone restore. Scoped independent review closed the P1 without new findings. These results do not establish service/CAS/ACK behavior, which remains a backend integration gate.

Corrected model SHA256 `b602cd8668301994e3bec7af198f152b6242cc427f48e4599d5e1807efc04c33`; tests `bab7865387a85434eb0bb00d1b431651d49d2b1ee1732ae0583f50c8143d4c99`; independent fix report `98014bdece3b0d73223e6515a921c11a201077dcf92a2d72484556f7d9e2c5f5`. Earlier checkpoint hashes above remain historical evidence.
