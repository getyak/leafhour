# Leafhour launch implementation plan

Use the isolated codex/leafhour-brand-launch worktree based on origin/main 42427d4. Protect the original divergent checkout and other agents' work.

1. Audit current product/auth/deployment and record the concrete design (spec alongside this plan). Install locked dependencies and select a supported Node runtime.
2. In independent file scopes, implement brand surfaces/assets and focused transactional email changes. Parent handles public configuration, server-rendered titles, MCP identity/compatibility, docs, and release allowlist. Preserve storage identifiers and all runtime data.
3. Inspect Vercel, Cloudflare, Resend, Supabase, and OAuth provider configuration using existing authenticated access. Record only safe metadata. Add/verify apex and www DNS/certificate, outgoing mail domain records, sender/templates, public origin and callbacks. No secret values in source, command output, or evidence.
4. Rename existing GitHub repository to getyak/leafhour and update remote/current references and hosting integration. Keep repository history and production project identity.
5. Render local desktop/mobile branding and email templates; exercise login, recovery contracts and MCP config. Run verify:deploy. Independent reviewer checks design coherence, auth/security, domain transitions, compatibility, and deployment scope. Fix actionable findings and rerun affected checks.
6. Sync target main without overwriting other work; commit only task changes, push, create/attach PR, wait for passing checks, normal merge. Follow production deploy and verify source commit.
7. Verify leafhour.com HTTPS, www behavior, production assets/title, existing-account login and book continuity, actual email receipt, and provider callback settings. Record evidence and any precise remaining external gate. Repeat final design review against the product promise.
