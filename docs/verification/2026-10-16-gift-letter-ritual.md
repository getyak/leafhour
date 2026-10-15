# Gift letter ritual · 2026-10-16

## Intent and delivered design

The user asked for a memorable gift that begins with opening an envelope, using soft sage grain, tactile stationery, imperfect lines and considered Chinese type. Reference screenshots informed material and pacing only. No reference logo, artwork, font or promotional text was copied.

The recipient sees an addressed envelope, the project's own book stamp, a postmark and a green seal. Opening lifts the flap, draws out the letter and unfolds it; folding reverses the same spring. The letter has an original irregular perforated alpha mask, a faint fold, Kaiti personal words and signature, Songti book titles, and quiet sans-serif controls. The existing original paper texture is reused. No external font requests, generated greetings, repeated motion or artificial loading wait were added.

The sender writes, previews the real recipient page, then explicitly seals a link. Copying or invoking system share remains a separate action. The result says the link has not been sent. Drafts and sealed results survive closing/reopening during the same loaded account session; changing account clears them. History lists sealed letters and keeps revocation available.

## Sharing and privacy boundaries

`/gift-preview` serves the real letter document in a same-origin iframe. The parent sends an explicit whitelist of visible book/letter metadata, never the original, private records, email, token or reading package. Both origin and source window are checked. The preview makes no API requests and intercepts recipient actions. Only this local preview route gains same-origin framing permission; the local server retains its other CSP directives. Actual gift links keep their prior endpoint and clean-URL rewrite.

The existing package/download/accept contract is retained. Full extracted original and optionally existing translations travel with the link; personal notes, questions, position and time do not. A shared public-signature helper gives the same visible sender before/after sealing and never derives a signature from an email address. A request/revision guard prevents an older background seal response from replacing a newer letter or deleting an edited draft.

## Automated checks

- Full Node test suite with concurrency 2: **574 total, 573 passed, 1 platform-specific skip, 0 failures/cancellations**. The first unrestricted parallel run hit three runtime-test timeouts under concurrent machine load; the bounded full run passed without increasing timeouts or changing those tests.
- New preview/spring tests cover whitelist, exact origin/source, malformed messages, real HTTP frame policy, continuous reversal, exact settling and reduced motion. Regression tests first failed for stale seal responses and the unpreviewed email-derived sender; all 24 focused service/preview/state tests then passed. The final state refinement passed both state tests again.
- Isolated reading runtime initialized: 927 files, 9.0 MB, no model calls. Hosted build, public-content scan, 303-file release allowlist and release provenance verification passed.
- Production smoke now checks both gift routes, preview frame policy, new stationery modules/masks, the real gift page identity, and existing anonymous catalog/profile access boundaries.

## Browser acceptance

Performed in the real in-app browser against a localhost-only server on port 8374. Public Walden plus a synthetic sender/recipient/message lived in an isolated temporary directory. No real cloud account, uploaded personal book, email delivery, calendar event or model request was involved.

- Wrote a two-line gift; returning to edit and closing/reopening preserved both fields. Preview used the actual envelope and letter. Network inspection showed no POST during writing/preview, and exactly one gift-creation POST after the explicit seal action.
- Reopened the composer and recovered the same sealed link without generating another. The system-share sheet was not submitted to any recipient.
- Opened/folded with keyboard, verified focus moves to the book heading, and tested reduced motion plus night appearance. The spring unit tests verify no pending frame after settling.
- Recipient layouts at 320, 390, 810, 1024, 1440 and 1920 CSS pixels had zero horizontal overflow. The 320-pixel composer/iframe also fit with a long recipient name and 450-character note. The iframe stays scrollable for long letters; the composer scrolls on short phone screens.
- Downloaded the real verified package through the browser; parsed a `marginalia-library` backup with exactly one book. Accepting an already-owned public book preserved it and reported the existing copy.
- Logged out of the temporary local account, opened the letter anonymously, chose to add it, logged into the local fixture, and returned to the already unfolded letter. The user still explicitly chooses acceptance after login.
- No warning/error console entries on the final letter/composer flows.

Local evidence is intentionally excluded from release: `local/gift-ritual-qa/envelope-desktop.png`, `letter-desktop-final.png`, `composer-writing.png`, `composer-preview.png`, `composer-sealed.png`, `letter-mobile.png`, `envelope-mobile-night.png`, `letter-mobile-night.png`, and the verification logs. These demonstrate the isolated application, not authenticated production delivery. Production source/deployment is verified separately after merge.
