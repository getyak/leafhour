# Open-source source-package scope

GET-154 prepares a concrete, reproducible **source release**. Root software already uses AGPL-3.0-only, and the user authorized public source on 2026-10-15. The repository is already public; this task does not change visibility or start billing. This record distinguishes observed metadata and technical checks from legal or human sign-off.

## License choice

| Candidate | Effect considered | Decision |
| --- | --- | --- |
| MIT | Broad reuse with retained notice; no reciprocal source condition | Considered; does not preserve the project's hosted-source intent |
| Apache-2.0 | Permissive reuse with explicit patent terms and notices | Considered; no hosted-source reciprocity |
| AGPL-3.0-only | Strong copyleft, with corresponding-source duties for modified software offered over a network | Existing selected root license; matches local running, self-hosting and sharing hosted modifications |

`LICENSE`, `package.json` and the lockfile root declare AGPL-3.0-only. Project-authored software is covered by that license; bundled third-party code retains its own terms. `app/fflate.mjs` retains its MIT text in `app/fflate-LICENSE.txt`; derived icons retain ISC notices in `app/icons-LICENSE.txt`. Do not apply AGPL to books, photographs, third-party recordings or trademarks.

## What is in the candidate

`tools/release-policy.mjs` exports only `release-files.json`, plus a `release-source.json` binding the source commit. The source package includes application/server code, build tools, public catalog text, tests, source/asset notices and the locked dependency manifest. It excludes Git history, `AGENTS.md`, `_briefs`, internal verification/handoff materials, `content`, `local`, uploaded originals, personal reading records, real environment files and credentials.

The export contains **no `node_modules`, `.reader-runtime`, prebuilt LibreOffice engine, libvips binary or installed native dependency tree**. `npm ci` is a separate installation step that obtains packages under their upstream terms. An installer, container or dependency bundle would be a different distribution with additional notice/source obligations; this check does not approve one.

The anonymous public catalog contains public-domain originals with per-book origin/license information in `catalog/manifest.json` and `catalog/world/*.json`; translation provenance is separate in `catalog/translations/README.md`. See `docs/catalog-content-audit.md` for the audit scope and territorial limits. Software licensing does not grant book redistribution rights, and private uploads never become public catalog material.

Media has its own evidence:

- Four photographs retain the Unsplash License and named work pages in `app/assets/atmospheres/NOTICE.md`.
- Five ambient recordings now have individual CC0 work pages, creator, source hashes, delivery hashes and processing parameters in the atmosphere manifest. Ambiguous former Moodist assets were replaced; they were not retroactively declared CC0.
- Project brand illustrations and vectors have generation/authorship records in `app/brand-assets/README.md`; synthetic music is produced by project code. No third-party song is claimed.
- The unmodified official Google sign-in icon follows the linked branding guidance in `app/auth-assets/README.md`; trademark use is not an open-source grant.

## Dependencies and distribution boundaries

`docs/dependency-licenses.json` inventories all 799 lock entries and 16 exact declared expressions, including dev/optional/platform flags and original tarball provenance. The report is bound to the lockfile SHA256. `docs/dependency-licenses-reviewed.json` is an explicit maintainer-controlled expression register, initially prepared by the coding agent and subject to independent technical review; it is not a claim of human or legal sign-off.

The checker rejects stale evidence, missing metadata, placeholders, unsupported expression syntax and expressions absent from that register. It preserves `AND` versus `OR`. It does not validate identifiers against the entire SPDX registry or turn npm metadata into proof of ownership or blanket compatibility.

Retain copyright/license/NOTICE texts for software actually redistributed. In particular, the inspected optional LibreOffice/MPL and sharp/libvips/LGPL payloads have source, notice and relinking requirements described in `docs/dependency-licenses.md`. They are excluded from this source-only candidate. Their requirements remain open prerequisites for any future downloadable binary bundle; links to upstream source alone are not claimed to satisfy them. Existing hosted function packaging is outside this candidate's distribution certification.

For a modified hosted AGPL service, provide its users the corresponding source as required by section 13. The public source repository is available, but a repository link alone is not a universal substitute for the actual corresponding source and required notices.

## Reproduce and run

```bash
node tools/dependency-licenses.mjs --check
node tools/release-policy.mjs
# From an exported candidate, Node.js >=22.13:
npm ci
npm start
```

Use a private, explicitly selected `READER_DATA_DIR` as described in `docs/local-instance.md`. Local identity, import, reading, backup and restore do not require a subscription or a model request. Export and restore follow `docs/library-portability.md`; test them with synthetic material and a clean second data directory. The task delivery record binds the candidate commit and actual test results; these commands alone are not a claim that a run occurred.

## Primary terms

[AGPL-3.0](https://www.gnu.org/licenses/agpl-3.0.html), [LGPL-3.0](https://www.gnu.org/licenses/lgpl-3.0.html), [MPL-2.0](https://www.mozilla.org/en-US/MPL/2.0/), [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0), [MIT](https://spdx.org/licenses/MIT.html), [ISC](https://spdx.org/licenses/ISC.html), [CC0-1.0](https://creativecommons.org/publicdomain/zero/1.0/) and [Unsplash License](https://unsplash.com/license). The inventory/register identifies the remaining declared permissive expressions individually. These links aid review; required license texts must travel with the distribution that triggers their conditions.
