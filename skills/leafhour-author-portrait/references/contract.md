# Person candidate contract — schema 1

The server stores the complete record below. In runtime patch mode, return only `{"patch":{...}}`: permitted fields are `intro,birth,death,events,works,contexts,excerpts,claims`. Omit untouched fields. Do not echo sources, identity, portrait, revision or visibility; the adapter preserves them. Write only the requested locale. Empty arrays are valid. Prefer about 6 events, 3 works and 1 excerpt in a small first batch. Formal task limits remain 20 events, 8 works, 1 context and 3 excerpts. All new claims must use supplied source ids and status `uncertain`. Generation cannot verify or upgrade a claim.

Complete record keys:
`schemaVersion,id,revision,visibility,originalName,names,intro,birth,death,portrait,periods,events,works,contexts,excerpts,sources,claims`.

Use the existing person id and expected revision. Visibility stays private for generated candidates. Locale maps contain only `en`, `zh-Hans`, `zh-Hant`, `ja` and genuinely authored text. Dates are null or `{value,precision,claimIds}`; precision is `year|month|day|approximate|range|unknown|disputed`.

- Period: `{id,from,to,title,summary,eventIds}`; from/to are strings or null.
- Event: `{id,date,title,body,kind,workIds,claimIds}`.
- Work: `{id,title,originalTitle,kind,year,bookId,summary,claimIds}`; year is a date object; bookId is null unless supplied as an exact public catalogue mapping.
- Context: `{workId,body,relationship,eventIds,claimIds,excerptIds}`. Relationship: `author_testimony|documented_relation|editorial_interpretation|contemporary_context`.
- Excerpt: `{id,text,language,workId,sourceId,locator,claimIds,translations}`. Translations are a locale map of `{text,status,attribution}` with status `draft|reviewed`.
- Source: `{id,url,title,publisher,accessedAt,license,excerpt,read,digest}`. Copy the service's supplied sources unchanged; digest is SHA-256 of the exact UTF-8 excerpt. Never claim an unread source was read.
- Claim: `{id,text,sourceIds,status}` with status `verified|uncertain|interpretation`. All references must resolve. Existing reviewed claims require read sources; this is an integrity condition and does not authorize generation to mark a claim verified. Every quotation is a continuous exact substring of its source excerpt.

`names,intro,title,summary,body,portrait.alt` are locale maps. `claim.text` is plain text. Portrait is null or `{url,alt,credit,license,sourceId}` referencing supplied public licence evidence. Preserve the supplied portrait exactly.

Woolf's October 1928 talks and the 1929 essay are related by her introductory note. Shelley's 1831 introduction is retrospective testimony about 1816, separate from the PG84 text in the public catalogue. Carse's private book is not a public text source; use public publisher facts and leave undocumented writing motives open.
