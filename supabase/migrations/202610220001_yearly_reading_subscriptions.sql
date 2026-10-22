begin;

-- Add annual sales without rewriting historical orders, subscription identities,
-- credit lots or ledger entries. Monthly orders created on v2 retain null here;
-- read views derive their documented legacy month period without a data backfill.
alter table public.billing_orders add column billing_period text;
alter table public.billing_orders add constraint billing_orders_recurring_period check (
  (billing_period is null and product_key<>'reading_yearly_1200') or
  (billing_period is not null and product_key='reading_monthly_100' and billing_period='every-month') or
  (billing_period is not null and product_key='reading_yearly_1200' and billing_period='every-year')
);
alter table public.billing_subscriptions drop constraint billing_subscriptions_product_key_check;
alter table public.billing_subscriptions add constraint billing_subscriptions_product_key_check check (product_key in ('reading_monthly_100','reading_yearly_1200'));
-- The existing partial unique owner index already covers every subscription plan.
-- All signup/state mutations also take the same account-row lock across processes.
create or replace function public.reader_billing_order_json(row_value public.billing_orders)
returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
  select public.reader_billing_order_json_v1(row_value)||jsonb_build_object(
    'subscriptionId',row_value.subscription_id,'transactionId',row_value.transaction_id,
    'periodStart',row_value.period_start,'periodEnd',row_value.period_end,
    'billingPeriod',coalesce(row_value.billing_period,case row_value.product_key when 'reading_monthly_100' then 'every-month' end));
$$;

create or replace function public.reader_billing_command(command_name text,command_payload jsonb)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  ledger_mode text; account_owner text; at_time timestamptz;
  period_value text; subscription_key text; customer_key text; provider_order_key text; transaction_key text; state_value text;
  item_id text; hash_value text; intent_value text; event_key text; event_hash_value text;
  start_time timestamptz; end_time timestamptz; supplier_time timestamptz;
  amount_value bigint; paid_value bigint; tax_value bigint; discount_value bigint; units_value bigint; refund_value bigint;
  subscription_row public.billing_subscriptions; order_row public.billing_orders; initial_row public.billing_orders;
  result_value jsonb; from_time timestamptz; to_time timestamptz;
