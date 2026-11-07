# GET-273 shared mirror v4 source contract

Status: source/off-device candidate only. This source agent starts no new native attempt, addon, lease, device or actual mirror. The controller may separately run the explicitly authorized synthetic-only Chrome transport probe; its result is recorded separately and never counts as native evidence. The recovered v3 attempt remains cancelled/exceptional, with its original frozen inputs, blocked receipt and true entry/restoration PNGs preserved. Its seven reader scenarios remain unrun.

## Actual entry composition and normal self-exit

`tools/get273-mirror-adapter.mjs` exports `createAdapterRuntime(options)`, and actual `main()` calls exactly this construction. The construction always wires `onCleanStop` to the current child process's `process.exit(code)`. Tests provide only fake external native/server/owner/receipt boundaries to this same construction; they supply no exit callback. No CLI test mode, fake-lease environment switch, device override or authorization bypass was added.

`tools/get273-mirror-runtime.mjs` permits this callback only after HTTP closure, input quiescence, native close promises, synchronous stopped-receipt write, stopped phase and hold removal. Normal shutdown exits 0; initialization failure exits 1. Blocked, pending, native close or receipt failure never calls it. The parent must still confirm OS child exit plus the valid stopped receipt. A callback/receipt is not OS-input attestation or UI acceptance.

The original 61-check result is retained as historical evidence; it did not protect actual entry wiring. The new actual-entry host children retain an external event-loop reference and import `createAdapterRuntime` from the actual adapter. They cover normal 0, startup-failed 1, close failure, receipt failure and pending close. Removing only the actual factory wiring makes the two expected normal-exit cases fail while the three blocked cases remain isolated; source is restored afterward. This executable mutation is recorded separately from the green suite. The final-source mutation runs in an isolated byte-identical copy, leaving the shared workspace stable for controller transport investigation.

## Finite refusal counters; original gate unchanged

`transportRejection(request, origin)` extracts the same existing refusal predicates in their original order. There are exactly four fixed categories:

- `remote-address`: remote address differs from the bound IPv4 loopback.
- `host`: Host differs from the exact own origin's host and port.
- `origin`: a supplied Origin differs from the exact own origin.
- `fetch-site`: Fetch-Site is cross-site.

The server increments only these four counters, saturating each at 1,000,000. The first applicable predicate is counted. `transportRejections()` returns a copy with exactly those four integer fields. There is no URL, query, method, header value, cap value, Cookie, body, input coordinates, event stream or raw request object in this snapshot. No diagnostics HTTP route or generic inspection/control surface is added.

The actual entry writes one owner-only `mirror-transport-rejections.json` snapshot before its first terminal stopped/blocked receipt, when a mirror server has been constructed. The snapshot does not exist for a pre-server initialization failure; absence must not be reinterpreted as zero. A failed diagnostic/receipt write cannot become successful cleanup. Counters report only those transport predicates; a 403 later in route/cap validation does not increment them. Four zero counters therefore do not establish the cause of a 403.

Host, Origin and frame/touch header-capability checks remain unchanged. Public root GET still passes the same transport gate; cross-site navigate/document remains rejected. Frame requests still require the own memory-only header capability even for another same-site localhost port. No Cookie is emitted/read, no credentials are forwarded, and no cap is put in URLs or evidence.

## Off-device evidence and freeze

The combined light suite has 69 passes, 0 failures, 0 skips: the earlier 61 checks plus five actual-entry host cases and three transport classification/HTTP/label cases. Real HTTP combinations exercise browser-like Fetch metadata with safe fake headers, including same-origin/none success, cross-site navigation refusal, Origin/Host priority, and a same-site image request with no cap. Canary tests verify that query/header/Cookie/authorization/cap inputs never appear in the four-counter snapshot. These are simulated combinations, not observations of v3 Chrome request headers.

The v3 Chrome refusal is still unproven at the individual-predicate level. Its 403 observations and backend GET 200 remain preserved failures; neither is relabelled Safari product failure. The new counters are for the next controller-authorized, newly frozen attempt. No Host/Origin/cap gate has been loosened to make a viewer load.

Source is frozen separately by file hash for the shared adapter/runtime/control and tests, with unchanged pinned native inputs from the reviewed v3 family. A consumer such as B must copy only those reviewed sources into its own fresh pack and review its actual parent/entry, retain original inherited ownership values, and use no old lease/cap/identity/instance. A new hash is not permission to boot or run.

Product acceptance remains pinned to the original merged GET-273 source `d302393d4ed01a82af6828d7200969be3b8addc9`. During this batch remote main advanced to `4cfdd7f` for GET-201 settings; it was fetched and left untouched. This source-only helper batch does not claim acceptance of that newer product head or rebuild its assets.

The source-only `syntheticTransport` server option changes fixed title/status/alt labels to `SYNTHETIC TRANSPORT ONLY / no device`; it changes no gate or native construction. Actual main uses the ordinary default. There is no CLI/environment fake-native mode. Synthetic probe frame/input boundaries must remain fixed/fake and cannot load an addon or touch a device.

## Source preservation delivery — 2026-11-07

GET-439 collects the 33 existing GET-273 helper, host-test and verification files on public main `9abd32a2e3e36d3dda5564ffd2d852ae515413ed`. The isolated copy preserves the original source; this additive delivery note records the handoff. Fourteen affected host test files passed 104 tests, with no failures, cancellations or skips. Those tests use synthetic boundaries and owned loopback HTTP, not a browser, device or native addon.

This delivery executes no probe, acquires no lease, consumes no grant, and creates no new execution freeze. Product acceptance remains pinned to `d302393d4ed01a82af6828d7200969be3b8addc9`; the original seven scenarios remain unrun and GET-273 remains In Progress. Existing frozen packs, pending controller coordination and native-input limitations retain their separate evidence and authorization boundaries.
