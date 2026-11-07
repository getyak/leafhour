# Historical local source references (GET-439)

These files preserve historical local source variants discovered during the 2026-11-07 complete code-sync audit. They are reference text, not application source, runnable fixtures, current configuration, or an instruction to restore old behavior.

The original inventory contained 80 local branch refs and 79 distinct commits. GitHub returned 71 commits associated with merged PRs. Eight local tips required further inspection; two have no source delta from their public baseline. Most remaining behavior was integrated by later public PRs. This directory preserves the 102 source/test/build-config blobs whose exact bytes were absent from both inspected public main history and GitHub object lookups.

`manifest.json` maps all eight tips and their changed source paths to Git blob IDs and SHA-256. `preservation: public-main-history` means that exact source blob already occurs in public main history; `text-reference` points to an unchanged deduplicated `.source.txt` object here. Original branch names and commit IDs are provenance, without importing their old Git ancestry. The local recovery refs remain intact.

The 102 objects contain 3,529,412 bytes. They include historical UI catalogs, application modules, synthetic tests and build metadata. User books, uploads, runtime data, logs, evidence, environment files and machine configuration were excluded from selection. See [public-boundary.md](public-boundary.md) for the completed content review and [manifest.json](manifest.json) for every path and hash.

Current application behavior continues to use the ordinary source tree. These snapshots do not establish CI, deployment, simulator, device, model or native UI acceptance. GET-273 source delivery and its still-separate native acceptance remain in PR #344; this reference directory does not change that task.
