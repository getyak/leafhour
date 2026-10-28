# Library first-paint transport plan

Goal: reduce the production source-module waterfall without changing state ownership or lazy boundaries.
Spec: ../specs/2026-10-28-library-first-paint-design.md

- [x] Write failing builder identity/laziness/allowlist tests and library-only HTML asset tests.
- [x] Build a release-checked, singleton-preserving portal asset; leave dynamic modules at public URLs and remove only known homepage assets from the library shell.
- [x] Run generated-page browser tests, release and locale audits, focused regression tests, independent review and a comparable transport experiment.
- [ ] Submit/merge after CI and verify the deployed commit, actual first usable books and the existing real-account recap.
