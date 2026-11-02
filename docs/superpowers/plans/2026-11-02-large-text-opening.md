# Large native text opening implementation plan

**Goal:** Open the user's actual large TXT without monopolizing the main thread, preserving source identities and reading behavior.
**Spec:** ../specs/2026-11-02-large-text-opening-design.md

- [x] Reproduce the actual source and record a failing bounded-layout/performance check; authenticate the requested test identity without logging credentials.
- [x] Add a bounded reading-source window with Unicode-safe offsets and original paragraph IDs; cover first/middle/end and very long single passages.
- [x] Integrate bounded layout, scroll continuation, forward/backward page boundaries, selection, Markdown fragments and honest page totals.
- [x] Verify actual source import/open/interaction/reopen in native iOS plus regression checks; independently review.
- [ ] Submit and merge after CI and follow the existing release.
