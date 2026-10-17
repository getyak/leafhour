# Security

**English** | [简体中文](SECURITY.zh-CN.md) | [繁體中文](SECURITY.zh-Hant.md) | [日本語](SECURITY.ja.md)

Please report security issues privately to the repository owner instead of opening a public issue.

Never commit book files, personal records, database passwords, Supabase secret or service-role keys, DeepSeek keys, or Vercel tokens. The browser must not receive `SUPABASE_SECRET_KEY`.

The supplied Supabase migration enables RLS and removes direct access from `anon` and `authenticated`. The current hosted adapter is intended for a single-owner deployment protected by Vercel Deployment Protection. Add Supabase Auth and per-user policies before running it as a public multi-user service.

The new public hosted entry only offers public-domain samples with clear licenses. Private uploads and records require an email identity; anonymous access cannot read the old single-book API. `reader_documents` and the `reader-originals` bucket are reachable only with the server-side key, and per-account isolation is enforced through the shared domain service. Deployments exclude private archives and local data; sign-up stays closed while the hosted email service is unconfigured.
