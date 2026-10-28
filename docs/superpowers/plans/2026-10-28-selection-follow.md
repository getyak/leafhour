# Selected-passage quotation follow-through

1. Reproduce the missing selection-follow behavior with the actual chat owner and reader adapter fixtures. Include a final text-range assignment after the reader's synchronous selection event.
2. Add a focus-preserving composer operation, with latest-only queuing during locked requests and lifecycle cleanup. Wire reader selection and active-selection capture on opening to that operation.
3. Verify typed quote boundaries, frozen requests, history, drafts, repeated selections and native close. Inspect the real desktop and narrow reader with a disposable local identity; observe context GETs and absence of sends.
4. Obtain independent review, fix confirmed issues, regenerate copy mappings and run affected tests/build/release checks. Update the existing scroll-motion PR, require current-head CI, merge normally, then verify the exact Production source.
