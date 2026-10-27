# Calendar date-only labels across time zones

The post-merge production review found an existing date-label defect made more visible by the shelf calendar: a date key represented as UTC noon was formatted in the browser's time zone. In Kiritimati, Auckland and Fiji, October31 appeared as November1 and weekday headers shifted to Tuesday-first while the grid stayed Monday-first.

The three date-only formatters now explicitly use UTC. Real reading instants, local-day aggregation, source intervals and saved records retain their existing time zones. No migration is needed.

The actual mounted-dashboard regression first failed with `November 1` for `2026-10-31`, then passed in all three default-zone simulations. All30 focused dashboard/calendar/activity/locale tests and the hosted build passed. Independent review reran6 mounted-dashboard tests and approved the patch. Complete current-commit CI is required before merge; final production outcome is recorded in the delivery PR metadata.
