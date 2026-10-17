# Configuration verification · 2026-10-17

The local configuration entry is `.env`, loaded by `npm start`. The loader preserves host variables, reads `.env.audio` as a fallback and gives `.env` priority. `npm run start:configured` remains an alias. `READER_AUDIO_SCRIPT_MODEL` supersedes the legacy dialogue name, with the old name retained as a fallback. Model defaults and existing pricing guards are unchanged.

Four regressions were first observed failing before implementation, then passed. They cover environment precedence, explicit empty values, missing files, multiline values, actual script-generation payload selection, legacy fallback and secret-free startup summaries. Full `npm run verify:deploy` passed: 757 tests, 756 passed, one existing platform skip, zero failures; isolated runtime initialization, public build and release snapshot checks passed. Independent review approved the diff and separately passed 32 focused tests.

## Real startup acceptance

The actual npm commands were launched in the isolated checkout using temporary fixture configuration and no paid model requests. Each scenario served all 30 public books and returned matching session and audio capability metadata:

| Scenario | Result |
|---|---|
| No environment files or AI keys | Reading starts; AI is reported unconfigured |
| One `.env` with fixture keys and a new script-model override | Keys load automatically; the actual capability endpoint reports the selected script model; startup says configured but unverified |
| Legacy `.env.audio` and `npm run start:configured` | Old file, command and script-model name continue to work |
| A deployment configuration that does not support the local speech queue | Startup explicitly reports unsupported speech even when a Key is present; the capability endpoint agrees |

No fixture Key appeared in captured startup logs. Temporary configuration files were removed after acceptance. Original account data was not used or modified. Real credentials, provider permissions, balances and paid speech results remain unverified. Hosted speech enablement and the existing Gemini PCM-format compatibility issue are outside this configuration change.

Source: Node.js [environment parsing](https://nodejs.org/docs/latest-v22.x/api/util.html#utilparseenvcontent). The local loader applies the project's explicitly documented precedence.
