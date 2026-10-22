-- Execute only against a disposable database after creating anon, authenticated,
-- service_role (BYPASSRLS) and applying 202610210001_credit_billing.sql.
-- node --test tests/billing-postgres.test.mjs does all of that automatically.
begin;
create function pg_temp.billing_assert(condition boolean,label text) returns void language plpgsql as $$
begin if condition is distinct from true then raise exception 'billing invariant failed: %',label; end if; end;
$$;
create function pg_temp.billing_error(action text,payload jsonb,expected text) returns void language plpgsql as $$
begin
  begin perform public.reader_billing_command(action,payload);
  exception when sqlstate 'P0001' then
    if sqlerrm='reader_billing:'||expected then return; end if; raise;
  end;
  raise exception 'billing expected error % for %',expected,action;
end;
$$;
-- GRANT requires the real temporary schema name, not the pg_temp alias.
do $$ begin execute format('grant usage on schema %I to service_role',pg_my_temp_schema()::regnamespace); end; $$;
select pg_temp.billing_assert(not has_function_privilege('anon','public.reader_billing_command(text,jsonb)','EXECUTE'),'anonymous RPC denied');
select pg_temp.billing_assert(not has_function_privilege('authenticated','public.reader_billing_command(text,jsonb)','EXECUTE'),'authenticated RPC denied');
select pg_temp.billing_assert(not has_table_privilege('authenticated','public.billing_entries','SELECT'),'authenticated tables denied');
select pg_temp.billing_assert((select bool_and(relrowsecurity) from pg_class where oid in ('public.billing_accounts'::regclass,'public.billing_entries'::regclass,'public.billing_orders'::regclass,'public.billing_credit_lots'::regclass)),'financial tables have RLS');
set local role service_role;
do $$
declare
  base jsonb='{"mode":"test","ownerId":"sql-owner","now":"2026-10-21T00:00:00Z"}';
  other jsonb='{"mode":"test","ownerId":"sql-other","now":"2026-10-21T00:00:00Z"}';
  held jsonb='{"mode":"test","ownerId":"sql-held","now":"2026-10-21T00:00:00Z"}';
  spent jsonb='{"mode":"test","ownerId":"sql-spent","now":"2026-10-21T00:00:00Z"}';
  order_data jsonb='{"id":"order-1","intentKey":"intent-1","productKey":"reading-100","productId":"product-test","amount":500,"currency":"USD","units":100}';
  payment_data jsonb='{"orderId":"order-1","eventId":"payment-1","eventHash":"hash-1","checkoutId":"checkout-1","providerOrderId":"provider-order-1","productId":"product-test","amount":500,"currency":"USD","paidAmount":500,"taxAmount":0,"discountAmount":0,"units":100}';
  quote_data jsonb='{"id":"quote-1","action":"translation","units":12,"scopeHash":"scope-1","scope":{"bookId":"synthetic-book","contentVersion":"v1","passageId":"p1"},"priceVersion":"v1","expiresAt":"2026-10-22T00:00:00Z"}';
  op jsonb; token_data jsonb; value jsonb; before_count bigint; n integer;
