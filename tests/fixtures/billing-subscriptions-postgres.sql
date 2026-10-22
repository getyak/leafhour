-- Isolated synthetic cluster only; no existing user data or external connections.
begin;
create function pg_temp.subscription_assert(condition boolean,label text) returns void language plpgsql as $$
begin if condition is distinct from true then raise exception 'subscription invariant failed: %',label; end if; end;
$$;
create function pg_temp.subscription_error(action text,payload jsonb,expected text) returns void language plpgsql as $$
begin
  begin perform public.reader_billing_command(action,payload);
  exception when sqlstate 'P0001' then if sqlerrm='reader_billing:'||expected then return; end if; raise; end;
  raise exception 'expected subscription error % for %',expected,action;
end;
$$;
-- GRANT requires the real temporary schema name, not the pg_temp alias.
do $$ begin execute format('grant usage on schema %I to service_role',pg_my_temp_schema()::regnamespace); end; $$;
select pg_temp.subscription_assert(not has_function_privilege('anon','public.reader_billing_command(text,jsonb)','EXECUTE'),'anonymous RPC denied');
select pg_temp.subscription_assert(not has_function_privilege('authenticated','public.reader_billing_command_v1(text,jsonb)','EXECUTE'),'old RPC denied');
select pg_temp.subscription_assert(not has_table_privilege('authenticated','public.billing_subscriptions','SELECT'),'subscription table denied');
set local role service_role;
do $$
declare
  base jsonb='{"mode":"test","ownerId":"synthetic-sql-monthly","now":"2026-10-21T00:00:00Z"}';
  other jsonb='{"mode":"test","ownerId":"synthetic-sql-other","now":"2026-10-21T00:00:00Z"}';
  expiry jsonb='{"mode":"test","ownerId":"synthetic-sql-expiry","now":"2026-10-21T00:00:00Z"}';
  order_data jsonb='{"id":"monthly-initial","intentKey":"monthly-intent","productKey":"reading_monthly_100","productId":"monthly-product","amount":500,"currency":"USD","units":100000000}';
  bind_data jsonb='{"subscriptionId":"sub-1","customerId":"customer-1","orderId":"monthly-initial","providerOrderId":"provider-initial","productKey":"reading_monthly_100","productId":"monthly-product","status":"active","currentPeriodStart":"2026-10-21T00:00:00Z","currentPeriodEnd":"2026-11-21T00:00:00Z","supplierUpdatedAt":"2026-10-21T00:00:01Z"}';
  payment jsonb='{"subscriptionId":"sub-1","customerId":"customer-1","transactionId":"tx-initial","providerOrderId":"provider-initial","orderId":"monthly-initial","periodStart":"2026-10-21T00:00:00Z","periodEnd":"2026-11-21T00:00:00Z","amount":500,"paidAmount":500,"taxAmount":0,"discountAmount":0,"currency":"USD","units":100000000,"eventId":"paid-initial","eventHash":"hash-initial"}';
  renewal jsonb; value jsonb; cycle_id text;
