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
