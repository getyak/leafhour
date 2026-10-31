# GET-348 loading experience

The calendar currently paints an unstyled `ws.loading` paragraph before session,
book list, lazy workspace module and stylesheet settle. The mounted workspace
then paints empty records before its requests settle. Both are real pending
states, not empty data.

Reuse the existing paper companion, paper colors, reading typography and verified
Alice excerpt. The server supplies the companion before JavaScript; the same
arrival controller spans session and module loading, then the workspace owns its
first data load. Calendar, notes and library have distinct localized statuses.
Public excerpts remain identified as source excerpts or Chinese AI drafts; they
never imply personal ownership, progress, completed reading or a private quote.

An initial pending state hides unknown records. Refreshes retain readable loaded
content. Failures stop the arrival and expose error/retry; guest mode exposes
sign-in. Keep workspace tabs, library return, focus, owner isolation and drafts.
Reuse the existing reduced-motion and visibility pause rules. No paid requests.

Alternatives considered: styling only the paragraph misses data loading; a new
full-screen overlay obscures navigation and duplicates the arrival lifecycle.
The shared in-content arrival is the implementation choice within the dispatched
scope, which explicitly authorizes implementation without another scope approval.

Validate English and Chinese (plus existing Japanese/traditional support), 320px
and desktop, blocked scripts/auth/data, module and request failure/retry,
first entry, navigation/back/reload, keyboard and reduced motion. Controlled
transport fixtures and real production checks are recorded separately.
