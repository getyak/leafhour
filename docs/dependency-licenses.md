# Dependency license evidence

Deterministic evidence for what the dependency tree **declares**, produced only from `package-lock.json`. It exists so a human can review third-party terms before redistribution. It is not legal advice, not proof of copyright ownership, and not a compatibility ruling: package metadata can be wrong or incomplete, and compatibility is never inferred from package names.

## Files

| File | Role |
| --- | --- |
| `tools/dependency-licenses.mjs` | Generator and checker (no network, lockfile only) |
| `docs/dependency-licenses.json` | Generated report: all 799 third-party records bound to the lockfile SHA256 |
| `docs/dependency-licenses-reviewed.json` | Maintainer-controlled technical review register for every exact declared expression |
| `docs/open-source-release.md` | Root AGPL code vs third-party software vs media |

The root project (`leafhour`, AGPL-3.0-only) is recorded separately in `report.root`; it is never counted as a third-party record.

## Regenerate and check

```bash
node tools/dependency-licenses.mjs            # regenerate docs/dependency-licenses.json
node tools/dependency-licenses.mjs --check    # verify the checked-in evidence
```

`--check` fails closed on:

- **stale report** — the checked-in report does not match what the current `package-lock.json` produces, including when the lockfile SHA256 binding changed;
- **missing expressions** — a package entry without license metadata;
- **unknown expressions** — placeholders (`UNLICENSED`, `UNKNOWN`, `SEE LICENSE IN …`, `LicenseRef-…`) or unsupported expression syntax;
- **new unreviewed expressions** — a syntactically accepted expression that `docs/dependency-licenses-reviewed.json` does not yet cover.

Regeneration never hides a failure. The generator refuses to write on missing/unknown/unreviewed evidence, the review record is never edited by the tool, and every regeneration prints the visible change summary it wrote (lockfile hash change, added/removed/changed records). Adopting a new expression therefore always requires a visible maintainer-controlled edit to the review record.

## Reading the report

Each record keeps the lock entry as declared: `name`, `version`, the **exact** SPDX `license` string, `dev`/`optional` flags, `os`/`cpu` platform constraints when declared (string or array form is preserved verbatim), `provenance`, `resolved` upstream location, `integrity` from the lockfile, and the lock `path`. Resolved URLs are stripped of credentials, query strings and fragments before recording; no other lockfile fields are copied.

Declared expressions (exact strings, counts): `MIT` 639, `Apache-2.0` 81, `BSD-3-Clause` 20, `ISC` 18, `LGPL-3.0-or-later` 10, `BlueOak-1.0.0` 8, `MPL-2.0` 6, `BSD-2-Clause` 4, `Apache-2.0 AND LGPL-3.0-or-later` 3, `(MIT AND Zlib)` 3, `0BSD` 2, `Apache-2.0 AND LGPL-3.0-or-later AND MIT` 1, `Python-2.0` 1, `Unlicense` 1, `MIT-0` 1, `(MIT OR CC0-1.0)` 1.

`AND` and `OR` are preserved exactly and never split into alternative choices: `(MIT OR CC0-1.0)` is a licensee choice for `type-fest`, `(MIT AND Zlib)` is a conjunctive pair for the `pako` copies under `pdf-lib`, and `Apache-2.0 AND LGPL-3.0-or-later` means both sets of terms apply to those native packages.

Classification as declared: 646 production, 37 dev, 90 optional, 26 dev+optional; 114 records carry `os`/`cpu` constraints. Dev dependencies do not claim to ship in production, and the platform-gated alternatives (sharp/libvips and LibreOffice Kit payloads for many OS/CPU pairs) are not all deployed — only the variants a given deployment installs. Provenance: 772 records resolve from `registry.npmjs.org` (npm/source installs), 27 are **traced hosted tarballs** resolved from `registry.npmmirror.com` (the `esbuild` package plus its 26 platform binaries, MIT, dev+optional) whose provenance is traced only through the lockfile `resolved` URL and `integrity` hash, and none resolve from git. `docs/local-instance.md` records this same observed split; no registry setting was changed.

## MPL and LGPL packages actually inspected

Inspection basis: the shared install cache on macOS arm64 (`darwin-arm64` payloads installed); other platform payloads were reviewed from lock metadata only.

