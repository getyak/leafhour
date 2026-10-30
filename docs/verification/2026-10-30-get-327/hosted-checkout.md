# Hosted source snapshots and catalog byte checks

The [GET-327](https://linear.app/getyak/issue/GET-327) implementation merged in [PR #268](https://github.com/getyak/leafhour/pull/268) as `672d5d74de2a80854c32073a30732da4fc3add0d`. That merge's GitHub CI passed all 4376 tests. Its Vercel production build failed two catalog checkout tests: both called `git show HEAD` in `/vercel/path0`, where the source snapshot has no `.git`. The production verifier correctly stopped after the provider reported failure. The old production source was not accepted as the new release.

The early build records identify cases 790 and 791 in `tests/catalog-checkout-bytes.test.mjs`; the final hosted summary was 4358 passed, 2 failed, 16 skipped. The error was `fatal: not a git repository`, for a book original and a people seed. The `.vercelignore` deliberately excludes `.git` and retains `.gitattributes`.

The byte checks now create an owned temporary Git repository. They copy the actual source attributes, read the actual snapshot files, store unfiltered byte objects, and run Git's real `core.autocrlf=true` worktree filter against each original catalog path. The source and filtered bytes must both match an audited SHA-256: existing reading metadata for all 64 books, and the people manifest for its three seeds. The existing catalog regression separately pins those book hashes and stable IDs.

Inherited `GIT_*` names are removed without case sensitivity, which matters on Windows. Each fixture supplies empty global configuration and attributes files and disables system configuration/attributes. All Git writes remain inside the temporary repository; cleanup runs after success or failure. Each Git process has a ten-second bound. There is no hosted skip and no dependence on a caller's HEAD, index or configuration.

Verification before the follow-up PR:

- The original test in a source-only snapshot reproduced both failures.
- The corrected tests pass in the working repository and a 72-file source-only snapshot with no `.git`.
- The two success cases and seven negative controls all returned their expected results: missing people/structured-book attributes, poisoned inherited configuration, missing attributes, corrupted source bytes, already-converted source bytes, and a missing audited hash. Restoring the snapshot passes again. The original plain-text books already use CRLF; the structured-book control is the meaningful LF-to-CRLF conversion case.
- `node --test tests/catalog-checkout-bytes.test.mjs tests/catalog-topics.test.mjs tests/release.test.mjs` passed all 10 tests with no failures or skips.
- Independent review identified the environment-name case issue, which was fixed, and confirmed the final byte baseline and isolation. The reviewed test blob is `364bce5b6e843874ae00ae617107a08556d9605c`.

These are host Git filter simulations and source-snapshot checks, not a new native Windows, production or device acceptance claim. Same-head CI, normal merge, a new production build and matching online-source verification remain the delivery gates. Public reader assets and native product code are unchanged by this follow-up.
