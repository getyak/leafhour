-- Synthetic data in an isolated local cluster only.
begin;
create function pg_temp.yearly_assert(condition boolean,label text) returns void language plpgsql as $$
begin if condition is distinct from true then raise exception 'yearly invariant failed: %',label; end if; end; $$;
create function pg_temp.yearly_error(action text,payload jsonb,expected text) returns void language plpgsql as $$
begin begin perform public.reader_billing_command(action,payload); exception when sqlstate 'P0001' then if sqlerrm='reader_billing:'||expected then return; end if; raise; end; raise exception 'expected yearly error %',expected; end; $$;
do $$ begin execute format('grant usage on schema %I to service_role',pg_my_temp_schema()::regnamespace); end; $$;
select pg_temp.yearly_assert(not has_function_privilege('anon','public.reader_billing_command(text,jsonb)','EXECUTE'),'anonymous RPC denied');
set local role service_role;
do $$
declare
 base jsonb='{"mode":"test","ownerId":"synthetic-yearly","now":"2026-10-22T00:00:00Z"}';
 order_data jsonb='{"id":"yearly-initial","intentKey":"yearly-intent","productKey":"reading_yearly_1200","productId":"prod-yearly","amount":5000,"currency":"USD","units":1200000000,"billingPeriod":"every-year"}';
 monthly jsonb='{"id":"monthly-other","intentKey":"monthly-other","productKey":"reading_monthly_100","productId":"prod-monthly","amount":500,"currency":"USD","units":100000000,"billingPeriod":"every-month"}';
 binding jsonb='{"subscriptionId":"sub-yearly","customerId":"cust-yearly","orderId":"yearly-initial","productKey":"reading_yearly_1200","productId":"prod-yearly","providerOrderId":"provider-initial","status":"active","currentPeriodStart":"2026-10-22T00:00:00Z","currentPeriodEnd":"2027-10-22T00:00:00Z","supplierUpdatedAt":"2026-10-22T00:00:00Z"}';
 paid jsonb='{"subscriptionId":"sub-yearly","customerId":"cust-yearly","transactionId":"tran-initial","providerOrderId":"provider-initial","orderId":"yearly-initial","periodStart":"2026-10-22T00:00:00Z","periodEnd":"2027-10-22T00:00:00Z","billingPeriod":"every-year","amount":5000,"paidAmount":5500,"taxAmount":500,"discountAmount":0,"currency":"USD","units":1200000000,"eventId":"evt-paid","eventHash":"hash-paid","cumulativeRefundAmount":0}';
 value jsonb; renewal jsonb; cycle text;
begin
 value=public.reader_billing_command('readiness','{"mode":"test"}');perform pg_temp.yearly_assert(value->>'schemaVersion'='3','annual schema ready');
 perform pg_temp.yearly_error('order',base||(order_data-'billingPeriod'),'invalid_input');
 value=public.reader_billing_command('order',base||order_data);perform pg_temp.yearly_assert(value->>'billingPeriod'='every-year','saved annual period');
 perform pg_temp.yearly_error('order',base||monthly,'subscription_exists');
 value=public.reader_billing_command('checkout',base||'{"orderId":"yearly-initial","checkoutId":"checkout-yearly"}');
 value=public.reader_billing_command('bindSubscription',base||binding);
 perform pg_temp.yearly_error('subscriptionPaid',base||paid||'{"amount":500,"paidAmount":1000}','payment_mismatch');
 perform pg_temp.yearly_error('subscriptionPaid',base||paid||'{"periodEnd":"2026-11-22T00:00:00Z"}','payment_mismatch');
 perform pg_temp.yearly_error('subscriptionPaid',base||paid||'{"billingPeriod":"every-month"}','payment_mismatch');
 value=public.reader_billing_command('subscriptionPaid',base||paid);perform pg_temp.yearly_assert(value->>'billingPeriod'='every-year','paid annual period');
 value=public.reader_billing_command('subscriptionPaid',base||paid||'{"eventId":"evt-duplicate","eventHash":"hash-duplicate"}');
 value=public.reader_billing_command('account',base);perform pg_temp.yearly_assert(value->>'availableUnits'='1200000000','1200 upfront exactly once');
 renewal=(paid-'orderId')||'{"transactionId":"tran-renewal","providerOrderId":"provider-renewal","periodStart":"2027-10-22T00:00:00Z","periodEnd":"2028-10-22T00:00:00Z","eventId":"evt-renewal","eventHash":"hash-renewal"}';
 value=public.reader_billing_command('subscriptionPaid',base||renewal);cycle=value->>'id';perform pg_temp.yearly_assert(value->>'billingPeriod'='every-year','renewal saved annual period');
 value=public.reader_billing_command('account',base);perform pg_temp.yearly_assert(value->>'availableUnits'='2400000000','annual renewal accumulates');
 value=public.reader_billing_command('refund',base||jsonb_build_object('orderId',cycle,'eventId','evt-refund','eventHash','hash-refund','refundId','refund-renewal','refundAmount',2750,'cumulativeRefundAmount',2750,'paidAmount',5500));
 value=public.reader_billing_command('account',base);perform pg_temp.yearly_assert(value->>'availableUnits'='1800000000','half refund removes 600 yearly points');
 value=public.reader_billing_command('subscriptionState',base||binding||'{"status":"scheduled_cancel","supplierUpdatedAt":"2026-10-23T00:00:00Z"}');
 perform pg_temp.yearly_error('order',base||monthly,'subscription_exists');
 value=public.reader_billing_command('subscriptionState',base||binding||'{"status":"canceled","supplierUpdatedAt":"2026-10-24T00:00:00Z"}');
 value=public.reader_billing_command('order',base||monthly);perform pg_temp.yearly_assert(value->>'productKey'='reading_monthly_100','cancel allows different plan');
 value=public.reader_billing_command('order',base||order_data||'{"ownerId":"synthetic-frozen","id":"frozen-source","intentKey":"frozen-source","productKey":"reading_100"}');
 value=public.reader_billing_command('dispute',base||'{"ownerId":"synthetic-frozen","orderId":"frozen-source","eventId":"evt-frozen","eventHash":"hash-frozen"}');
 perform pg_temp.yearly_error('order',base||order_data||'{"ownerId":"synthetic-frozen","id":"frozen-yearly","intentKey":"frozen-yearly"}','frozen_account');
 perform pg_temp.yearly_error('order',base||monthly||'{"ownerId":"synthetic-frozen","id":"frozen-monthly","intentKey":"frozen-monthly"}','frozen_account');
 value=public.reader_billing_command('summary','{"mode":"test","from":"2026-10-01T00:00:00Z","to":"2026-11-01T00:00:00Z"}');perform pg_temp.yearly_assert(value->>'yearlyPaidOrders'='2' and value->>'monthlyPaidOrders'='0' and value->>'oneTimePaidOrders'='0','annual separated from retired topups');
end; $$;
reset role;
rollback;
select 'billing_yearly_sql_invariants_passed' as result;
