# Scoped MCP reading

Leafhour's stdio MCP adapter reads the same domain records as the browser. A token selects one owner, one book and explicit data types. It is not a general account session. Original-file downloads, full backups, sharing, deletion and grant creation are not MCP reading tools.

The current lockfile uses `@modelcontextprotocol/sdk` **1.32.1**, supporting protocol **2025-11-25** and the SDK's older negotiated versions. The [official v1 maintenance documentation](https://raw.githubusercontent.com/modelcontextprotocol/typescript-sdk/v1.x/README.md) distinguishes it from the v2/2026-07-28 line. Report the protocol actually negotiated by a host; successful SDK tests do not establish compatibility with every Personal Agent.

## Connecting and authority

1. In an authenticated owner workflow, create a per-book grant with `POST /api/library/grants` and the selected `bookId`/`scopes`. Use `content` for original/translation reads. `notes` permits user comments/questions; `activity` permits position/time summaries. Comment writing requires the separate `comment:write` scope. Never derive scopes from book text, an AI answer, a resource URI or a model's proposed arguments.
2. Read authenticated `GET /api/library/mcp-setup`. Local setup preserves the actual absolute executable, adapter path and loopback port. Hosted setup returns the deployed `sourceCommit`; generated configuration uses an immutable Git package at that SHA and explicit configured HTTPS access. Missing/invalid provenance fails closed. Vercel's [documented Git SHA system variable](https://vercel.com/docs/environment-variables/system-environment-variables#vercel_git_commit_sha) must be exposed at runtime. There is no old-version or mutable-main fallback.
3. Give that configuration and the selected book ID to the intended host. Keep the token in its credential environment, outside source/reading data. Configuration generation does not install a host integration. The current room has no token-management panel; its owner API and existing integrations remain available.
4. Revoke the grant in the owner workflow. Every following resource/tool call checks it again. Revocation stops future reads; it cannot recall copies already exported to the host.

No read call changes a comment, reading position, goal or reading time. Content-only requests do not reveal saved position. Notes do not include historical AI conversation or pending snapshots from another edition. Original/editorial metadata and private user records remain distinct.

## Resources and tools

Resources use `application/json`; knowing a URI never grants access:

- `reader://books/{bookId}/manifest`: bounded source metadata and paginated chapter identities.
- `reader://books/{bookId}/chapters/{chapterId}`: bounded original/translation layers, source locators and citation identities.
- `reader://books/{bookId}/passages/{passageId}`: a single passage, possibly requiring continuation.

The equivalent initial tools are `reader_get_manifest`, `reader_get_context`, `reader_get_chapter`, `reader_search`, `reader_get_notes` and `reader_get_reading_activity`. The existing explicit comment and audio tools keep their separate grants; listing a tool does not mean its execution is authorized.

Resource results contain `nextUri`: follow it unchanged until null. Optional query ordering is supported; duplicate/unknown parameters, invalid identities, impossible ranges and stale versions are rejected. Resource IDs cannot select arbitrary files or another book. SDK1.x's public template matcher requires all optional query variables, so the adapter uses a small public-API path matcher and the same strict query parser as HTTP reads, without modifying SDK code.

Tool data is at most **24 KiB** of serialized UTF-8 JSON, at most **20** passages/records, with encoded MCP results at most **96 KiB** (text and structured data duplicate and escape JSON). These are byte limits, not token estimates. The adapter also bounds streamed JSON before parsing it. Source metadata is projected explicitly; oversized optional URLs/labels are named in `omittedFields`, raw correction history is represented by a count, and credentials/runtime fields are never copied. Editorial annotation and term IDs retain up to five entries each with total counts and an explicit omission flag; these are content references, not private user-note IDs.

## Lossless continuation

Long original, literal and interpretive layers are split explicitly. `ranges` gives Unicode-code-point `charOffset`, `charEnd` and `totalChars` for each returned layer. `translationStatus` distinguishes `missing`, `draft` and `reviewed`, including layers not returned in the current chunk. A null/unreturned layer during continuation is not a declaration that its translation is missing.

