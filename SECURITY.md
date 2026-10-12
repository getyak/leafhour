# Security

Please report security issues privately to the repository owner instead of opening a public issue.

Never commit book files, personal records, database passwords, Supabase secret or service-role keys, DeepSeek keys, or Vercel tokens. The browser must not receive `SUPABASE_SECRET_KEY`.

The supplied Supabase migration enables RLS and removes direct access from `anon` and `authenticated`. The current hosted adapter is intended for a single-owner deployment protected by Vercel Deployment Protection. Add Supabase Auth and per-user policies before running it as a public multi-user service.
