# Monthly subscription only — 2026-10-22

The sole current offer is US$5 per month. Each successful payment grants 100 reading points. Points accumulate without expiry; cancelling stops future renewals and preserves delivered points. Reading questions and selected-text explanations cost 4 points per completed answer; a paragraph's independently saved literal and interpretive Chinese translations cost 1 point.

The pricing page introduces these three AI benefits alongside the offer. A separate section explains that reading, personal notes, saved results, layout settings, export and self-hosting remain free. English, Simplified Chinese, Traditional Chinese and Japanese are interface languages; newly generated translations currently target Chinese. The page does not promise unlimited AI or four translation targets. Pricing, account billing, terms, refunds, privacy and operator configuration use the same monthly policy.

## Payment boundaries

- The catalog and new checkout accept only `reading_monthly_100`; retired `reading_100` requests fail before a supplier request or order mutation.
- Subscription readiness requires the schema-v2 store and the verified recurring US$5 monthly product. Setup no longer requires or creates a one-time product.
- Historical purchases, point grants, receipts, refunds, disputes and reconciliation retain their original facts. Historical fulfillment uses the saved product binding and signed payment evidence even after the retired sale configuration disappears.
- Public historical order views omit resumable checkout URLs for retired products. Raw records remain intact, and monthly checkout URLs remain usable.
- No real account data, provider charge, merchant configuration or billing activation was performed. Billing availability must still pass the existing production readiness gates.

## Verification

- Full local verification: 3,162 tests, 3,161 passed, one platform-only skip, zero failures. Isolated runtime initialized 928 files without model requests; hosted build checked 404 files and 11 registered media assets; release allowlist checked 863 software files.
- Focused backend verification: 84 passed, including retired-checkout rejection, historical reconciliation, public order URL filtering and monthly URL preservation.
- Focused pricing/account verification: 45 passed. Setup verification: seven passed.
- After the final privacy wording and October 22 date update: 18 affected build, locale and discovery tests passed.
- Copy export, actual pinned Vale/textlint checks and the real-CLI negative canaries passed; canonical generated inventories are included.
- Independent policy/backend/UI review found no remaining blockers.
- An isolated local server with temporary storage and disabled providers was checked in a real browser. Desktop pricing and the full page showed one offer and the stated benefits. English at 320 px and Chinese at 390 px had one monthly product and no horizontal overflow. No browser errors were observed.

Screenshots: [desktop](2026-10-22-monthly-subscription-only/pricing-desktop.png), [full page](2026-10-22-monthly-subscription-only/pricing-full.png), [English at 320 px](2026-10-22-monthly-subscription-only/pricing-en-320.png), [Chinese at 390 px](2026-10-22-monthly-subscription-only/pricing-zh-390.png).

These are local implementation and browser results. Merge, automatic Production publication and same-commit live acceptance are recorded separately on the pull request after they finish.