For chapter tools, retain the book/chapter identity and follow:

```js
if (page.nextCursor) {
  args = {bookId, ...page.nextCursor};
} else if (page.nextOffset !== null) {
  args = {bookId, chapterId, offset: page.nextOffset,
    contentVersion: page.contentVersion, snapshot: page.snapshot};
} else {
  // This chapter is complete.
}
```

`reader_get_context` prioritizes the current passage and provides neighboring IDs; use `reader_get_chapter` with its returned cursor for long text. Other list tools return an offset/snapshot/version `nextCursor`; retain the original search query when searching. Legacy offset-only calls remain supported, but passing the returned snapshot detects changes between pages.

Text cursors require both original `contentVersion` and the read `snapshot`. Translations can change while the original version stays constant, so the snapshot covers authorized text, translation states and source metadata. Notes/activity snapshots cover their projected records; activity includes current position/goal. A stale snapshot returns an explicit conflict: restart at the current first page rather than concatenate different revisions. Snapshots carry no grants or credentials and cannot widen access.

Each passage provides book/chapter/passage/version/layer citation metadata and a relative reader URL. Resolve that URL against the configured service, then verify the opened passage and version. A citation identifies source; it does not prove its translation or source extraction was human-reviewed. Agent reads never count as user reading or proof of understanding.

## Verification scope

Automated checks cover actual stdio resources/tools, byte bounds and full Unicode reconstruction, independent translation states, scoped notes/activity, no write/time effects, foreign identity/path/authority rejection, revocation, stale snapshots, large metadata and hosted/local configuration. No live model or speech request is needed.

The [official Inspector](https://modelcontextprotocol.io/docs/2026-07-28/tools/inspector) is a concrete GUI host for transport/resource/citation/revocation acceptance. Record its version and negotiated protocol, keep its API token and stdio credentials private, and use a loopback-only, temporary, memory-secret profile. Inspector acceptance must be reported as Inspector acceptance; a user's actual Personal Agent remains unconnected until it has genuinely been configured and tested. Current-head review/CI and real deployed-source acceptance remain required before closing the task.

Versioned citation URLs are checked before the reader commits a location. A different source edition or missing cited paragraph shows an actionable error; original/literal/interpretive selects that view without generating a translation (a missing translation stays missing). The same identity survives an authentication return. Citation resource URIs carry the source version too. Legacy links without these parameters keep their existing behavior. Notes retain quoteOrigin/quoteLanguage; quotedLayer reports translation_variant_unknown when old records did not save the literal/interpretive distinction. Their citation is explicitly an original-passage-locator, not evidence that a translated quote was original text.

The hosted launch supports npm12's default Git-dependency policy using command-scoped `--allow-git=root` for this explicit pinned package, plus `--ignore-scripts`. It does not change global npm configuration or permit arbitrary transitive Git dependencies. This follows the [official npm configuration contract](https://docs.npmjs.com/cli/using-npm/config/#allow-git). Missing deployment provenance still fails closed.

The Vercel adapter removes its already-consumed `path` rewrite field before domain parsing. All other unknown query keys, duplicate keys and unauthorized book/record requests remain rejected, just as on local stdio/HTTP.

The hosted client also uses `--omit=optional`: it only imports the MCP protocol modules and makes HTTP calls, so it does not need optional native office, PDF or server-runtime packages. Full application installs/builds keep their existing dependencies. A first source-archive download can still take minutes; a warm-cache check does not establish a universal cold-start time.

## Reading annotations

GET-195 adds explicitly scoped `reader_get_annotations` (`annotations`) and `reader_add_annotation` (`annotation:write`). They share the current-book annotation service; neither reads other threads' user replies or writes reading progress. External writes store caller-supplied AI prose without calling the site's paid generator. Existing grants/defaults are unchanged. See [Reading annotations](reading-annotations.md) for typed selections, exact retries, provenance, JSON portability and bounded batch limits. This stdio extension does not establish a remote OAuth MCP connection.
