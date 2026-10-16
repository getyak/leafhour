# Leafhour brand and domain launch

Date: 2026-10-16. Status: implementation authorized by the user's request to design, implement, review, and deploy.

## Product promise

Leafhour is a personal reading room: stay with a book, return to your own questions, and invite AI into the conversation when useful. Books, highlights, notes, and exports remain under the reader's control. The global brand is Leafhour; the current Chinese interface remains honest about its available languages.

Primary line: **Stay with a book.** Supporting English description: **Your personal reading room, with AI by your side.** Chinese expression: **留一点时间，读进一本书。** Avoid claims of understanding, unlimited AI, or features that are only planned.

## Research and decisions

- OpenAI's official brand guide treats consistent typography, proportions, and restrained use of its symbol as a system: https://openai.com/brand/ . Apply consistency and a recognizable symbol; do not copy its proprietary typeface or mark.
- Anthropic's official company presentation connects editorial typography and a calm surface to a clear promise of reliable AI: https://www.anthropic.com/company . This is our observation of the public presentation, not a claim about a published Anthropic identity specification.
- OpenAI's frontend design guidance favors a clear visual thesis, deliberate hierarchy, and preservation of useful existing patterns: https://developers.openai.com/blog/designing-delightful-frontends-with-gpt-5-4 . Keep the paper, natural light, forest palette, and reading-first workspace already present in this product.

- Mistral's official brand guide emphasizes an identifiable small-scale emblem, clearspace, and coherent extensions: https://mistral.ai/brand/ . Apply the discipline while retaining Leafhour's own page/leaf identity.

Leafhour's identity comes from an original leaf/page/hour symbol, a compact serif wordmark, measured spacing, and a consistent forest green. No borrowed AI-company symbol, glowing AI orb, decorative dashboard cards, or competing secondary brand. A small circle can suggest time; a folded leaf/page carries reading. The symbol must work at favicon size and as a one-color mark.

Palette: paper #F7F5EF, ink #263B32, forest #365B45, muted sage #DDE5D8, warm accent #B28152. Existing accessibility and reader themes take precedence over marketing colors. Typography uses existing system serif and sans stacks with explicit fallbacks; no remote font request or proprietary asset.

Home hierarchy: unmistakable Leafhour wordmark; one concise product promise; direct reading entry; concrete proof through the existing reading experience; ownership and open-source statement; quiet footer. Existing shelf/reader workflows remain stable. Header, favicon, about dialog, privacy page, gifts, emails, document titles, and social preview use the same name and symbol. Motion stays optional and honors reduced motion.

## Domain and service topology

Canonical origin: https://leafhour.com . www.leafhour.com redirects to the apex. Preserve the former reader host during transition, with a safe GET navigation redirect once the new domain is verified. Do not forward posted passwords or OAuth codes across origins. Existing host-only sessions require a fresh sign-in; Supabase identities and account-scoped data stay unchanged.

Rename the existing public GitHub repository to getyak/leafhour, retaining history, issues, and redirects. Update visible URLs, project description/homepage, generated MCP configuration, and current deployment instructions. Keep legacy MCP binary alias for compatibility. Vercel project identity can stay stable; its display name may change only if deployment linkage remains verified.

Internal storage keys, export schema kinds, cookies, stable book/paragraph IDs, and account namespaces remain unchanged. Brand work is not a data migration. Historical dated evidence remains historical.

## Authentication and mail

Keep password-first login, verified signup/recovery, rate limiting, one-time password setup proofs, and OAuth session protections. Change provider configuration and transactional identity instead of rewriting proven policy. Local SMTP and Supabase templates use focused bilingual Leafhour transactional copy.

Vercel public origin, Supabase site URL/redirect allowlist, Google authorized origin, Apple web domain/relay sender configuration, and outgoing SMTP identity must agree. Supabase's provider callback remains the same project callback. Sender: Leafhour <hello@leafhour.com>; support address: support@leafhour.com, activated only when routing is verified. Resend domain authentication requires the exact provider DKIM/SPF records; inspect existing MX before changing any record. Preserve existing SMTP secret and provider credentials.

Official references: https://supabase.com/docs/guides/auth/redirect-urls ; https://supabase.com/docs/guides/auth/auth-email-templates ; https://resend.com/docs/dashboard/domains/introduction ; https://vercel.com/docs/domains/working-with-domains/add-a-domain ; https://docs.github.com/en/repositories/creating-and-managing-repositories/renaming-a-repository . Use current provider documentation for API mutations.

## Acceptance

Review source diff and rendered desktop/mobile screens. Test relevant auth contracts plus complete repository verification. Deploy through the existing public repository and checks. Confirm new-domain HTTPS and source commit, password login into the existing default account, stable account book/record inventory, actual verification-email delivery and sender, and OAuth configuration. Distinguish simulated contract checks, provider verification, mailbox receipt, and real browser interaction. Record unresolved external gates explicitly; do not label them complete. Do not reset the default account's password or create paid services to make a test pass.