begin
  value=public.reader_billing_command('readiness','{"mode":"test"}');perform pg_temp.subscription_assert(value->>'schemaVersion'='2','additive schema ready');
  value=public.reader_billing_command('order',base||order_data);
  perform pg_temp.subscription_error('order',base||order_data||'{"id":"duplicate-monthly","intentKey":"duplicate-intent"}','subscription_exists');
  value=public.reader_billing_command('checkout',base||'{"orderId":"monthly-initial","checkoutId":"checkout-initial"}');
  value=public.reader_billing_command('bindSubscription',base||bind_data);
  perform pg_temp.subscription_assert(value->>'initialProviderOrderId'='provider-initial','initial payment lookup binding');
  value=public.reader_billing_command('lookupOrder','{"mode":"test","providerOrderId":"provider-initial"}');perform pg_temp.subscription_assert(value->>'id'='monthly-initial','prepayment refund lookup');
  value=public.reader_billing_command('subscriptionPaid',base||payment);
  value=public.reader_billing_command('subscriptionPaid',base||payment||'{"eventId":"paid-initial-repeat","eventHash":"hash-repeat"}');
  value=public.reader_billing_command('account',base);perform pg_temp.subscription_assert(value->>'availableUnits'='100000000','initial exactly once');
  renewal=(payment-'orderId')||'{"transactionId":"tx-renewal","providerOrderId":"provider-renewal","periodStart":"2026-11-21T00:00:00Z","periodEnd":"2026-12-21T00:00:00Z","eventId":"paid-renewal","eventHash":"hash-renewal"}';
  value=public.reader_billing_command('subscriptionPaid',base||renewal);cycle_id=value->>'id';perform pg_temp.subscription_assert(cycle_id<>'monthly-initial','distinct renewal financial order');
  value=public.reader_billing_command('subscriptionPaid',base||renewal||'{"eventId":"renewal-repeat","eventHash":"renewal-repeat-hash"}');
  perform pg_temp.subscription_error('subscriptionPaid',base||renewal||'{"transactionId":"tx-period-replay","providerOrderId":"provider-replay","eventId":"replayed-period","eventHash":"replayed-period-hash"}','payment_mismatch');
  perform pg_temp.subscription_error('subscriptionPaid',base||renewal||'{"paidAmount":600,"taxAmount":100,"eventId":"money-replay","eventHash":"money-hash"}','payment_mismatch');
  value=public.reader_billing_command('account',base);perform pg_temp.subscription_assert(value->>'availableUnits'='200000000','renewal exactly once');
  value=public.reader_billing_command('refund',base||jsonb_build_object('orderId',cycle_id,'eventId','refund-renewal','eventHash','refund-hash','refundId','refund-id','refundAmount',500,'cumulativeRefundAmount',500,'paidAmount',500));
  value=public.reader_billing_command('subscriptionPaid',base||renewal||'{"eventId":"late-paid","eventHash":"late-hash"}');
  value=public.reader_billing_command('account',base);perform pg_temp.subscription_assert(value->>'availableUnits'='100000000','late paid cannot revive renewal');
  value=public.reader_billing_command('subscriptionState',base||bind_data||'{"status":"scheduled_cancel","supplierUpdatedAt":"2026-10-23T00:00:00Z"}');
  value=public.reader_billing_command('subscriptionState',base||bind_data||'{"status":"active","supplierUpdatedAt":"2026-10-22T00:00:00Z"}');perform pg_temp.subscription_assert(value->>'status'='scheduled_cancel','state monotonic');
  perform pg_temp.subscription_error('subscriptionState',base||bind_data||'{"status":"paused","supplierUpdatedAt":"2026-10-23T00:00:00Z"}','idempotency_conflict');
  value=public.reader_billing_command('subscriptions',other);perform pg_temp.subscription_assert(jsonb_array_length(value->'subscriptions')=0,'owner isolated list');
  value=public.reader_billing_command('lookupSubscription','{"mode":"live","subscriptionId":"sub-1"}');perform pg_temp.subscription_assert(value is null,'mode isolated lookup');
  value=public.reader_billing_command('order',other||order_data||'{"id":"other-order"}');
  value=public.reader_billing_command('checkout',other||'{"orderId":"other-order","checkoutId":"checkout-other"}');
  perform pg_temp.subscription_error('bindSubscription',other||bind_data||'{"orderId":"other-order"}','owner_mismatch');
  value=public.reader_billing_command('subscriptionState',base||bind_data||'{"status":"canceled","supplierUpdatedAt":"2026-10-24T00:00:00Z"}');
  value=public.reader_billing_command('order',base||order_data||'{"id":"replacement","intentKey":"replacement-intent"}');
  value=public.reader_billing_command('summary','{"mode":"test","from":"2026-10-01T00:00:00Z","to":"2026-12-01T00:00:00Z"}');perform pg_temp.subscription_assert(value->>'monthlyPaidOrders'='2' and value->>'oneTimePaidOrders'='0','monthly summary');
  -- Supplier refund/dispute snapshots are applied in the very same paid command.
  value=public.reader_billing_command('bindSubscription',other||bind_data||'{"subscriptionId":"sub-other","customerId":"customer-other","orderId":"other-order","providerOrderId":"other-provider"}');
  value=public.reader_billing_command('subscriptionPaid',other||payment||'{"subscriptionId":"sub-other","customerId":"customer-other","orderId":"other-order","providerOrderId":"other-provider","transactionId":"tx-other","eventId":"paid-refunded","eventHash":"refunded-hash","cumulativeRefundAmount":500}');
  perform pg_temp.subscription_assert(value->>'status'='refunded','refund snapshot tombstone');
  value=public.reader_billing_command('account',other);perform pg_temp.subscription_assert(value->>'availableUnits'='0','refunded cycle never available');
  -- Expiry comes only from a verified supplier snapshot in the domain. The
  -- transaction still fences identity, actual payments and subscription binds.
  value=public.reader_billing_command('order',expiry||order_data||'{"id":"expiry-order","intentKey":"expiry-intent"}');
  perform pg_temp.subscription_error('expireCheckout',expiry||'{"orderId":"expiry-order","checkoutId":"expiry-checkout"}','invalid_state');
  value=public.reader_billing_command('checkout',expiry||'{"orderId":"expiry-order","checkoutId":"expiry-checkout"}');
  perform pg_temp.subscription_error('expireCheckout',expiry||'{"orderId":"expiry-order","checkoutId":"wrong-checkout"}','payment_mismatch');
  perform pg_temp.subscription_error('expireCheckout',other||'{"orderId":"expiry-order","checkoutId":"expiry-checkout"}','owner_mismatch');
  perform pg_temp.subscription_error('expireCheckout',expiry||'{"mode":"live","orderId":"expiry-order","checkoutId":"expiry-checkout"}','not_found');
  value=public.reader_billing_command('expireCheckout',expiry||'{"orderId":"expiry-order","checkoutId":"expiry-checkout"}');
  perform pg_temp.subscription_assert(value->>'status'='expired' and not (value->>'paymentVerified')::boolean,'unpaid checkout expires');
  value=public.reader_billing_command('expireCheckout',expiry||'{"orderId":"expiry-order","checkoutId":"expiry-checkout"}');
  perform pg_temp.subscription_assert(value->>'status'='expired','checkout expiry replay');
  value=public.reader_billing_command('order',expiry||order_data||'{"id":"expiry-replacement","intentKey":"expiry-replacement-intent"}');
  value=public.reader_billing_command('checkout',expiry||'{"orderId":"expiry-replacement","checkoutId":"expiry-replacement-checkout"}');
  value=public.reader_billing_command('bindSubscription',expiry||bind_data||'{"subscriptionId":"expiry-sub","customerId":"expiry-customer","orderId":"expiry-replacement","providerOrderId":"expiry-provider"}');
  perform pg_temp.subscription_error('expireCheckout',expiry||'{"orderId":"expiry-replacement","checkoutId":"expiry-replacement-checkout"}','invalid_state');
  perform pg_temp.subscription_error('expireCheckout',base||'{"orderId":"monthly-initial","checkoutId":"checkout-initial"}','invalid_state');
  value=public.reader_billing_command('subscriptionState',expiry||bind_data||'{"subscriptionId":"expiry-sub","customerId":"expiry-customer","status":"expired","supplierUpdatedAt":"2026-10-25T00:00:00Z"}');
  perform pg_temp.subscription_error('order',expiry||order_data||'{"id":"during-expiry","intentKey":"during-expiry"}','subscription_exists');
  value=public.reader_billing_command('subscriptionState',expiry||bind_data||'{"subscriptionId":"expiry-sub","customerId":"expiry-customer","status":"active","supplierUpdatedAt":"2026-10-25T01:00:00Z"}');
  perform pg_temp.subscription_assert(value->>'status'='active','expired payment retries may resume');
  value=public.reader_billing_command('subscriptionState',expiry||bind_data||'{"subscriptionId":"expiry-sub","customerId":"expiry-customer","status":"canceled","supplierUpdatedAt":"2026-10-25T02:00:00Z"}');
  value=public.reader_billing_command('order',expiry||order_data||'{"id":"after-terminal-expiry","intentKey":"after-terminal-expiry"}');
  value=public.reader_billing_command('checkout',expiry||'{"orderId":"after-terminal-expiry","checkoutId":"after-terminal-checkout"}');
  value=public.reader_billing_command('bindSubscription',expiry||bind_data||'{"subscriptionId":"after-terminal-sub","customerId":"expiry-customer","orderId":"after-terminal-expiry","providerOrderId":"after-terminal-provider","supplierUpdatedAt":"2026-10-26T00:00:00Z"}');
  perform pg_temp.subscription_error('subscriptionState',expiry||bind_data||'{"subscriptionId":"expiry-sub","customerId":"expiry-customer","status":"active","supplierUpdatedAt":"2026-10-27T00:00:00Z"}','subscription_exists');
  value=public.reader_billing_command('account',expiry);perform pg_temp.subscription_assert(value->>'availableUnits'='0','expiry never grants points');
end;
$$;
reset role;
rollback;
select 'billing_subscription_sql_invariants_passed' as result;