| Packages | Declared expression | Install kind | Found in inspection |
| --- | --- | --- | --- |
| `@deepseek-ai/libreoffice-kit` | `MPL-2.0` | npm/source install | Full MPL-2.0 text in `LICENSE`. `NOTICE` traces font-name data to LibreOffice core `unotools/source/misc/fontdefs.cxx` at revision `bce0998afefdbc355585ca324285661a2170ba77` (upstream MPL-2.0 plus Apache Software Foundation notice) and carries the MIT text for the DeepSeek-derived adapter |
| `@deepseek-ai/libreoffice-kit-{darwin-arm64,darwin-x64,win32-arm64,win32-x64,wasm}` | `MPL-2.0` | optional native packages | Only `darwin-arm64` installed here (148 MB). Bundles the `LibreOfficeDev.app` engine binary (LibreOffice 26.8.0.3 built from core at the revision above). `licenses/` carries `LibreOffice-MPL-2.0.txt`, `DeepSeek-Harness-MIT.txt` and `LibreOffice-third-party.html` (324 KB of third-party notices). `sources/` carries build recipes, `core-changes.patch`, and `core.json`/`core-source.json` revision pointers — the engine source itself is referenced to the public core repository, not bundled |
| `@img/sharp-libvips-*` (10 packages) | `LGPL-3.0-or-later` | optional native packages | Only `darwin-arm64` installed here (17 MB): prebuilt `libvips-cpp.8.18.7.dylib` and headers. `README.md` lists bundled component terms (LGPLv3 parts: fribidi, glib, libexif, libheif, librsvg, libvips, pango, proxy-libintl; cairo under MPL-1.1; further permissive parts) with component versions in `versions.json`. No license text file ships inside the package |
| `@img/sharp-win32-{arm64,ia32,x64}` | `Apache-2.0 AND LGPL-3.0-or-later` | optional native packages | Metadata-only review on this host (Windows payloads not installed) |
| `@img/sharp-wasm32` | `Apache-2.0 AND LGPL-3.0-or-later AND MIT` | optional native package | Metadata-only review on this host |

The plain `sharp`, `@img/sharp-darwin-*`, `@img/sharp-linux*`, `@img/sharp-freebsd-wasm32` and `@img/sharp-webcontainers-wasm32` packages declare `Apache-2.0` and were not re-inspected as LGPL/MPL carriers.

## Binary distribution boundaries

The GET-154 candidate is a source-only export from `release-files.json`. It contains no `node_modules`, `.reader-runtime`, native engines or libvips binaries. The following obligations remain prerequisites for any future downloadable binary/dependency bundle; this source-package check does not certify an existing hosted function deployment:

1. **LibreOffice engine binaries (`MPL-2.0`, plus the bundled third-party components in `LibreOffice-third-party.html`)** — the native engine packages distribute binaries while the corresponding engine source is provided as a pinned upstream revision plus recipes and patches, not as bundled source. Before any redistribution of these packages, decide and document a compliant source-availability route and surface the 324 KB third-party notice list. Whether the revision-pointer form satisfies MPL-2.0 source-availability duties and how it interacts with the AGPL §13 network-source offer is a legal review item that this evidence does not resolve.
2. **sharp/libvips prebuilt binaries (`LGPL-3.0-or-later`, incl. the LGPLv3 components listed above)** — distributing these binaries requires carrying the license texts and modification notices and satisfying the relinking-or-corresponding-source conditions; the packages ship a README license table but no license text file. The same applies to the `Apache-2.0 AND LGPL-3.0-or-later` Windows payloads and the `Apache-2.0 AND LGPL-3.0-or-later AND MIT` wasm payload if they are ever shipped.
3. **Which optional native packages actually ship** is deployment-dependent (Vercel linux-x64 vs self-hosted vs local darwin development). Confirm the real distributed set per target and apply the obligations to what ships; do not treat unused platform variants as reviewed away if they are redistributed in some artifact.
4. **Media provenance** is separately recorded in `app/assets/atmospheres/NOTICE.md`, its per-file manifest, `app/brand-assets/README.md` and `app/auth-assets/README.md`. Five ambiguous upstream recordings were replaced with individually documented CC0 files. Their rights do not come from software licenses.

## Deliberate limits

The report records declared SPDX expressions and lock provenance only. It does not verify license texts against declared fields, does not conclude compatibility, does not count every platform alternative as deployed, and does not claim dev dependencies ship in production. Official license texts are linked from `docs/open-source-release.md`; a URL alone never satisfies attribution or source obligations.

The expression parser checks supported syntax and rejects placeholders. It does not embed the SPDX identifier registry. Every complete expression must also appear in the explicit register, whose initial technical notes were prepared by the coding agent; this is not a claim of human or legal sign-off.