begin
  value=public.reader_billing_command('readiness','{"mode":"test"}');
  perform pg_temp.billing_assert(value->>'backend'='postgres' and (value->>'ready')::boolean,'readiness');
  value=public.reader_billing_command('account',base);
  perform pg_temp.billing_assert(value->>'availableUnits'='0' and not (value->>'trialGranted')::boolean,'empty account');
  perform pg_temp.billing_assert(not exists(select 1 from public.billing_accounts where owner_id='sql-owner'),'account GET is pure');
  value=public.reader_billing_command('trial',base||'{"grantId":"trial-1","units":10,"campaignBudgetUnits":1000}');
  value=public.reader_billing_command('trial',base||'{"grantId":"trial-new-id","units":999,"campaignBudgetUnits":1000}');
  perform pg_temp.billing_assert(value->>'availableUnits'='10' and value->>'grantedUnits'='10','trial once');
  perform pg_temp.billing_error('trial',other||'{"grantId":"trial-over-budget","units":1000,"campaignBudgetUnits":1000}','trial_budget_exhausted');
  value=public.reader_billing_command('account',base||'{"mode":"live"}');
  perform pg_temp.billing_assert(value->>'availableUnits'='0','mode isolation');

  value=public.reader_billing_command('order',base||order_data);
  value=public.reader_billing_command('order',base||order_data||'{"id":"unused-new-id"}');
  perform pg_temp.billing_assert(value->>'id'='order-1','purchase intent idempotent');
  perform pg_temp.billing_error('order',base||order_data||'{"units":101}','idempotency_conflict');
  value=public.reader_billing_command('getOrder',other||'{"orderId":"order-1"}');
  perform pg_temp.billing_assert(value is null,'foreign order not exposed');
  value=public.reader_billing_command('checkoutAttempt',base||'{"orderId":"order-1"}');
  perform pg_temp.billing_assert((value->>'claimed')::boolean,'checkout first claimant');
  value=public.reader_billing_command('checkoutAttempt',base||'{"orderId":"order-1"}');
  perform pg_temp.billing_assert(not (value->>'claimed')::boolean,'checkout subsequent claimant fenced');
  value=public.reader_billing_command('checkout',base||'{"orderId":"order-1","checkoutId":"checkout-1"}');
  value=public.reader_billing_command('checkout',base||'{"orderId":"order-1","checkoutId":"checkout-1","checkoutUrl":"https://checkout.creem.io/test"}');
  perform pg_temp.billing_assert(value->>'checkoutUrl'='https://checkout.creem.io/test','late URL binding');
  perform pg_temp.billing_error('payment',other||payment_data,'owner_mismatch');
  perform pg_temp.billing_error('payment',base||payment_data||'{"amount":501}','invalid_input');
  perform pg_temp.billing_error('payment',base||payment_data||'{"productId":"foreign-product"}','invalid_input');
  perform pg_temp.billing_error('payment',base||payment_data||'{"taxAmount":1}','invalid_input');
  for n in 1..10 loop value=public.reader_billing_command('payment',base||payment_data); end loop;
  value=public.reader_billing_command('payment',base||payment_data||'{"eventId":"payment-second-id","eventHash":"hash-second-id"}');
  value=public.reader_billing_command('account',base);
  perform pg_temp.billing_assert(value->>'availableUnits'='110','event and order dedupe grant once');
  perform pg_temp.billing_error('payment',base||payment_data||'{"eventHash":"changed"}','event_conflict');
  value=public.reader_billing_command('lookupOrder','{"mode":"test","providerOrderId":"provider-order-1"}');
  perform pg_temp.billing_assert(value->>'ownerId'='sql-owner','internal order lookup');
  value=public.reader_billing_command('lookupOrder','{"mode":"live","providerOrderId":"provider-order-1"}');
  perform pg_temp.billing_assert(value is null,'lookup respects mode');

  value=public.reader_billing_command('quote',base||quote_data);
  perform pg_temp.billing_error('reserve',base||'{"quoteId":"quote-1","operationId":"op-1","idempotencyKey":"idem-1","scopeHash":"wrong"}','quote_changed');
  op=public.reader_billing_command('reserve',base||'{"quoteId":"quote-1","operationId":"op-1","idempotencyKey":"idem-1","scopeHash":"scope-1"}');
  value=public.reader_billing_command('operation',base||'{"operationId":"op-1","consistent":true}');
  perform pg_temp.billing_assert(value->>'id'='op-1' and value->>'status'='reserved','consistent read sees committed reservation');
  value=public.reader_billing_command('operation',base||'{"operationId":"not-started","consistent":true}');
  perform pg_temp.billing_assert(value is null,'consistent read confirms absent operation for existing account');
  token_data=jsonb_build_object('operationId','op-1','reservationToken',op->>'reservationToken');
  value=public.reader_billing_command('reserve',base||'{"quoteId":"quote-1","operationId":"different-op","idempotencyKey":"idem-1","scopeHash":"scope-1"}');
  perform pg_temp.billing_assert(value->>'id'='op-1','reservation idempotency');
  perform pg_temp.billing_assert((select a.units=10 from public.billing_allocations a join public.billing_credit_lots l on l.mode=a.mode and l.id=a.lot_id where a.operation_id='op-1' and l.source='trial'),'trial spent before purchased FIFO');
  value=public.reader_billing_command('operation',other||'{"operationId":"op-1"}');
  perform pg_temp.billing_assert(value is null,'foreign operation not exposed');
  perform pg_temp.billing_error('running',base||token_data||'{"reservationToken":"wrong"}','stale_worker');
  value=public.reader_billing_command('running',base||token_data);
  perform pg_temp.billing_assert((value->>'executionClaimed')::boolean,'single execution claimant');
  value=public.reader_billing_command('running',base||token_data);
  perform pg_temp.billing_assert(not (value->>'executionClaimed')::boolean,'subsequent execution fenced');
  value=public.reader_billing_command('release',base||token_data||'{"expectedStatus":"reserved","reason":"recovery"}');
  perform pg_temp.billing_assert(value->>'status'='running','recovery release cannot race a claimed worker');
  perform pg_temp.billing_error('settle',base||token_data,'invalid_state');
  perform pg_temp.billing_error('result',base||token_data||'{"receipt":{"ownerId":"sql-owner","bookId":"synthetic-book","contentVersion":"wrong","passageId":"p1","resultId":"result-1"}}','invalid_receipt');
  value=public.reader_billing_command('result',base||token_data||'{"receipt":{"ownerId":"sql-owner","bookId":"synthetic-book","contentVersion":"v1","passageId":"p1","resultId":"result-1"}}');
  value=public.reader_billing_command('recover',base);
  perform pg_temp.billing_assert(jsonb_array_length(value->'operations')=1,'saved receipt recovery');
  value=public.reader_billing_command('settle',base||token_data);
  value=public.reader_billing_command('settle',base||token_data);
  value=public.reader_billing_command('account',base);
  perform pg_temp.billing_assert(value->>'consumedUnits'='12' and value->>'reservedUnits'='0','settle exactly once');
  value=public.reader_billing_command('ackPublished',base||'{"operationId":"op-1"}');
  value=public.reader_billing_command('recover',base);
  perform pg_temp.billing_assert(jsonb_array_length(value->'operations')=0,'acknowledged publication absent from recovery');
  value=public.reader_billing_command('reverse',base||'{"operationId":"op-1","reason":"publication_failed"}');
  value=public.reader_billing_command('reverse',base||'{"operationId":"op-1","reason":"publication_failed"}');
  value=public.reader_billing_command('account',base);
  perform pg_temp.billing_assert(value->>'consumedUnits'='0' and value->>'availableUnits'='110','reverse once');

  value=public.reader_billing_command('quote',base||quote_data||'{"id":"expired-quote"}');
  perform pg_temp.billing_error('reserve',base||'{"quoteId":"expired-quote","operationId":"expired-op","idempotencyKey":"expired-key","scopeHash":"scope-1","now":"2026-10-23T00:00:00Z"}','stale_quote');
  value=public.reader_billing_command('quote',base||quote_data||'{"id":"quote-race1","units":80}');
  value=public.reader_billing_command('quote',base||quote_data||'{"id":"quote-race2","units":80}');
  op=public.reader_billing_command('reserve',base||'{"quoteId":"quote-race1","operationId":"op-race1","idempotencyKey":"race1","scopeHash":"scope-1"}');
  perform pg_temp.billing_error('reserve',base||'{"quoteId":"quote-race2","operationId":"op-race2","idempotencyKey":"race2","scopeHash":"scope-1"}','insufficient_credits');
  value=public.reader_billing_command('release',base||jsonb_build_object('operationId','op-race1','reservationToken',op->>'reservationToken','reason','cancelled'));
  value=public.reader_billing_command('release',base||jsonb_build_object('operationId','op-race1','reservationToken',op->>'reservationToken','reason','cancelled'));
  value=public.reader_billing_command('account',base);
  perform pg_temp.billing_assert(value->>'reservedUnits'='0' and value->>'availableUnits'='110','cancel releases exactly once');

  -- A verified refund may arrive before the payment webhook. The later payment
  -- can only grant the unrevoked half, never the original complete entitlement.
  value=public.reader_billing_command('order',other||order_data||'{"id":"order-pre-refund","intentKey":"intent-pre-refund"}');
  value=public.reader_billing_command('checkout',other||'{"orderId":"order-pre-refund","checkoutId":"checkout-pre-refund"}');
  value=public.reader_billing_command('refund',other||'{"orderId":"order-pre-refund","eventId":"refund-early","eventHash":"refund-hash","refundId":"refund-id","refundAmount":250,"cumulativeRefundAmount":250,"paidAmount":500}');
  value=public.reader_billing_command('payment',other||payment_data||'{"orderId":"order-pre-refund","eventId":"payment-late","eventHash":"late-hash","checkoutId":"checkout-pre-refund","providerOrderId":"provider-pre-refund"}');
  value=public.reader_billing_command('account',other);
  perform pg_temp.billing_assert(value->>'availableUnits'='50','refund-before-payment does not resurrect credits');
  value=public.reader_billing_command('refund',other||'{"orderId":"order-pre-refund","eventId":"refund-new-event","eventHash":"refund-new-hash","refundId":"refund-id","refundAmount":250,"cumulativeRefundAmount":250,"paidAmount":500}');
  value=public.reader_billing_command('account',other);
  perform pg_temp.billing_assert(value->>'availableUnits'='50','refund IDs deduplicated across event IDs');
  value=public.reader_billing_command('dispute',other||'{"orderId":"order-pre-refund","eventId":"dispute-1","eventHash":"dispute-hash"}');
  value=public.reader_billing_command('payment',other||payment_data||'{"orderId":"order-pre-refund","eventId":"payment-after-dispute","eventHash":"after-dispute-hash","checkoutId":"checkout-pre-refund","providerOrderId":"provider-pre-refund"}');
  value=public.reader_billing_command('account',other);
  perform pg_temp.billing_assert(value->>'availableUnits'='0' and (value->>'frozen')::boolean,'dispute cannot resurrect credits');

  -- Refunding a held purchase cancels every affected operation before revocation.
  value=public.reader_billing_command('order',held||order_data||'{"id":"order-held","intentKey":"intent-held"}');
  value=public.reader_billing_command('checkout',held||'{"orderId":"order-held","checkoutId":"checkout-held"}');
  value=public.reader_billing_command('payment',held||payment_data||'{"orderId":"order-held","eventId":"payment-held","eventHash":"held-hash","checkoutId":"checkout-held","providerOrderId":"provider-held"}');
  value=public.reader_billing_command('quote',held||quote_data||'{"id":"quote-held","units":70}');
  op=public.reader_billing_command('reserve',held||'{"quoteId":"quote-held","operationId":"op-held","idempotencyKey":"idem-held","scopeHash":"scope-1"}');
  value=public.reader_billing_command('refund',held||'{"orderId":"order-held","eventId":"refund-held","eventHash":"refund-held-hash","refundId":"refund-held-id","refundAmount":500,"cumulativeRefundAmount":500,"paidAmount":500}');
  value=public.reader_billing_command('account',held);
  perform pg_temp.billing_assert(value->>'availableUnits'='0' and value->>'reservedUnits'='0','held refund leaves no dangling holds');
  value=public.reader_billing_command('operation',held||'{"operationId":"op-held"}');
  perform pg_temp.billing_assert(value->>'status'='released','refunded operation cancelled');
  perform pg_temp.billing_error('settle',held||jsonb_build_object('operationId','op-held','reservationToken',op->>'reservationToken'),'stale_worker');

  -- Spent entitlement is exposure, never a negative balance or silent replenishment.
  value=public.reader_billing_command('order',spent||order_data||'{"id":"order-spent","intentKey":"intent-spent"}');
  value=public.reader_billing_command('checkout',spent||'{"orderId":"order-spent","checkoutId":"checkout-spent"}');
  value=public.reader_billing_command('payment',spent||payment_data||'{"orderId":"order-spent","eventId":"payment-spent","eventHash":"spent-hash","checkoutId":"checkout-spent","providerOrderId":"provider-spent"}');
  value=public.reader_billing_command('quote',spent||quote_data||'{"id":"quote-spent","units":40}');
  op=public.reader_billing_command('reserve',spent||'{"quoteId":"quote-spent","operationId":"op-spent","idempotencyKey":"idem-spent","scopeHash":"scope-1"}');
  token_data=jsonb_build_object('operationId','op-spent','reservationToken',op->>'reservationToken');
  value=public.reader_billing_command('result',spent||token_data||'{"receipt":{"ownerId":"sql-spent","bookId":"synthetic-book","contentVersion":"v1","passageId":"p1","resultId":"result-spent"}}');
  value=public.reader_billing_command('settle',spent||token_data);
  value=public.reader_billing_command('refund',spent||'{"orderId":"order-spent","eventId":"refund-spent","eventHash":"refund-spent-hash","refundId":"refund-spent-id","refundAmount":500,"cumulativeRefundAmount":500,"paidAmount":500}');
  value=public.reader_billing_command('account',spent);
  perform pg_temp.billing_assert(value->>'availableUnits'='0' and (value->>'frozen')::boolean,'spent refund freezes without negative balance');
  value=public.reader_billing_command('reverse',spent||'{"operationId":"op-spent"}');
  value=public.reader_billing_command('account',spent);
  perform pg_temp.billing_assert(value->>'availableUnits'='0' and value->>'consumedUnits'='0' and not (value->>'frozen')::boolean,'full consumption reversal cannot restore refunded credits and clears resolved exposure');
  perform pg_temp.billing_assert((select units=40 and restored_units=0 from public.billing_entries where mode='test' and operation_id='op-spent' and type='reverse'),'full consumption and restored balance remain distinct');
  value=public.reader_billing_command('getOrder',spent||'{"orderId":"order-spent"}');
  perform pg_temp.billing_assert(value->>'exposureUnits'='0','reversal clears the order refund exposure');

  value=public.reader_billing_command('providerCall',base||'{"id":"call-unknown","feature":"translation","funding":"credits","provider":"synthetic","model":"synthetic","status":"failed","usage":null,"costMicrousd":null,"costStatus":"unknown","startedAt":"2026-10-21T00:00:00Z"}');
  value=public.reader_billing_command('providerCall',base||'{"id":"call-unknown","feature":"translation","funding":"credits","provider":"synthetic","model":"synthetic","status":"failed","usage":null,"costMicrousd":null,"costStatus":"unknown","startedAt":"2026-10-21T00:00:00Z"}');
  value=public.reader_billing_command('providerCall',base||'{"id":"call-known","feature":"translation","funding":"sponsored","provider":"synthetic","model":"synthetic","status":"succeeded","usage":{"inputTokens":2,"outputTokens":1,"cacheReadTokens":0,"cacheWriteTokens":0},"costMicrousd":3,"costStatus":"reported_usage_rated","pricingVersion":"synthetic-rate-v1","startedAt":"2026-10-21T00:00:00Z"}');
  perform pg_temp.billing_assert((select price_version='synthetic-rate-v1' from public.billing_provider_calls where mode='test' and id='call-known'),'actual pricing version persisted');
  value=public.reader_billing_command('summary','{"mode":"test","from":"2026-10-21T00:00:00Z","to":"2026-10-22T00:00:00Z"}');
  perform pg_temp.billing_assert(value->>'calls'='2' and value->>'unknownCostCalls'='1' and value->>'knownCostMicrousd'='3','usage remains unknown and attempt IDs dedupe');
  perform pg_temp.billing_assert(value->'callsByFunding'->'sponsored'->>'knownCostMicrousd'='3' and value->'callsByFeature'->'translation'->>'calls'='2','cost grouped by funding and feature');
  perform pg_temp.billing_assert(value->'grantedUnitsBySource'->>'trial'='10' and value->'consumedUnitsBySource'->>'trial'='0' and value->'consumedUnitsBySource'->>'purchase'='0','immutable source accounting');
  perform pg_temp.billing_assert(value->>'trialGrants'='1' and value->>'reviewOrders'='0' and (value->>'costCoverage')::numeric=0.5 and value->>'paymentFeesStatus'='unknown','coverage and cash categories remain explicit');
  perform pg_temp.billing_assert(value->'salesByCurrency'->>'USD'='2000' and value->'refundsByCurrency'->>'USD'='1250','cash totals from immutable event facts');
  value=public.reader_billing_command('summary','{"mode":"test","from":"2026-10-21T00:00:01Z","to":"2026-10-22T00:00:00Z"}');
  perform pg_temp.billing_assert(value->>'calls'='0' and value->>'costCoverage' is null and value->'salesByCurrency'='{}'::jsonb,'half-open event time and empty coverage');
  value=public.reader_billing_command('entries',base||'{"limit":2}');
  perform pg_temp.billing_assert(jsonb_array_length(value->'entries')=2 and value->>'nextCursor' is not null,'entry cursor pagination');
  value=public.reader_billing_command('entries',base||jsonb_build_object('limit',2,'cursor',value->>'nextCursor'));
  perform pg_temp.billing_assert(jsonb_array_length(value->'entries')=2,'entry second page');
  value=public.reader_billing_command('orders',base||'{"limit":1}');
  perform pg_temp.billing_assert(jsonb_array_length(value->'orders')=1,'orders pagination');
  -- A lost worker leaves an unknown dispatch. Completion enriches that same row,
  -- never its account/source identity, and never an already terminal receipt.
  value=public.reader_billing_command('providerCall',base||'{"id":"call-dispatched","feature":"translation","funding":"credits","provider":"synthetic","model":"synthetic","status":"unknown","usage":{"inputTokens":null,"outputTokens":null,"cacheReadTokens":null,"cacheWriteTokens":null},"costMicrousd":null,"costStatus":"unknown","startedAt":"2026-10-21T00:00:00Z"}');
  value=public.reader_billing_command('summary','{"mode":"test","from":"2026-10-21T00:00:00Z","to":"2026-10-22T00:00:00Z"}');
  perform pg_temp.billing_assert(value->>'calls'='3' and value->>'unknownCostCalls'='2','unfinished dispatch contributes unknown cost coverage');
  perform pg_temp.billing_error('providerCall',base||'{"id":"call-dispatched","feature":"conversation","funding":"credits","provider":"synthetic","model":"synthetic","status":"completed","usage":{"inputTokens":2,"outputTokens":1,"cacheReadTokens":0,"cacheWriteTokens":0},"costMicrousd":3,"costStatus":"reported_usage_rated","startedAt":"2026-10-21T00:00:00Z","finishedAt":"2026-10-21T00:00:01Z"}','idempotency_conflict');
  value=public.reader_billing_command('providerCall',base||'{"id":"call-dispatched","feature":"translation","funding":"credits","provider":"synthetic","model":"synthetic","status":"completed","usage":{"inputTokens":2,"outputTokens":1,"cacheReadTokens":0,"cacheWriteTokens":0},"costMicrousd":3,"costStatus":"reported_usage_rated","startedAt":"2026-10-21T00:00:00Z","finishedAt":"2026-10-21T00:00:01Z"}');
  value=public.reader_billing_command('summary','{"mode":"test","from":"2026-10-21T00:00:00Z","to":"2026-10-22T00:00:00Z"}');
  perform pg_temp.billing_assert(value->>'calls'='3' and value->>'unknownCostCalls'='1' and value->>'knownCostMicrousd'='6','completion updates one attempt without double counting');
  perform pg_temp.billing_error('providerCall',base||'{"id":"call-dispatched","feature":"translation","funding":"credits","provider":"synthetic","model":"synthetic","status":"failed","usage":{"inputTokens":2,"outputTokens":1,"cacheReadTokens":0,"cacheWriteTokens":0},"costMicrousd":3,"costStatus":"reported_usage_rated","startedAt":"2026-10-21T00:00:00Z","finishedAt":"2026-10-21T00:00:01Z"}','idempotency_conflict');
  begin
    update public.billing_entries set units=999 where mode='test' and owner_id='sql-owner';
    raise exception 'immutable ledger update was allowed';
  exception when sqlstate 'P0001' then
    if sqlerrm<>'reader_billing:invalid_state' then raise; end if;
  end;
  begin
    delete from public.billing_entries where mode='test' and owner_id='sql-owner';
    raise exception 'immutable ledger delete was allowed';
  exception when sqlstate 'P0001' then
    if sqlerrm<>'reader_billing:invalid_state' then raise; end if;
  end;
end;
$$;
reset role;
select 'billing_sql_invariants_passed';
rollback;
