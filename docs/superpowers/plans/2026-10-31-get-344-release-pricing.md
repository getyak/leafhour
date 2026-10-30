# GET-344 release pricing guard repair

The first PR CI identified two direct integration omissions: domain tests named `ios-*` entered the dependency-free iOS contract job, and the generated copy inventory did not match the new server fields. The domain tests now use `library-native-*`; the iOS contract suite passes with no `node_modules` directory.

A full local host attempt also exposed the existing pricing publication window: the recorded references ended at `2026-10-31T16:00:00Z`, leaving less than the required 24 hours at release. The official [CNY](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/) and [USD](https://api-docs.deepseek.com/quick_start/pricing/) pages were checked again. Token rates are unchanged. Search and Fetch each cost ¥5/$0.75 per 1,000 successful requests; the Harness free-tool cutoff remains November 1, 2026 at 00:00 CST.

## Invariants

- Preserve the legacy ¥0.75 reservation ceiling, eight-request and 24-tool limits, 3,072/1,024 main/auxiliary output limits, and the USD reservation path.
- Reserve the standalone ¥0.005 Search fee for every admitted legacy auxiliary request, even during the promotion. Domain tools do not acquire a web fee.
- Use integer micro-CNY for atomic admission; an unaffordable request changes neither request count nor reserved cost and never reaches HTTP dispatch.
- The pinned auxiliary adapter admits one `web_search_20250305` tool with `max_uses:1`, the fixed model and output limit, no Fetch and no internal retry. Reject shape changes before dispatch.
- Do not move the free-tool cutoff, relax expiry, alter customer point prices or make real paid calls. References remain valid for at most seven days and a release still needs at least 24 hours remaining.

## Implementation and evidence

The legacy budget now includes the standalone tool fee inside the existing ceiling. The publication check requires verified tool-fee reservation metadata instead of assuming the legacy route must stop at the free promotion boundary. Both official response hashes/byte lengths and the actual observation time are recorded in `harness/pricing-verification.json`.

Two new fee regressions failed before implementation and passed after repair. The focused pricing, chat-runtime, actual pinned search-adapter and native-library domain group passes **68 tests**. It covers the promotion boundary, invalid/missing rates, atomic refusal, shared main/auxiliary budget, a single admitted Search request and zero HTTP dispatch when the fee is unaffordable. The official-source hash check also passes; these are reservations, not invoices.

The broad local host attempt was not recorded as a full acceptance pass: it used the reusable dependency link, lacked native PostgreSQL and encountered incomplete SDK/runtime packaging prerequisites. Its pricing-window failure prompted this repair. Required clean Linux dependency/runtime and native PostgreSQL verification remain remote CI gates; the 217 affected host checks and native acceptance in the main GET-344 record remain separately identified.
