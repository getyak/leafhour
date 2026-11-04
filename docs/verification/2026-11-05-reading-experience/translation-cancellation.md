# Translation cancellation: server evidence

2026-11-05. This is the server portion of R12; native switch/close behavior and physical-device acceptance remain separate.

The translate response now owns an AbortController. A disconnected native request cancels the actual provider fetch, and passes the same signal through billing and the domain service. The signal is an out-of-band option, never part of the model's source JSON. Permission and cancellation are checked before generation, after generation, in the mutation and immediately before the local rename or hosted CAS dispatch.

The commit begins at rename/CAS dispatch. Cancellation before this point cannot publish a late translation. Cancellation after a submitted commit does not promise rollback: the existing durable request and billing receipt must be reconciled. Stored completed translations remain intact. Other translation languages, source-version checks, account isolation and reviewed/concurrent variants retain their existing behavior.

Red run: all five new cancellation cases failed or timed out against the original behavior (`/tmp/leafhour-translation-cancel-red.log`). Green run after implementation: 124 tests passed, zero failures/skips (`/tmp/leafhour-translation-cancel-related.log`). This batch covers cancellation, actual mocked provider fetch, HTTP disconnect, a delayed hosted blob stage before CAS, existing hosted storage, source/owner safety, multilingual variants, dispatch metering, provider pricing and billing. No real provider call or account access occurred.

The hosted-storage test proves the commit fence after asynchronous staging. Atomicity after an already dispatched remote CAS is deliberately not claimed. Further native tests must prove closing the UI cancels URLSession and stops later passages while retaining uncertain request identity.
