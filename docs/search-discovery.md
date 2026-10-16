# Leafhour search and AI discovery

Updated 2026-10-16. This work makes the existing product understandable and discoverable; it does not promise indexing, ranking, rich results or AI citations.

## Audience and useful entry points

Leafhour is an open-source AI reading room, with original text, translations and personal records kept distinct. Its useful discovery topics are reading your own PDF/Markdown/text books, bilingual close reading, ownership and self-hosting, and book-scoped access for a personal agent. The product should be described through these actual capabilities instead of broad claims about understanding books or unlimited AI.

| Public page | Job |
| --- | --- |
| `/` | Chinese introduction, reading demonstration and visible questions about formats, translations, records and current limitations. |
| `/en` | English product introduction with source-linked public samples, actual capabilities and explicit language/backup limitations. |
| `/en/mcp` | Technical guide to the existing adapter, scopes, current setup path, revocation and hosted audio limitations. |
| `/privacy` | Public account and data-handling notice, currently in Chinese. |

The English introduction is a product page, not a claim that the reading application has been fully localized. Its language link is visible in the Chinese homepage navigation and footer. The Chinese and English introductions declare reciprocal `hreflang` references and separate canonical URLs. The MCP guide has its own canonical URL and breadcrumbs.

Every discovery page is authored HTML available before JavaScript. People and crawlers receive the same facts. The new public pages reuse Leafhour's existing mark, illustration, paper and forest palette, with no third-party font, tracking script or additional model call.

## Technical and privacy boundaries

`/robots.txt` advertises `/sitemap.xml`, permits public crawling and disallows API/export crawling. Its wildcard group also applies to AI search crawlers; it introduces no separate per-agent group that could accidentally omit the API restrictions. CSS, images and other rendering resources remain accessible.

Robots rules are crawler guidance, not access control. Existing service authentication, account isolation and grant scopes continue to protect personal data. Private reader/library/gift shells, evaluation pages and API responses additionally return `X-Robots-Tag: noindex, nofollow, noarchive`. HTML shells retain their robots metadata. The library renderer removes public JSON-LD and language-alternate metadata rather than inheriting the homepage's discovery identity. Both the local server and Vercel deployment apply the exclusion headers.

The sitemap contains only the four curated public URLs above. It never enumerates uploaded books, personal accounts, notes, reading query strings, gift tokens or signed resources. It omits invented modification dates and low-value priority/change-frequency signals. Add public pages deliberately, with a useful visible purpose, canonical metadata and actual internal links.

The Organization, WebSite, SoftwareApplication, WebPage, TechArticle and BreadcrumbList descriptions identify the real project and its pages. They contain no fabricated ratings, reviews, prices, awards or usage counts. SoftwareApplication markup without the additional required commercial/review fields is not a claim of eligibility for Google's software-app rich result. Visible questions are useful content; this release does not promise FAQ rich results.

## GEO decisions and primary sources

Google's current guidance treats generative search discovery as part of Search: useful original information, accessible pages and ordinary technical SEO still matter. It explicitly says `llms.txt` is not used as a special Google Search signal. This release therefore prioritizes readable product facts, clear limitations and a specific MCP guide rather than an AI-only text file, hidden prompts, synthetic testimonials or many near-duplicate keyword pages.

OpenAI distinguishes OAI-SearchBot for search discovery from GPTBot for training. Anthropic likewise distinguishes its search, user-request and training crawlers. Public crawl permission is not a grant to private library data. A successful request using a crawler User-Agent checks delivery under that header; it does not prove a genuine provider crawler has visited, that a firewall allows every published provider IP, or that an answer system will cite the page.

- [Google: generative AI search optimization](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide)
- [Google: robots.txt limitations](https://developers.google.com/search/docs/crawling-indexing/robots/intro)
- [Google: localized page versions](https://developers.google.com/search/docs/specialty/international/localized-versions)
- [Google: building and submitting a sitemap](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)
- [Google: SoftwareApplication structured data](https://developers.google.com/search/docs/appearance/structured-data/software-app)
- [OpenAI: crawler purposes and controls](https://developers.openai.com/api/docs/bots)
- [Anthropic: crawler purposes and controls](https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler)
- [Bing: AI citation performance reporting](https://www.bing.com/webmasters/help/ai-performance-9f8e7d6c)

## Verification and measurement

Before this change, real HTTPS requests found `/robots.txt`, `/sitemap.xml` and `/en` returning 404. The homepage had canonical/social metadata but no JSON-LD; private pages had robots metadata without the additional response header. This is a technical baseline, not a ranking or citation baseline.

The HTTP tests exercise actual routes in isolated storage: correct discovery MIME types; an allowlisted sitemap whose public targets return 200; English content/canonical/language metadata without JavaScript; parseable structured data; private-page/API exclusion; unchanged unauthenticated export denial; and equal content for people and search User-Agents. Deployment checks require the generated English and discovery assets. Production smoke verifies the actual hosted routes, metadata, sitemap and private exclusion headers after the exact merged source is live. No real account content or model requests are needed for these checks.

After deployment, submit `https://leafhour.com/sitemap.xml` in the existing Search Console property and inspect the home/English URLs. Record the actual response separately: submission is not acceptance of all URLs, and a successful live URL test is not indexed status. If Bing Webmaster Tools is available to the operator, submit the same sitemap and use its AI Performance report for actual citation evidence.

For later evaluation, compare branded and relevant non-branded impressions/clicks, indexed public URLs and the pages visitors reach. Search Console data and search-engine crawling can lag publication. Useful query groups include “Leafhour”, “open source AI reading app”, “read PDF with AI and notes”, “bilingual reading app”, “MCP book reader”, “AI 辅助阅读” and “开源私人阅读书房”. These are evaluation topics, not promised rankings.

For a manual AI-answer check, record the date, host/model, exact question, cited URL and any factual errors. Example questions: “What file formats does Leafhour support?”, “Can an agent read my Leafhour notes without permission?” and “Is the Leafhour interface available in English?”. A direct retrieval check can prove that facts are accessible; only an actual answer with a citation proves a citation occurred. Do not invent a GEO score, automate paid model requests or report ranking growth before real evidence exists.