begin
  if jsonb_typeof(command_payload) is distinct from 'object' or octet_length(command_payload::text)>65536 then raise exception using errcode='P0001',message='reader_billing:invalid_input'; end if;
  ledger_mode=command_payload->>'mode';
  if ledger_mode is null or ledger_mode not in ('test','live') then raise exception using errcode='P0001',message='reader_billing:invalid_input'; end if;
  at_time=public.reader_billing_timestamp(command_payload->'now');
  if command_name='readiness' then return jsonb_build_object('ready',true,'durable',true,'schemaVersion',3,'backend','postgres'); end if;
  if command_name='lookupSubscription' then
    subscription_key=public.reader_billing_text(command_payload->'subscriptionId');
    select * into subscription_row from public.billing_subscriptions where mode=ledger_mode and subscription_id=subscription_key;
    if not found then return null; end if;return public.reader_billing_subscription_json(subscription_row);
  end if;
  if command_name='summary' then
    result_value=public.reader_billing_command_v1(command_name,command_payload);
    from_time=public.reader_billing_timestamp(command_payload->'from',null);to_time=public.reader_billing_timestamp(command_payload->'to',null);
    return result_value||jsonb_build_object(
      'monthlyPaidOrders',(select count(*) from public.billing_entries e join public.billing_orders o on o.mode=e.mode and o.id=e.order_id where e.mode=ledger_mode and e.type='payment' and e.paid_amount>0 and e.created_at>=from_time and e.created_at<to_time and o.product_key='reading_monthly_100'),
      'yearlyPaidOrders',(select count(*) from public.billing_entries e join public.billing_orders o on o.mode=e.mode and o.id=e.order_id where e.mode=ledger_mode and e.type='payment' and e.paid_amount>0 and e.created_at>=from_time and e.created_at<to_time and o.product_key='reading_yearly_1200'),
      'oneTimePaidOrders',(select count(*) from public.billing_entries e join public.billing_orders o on o.mode=e.mode and o.id=e.order_id where e.mode=ledger_mode and e.type='payment' and e.paid_amount>0 and e.created_at>=from_time and e.created_at<to_time and o.product_key not in ('reading_monthly_100','reading_yearly_1200')),
      'activeSubscriptions',(select count(*) from public.billing_subscriptions where mode=ledger_mode and status='active'));
  end if;
  if command_name not in ('bindSubscription','subscriptions','subscriptionState','subscriptionPaid','expireCheckout') and not (command_name='order' and command_payload->>'productKey' in ('reading_monthly_100','reading_yearly_1200')) then
    return public.reader_billing_command_v1(command_name,command_payload);
  end if;
  account_owner=public.reader_billing_text(command_payload->'ownerId');
  if command_name='subscriptions' then
    return jsonb_build_object('subscriptions',coalesce((select jsonb_agg(public.reader_billing_subscription_json(s) order by s.sequence desc) from public.billing_subscriptions s where s.mode=ledger_mode and s.owner_id=account_owner),'[]'::jsonb));
  end if;

  -- This is the same account lock used by the underlying ledger. It also fences
  -- different checkout intents before any external subscription can be created.
  insert into public.billing_accounts(mode,owner_id,created_at) values(ledger_mode,account_owner,at_time) on conflict do nothing;
  perform 1 from public.billing_accounts where mode=ledger_mode and owner_id=account_owner for update;
  if command_name='order' then
    intent_value=public.reader_billing_text(command_payload->'intentKey');
    period_value=case command_payload->>'productKey' when 'reading_monthly_100' then 'every-month' when 'reading_yearly_1200' then 'every-year' end;
    if command_payload ? 'billingPeriod' and command_payload->>'billingPeriod' is distinct from period_value or command_payload->>'productKey'='reading_yearly_1200' and (command_payload->>'billingPeriod' is distinct from 'every-year' or command_payload->>'amount'<>'5000' or command_payload->>'units'<>'1200000000' or command_payload->>'currency'<>'USD') then raise exception using errcode='P0001',message='reader_billing:invalid_input'; end if;
    if not exists(select 1 from public.billing_orders where mode=ledger_mode and owner_id=account_owner and intent_key=intent_value) and exists(select 1 from public.billing_accounts where mode=ledger_mode and owner_id=account_owner and frozen) then raise exception using errcode='P0001',message='reader_billing:frozen_account'; end if;
    if not exists(select 1 from public.billing_orders where mode=ledger_mode and owner_id=account_owner and intent_key=intent_value) and (
      exists(select 1 from public.billing_subscriptions where mode=ledger_mode and owner_id=account_owner and status not in ('canceled')) or
      exists(select 1 from public.billing_orders o left join public.billing_subscriptions s on s.mode=o.mode and s.subscription_id=o.subscription_id where o.mode=ledger_mode and o.owner_id=account_owner and o.product_key in ('reading_monthly_100','reading_yearly_1200') and o.status<>'expired' and (s.subscription_id is null or s.status not in ('canceled')))
    ) then raise exception using errcode='P0001',message='reader_billing:subscription_exists'; end if;
    select * into order_row from public.billing_orders where mode=ledger_mode and owner_id=account_owner and intent_key=intent_value;
    if found then
      if command_payload ? 'billingPeriod' and coalesce(order_row.billing_period,case order_row.product_key when 'reading_monthly_100' then 'every-month' end) is distinct from command_payload->>'billingPeriod' then raise exception using errcode='P0001',message='reader_billing:idempotency_conflict'; end if;
      return public.reader_billing_command_v1(command_name,command_payload);
    end if;
    item_id=public.reader_billing_text(command_payload->'id');
    amount_value=public.reader_billing_integer(command_payload->'amount');units_value=public.reader_billing_integer(command_payload->'units',1);
    insert into public.billing_orders(mode,id,owner_id,intent_key,product_key,product_id,amount,currency,units,billing_period,created_at,updated_at)
      values(ledger_mode,item_id,account_owner,intent_value,public.reader_billing_text(command_payload->'productKey'),public.reader_billing_text(command_payload->'productId'),amount_value,command_payload->>'currency',units_value,period_value,at_time,at_time) returning * into order_row;
    return public.reader_billing_order_json(order_row);
  end if;
  if command_name='expireCheckout' then
    item_id=public.reader_billing_text(command_payload->'orderId');intent_value=public.reader_billing_text(command_payload->'checkoutId');
    select * into order_row from public.billing_orders where mode=ledger_mode and id=item_id for update;
    if not found then raise exception using errcode='P0001',message='reader_billing:not_found'; end if;
    if order_row.owner_id<>account_owner then raise exception using errcode='P0001',message='reader_billing:owner_mismatch'; end if;
    if order_row.checkout_id is null then raise exception using errcode='P0001',message='reader_billing:invalid_state'; end if;
    if order_row.checkout_id<>intent_value then raise exception using errcode='P0001',message='reader_billing:payment_mismatch'; end if;
    if order_row.status not in ('pending','expired') or order_row.payment_verified or order_row.subscription_id is not null or exists(select 1 from public.billing_subscriptions where mode=ledger_mode and initial_order_id=item_id) then raise exception using errcode='P0001',message='reader_billing:invalid_state'; end if;
    if order_row.status<>'expired' then update public.billing_orders set status='expired',updated_at=at_time where mode=ledger_mode and id=item_id returning * into order_row; end if;
    return public.reader_billing_order_json(order_row);
  end if;

  subscription_key=public.reader_billing_text(command_payload->'subscriptionId');customer_key=public.reader_billing_text(command_payload->'customerId');
  select * into subscription_row from public.billing_subscriptions where mode=ledger_mode and subscription_id=subscription_key for update;
  if found and subscription_row.owner_id<>account_owner then raise exception using errcode='P0001',message='reader_billing:owner_mismatch'; end if;
  if command_name<>'bindSubscription' and subscription_row.subscription_id is null then raise exception using errcode='P0001',message='reader_billing:not_found'; end if;
  if subscription_row.subscription_id is not null and subscription_row.customer_id<>customer_key then raise exception using errcode='P0001',message='reader_billing:payment_mismatch'; end if;

  if command_name in ('bindSubscription','subscriptionState') then
    state_value=public.reader_billing_text(command_payload->'status');
    if state_value not in ('active','trialing','past_due','unpaid','paused','scheduled_cancel','canceled','expired','incomplete') then raise exception using errcode='P0001',message='reader_billing:invalid_input'; end if;
    start_time=public.reader_billing_timestamp(command_payload->'currentPeriodStart',null);end_time=public.reader_billing_timestamp(command_payload->'currentPeriodEnd',null);supplier_time=public.reader_billing_timestamp(command_payload->'supplierUpdatedAt',null);
    if start_time is null or end_time is null or end_time<=start_time or supplier_time is null then raise exception using errcode='P0001',message='reader_billing:invalid_input'; end if;
    if command_name='bindSubscription' then
      item_id=public.reader_billing_text(command_payload->'orderId');
      select * into order_row from public.billing_orders where mode=ledger_mode and id=item_id for update;
      if not found then raise exception using errcode='P0001',message='reader_billing:not_found'; end if;
      if order_row.owner_id<>account_owner then raise exception using errcode='P0001',message='reader_billing:owner_mismatch'; end if;
      if order_row.product_key not in ('reading_monthly_100','reading_yearly_1200') or order_row.product_key is distinct from command_payload->>'productKey' or order_row.product_id is distinct from command_payload->>'productId'
        or subscription_row.subscription_id is not null and (subscription_row.initial_order_id<>item_id or subscription_row.product_id<>order_row.product_id)
        or order_row.subscription_id is not null and order_row.subscription_id<>subscription_key then raise exception using errcode='P0001',message='reader_billing:payment_mismatch'; end if;
      if subscription_row.subscription_id is null and exists(select 1 from public.billing_subscriptions where mode=ledger_mode and owner_id=account_owner and status not in ('canceled')) then raise exception using errcode='P0001',message='reader_billing:subscription_exists'; end if;
      if command_payload->>'providerOrderId' is not null then
        provider_order_key=public.reader_billing_text(command_payload->'providerOrderId');
        if order_row.provider_order_id is not null and order_row.provider_order_id<>provider_order_key or subscription_row.initial_provider_order_id is not null and subscription_row.initial_provider_order_id<>provider_order_key
          or exists(select 1 from public.billing_orders where mode=ledger_mode and provider_order_id=provider_order_key and id<>item_id) then raise exception using errcode='P0001',message='reader_billing:payment_mismatch'; end if;
        update public.billing_orders set provider_order_id=provider_order_key where mode=ledger_mode and id=item_id;
      end if;
      if subscription_row.subscription_id is null then
        insert into public.billing_subscriptions(mode,subscription_id,owner_id,customer_id,initial_order_id,initial_provider_order_id,product_key,product_id,status,current_period_start,current_period_end,supplier_updated_at,created_at,updated_at)
          values(ledger_mode,subscription_key,account_owner,customer_key,item_id,provider_order_key,order_row.product_key,order_row.product_id,state_value,start_time,end_time,supplier_time,at_time,at_time) returning * into subscription_row;
      elsif provider_order_key is not null and subscription_row.initial_provider_order_id is null then
        update public.billing_subscriptions set initial_provider_order_id=provider_order_key where mode=ledger_mode and subscription_id=subscription_key returning * into subscription_row;
      end if;
      update public.billing_orders set subscription_id=subscription_key where mode=ledger_mode and id=item_id;
    end if;
    if supplier_time<subscription_row.supplier_updated_at then return public.reader_billing_subscription_json(subscription_row); end if;
    if supplier_time=subscription_row.supplier_updated_at and (subscription_row.status<>state_value or subscription_row.current_period_start<>start_time or subscription_row.current_period_end<>end_time) then raise exception using errcode='P0001',message='reader_billing:idempotency_conflict'; end if;
    if state_value not in ('canceled') and exists(select 1 from public.billing_subscriptions where mode=ledger_mode and owner_id=account_owner and subscription_id<>subscription_key and status not in ('canceled')) then raise exception using errcode='P0001',message='reader_billing:subscription_exists'; end if;
    update public.billing_subscriptions set status=state_value,current_period_start=start_time,current_period_end=end_time,supplier_updated_at=supplier_time,updated_at=at_time where mode=ledger_mode and subscription_id=subscription_key returning * into subscription_row;
    return public.reader_billing_subscription_json(subscription_row);
  end if;

  transaction_key=public.reader_billing_text(command_payload->'transactionId');provider_order_key=public.reader_billing_text(command_payload->'providerOrderId');
  event_key=public.reader_billing_text(command_payload->'eventId');event_hash_value=public.reader_billing_text(command_payload->'eventHash');
  start_time=public.reader_billing_timestamp(command_payload->'periodStart',null);end_time=public.reader_billing_timestamp(command_payload->'periodEnd',null);
  if start_time is null or end_time is null or end_time<=start_time then raise exception using errcode='P0001',message='reader_billing:invalid_input'; end if;
  amount_value=public.reader_billing_integer(command_payload->'amount');paid_value=public.reader_billing_integer(command_payload->'paidAmount');tax_value=public.reader_billing_integer(command_payload->'taxAmount');discount_value=public.reader_billing_integer(command_payload->'discountAmount');units_value=public.reader_billing_integer(command_payload->'units',1);
  select * into initial_row from public.billing_orders where mode=ledger_mode and id=subscription_row.initial_order_id;
  period_value=coalesce(initial_row.billing_period,case initial_row.product_key when 'reading_monthly_100' then 'every-month' end);
  if command_payload ? 'billingPeriod' and command_payload->>'billingPeriod' is distinct from period_value or period_value='every-year' and (end_time-start_time<interval '365 days' or end_time-start_time>interval '366 days') or period_value='every-month' and (end_time-start_time<interval '28 days' or end_time-start_time>interval '31 days') then raise exception using errcode='P0001',message='reader_billing:payment_mismatch'; end if;
  if paid_value<=0 or discount_value>amount_value or paid_value::numeric<>amount_value::numeric-discount_value+tax_value
    or initial_row.amount<>amount_value or initial_row.units<>units_value or initial_row.currency is distinct from command_payload->>'currency' then raise exception using errcode='P0001',message='reader_billing:payment_mismatch'; end if;
  if exists(select 1 from public.billing_orders where mode=ledger_mode and subscription_id=subscription_key and period_start=start_time and period_end=end_time and transaction_id<>transaction_key) then raise exception using errcode='P0001',message='reader_billing:payment_mismatch'; end if;
  select * into order_row from public.billing_orders where mode=ledger_mode and transaction_id=transaction_key for update;
  if found then
    if order_row.owner_id<>account_owner or order_row.subscription_id<>subscription_key or order_row.provider_order_id is distinct from provider_order_key or order_row.period_start<>start_time or order_row.period_end<>end_time
      or order_row.amount<>amount_value or order_row.paid_amount<>paid_value or order_row.tax_amount<>tax_value or order_row.discount_amount<>discount_value or order_row.currency is distinct from command_payload->>'currency' or order_row.units<>units_value
      or command_payload->>'orderId' is not null and command_payload->>'orderId'<>order_row.id then raise exception using errcode='P0001',message='reader_billing:payment_mismatch'; end if;
    item_id=order_row.id;
  elsif command_payload->>'orderId' is not null then
    item_id=public.reader_billing_text(command_payload->'orderId');
    if item_id<>subscription_row.initial_order_id or initial_row.transaction_id is not null and initial_row.transaction_id<>transaction_key
      or subscription_row.initial_provider_order_id is not null and subscription_row.initial_provider_order_id<>provider_order_key then raise exception using errcode='P0001',message='reader_billing:payment_mismatch'; end if;
    select * into order_row from public.billing_orders where mode=ledger_mode and id=item_id for update;
  else
    if subscription_row.initial_provider_order_id=provider_order_key then raise exception using errcode='P0001',message='reader_billing:payment_mismatch'; end if;
    hash_value=encode(sha256(convert_to(ledger_mode||':'||transaction_key,'UTF8')),'hex');item_id='subscription:'||hash_value;
    insert into public.billing_orders(mode,id,owner_id,intent_key,product_key,product_id,amount,currency,units,billing_period,checkout_id,created_at,updated_at)
      values(ledger_mode,item_id,account_owner,item_id,subscription_row.product_key,subscription_row.product_id,amount_value,initial_row.currency,units_value,period_value,'cycle:'||hash_value,at_time,at_time) returning * into order_row;
  end if;
  if order_row.provider_order_id is not null and order_row.provider_order_id<>provider_order_key or exists(select 1 from public.billing_orders where mode=ledger_mode and provider_order_id=provider_order_key and id<>item_id) then raise exception using errcode='P0001',message='reader_billing:payment_mismatch'; end if;
  if item_id=subscription_row.initial_order_id and subscription_row.initial_provider_order_id is null then update public.billing_subscriptions set initial_provider_order_id=provider_order_key where mode=ledger_mode and subscription_id=subscription_key; end if;
  update public.billing_orders set subscription_id=subscription_key,transaction_id=transaction_key,period_start=start_time,period_end=end_time where mode=ledger_mode and id=item_id returning * into order_row;
  hash_value=encode(sha256(convert_to(ledger_mode||':'||transaction_key,'UTF8')),'hex');
  -- The supplier may already have refunded or disputed a delayed paid event.
  -- Apply its monotonic tombstone first, inside this same database transaction.
  if command_payload ? 'cumulativeRefundAmount' then
    refund_value=public.reader_billing_integer(command_payload->'cumulativeRefundAmount');
    if refund_value>paid_value then raise exception using errcode='P0001',message='reader_billing:payment_mismatch'; end if;
    if refund_value>order_row.refunded_amount then
      result_value=public.reader_billing_command_v1('refund',command_payload||jsonb_build_object('orderId',item_id,'eventId','snapshot-refund:'||hash_value||':'||refund_value,'eventHash','snapshot-refund:'||hash_value||':'||refund_value,'refundId','snapshot-refund:'||hash_value||':'||refund_value,'refundAmount',refund_value-order_row.refunded_amount,'cumulativeRefundAmount',refund_value));
    end if;
  end if;
  if command_payload ? 'disputed' then
    if jsonb_typeof(command_payload->'disputed') is distinct from 'boolean' then raise exception using errcode='P0001',message='reader_billing:invalid_input'; end if;
    if command_payload->'disputed'='true'::jsonb and not order_row.disputed then
      result_value=public.reader_billing_command_v1('dispute',command_payload||jsonb_build_object('orderId',item_id,'eventId','snapshot-dispute:'||hash_value,'eventHash','snapshot-dispute:'||hash_value));
    end if;
  end if;
  return public.reader_billing_command_v1('payment',command_payload||jsonb_build_object('orderId',item_id,'productId',order_row.product_id,'checkoutId',order_row.checkout_id,'eventId',event_key,'eventHash',event_hash_value));
exception
  when unique_violation then raise exception using errcode='P0001',message='reader_billing:idempotency_conflict';
  when check_violation or not_null_violation or foreign_key_violation or invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format or datetime_field_overflow then raise exception using errcode='P0001',message='reader_billing:invalid_input';
end;
$$;
revoke all on function public.reader_billing_command(text,jsonb),public.reader_billing_order_json(public.billing_orders) from public,anon,authenticated;
grant execute on function public.reader_billing_command(text,jsonb),public.reader_billing_order_json(public.billing_orders) to service_role;
notify pgrst,'reload schema';
commit;
