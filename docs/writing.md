# Writing Leafhour copy

Leafhour's voice is a quiet reading room: a bookseller who is brief, accurate and never flattering. Every visible line must answer one question: **why does the reader need this now?** If it cannot answer, delete it.

This is the GET-202 writing standard ([issue](https://linear.app/getyak/issue/GET-202)). The four-language catalogues live in `app/ui-catalogs/{en,zh-Hans,zh-Hant,ja}.mjs`; static page text lives in `app/**/*.html` and DOM-facing literals in `app/**/*.mjs`. The copy inventory (`docs/copy/`) and the lint guardrails below keep the standard enforceable — but the standard is the point, not the linter.

## Principles

1. **Every line earns its place.** If you cannot say why the reader needs it right now, delete it.
2. **Status is quiet by default.** Success states are a light "已保存" that disappears. Persistent status text only appears on errors, on decisions the reader must make, or where the reader explicitly asks (hover/tap/详情).
3. **Explain once, at the moment it matters.** Privacy and cost explanations appear before the action they describe, once, and stay retrievable in settings/privacy. Never as permanent page furniture.
4. **Verbs and concrete nouns.** 「下载备份」「点 译 看中文」, not 「可按需…」「支持…」「已配置的…」.
5. **Write what the reader can do and gets.** Not how the system works: no pipelines, queues, receipts, versions, IDs, model routing, sessions.
6. **Let the UI speak first.** An affordance, icon, position or state colour beats a sentence. If the interface already shows it, do not write it again.
7. **Errors: what happened (human words) → is my stuff safe → which button fixes it.** No apologies unless we broke something, no blame, no error codes outside a details drawer.
8. **One screen says one thing once.** The same time, limit or fact appears at most once per screen.
9. **Punctuation and tone (ZH):** full-width punctuation; 「你」 not 「您」; few dashes and ellipses; no exclamation marks; Arabic numerals; a space between Chinese and Latin text.
10. **Temperature comes from precise detail, not adjectives.** 「每晚 20:00，我在《存在与虚无》里给你留一张纸条」 is warm because it is specific. Empty warmth reads as machine output.

Research basis: GOV.UK *Writing for user interfaces*, NN/g *Error-Message Guidelines*, Google *Writing helpful error messages*, Material Design 3 *Global writing*, Shopify Polaris (archived) *Content fundamentals*, Elastic EUI error-message guidance, Atlassian content design, Apple HIG *Writing*, Mailchimp content style, Ant Design 文案规范. All agree: delete first, then make it concrete, and only then polish.

## Classification rubric (A–F)

| Class | Definition | Typical signals | Default handling |
| -- | -- | -- | -- |
| **A developer copy / system-state leak** | implementation state written for readers | 已提取、待校对、回执、请求、队列、同步、版本、会话、写入、校验、宿主、receipt、request、queue、sync、session、commit | delete, or hide behind hover/详情; human words only on errors |
| **B privacy/technical note at the wrong moment** | correct information, wrong position or frequency | permanent 「只发送……」「仅保存在本机」 | move to the first time the action happens, once; retrievable in settings/privacy |
| **C AI flavour** | formulaic warmth, empty rhetoric, repetition | the banned lists below | delete first; if it must stay, make it concrete |
| **D redundant explanation** | the UI already says it | 「点击…可…」「Esc 关闭浮层」 | delete, or replace with an affordance/tooltip |
| **E terminology** | words the reader does not know | ZIP, JSON, MiB, stable ID, SHA-256, 宿主, Agent, 云模型, 双译, 草稿, MCP, OCR | replace with human words; keep technical terms only inside deliberately opened 详情/高级 |
| **F cross-language inconsistency** | meaning/tone/length drift, missing translations, hardcoding | key missing, English left inside ZH/JA copy, JA that is a literal ZH translation | rewrite per language around the same meaning; never word-by-word translation |

One sentence can belong to several classes; process in the order **A/B > E > D > C > F**.

## Banned and watched lists (T1/T2/T3)

The enforced token lists live in `.vale/styles/Leafhour/*.yml` (EN + zh-Hans + zh-Hant) and `.textlint/prh.yml` (JA), taken from the GET-202 issue lists.

- **T1 — fix immediately.** Developer words (回执/请求/队列/同步/会话/提交/校验/版本/稳定 ID/宿主/实例/云模型/双译/AI 草稿/字节/MiB and the EN/JA equivalents), formulaic sentences (不是 X 而是 Y, 先…再…, it's not X it's Y, 〜することができます, 〜となっております), marketing diction (赋能、无缝、沉浸式、delve、seamless、unlock、journey、シームレス…). T1 fails the lint.
- **T2 — fix when repeated in the same passage.** 安静、慢慢、轻轻、陪、留、纸条、仍保留、可以重试、暂时无法; quiet, gently, moment, simply, just, easily; そっと/静かに (JA, when duplicated). Punctuation ——、…、！ outside loading states. T2 stays a visible warning: repetition and loading context are human judgements a token rule cannot make.
- **T3 — judge by site-wide density.** No rule; review in batches.

Frequency-dependent items stay manual review on purpose. Do not "fix" the linter by rewording protected facts or by weakening a rule.

## Truthful error wording

Routine coverage and usage explanations do not belong between a chapter title and its text, including inside a collapsed panel. Show short sample coverage in book details and put provenance in explicitly opened source/translation details. Derive review status and authorship from the actual saved variants, including personal overrides of public samples. Keep missing-translation labels at the affected passage and sending scope beside the generation action. Progress, failures, unconfirmed outcomes, unsaved drafts and changing prices remain visible when relevant; a previous consent never substitutes for a necessary new price decision.

- A transport failure does not prove the server failed to save. Say that save confirmation was unavailable and keep the known local draft; never claim "nothing was saved" as fact.
- Claim a file/record is safe only when the relevant local or server fact is established.
- A source marked unreviewed must not become "reviewed" through a quieter badge.
- "AI translation" may replace internal two-draft jargon, but it must not imply a human checked it, and it must not collapse literal and interpretive drafts into one.
- Model/provider/cost facts stay discoverable before the related action. Deleting privacy facts to make the lint happy is a bug.

## Protected source material

Book titles, authors, quotations, pathnames, URLs, sample English text, numeric limits and legal facts are protected: they are preserved exactly and never rewritten by copy work. The inventory labels such rows `protected` with the matched reason (`docs/copy/copy-candidates.csv`, `docs/copy/copy-inventory.json`). Protection is a rewrite guard, not lint immunity: if protected text produces an alert, it is reported and reviewed like anything else.

## Multilingual meaning parity

- Four locales: `en`, `zh-Hans`, `zh-Hant`, `ja`. The key sets must match exactly; missing keys are a parity failure, not a fallback.
- Decide the meaning once (usually from the ZH original), then write each language in its own idiom. Do not translate word by word.
- Authoritative source text, catalogue keys and sample English are data: machine translation and "polish" passes must not touch them.
- The inventory records per-item values and source locations for all four locales; the export (`build/copy/<locale>.txt`) is the lint corpus and must stay byte-exact.

## Guardrails: how copy is checked

1. `node scripts/export-copy.mjs --root . --out build/copy` rebuilds `docs/copy/copy-inventory.{json,csv}`, `docs/copy/copy-candidates.csv` and the per-locale corpus plus `build/copy/manifest.json` (every emitted line maps to one item id, locale, kind and value SHA256). Two runs are byte-identical; the tracked artifacts bind scanned input bytes (SHA256 per file) and never embed the executing commit, so an unrelated commit cannot change them. The export refuses wrong declared hashes, parity gaps, duplicate ids and empty corpora.
2. `node tools/copy-lint.mjs --manifest build/copy/manifest.json` runs the real pinned CLIs — Vale 3.24.0 for EN/ZH/Hant (`.vale.ini`, `.vale/styles/Leafhour/*`) and textlint 15.8.0 with the official JA technical-writing preset and prh for JA (`.textlintrc.json`, `.textlint/prh.yml`). The preset's 23 rules are configured one by one at explicit warning severity because the preset-level severity does not propagate, and prh is locked at error severity so a configuration downgrade cannot silently unblock JA T1.
3. Before any debt or exception matching, every item's exact bytes are recomputed from its line range and compared with the manifest declaration, and every alert is bound by normalized file + locale + line range: changed bytes or a second file can never borrow a documented binding. Structurally valid but empty tool results, inconsistent exit/alert pairs, missing/duplicate/unrequested file results and invalid severities all fail closed.
4. Result classes: **new T1** fails the run; **warnings** stay visible; **existing debt** stays visible and separately counted; **justified exceptions** are narrow and reasoned. Missing tool, missing config, unknown/missing preset rules, empty corpus, unsupported locale or malformed tool output all fail closed.
5. `node tools/copy-canaries.mjs` replants real T1/warning/clean/exception/changed-value/prh-downgrade cases through the real CLIs, so an empty or mis-scoped rule — or a silently downgraded severity — cannot look healthy.

### Existing debt versus justified exceptions

- `tools/copy-lint-debt.json` is the **frozen existing-debt baseline** found at the accepted GET-201 source. Each entry binds one item, locale, rule and the exact value SHA256 that existed at the frozen revision, and is labelled `existing-debt` / `unreviewed`. It is not a justification and never becomes one.
- `tools/copy-lint-allowances.json` holds **narrow justified exceptions**: exact item + locale + rule + value hash + a concrete reader-facing reason and where it was reviewed. No page-wide or namespace-wide bypasses exist.
- A changed value loses its binding immediately (the hash no longer matches) and the lint fails for re-review. An entry that matches nothing any more is reported as stale and fails until it is pruned. Maintenance is manual editing only — there is deliberately no regeneration command, and the frozen-revision binding rejects any attempt to add newly worded text to the baseline.

## Source and context evidence rules

- Regex/AST discovery is only candidate discovery. It never proves text is unused, actually visible, human-reviewed or completely covered. Global HTML coverage is not complete.
- Every inventory row keeps its `file:line:column` source reference, a unique stable identity and an explicit `unreviewed`/`unknown` review state. Context hints (key namespace, DOM property, HTML attribute) carry a confidence and evidence string; the final surface/trigger/classification require an explicit source-bound decision. Agent decisions say `by: agent` and never count as human or native-language review.
- A hardcoded literal joins the lint corpus only through an explicit, source-bound adjudication in `docs/copy/copy-reviewed.json` (exact candidate id + original value SHA256 + source SHA256 + locale + `by: agent` + surface + trigger + concrete rationale + `state: reviewed`). Stale, unknown, duplicate or incomplete decisions fail the export; protected source material (quotes, paths, URLs, author text) and unknown candidates can never become reviewed rows or waivers automatically. The current bounded supplement admits three source-inspected English navigation labels; every other candidate stays unknown.
- Dynamic/computed references stay recorded as unresolved evidence with their literal fragments; they are never reported as "unused".
- Duplicate keys are recorded at every source location; the export refuses to run until they are resolved.

## Current bounded source audit

`docs/copy/copy-ledger.json` connects only the 23 catalogue keys / 92 locale decisions already delivered in GET-218 to the generated inventory. Each decision binds key, locale, canonical source, actual value hash, historical evidence record hash, current consumer locations and inspected context-file hashes. Copy, locale, evidence or context drift reopens unknown; unchanged wording cannot preserve a changed trigger. All four locale decisions must remain valid for the key to count as agent-reviewed. This does not grant a lint allowance, assert visible exposure for an unresolved retained key, or claim native-speaker approval. The separate 19 structural decisions preserve verified historical evidence and explicit **current unknown** states; they never inflate catalogue counts.

The denominator and unknown remainder come from the current scan, including new keys and consumers. The GET-218 audit baseline has 2221 keys: 23 agent-reviewed / 2198 unreviewed; 92 reviewed / 8792 unreviewed locale values. Three English navigation literals join lint; 4860 of 4863 candidates remain unknown, including 132 protected-source candidates. These are the 556076d source snapshot, not constants or a claim about a later integrated tree. `scripts/export-copy.mjs` derives current totals every time. See the [canonical scope matrix](verification/2026-10-27-get-202-copy-ledger.md) for verified and unknown work, and `docs/copy/README.md` for re-review.

## Still unfinished (GET-202 remains open)

- The full per-item audit and four-language rewrite has not happened. Only the bounded GET-218 source decisions and three navigation literals above have been admitted; the generated remainder stays unreviewed/unknown. Global HTML discovery and real visibility coverage remain incomplete.
- GET-218 already has scoped contextual browser evidence, linked in its verification record; this batch reuses that history and does not re-run or extend it. Site-wide before/after coverage, five-second non-technical-reader studies, read-aloud/portability tests and native ZH/EN/JA review (including Hant consistency) remain unknown. Agent decisions cannot substitute for them.
- GET-218 delivered the quiet chapter heading and source/translation details; existing click/Enter passage selection exposes its action. A dedicated hover affordance is not established by this source audit. First-use owner/book/version privacy confirmation is a separate concurrent supplement and remains pending in this ledger baseline; no acceptance is borrowed from its in-progress work.
- Frequency-dependent T2 items (repetition on one screen, loading-context ellipses, JA そっと/静かに) stay manual review by design.
- PRH replacement suggestions in `.textlint/prh.yml` are provisional guardrail guidance (deletion-first per the issue); native Japanese review of final wording is pending.
- `.github/workflows/ci.yml` installs the pinned CLIs, exports/checks tracked outputs, runs real lint/canaries and then the full suite. The test driver forwards only the two explicit tool paths to tests; runtime builders retain their restricted environment. Main Production verification waits for this CI workflow at the same commit. Vercel Git deployment may start independently; all applicable PR checks must pass before merge, and exact Production acceptance remains a separate requirement. Local runs without installed CLIs explicitly mark those cases skipped; a skip is not a real-CLI pass.
