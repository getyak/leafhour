# Project design tooling

GET-281 installs upstream [Impeccable](https://github.com/pbakaus/impeccable) npm release 4.8.0, engine 0.1.18, for Cursor at project scope. The installed skill, four agent definitions, launcher, reference files and Cursor hook are checked in under `.cursor/`; their Apache-2.0 license is included. Vendored text has trailing whitespace normalized only. The upstream release is pinned here for reproducibility; project runtime dependencies are unchanged.

Reinstall from the repository root:

```sh
npx impeccable@4.8.0 install --providers=cursor --scope=project
```

Use `/impeccable init` and `/impeccable document` inside the agent, not as shell subcommands. Current product facts and the design extracted from code are recorded in root PRODUCT.md and DESIGN.md. No extra standing visual preference or detector ignore was inferred or configured.

The downloaded engine is ignored by Git. The launcher verifies its release SHA-256 against `scripts/engine-checksums.txt` before use. It can retrieve the engine on a new machine. Tooling and hooks are development-only: `release-files.json` excludes `.cursor/` and `.impeccable/` from the shipped app.

```sh
.cursor/skills/impeccable/scripts/impeccable detect --json app/index.html
```

Keep primary findings and advisories separate. Current rendered/source evidence, critique, intentional weather texture advisory and validation limits are in `docs/verification/2026-10-28-get-281-impeccable.md`.
