# GET-192 optional listening controller boundary

This narrowly amends the GET-192 external module graph. The initial JavaScript
limit remains **327680 bytes** and CSS remains **204800 bytes**. Existing lazy
module permissions, six locale catalogue imports, data contracts, payment intent,
source text, and the approved scene guards are unchanged.

## Public graph and ownership

The compiled `reader-audio-bootstrap.mjs` imports exactly
`./reader-audio.js` on genuine listening intent or an existing authorized resume
marker. One **explicit** retry may import `./reader-audio.js?retry=1`; both URLs
use the same release file. No automatic retry, additional query, alias, hash,
static/require edge, alternative caller, or server/pure entry is authorized.
The source audit checks the external controller's complete transitive graph as
well as the compiler graph. Its only stateful public dependency is the existing
physical `/ui-locale.mjs`. Pure dependencies are release-backed. The controller
must not import `reader-api.mjs` or `reader-navigation.mjs`.

The eager owner receives the existing API/session/storage and navigation handles.
It retains the seven real controls and owns the single file input. Importing the
controller is definition-only. `mountReaderAudio` is a per-document single flight
with one `ready` promise, explicit action dispatcher, and idempotent disposal.
Partial mounting rolls back DOM, observers, locale ownership, and listeners.
The bootstrap dispatches a real pagehide event synchronously to the controller
before invalidation; the controller deduplicates that event. This preserves final
position saving and pause. Persisted Back restores a live owner; interrupted
metadata/mounts can restart without publishing the old result.

## Intent, restoration, and metadata

At a genuine gesture the bootstrap captures owner, reader identity, book,
contentVersion, selection generation, parts, language, and variant. It uses these
snapshots directly after code and boot readiness; it never synthesizes a click or
requires a second click. Reader selection/ready/session events invalidate pending
intents, including ABA transitions. Locale events only format cached semantic UI.
A different overlay opened while loading retains focus and its close behavior.
Loading/error/cancel/retry/manual reload use a nonmodal owned surface. Canceling
loading does not cancel an already authorized server task.

The file picker is invoked synchronously within the real button activation,
including the existing records-panel entry. Change captures the File under the
same gesture identity. The mounted owner retains the original 32 MiB limit and
`validate -> import -> GET preferences -> save preferences -> records` sequence.
Every await is checked before the next stage. A module retry does not consume or
repeat successful business stages. The input is cleared in the finalizer.

Only the current owner/book's existing three scoped keys can cause automatic
loading: `leafhour-guide-job-v1`, `leafhour-guide-request-v1`, and
`marginalia-audio-position-v1`. Preferences alone do not initialize media.
Restoration retains the old priority and fallthrough: job, then an authorized
pending request with its original idempotency key/payload, then saved position.
Invalid/malformed marker behavior does not escalate into a new intent. A failed
module load preserves markers and provides local retry/cancel without opening a
dialog. Restoration does not make a UUID or autoplay the restored position/guide.
An existing task GET **can resume provider work**; these are existing authorized
tasks, not a guarantee of zero provider work. Verification uses synthetic tasks.

A small eager read-only metadata owner shares the original capabilities and
preferences requests and request condition, using the same API/session instance.
The resulting promise is injected into the controller, which does not refetch it.
Real voice names, speed and follow preference appear without media intent.
Failure is visibly unavailable instead of permanently advertising default values.
Capabilities failure preserves the prior skip-restoration branch; preference
failure keeps local preferences and the prior restoration behavior. There is no
background retry/backoff, preference save, polling, or generation in this owner.
Only a new valid reader lifecycle may start a new metadata promise. Locale
publication never rereads metadata. On successful controller readiness the eager
summary binding relinquishes ownership to the mounted preferences UI.

## Acceptance and evidence boundary

The implementation has production-module tests for first actions, snapshots,
finite retry, file stages, metadata, restore traces, cancellation, partial mounts,
BFCache and exact source graph. The original five scene guard/handler functions
remain byte-identical. The prior 58 scene counterexamples retain their assertions.
See [implementation evidence](../../verification/2026-10-20-get-192-audio-boundary.md).
Native browser activation, import 503 recovery, focus/selection, visual states,
independent review, final integrated build, CI, Production, and live acceptance
remain separate parent delivery gates. Source graph byte counts are not measured
network transfer, cache behavior, or first-action latency.


## Independent review repair: initialization, selection and modal ownership

Cancellation disposes a controller that is still awaiting `ready`, so its existing
post-await scope/disposal fences stop deferred metadata and restore stages. It
never sends a server cancel for local initialization. A ready playback owner is
retained. A new valid entry can share an in-flight initialization without a gap,
and an explicit later entry can remount cached code after cancellation using the
unchanged original restore marker and payload.

The bootstrap observes the reader's real `reader:selection-end`. Only the
committed dispatcher's synchronous `dismissTools()` preserves that entry's
selection generation; later independent selection-end events invalidate awaited
results normally. This also refreshes the cached Read/Read selection label.

Loading and recovery controls move into the originating modal's subtree, with a
sticky, scrollable surface inside that modal. The bootstrap remembers the entry
focus and restores it on local cancellation only while focus remains in its own
surface and the original set of open dialogs still owns the operation. A newly
opened modal prevents old loader results from taking focus or publishing errors.
The same close handling applies to the dynamically mounted records dialog and
its file-picker entry. Background restoration does not move focus.

Viewport clearance and follow visibility read the current injected window height
at each calculation. Export results and errors require the originating panel
revision and current intent before download or UI publication. The release list
includes the low-level fixture actually imported by the newly selected tests;
unrelated previously unselected tests remain outside the release list.


## R7 scope ruling: recovery controls are a reader interaction boundary

The parent explicitly extended the original `reader.js` scope restriction for
this repair: add only `#audio-bootstrap-status` to the real reader's existing
click, pointerup, selection-keyup and relevant keydown exclusions. The nonmodal
recovery surface belongs to the audio action; its Retry, Cancel and Reload must
not dismiss or recapture the underlying reading selection, or invoke reader
fullscreen/Escape shortcuts. The exclusion matches descendants through `closest`
and applies only to this surface. No document-wide propagation is stopped.

Independent `reader:selection-end` still invalidates the pending source intent,
and a committed action retains only its existing synchronous own-dismissal
exception. Outside clicks and ordinary reader pointer/keyboard handling remain
active. The fixed base-plus-one-retry graph, immutable input, file activation,
restore, metadata and modal-ownership contracts are unchanged.


## Native acceptance follow-up: built-in voice UI descriptors

The existing pure metadata module also provides `audioVoiceUi`. It returns a
cached-label-compatible UI descriptor only when a voice ID and field value
exactly match one of the four built-in `server/media-config.mjs` label or
description pairs. Matching is per field; an unknown ID or customized field
value remains literal. No capability object, voice ID, preference or default is
rewritten. Eight `audio.voice.<ID>.label/description` data entries per catalogue
cover Sulafat, Charon, Puck and Kore.

Both eager summary and mounted summary/player metadata/native voice options/
description feed these descriptors into their existing nested label formatter.
Locale publication only formats retained descriptors; it neither re-reads
capabilities nor saves preferences, changes native selection, calls APIs or
starts playback. The raw controller now imports the existing pure metadata
module, so only that exact file is added to `AUDIO_PUBLIC_FILES`. Existing
release/static backing already serves it; all other graph rules and caps remain.
