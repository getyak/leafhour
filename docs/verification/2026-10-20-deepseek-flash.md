# DeepSeek Flash defaults

All DeepSeek text paths now default to `deepseek-flash`: reading/chat already used it, and translation, dialogue scripts and guided-listening stages now use the same model. The three Chat Completions adapters explicitly send `thinking: {type: 'disabled'}` to retain non-thinking operation. Existing model overrides and their precedence remain supported; Gemini speech and image configuration are unchanged.

Official interface references: [model identifiers](https://api-docs.deepseek.com/quick_start/pricing/), [thinking toggle](https://api-docs.deepseek.com/guides/thinking_mode/). Flash otherwise enables thinking by default.

Validation:

- Focused configuration and provider-adapter checks: 26 passed, zero failed. Mock requests cover the actual outgoing model/thinking fields and translation attribution, including explicit overrides.
- Isolated PDF/runtime packaging checks: 10 passed, zero failed, one platform-specific skip.
- Full `npm run verify:deploy`: 2,526 passed, zero failed, one platform-specific skip (2,527 total); official isolated runtime initialized 928 files / 9.0 MB; hosted build, 351-file public build and 744-file software release allowlist passed.
- Independent source review and final translation-adapter test review: no confirmed P0, P1 or P2 findings.

These checks use synthetic fixtures and make no paid model requests. They verify configuration, request contracts and deployable packaging, not generated-content quality. Usage-account inspection evidence is kept outside the public repository and contains no API keys or book content.
