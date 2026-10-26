const layers = new Set(['source', 'literal', 'interpretive']);
const hasText = value => typeof value === 'string' && !!value.trim();
const validQuote = quote => quote && typeof quote === 'object' && hasText(quote.passageId) && hasText(quote.version) && layers.has(quote.layer) && hasText(quote.text);

export function quoteIdentity(quote) {
  if (!quote) return '';
  return JSON.stringify([quote.passageId, quote.version, quote.layer, quote.startUtf16, quote.endUtf16, quote.text]);
}

export function resolveCompanionContext({readingQuote,discussionQuote,discussionStarted=false,draft='',question='',pendingTurn=null}) {
  const established = discussionStarted === true || hasText(draft) || hasText(question);
  const pending = validQuote(pendingTurn?.quote) && hasText(pendingTurn?.question);
  const continuing = established || pending;
  const chosen = established ? discussionQuote : pending ? pendingTurn.quote : readingQuote;
  const quote = validQuote(chosen) ? {...chosen} : null;
  const reading = validQuote(readingQuote) ? readingQuote : null;
  const same = !!quote && !!reading && quoteIdentity(quote) === quoteIdentity(reading);
  const samePassage = !!quote && !!reading && quote.passageId === reading.passageId && quote.version === reading.version && quote.layer === reading.layer;
  return {
    mode: !quote ? 'blocked' : continuing ? 'discussion' : 'reading',
    label: continuing ? '继续讨论' : '读到这里',
    quote,
    relation: same ? 'current' : samePassage ? 'selection' : 'previous',
    canAskCurrent: !!quote && !!reading && continuing && !same,
  };
}
