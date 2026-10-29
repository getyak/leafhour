# GET-312 independent first review

Reviewed the working tree in `/Users/cubxxw/.codex/worktrees/ios-connected-reader/leafhour` against `origin/main` starting at `44f3836`, including the design/plan, application and core changes, tests, and the owning server APIs. This report reflects the source at review time; workers may already be repairing these findings. No code was edited, no build/simulator was started, and no real account/provider request was made. Reproduction sequences below are deterministic source-level scenarios, not claims of executed device acceptance. The controller separately reported 72 passing host tests; these do not exercise the interleavings below.

## Findings

### 1. [P1] A pull can overwrite records saved after the reader opens

**Location:** `apps/ios/LeafhourCore/Sources/LeafhourCore/CloudBookSync.swift:187-188` (also `:120-121`, `apps/ios/Leafhour/LeafhourApp.swift:139` and `:243-247`).

`pull` is a value captured when synchronization starts. The comment that no reader owns this book is not enforced for the lifetime of the operation. LibraryModel allows opening the book while a pull is suspended; the second `synchronize` returns immediately because `running` contains the ID, so `open` constructs a ReaderSession from the pre-pull state. The first pull later writes its copied `state` wholesale. Example: start a shelf synchronization with a remote note and a pending local note/progress; delay its POST after the state snapshot, open the book, save another note/draft, then finish the POST. Line 188 overwrites the newly saved local record. Conversely, a reader created before the pull completes can overwrite the pulled notes on its next save. This violates the local-first durable outbox requirement and can lose unsynchronized content.

**Repair:** Make callers join the same in-flight operation before reading the initial reader state, and prevent a pull from committing a stale snapshot when a reader owns the book. Use an atomic revision/merge or a book-level ownership mechanism, not only a one-time `reader == nil` test. Add a delayed-response test with a concurrent local save.

### 2. [P1] Opening a book can publish the old account's reader after sign-out

**Location:** `apps/ios/Leafhour/LeafhourApp.swift:241-247`, especially `:243-247`.

The owner check occurs before the network suspension. `open` does not capture/recheck `contextID`, and its synchronization error is ignored with `try?`. Repro: with account A, tap a downloaded cloud book while `/records` is slow; before the reader is presented, open the account sheet and sign out. `reader` remains nil and `busy` remains false during this open, so sign-out is allowed (direct `open` synchronization does not set `model.syncing`). Sign-out clears account A and changes the cloud generation. The old request fails its generation fence, but `open` swallows that error, reads A's old captured library, and assigns A's ReaderSession after logout. This exposes the prior account's book and personal records despite the intended namespace isolation.

**Repair:** Capture the account/context/library/sync together at entry, and fence every resumed operation, especially immediately before publishing the reader; alternatively hold a model-level open/account-transition state. Cancellation/account-changed errors must not turn into successful opens. Test logout while a delayed open is in progress.

### 3. [P2] One oversized local note permanently blocks the book's later sync

**Location:** `apps/ios/LeafhourCore/Sources/LeafhourCore/CloudBookSync.swift:160-165`.

Native NoteEditorPanel and ReaderSession accept arbitrary nonempty note bodies, but the owning server `server/library-service.mjs:473-475` rejects `input.text.length > 2000` (UTF-16 units). A 2,001-character note saves successfully locally, then always receives HTTP 400 here. The exception aborts the entire loop before later notes and progress, and the same oldest note is retried on every sync; there is no native saved-note edit/delete path to remove the blocker. The result is a permanently stalled book outbox after a valid local operation, not merely one note remaining local.

**Repair:** Surface the cloud note limit before submission while preserving the local draft/content; isolate per-note permanent failures so unrelated notes and progress continue. Give the user a way to resolve an unsyncable saved note and test the exact server boundary.

### 4. [P2] Rendered Markdown selections cannot be used for discussion across formatting

