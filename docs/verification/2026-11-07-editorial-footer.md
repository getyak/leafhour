# Homepage footer refinement

Reference: the live footer at https://cubxxw.com/, inspected on 2026-11-07. Its useful structure is a brand introduction, vertically grouped navigation and a separate colophon. Leafhour keeps its own mark, Newsreader wordmark, paper/green palette and existing appearance controller.

The homepage footer now has a concise product introduction and public-sample entry, three vertical groups for reading, the open project and reader policies, plus a lower copyright/license/creator line. External arrows distinguish destinations. The support email comes from the already-published privacy page; project issues are enabled. Existing policy routes and reading-link locale parameters are retained across English, Simplified Chinese, Traditional Chinese and Japanese. Existing no-pricing/no-MCP footer scope is retained.

At phone widths the brand occupies a full row, reading/project groups share two columns, and policies use a separate two-column row. All rendered footer anchors/buttons measured at least 44px high. English and Japanese were checked at 360, 768 and 1440px with no horizontal overflow; Chinese was visually checked at 390px and desktop. Paper and night views were inspected. The existing appearance menu mounted once, stayed inside the 390px viewport and closed on Escape. The private library continues to hide the public footer.

Validation: 94 affected tests passed; hosted build, public asset integrity and real pinned copy lint passed. The local generated public build with gzip scored Lighthouse mobile performance 98, accessibility 100, best practices 100 and SEO 100. These are measured technical categories, not an aesthetic rating or live-production score. Screenshots and the audit are retained with this chat's local verification artifacts.

Independent static review reported no P1/P2 blockers. Deployment and live source acceptance are verified separately from local results.
