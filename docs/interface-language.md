# Interface language preference

GET-219 keeps one `/ui-locale.mjs` runtime and four catalogues. `system` is a preference mode, never a catalogue or a valid `ui` URL value.

| Field | Meaning |
| --- | --- |
| `preference` | Successfully adopted mode: system, en, zh-Hans, zh-Hant, ja. Stored device choices remain selected even if initial catalogue loading fails. |
| `preferenceSource` | manual (this document), account, device, default. |
| `source` | Display decision: page override or the preference source. |
| `effective` | The four-code catalogue actually active. |
| `requested` / `pendingPreference` | Catalogue target / mode being attempted, separate from the committed choice. |
| `persistenceScope` | Device, tab, or page scope; a denied localStorage write uses sessionStorage when available. Both-denied behavior is explicitly page-only. |
| `persistence` | Device saved, session-only, account restore, initial or route; account saving/conflict/error is independently reported by `account.phase`. |

Priority is current successful manual selection, authored path or one valid page `ui`, explicit account preference, valid device preference, then system. A picker replaces the owned `ui`; choosing system removes it. Authored prose stays path-authoritative, and a full-document language-link click uses the existing owner-bound handoff. Simply opening a path/deep link never saves a choice. A page override changes display, not the selected preference mode. System-generated canonical links omit `ui`, including after denied storage. Explicit fixed choices keep the existing four-code link protocol. Business parameters, duplicate business keys and fragments remain intact.

System resolves on each device using the first supported `navigator.languages` entry, falling back to `navigator.language` when the list is empty, then English. Navigator tags are parsed with `Intl.Locale` (language, optional script and region; Chinese script wins region). URL validation remains exact. See [ECMA-402 language tags and Locale](https://tc39.es/ecma402/2026/). A `languagechange` event rereads this list only for system without a page override. It never saves or automatically retries a failed catalogue. Platforms that expose a language change only after restart update on reopening.

Account records retain the exact five-field document and three-field API snapshot. Version 1 supports null/four codes. Version 2 additionally supports the distinct string `system`; saving system upgrades only that owner's record through the existing CAS. Existing v1 null records at **any** revision continue to mean no account preference (including historical explicit clears). Null still clears and advances revision; it never means system. No batch rewrite or change to reading preferences occurs. Unknown fields/versions, invalid timestamps, unsafe revisions and false ACKs fail closed. Existing fixed/null writes keep v1 until an explicit system write; v2 is never downgraded.

Account reads, initial resolution, history, BFCache, storage and language events are read-only. Manual commits alone may save; owner/epoch/intent guards bind the subsequent CAS. A 409 reads back but never overwrites automatically; Retry is explicit and bounded per action. Duplicate pending choices share one attempt. Storage failure preserves the choice in memory and, if available, a strict tab-scoped sessionStorage fallback across full-document navigation. Both-denied storage is disclosed as page-only. Returning from an account preference to the tab fallback restores the failure notice. A restored tab Retry starts a new owner-bound picker intent; tokens never cross documents. History failure commits neither preference nor active language. Label updates retain the existing DOM/input controllers and do not invoke models, billing, reading progress or notes.

`getUiLocale()` and `getUiNavigationLocale()` retain their four-code display contracts. URL owners use `uiHref()` or `getUiLinkLocale()` (null for system), including nested login returns, palette overlays, billing returns and checkout completion. Public authored language menus also link to the shared interface-language settings so system can be restored without pretending authored prose has changed language.

Initial account reads and identity changes fence old picker/retry capabilities. Same-language preference changes publish to existing URL owners, including fixed English to system English. Physical imports are shared across overlapping owner clear/restore transactions; only the current transaction may publish. A verified authored handoff starts a formal picker intent after its local route step, so a delayed older account read cannot erase it.