**Location:** `apps/ios/Leafhour/ReaderCloudTools.swift:144-154`, especially `:149-151`; selection producer: `apps/ios/Leafhour/TextReadingView.swift:208-213`.

The selection producer stores the rendered text plus its source start offset. `prepare` then assumes that rendered selection is a contiguous exact substring of the Markdown source. For source `A **bold** thought`, selecting the displayed `A bold thought` and invoking “问陪读” always fails the equality check with “所选文字已变化”, despite no change. The same happens for selections crossing a link, escaped text, or decoded HTML entity. This defeats an explicitly offered tool on common Markdown selections. The server correctly requires exact source text and UTF-16 boundaries (`app/reading-chat-quote.mjs`), so weakening the check is not sufficient.

**Repair:** Retain mapped source start/end information when producing the selection and construct the server quote from the exact corresponding source substring, keeping displayed selection separate. Cover cross-emphasis and decoded-entity selections, not only unformatted Unicode.

### 5. [P2] A completed text selection keeps subsequent tools pinned to the old paragraph

**Location:** `apps/ios/Leafhour/ReaderScreen.swift:40-41` and `:99`; consumer: `apps/ios/Leafhour/ReaderCloudTools.swift:53-56`.

The new Translate/Discuss selection actions assign `session.selection`, but dismissing the sheet only changes chrome and ordinary text scrolling never clears that stored selection. `currentPassage` always prefers this value while the chapter is unchanged. Repro: select paragraph A, open its translation, dismiss, scroll to paragraph B in the same chapter, then use the bottom toolbar to translate/discuss. It still shows and can submit A. The same persistent selection also disables toolbar auto-hide because `sleepChrome` requires nil selection. A new chapter clears the value, but ordinary within-chapter reading does not.

**Repair:** Give a selected-quote invocation an explicit scoped lifetime; clear it when that tool closes or when the active selection/navigation changes, and have the generic toolbar use the current reading anchor. Test selection → dismiss → scroll within the same chapter → toolbar tool.

### 6. [P2] A definitively rejected generation request locks out new requests

**Location:** `apps/ios/Leafhour/ReaderCloudTools.swift:220-222`; coupled guard `:135`.

`perform` retains `retry` for every error, and `prepare` refuses any new action while `retry` exists. A deterministic rejection therefore has no recovery in the open reader. For example, load the conversation, change the chat scope on Web, then submit the stale native scopeRevision: the server returns 412 (`app/reading-chat-scope.mjs`). Refreshing the conversation updates the scope but does not clear/rebuild the retry body, so every retry sends the same stale revision and every new question/translation is blocked. Expired quotes or a rejected Chinese-to-Chinese translation similarly trap the shared tool model. There is no “abandon this request” action; only closing the entire reader recreates it.

**Repair:** Preserve exact identities only for genuinely uncertain/in-flight results; classify known pre-execution refusals and allow explicit retry preparation with fresh scope/quote, keeping the question intact. Provide an explicit abandon/recover path that does not silently repeat a possibly charged operation. Test 412 recovery after refreshing scope.

## Other reviewed boundaries

The isolated URLSession/cookie jar, generation checks inside CloudLibraryClient, explicit owner headers, Keychain accessibility, private account roots, and same-origin/nonpersistent WKWebView policy are directionally sound. The account leak above is in the model publication step after those client checks, not a claim that the HTTP generation fence itself fails. Cloud reads keep text copies separately labeled and retain local integrity manifests; multipart downloads validate lengths and SHA-256. Markdown retains source identities and maps displayed positions instead of rewriting existing passages. The new parser provenance documentation names a pinned upstream tag and preserves license notices; no network comparison of vendored blobs was performed by this reviewer. No further P0/P1 was established in those areas during this pass.

The bundle identifier indirection described by the controller preserves the default app identifier; source changes enabling an isolated test bundle are appropriate. This review does not establish signing, production account login, TestFlight distribution, physical-device behavior, or paid-provider acceptance.
