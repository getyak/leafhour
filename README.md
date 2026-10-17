# Leafhour

**English** | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-Hant.md) | [日本語](README.ja.md)

**Stay with a book.** Your personal reading room, with AI by your side.

Leafhour helps people finish one book they want to read, a little at a time: today continue from the source sentence where you stopped, leave a short note of your own understanding afterward, and come back tomorrow. The reading surface stays quiet; source text with two translations, personal notes and close-reading prompts appear only when you ask for them.

Development happens in the single public repository [getyak/leafhour](https://github.com/getyak/leafhour). Code, design documents, execution plans and acceptance records are open source under AGPL-3.0. Default public-domain English originals and their source licenses live in `catalog/`; private books, personal translations, notes, reading records and server-side secrets are never published with the source.

The reading page’s squirrel keeps you company after you sign in and remembers books where you turned it off: it first reads quietly for about 90 seconds, then at least every 5 minutes may leave one thought based on the passages currently and recently in the foreground, and stays silent when nothing fits. It speaks at most three times per reading session. Bubbles can be ignored, collapsed, or opened in the existing reading conversation; your drafts are never overwritten, and the companion can be turned off at any time in the conversation. The squirrel can be dragged or moved with Alt + arrow keys, its position is saved in the current browser, and bubbles travel with it; the persistent “accompanying” badge is gone. No messages appear while you select text, write notes, chat, or while the page is in the background; private notes are never read and nothing is pushed outside the site.

## What works today

A complete path is available locally: website → public catalog → local reading room or email code → upload PDF / TXT / Markdown → two translations per passage → personal records and reading conversation. The default catalog ships the complete English originals of *Alice’s Adventures in Wonderland*, *Meditations*, and *Walden*, with sources and licenses kept in `catalog/`; translations are generated on request and are never claimed to be complete up front. The default catalog contains no private sample books.

The new reading room supports both the local service and Vercel + Supabase. The cloud uses separate private data tables, content-version checks and private original-file storage; the default public books can be read anonymously. The hosted version signs in with email and password by default, with an email code as a fallback; new rooms and password recovery verify the email first and then set a password. Google and Apple sign-in are also supported, and self-hosters see only the methods they configured.

Reading continues from the passage where you stopped; the other books stay on the lower shelf. Search, upload, the reading calendar and the reading conversation share one collapsible left sidebar; your avatar and name sit at the bottom left and open the profile editor; sign-out and page appearance live in “Settings”. Phones use a drawer navigation. The old “Data & Agent” panel is gone, while its data and domain APIs remain. Reading records, timing rules, drafts and backups are described in [Reading and data retention](docs/reading-journey.md).

The bookshelf uses mist-green paper texture, thin shelf lines and cloth bindings, with a night appearance and support for the system reduced-motion setting. The same book keeps one cover across shelf, search and continue-reading, and its text comes from real book metadata; the paper texture’s provenance and prompt are documented in [Brand assets](app/brand-assets/README.md).

Hovering or focusing a book reveals more actions; touch devices show buttons directly. Covers and handles can be dragged to reorder, and the menu can move a book forward or backward while the handle’s arrow keys do the same; signed-in order is saved per account. Moving a book to the trash keeps its source text, translations and reading records and can be undone; there is no permanent delete.

“Add a reading schedule” sets a local time, duration, repeat cycle and reminder, then downloads an `.ics` file; reminders work only after you open it and add it to your system calendar. The app never creates system calendar events directly.

“Send this book” lets you write a recipient name and a note and produces a paper-feeling gift letter that can be opened. The link carries the book description; the recipient can download the full reading pack and add it to their own shelf after signing in. The source text and the translations you ticked travel with the letter, while personal notes, questions, reading position and timing do not; translations keep their draft status. Revoking the link stops future access; already downloaded packs and claimed books are not deleted remotely. Hosted claiming requires the source and translations to total no more than 3.5 MB; larger packs can be downloaded locally instead.

Gifts move through “write the note → watch it open → seal and share”. The preview reuses the real recipient page and passes only the visible description in the browser, creating no link until you explicitly seal it; then you copy the link or use the system share sheet yourself. Closing and reopening the window in the same account keeps this draft or sealed link. Recipients can open the letter before signing in and stay on the opened letter after returning. The envelope and card use original irregular paper edges, a postmark and soft paper texture; the animation folds back and respects reduced motion.

- Chinese, English and bilingual reading modes, with literal and interpretive translations saved separately; a missing translation shows the source once and labels the missing version
- During anonymous trial reading, requesting a translation returns the same source passage and generates only after an explicit second click; when the service is unconfigured the entry is honestly disabled
- Passage source text, annotations, thoughts and questions align on stable IDs
- X-ray argument transparency, stance-flipping pages, echo review and restrained chapter interactions
- Selecting text saves a pale-yellow private highlight; click to remove it or write a thought, and return to the sentence from “My records”
- Selecting a sentence generates a configurable monolingual or bilingual share image
- Font, size, line height, paragraph spacing, tracking, first-line indent and paper themes
- Reading calendar, daily goals, your understanding and questions, revisited at the source position
- Actively started foreground reading time, with manual confirmation for finished chapters and books
- Import and export of highlights, comments, questions, reading position, sessions and reading marks
- Local JSON storage, or private hosting on Vercel + Supabase

## Running locally

Node.js 22.13 or newer:

```bash
npm ci
npm test
npm start
```

Visit `http://127.0.0.1:8330/` for the website and `/library` for the reading room. The old private sample book entry moved to `/read`; `/read?book=ID` opens a specific book in the new room. The default public catalog starts even without local private books. Local uploads and records live in the Git-ignored `local/service/portal/` and never enter the public source.

To keep personal data outside the source directory, set `READER_DATA_DIR` and keep using `npm start`. Directory layout, restart and update steps are in [Local instance and data](docs/local-instance.md); without it the existing `local/service/` is used and existing rooms are never moved automatically.

Reading settings independently choose a close-reading or language-learning goal, a preferred language, a display mode and literal/interpretive translations; switching keeps your passage position and old records stay source-first. See [Reading goals and language](docs/reading-preferences.md).

Saved thoughts and questions can be edited individually while keeping their creation time, quote and source position; when another edit conflicts, the newer words are read before an explicit save. Failed retries keep the new draft, and uncertain sources never guess a jump target. Behavior and draft backup boundaries are in [Editing your thoughts and questions](docs/personal-records.md).

When you want AI, copy the single template [`.env.example`](.env.example) to `.env` and fill in the keys you need: `DEEPSEEK_API_KEY` for translation, reading conversation and lecture scripts, `GEMINI_API_KEY` for local speech. Models are preselected and reading alone needs no configuration. `npm start` reads the configuration and its startup message states what is configured, what still needs verification, and whether speech works in the current deployment. The same template holds commented-out hosting and advanced options; see [Configuration](docs/configuration.md).

PDF text is extracted locally, limited to 20 MB, 500 pages and two million characters; scanned PDFs and encrypted files fail with a clear reason, and OCR is not included yet. The default 30 English reading editions use audited table-of-content boundaries and start at the body text, while prefaces and appendices remain reachable. Private uploads are currently split into reading segments every 30 passages, and the interface labels this automatic segmentation as not the author’s chapter structure. Catalog adjustments keep passage IDs so existing notes and positions still point at the same sentences.

Choosing another invalid file clears the old choice so the previous file can never be uploaded by mistake. After a failed upload you can retry or change files; closing the upload window lets the request continue and the shelf updates on success. A private PDF reading page can expand to show the filename and extraction notes, clearly marked as not yet proofread.

The source panel lets you download your own uploaded original for proofreading; the content is verified before download and originals are offered only to the owning room account. A JSON backup without its original says so explicitly; uploading the same original again restores it while keeping existing translations and records, including books migrated from other accounts. Original downloads are not part of the existing MCP content grant.

The room shows the chapter you last read, and “Continue reading” returns to that passage and typography. Signed-in server positions win; anonymous trial reading is kept only in the local browser. When several tabs read at once, an old position never silently overwrites a newer one; the page keeps its content and lets you choose the newer position or continue here. Exports obey the same check.

“Page layout” in reading settings offers scrolling or page turning. Both the source and the Chinese translation can be read as a spread like an open book, turning with ← → or the buttons at the foot of the page; windows narrower than 900px show one page. Turning past a chapter end continues to the next chapter, and turning backward returns to the previous one. The bilingual layout keeps its arrangement and remembers the page-turn preference when you switch back. At 980px and below the room uses drawer navigation to leave space for text and shelves.

Long passages additionally store an in-paragraph reading ratio so refreshes, font-size changes and other window widths return to a similar place in the paragraph; old records still restore by pixel offset. Ratio positioning is not guaranteed word-identical; source text and passage IDs are unchanged.

You can keep writing while a thought or question saves. The confirmation clears only that submission and later words stay a draft. Drafts and unconfirmed submissions are cached per account and book in the browser; lost confirmations retry exactly and refreshes reconcile with saved records first. When the browser cannot keep a draft you are asked to copy the text. Unfinished items in after-reading records return from “Drafts”, and each tab keeps its own thoughts. Room export merges local pending sessions and chapter marks, while after-reading drafts are backed up separately; restoring through the web leaves them as local drafts until you save them as notes. The margin panel and after-reading records share the draft entry, and old per-passage drafts can be found and exported too.

Opening personal records from anonymous trial reading lets you sign in and return to the same passage and panel. The return intent is used once, and later refreshes follow the normal resume position. If you are signed in but the record read fails, you can retry in place; once a newer position arrives you choose where to continue, and exports honor the same protection. Text over the quote limit is not written into the record quote, while the source and passage link are kept and retries reuse the same submission ID.

### Books and catalog

The top-bar book title and current chapter are clickable and open a book-info overlay with the existing description, author, source and current chapter. The overlay closes with Esc, its close button or an outside click while the reading position stays put. The left “Room” and “Contents” entries share icons, spacing and touch height; contents are grouped by chapter with the current chapter marked, and clicking the row enters it. Books with numbered sections can still expand sections and return to their passages.

### Reading atmosphere

The “Atmosphere” control at the top right of the reading page offers forest pages, rainy-window night reading, cabin hearth and seaside dawn, or “paper only”. Scenery stays around the text; when a side panel opens the text keeps its own opaque paper. Narrow screens favor text, and night mode plus the system reduced-motion preference keep working.

Choosing a scene enables its light music and ambient sound by default, and switching scenes swaps both. The two volume channels adjust independently and either can be muted by turning it to zero; scene switches remember the mute. Closing the panel keeps reading going and the top bar can pause sound. Refresh keeps the scene without autoplay, leaving the page pauses it, and background sound lowers while narration plays. Music is synthesized locally with piano tones and harmonies; ambient recordings and images ship with the app and nothing connects to third-party media services at runtime. Provenance, processing and licenses are in [Atmosphere assets](app/assets/atmospheres/NOTICE.md).

“Scene motion” controls the forest light, rain streaks, hearth glow and slow sea movement behind the text, and the panel preview follows along. Night mode is available and the text stays stable. Motion and sound switch off independently; backgrounding stops motion, and the system reduced-motion preference wins.

Theme, volume and motion preferences are saved per account and book in the current browser and are not yet part of room export and restore. Sound is never required for reading or translation and never adds reading time or model requests.

### Email and translation

To use email sign-in locally, configure SMTP in the same `.env` and start with `npm start`; variables are in [Configuration](docs/configuration.md). Codes are genuinely sent over SMTP, expire after ten minutes, work once and die after five failures; sign-up and sign-in share one entry, and sessions live in HttpOnly cookies. Without SMTP nothing pretends to send mail; the local room is a single-user mode and does not imply a verified email identity.

Signing out clears private book titles, grant lists, displayed tokens and file choices from the page; books and created agent grants stay on the server and grants must be revoked in the room. After an account switch, old requests cannot update the new account’s page and old restore tasks cannot write into it; returning from another tab re-checks the current identity.

With `DEEPSEEK_API_KEY` configured, click a passage and choose “Translate this passage”. Only the current passage and one neighbor on each side are sent, and literal and interpretive translations are kept separately as AI drafts. Font size, switching to existing translations and plain reading never call a model. Per-paragraph translation uses the DeepSeek API; the book echo demo continues to use the official DSH.

You can move to other passages while a translation runs and the result still lands on its original passage; returning to one still translating cannot resubmit it. Leaving or deselecting never forces a late result to change your reading language. Failures and retries also match the original passage. Existing dual translations open locally; when no service is configured the generation entry is honestly disabled while source text and existing translations remain.

Chinese source text reads directly, and without an existing translation only the source view is offered, never labelled English or missing. Chinese passages do not call the Chinese translation service; existing dual-translation records remain readable. Excerpts are marked “Chinese source”, and note quotes record separately whether they point at the source or a translation. Chinese/English recognition uses text heuristics and also corrects early language marks when loading old private books; this does not claim accurate recognition of arbitrary mixed-language books.

The existing room export, restore and grant domain APIs stay compatible with older clients; the new room no longer shows that operations panel. Backups include extracted source text, translations, notes and positions, but never the source PDF or keys; originals are stored separately. The restore notes below apply to older clients and the domain APIs.

Restore first inspects the whole backup, then checks each book against existing source text. Format errors name the failing book and nothing is written during inspection; after passing, restore proceeds per book and data batch. Network drops or write failures can leave partially restored data, the page says so, and the same backup can be chosen again to merge. Restored positions use this instance’s incrementing versions, and old reading tabs must still handle position conflicts.

### Reading conversation

“Reading conversation” in the sidebar opens a window around the current book. You can read the source, literal and interpretive translations first, and a model runs only after a question is explicitly sent. Answers are marked AI explanation candidates whose quotes jump back to the source; your questions are saved to their passages and can be revisited in the reading calendar.

The conversation uses the official DeepSeek Harness and by default pages through only the current book on request; next to the send box you can explicitly choose and save “room, public catalog and web”. It sends the question, book title, current chapter and passage position, up to six recent conversation turns within the allowed scope, and the text and search terms it reads on request; private comments are never read automatically. Scopes, cloud processing and restore rules are in [Reading conversation scopes](docs/reading-chat-scope.md). Each generation has context, time and cost limits. Closing the window keeps the draft, stopping interrupts the running instance, and a refresh first recovers the original request instead of generating the same question twice. Without a model configured the draft is kept and send is disabled. Each book keeps up to 100 questions, and the window can export the conversation; this is a bounded release without unlimited history.

### Narration and chapter talks

Select text and press “Read aloud”, or choose “Listen from here” in a passage’s more-menu. “Listen to this chapter” at the chapter head offers an opening guide, narration from the current position and a two-host talk, with a whole-book tour one step further. DeepSeek drafts and verifies the script in batches from the source text, Gemini voices it, and the script can be expanded and edited at any time. The bottom player offers pause, speed, passage steps, jump-to-source and download; on phones, tap the content title for more actions.

Voice and the two hosts’ preferences live in “Reading settings → Listening → Voice and speed”. Speed changes happen locally and never regenerate. A first preview generates one fixed short text and repeats reuse the existing voice. Untranslated content is clearly flagged and you can choose to hear the corresponding source instead.

Text work uses DeepSeek while speech talks to the official Google Gemini 3.8 Flash TTS and receives WAV audio. Day-to-day, fill `DEEPSEEK_API_KEY` and `GEMINI_API_KEY` in `.env` and keep the unified model defaults. Overrides use `READER_TRANSLATION_MODEL`, `READER_AUDIO_SCRIPT_MODEL` and `READER_SPEECH_MODEL`. The older `.env.audio`, `READER_DIALOGUE_MODEL` and `npm run start:configured` remain compatible; precedence is in [Configuration](docs/configuration.md). Images have no generation entry yet and the default template shows no image model. Real environment configuration never enters Git or exports, and the public template keeps only variables and placeholders.

Generating speech needs valid credits; insufficient balance shows the real error without retrying charges or switching providers. Cancel stops later segments and rejects late results; requests already sent to the provider may still bill. Listening position is independent of reading position and time, and playback waits for your tap after a restore.

Sound settings export and restore a listening backup containing scripts, voices, preferences and playback position. Restore packs are limited to 32 MB and larger records download audio separately. Import verifies every source and voice hash before writing and never overwrites conflicting edited scripts. Books themselves migrate through the regular room backup. “Saved listening” at the chapter head and in sound settings opens audio and scripts and waits for playback after restore; the script version used for voicing is kept separately so later edits never rewrite the basis of old audio. The listening list can also export scripts and positions only.

Local and hosted deployments share the listening domain logic. Hosted jobs use Supabase private storage, concurrency leases and bounded background processing; leaving the page lets saved jobs finish unsubmitted steps. Text, talks and reading positions are stored separately. “Ask here” pauses the audio and opens an existing conversation draft with the source reference without sending. Full scopes, costs and recovery notes are in [Guided listening](docs/guided-listening.md). Voice cloning is not available.

The current guided-listening implementation and verification are in the [2026-10-17 acceptance record](docs/verification/2026-10-17-guided-listening.md): a real official Gemini two-host sample was generated and the local browser verified playback, source jumps, question drafts and segment continuation.

Verification evidence lives in the Git-ignored `local/verification/audio-reading/`. Earlier record (2026-10-15): a real DeepSeek synthesis produced an 8-round material script and passed quote checks; the first Gemini short-text request returned 402 and produced no real speech. Player, editing and migration were verified with isolated audio, which cannot claim Gemini audio quality or playback latency.

### Connecting MCP

The new room removed the token and configuration panels. Existing MCP clients, per-book grants and revocation stay compatible; the protocol and scopes are in [_briefs/mcp-contract.md](_briefs/mcp-contract.md). The in-page reading conversation uses the signed-in account’s single-book permission directly and needs no separate MCP token.

Collapsing a token clears only this page; revocation stops future access immediately and clears the page’s token and configuration preview. Content already copied elsewhere is not deleted automatically. The official MCP SDK stdio entry connects to the same local reading service; a manual example on the default port:

```json
{
  "mcpServers": {
    "marginalia": {
      "command": "node",
      "args": ["/absolute/path/to/leafhour/server/mcp.mjs"],
      "env": {
        "READER_SERVICE_URL": "http://127.0.0.1:8330",
        "READER_AGENT_TOKEN": "your-scoped-token"
      }
    }
  }
}
```

Tools include `reader_get_context`, `reader_get_chapter`, `reader_search`, `reader_get_notes`, `reader_get_reading_activity` and `reader_add_comment`. Content, notes, activity and comment writing are authorized separately; writes accept only explicit user words and idempotency keys prevent double saves. Agent reads never add reading time. Local configuration connects to the loopback address; cloud configuration pins the release tag `v0.3.0` to the full commit `fb6141fc4ceea4a15131fb7abca8a2d6579d6eb1`, starts the same stdio adapter from the source package and explicitly allows the configured HTTPS room. Pinning the full commit fixes the version that actually runs and lets npm fetch the hosted source package directly. Remote access remains authorized per book and data type and rejects redirects; this is not a remote OAuth MCP endpoint. Generating configuration does not install anything into your agent.

## Private hosting

Public code and private data stay apart:

```text
Public repo: feature branch → PR → main → Vercel verification and deployment
                                 │ server-side secret
                                 ▼
                         Supabase private tables
                         ├─ book + translations
                         └─ notes + reading state
```

Schema migrations live in `supabase/migrations/`. The current version uses a dedicated `reader_documents` table and a private `reader-originals` bucket; RLS is on and `anon` and `authenticated` have no direct table rights. The two older single-book tables remain for compatibility and are not public entries. Vercel Functions reach them with a server-side secret. Full deployment steps are in [deploy/README.md](deploy/README.md) and the automation in [docs/ci-cd.md](docs/ci-cd.md).

The browser needs no server key. The “Hosted deployment” section of the single template [`.env.example`](.env.example) lists the variables; real values go into Vercel Environment Variables, and local runs use the Git-ignored `.env`.

Current database schema, account isolation, original storage and default test-data ownership are in [Database and default test room](docs/data-workspace.md).

## Content boundaries

The reader, data formats, migration, import/export and agent adapter can be open source. Whether book content may be public depends on each book’s license; the software license never grants the right to distribute the originals. Personal records belong by default to the operator’s own instance.

Read online: [leafhour.com](https://leafhour.com)

Project home: [GitHub](https://github.com/getyak/leafhour)

## License

[GNU Affero General Public License v3.0](LICENSE). If you offer a modified version over a network, you must offer its source to the service’s users.
