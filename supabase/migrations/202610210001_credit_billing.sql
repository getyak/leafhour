begin;

-- Dedicated relational financial state. Reading content remains in the library.
-- Every mutation locks its account before touching lots, operations or orders.
create table if not exists public.billing_accounts (
  mode text not null check (mode in ('test','live')),
  owner_id text not null check (length(owner_id) between 1 and 200),
  trial_granted boolean not null default false,
  frozen boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (mode,owner_id)
);
create table if not exists public.billing_orders (
  sequence bigint generated always as identity unique,
  mode text not null,
  id text not null,
  owner_id text not null,
  intent_key text not null,
  product_key text not null,
  product_id text not null,
  amount bigint not null check (amount between 0 and 9007199254740991),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  units bigint not null check (units between 1 and 9007199254740991),
  status text not null default 'pending' check (status in ('pending','paid','partially_refunded','refunded','disputed')),
  payment_verified boolean not null default false,
  checkout_id text,
  checkout_url text,
  checkout_attempted_at timestamptz,
  provider_order_id text,
  paid_amount bigint check (paid_amount between 0 and 9007199254740991),
  tax_amount bigint not null default 0 check (tax_amount >= 0),
  discount_amount bigint not null default 0 check (discount_amount >= 0),
  refunded_amount bigint not null default 0 check (refunded_amount >= 0),
  revoked_units bigint not null default 0 check (revoked_units >= 0 and revoked_units <= units),
  exposure_units bigint not null default 0 check (exposure_units>=0 and exposure_units<=units),
  disputed boolean not null default false,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (mode,id),
  foreign key (mode,owner_id) references public.billing_accounts(mode,owner_id),
  unique (mode,owner_id,intent_key),
  unique (mode,checkout_id),
  unique (mode,provider_order_id)
);
create table if not exists public.billing_credit_lots (
  sequence bigint generated always as identity unique,
  mode text not null,
  id text not null,
  owner_id text not null,
  source text not null check (source in ('trial','purchase','review')),
  order_id text,
  units bigint not null check (units between 1 and 9007199254740991),
  available_units bigint not null check (available_units >= 0),
  reserved_units bigint not null default 0 check (reserved_units >= 0),
  consumed_units bigint not null default 0 check (consumed_units >= 0),
  revoked_units bigint not null default 0 check (revoked_units >= 0 and revoked_units <= units),
  created_at timestamptz not null default now(),
  primary key (mode,id),
  foreign key (mode,owner_id) references public.billing_accounts(mode,owner_id),
  foreign key (mode,order_id) references public.billing_orders(mode,id),
  unique (mode,order_id),
  check (available_units + reserved_units + consumed_units <= units)
);
create unique index if not exists billing_one_trial_per_account on public.billing_credit_lots(mode,owner_id) where source='trial';
create index if not exists billing_lots_fifo on public.billing_credit_lots(mode,owner_id,source,sequence) where available_units>0;
create table if not exists public.billing_quotes (
  mode text not null,
  id text not null,
  owner_id text not null,
  action text not null,
  units bigint not null check (units between 1 and 9007199254740991),
  scope_hash text not null,
  scope jsonb not null check (jsonb_typeof(scope)='object'),
  price_version text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (mode,id),
  foreign key (mode,owner_id) references public.billing_accounts(mode,owner_id)
);
create table if not exists public.billing_operations (
  mode text not null,
  id text not null,
  owner_id text not null,
  quote_id text not null,
  idempotency_key text not null,
  action text not null,
  units bigint not null check (units between 1 and 9007199254740991),
  scope_hash text not null,
  scope jsonb not null,
  reservation_token text not null,
  status text not null check (status in ('reserved','running','result_saved','settled','released','cancelled','reversed')),
  receipt jsonb,
  reason text,
  started_at timestamptz,
  settled_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (mode,id),
  foreign key (mode,owner_id) references public.billing_accounts(mode,owner_id),
  foreign key (mode,quote_id) references public.billing_quotes(mode,id),
  unique (mode,owner_id,idempotency_key),
  unique (mode,quote_id)
);
create table if not exists public.billing_allocations (
  mode text not null,
  operation_id text not null,
  lot_id text not null,
  units bigint not null check (units>0),
  state text not null check (state in ('held','consumed','released','reversed')),
  primary key (mode,operation_id,lot_id),
  foreign key (mode,operation_id) references public.billing_operations(mode,id),
  foreign key (mode,lot_id) references public.billing_credit_lots(mode,id)
);
create table if not exists public.billing_entries (
  id bigint generated always as identity primary key,
  mode text not null,
  owner_id text not null,
  type text not null check (type in ('grant','hold','consume','release','reverse','refund','payment','refund_cash')),
  units bigint not null,
  reserved_units bigint not null default 0,
  restored_units bigint check (restored_units>=0),
  operation_id text,
  order_id text,
  lot_id text,
  source text,
  source_units jsonb check (source_units is null or jsonb_typeof(source_units)='object'),
  amount bigint check (amount>=0),
  paid_amount bigint check (paid_amount>=0),
  tax_amount bigint check (tax_amount>=0),
  discount_amount bigint check (discount_amount>=0),
  currency text check (currency ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now(),
  foreign key (mode,owner_id) references public.billing_accounts(mode,owner_id),
  foreign key (mode,operation_id) references public.billing_operations(mode,id),
  foreign key (mode,order_id) references public.billing_orders(mode,id),
  foreign key (mode,lot_id) references public.billing_credit_lots(mode,id)
);
create index if not exists billing_entries_owner_cursor on public.billing_entries(mode,owner_id,id desc);
create table if not exists public.billing_webhook_inbox (
  mode text not null check (mode in ('test','live')),
  event_id text not null,
  event_hash text not null,
  event_type text not null check (event_type in ('payment','refund','dispute')),
  owner_id text not null,
  order_id text not null,
  created_at timestamptz not null default now(),
  primary key (mode,event_id),
  foreign key (mode,order_id) references public.billing_orders(mode,id)
);
create table if not exists public.billing_refunds (
  mode text not null,
  refund_id text not null,
  order_id text not null,
  refund_amount bigint not null check (refund_amount>=0),
  cumulative_refund_amount bigint not null check (cumulative_refund_amount>=0),
  money_delta bigint not null check (money_delta>=0),
  created_at timestamptz not null default now(),
  primary key (mode,refund_id),
  foreign key (mode,order_id) references public.billing_orders(mode,id)
);
create table if not exists public.billing_provider_calls (
  mode text not null,
  id text not null,
  owner_id text not null,
  operation_id text,
  feature text not null,
  funding text not null,
  provider text not null,
  model text not null,
  status text not null,
  usage jsonb,
  cost_microusd bigint check (cost_microusd between 0 and 9007199254740991),
  cost_status text not null,
  price_version text,
  started_at timestamptz not null,
  finished_at timestamptz,
  primary key (mode,id),
  foreign key (mode,owner_id) references public.billing_accounts(mode,owner_id),
  foreign key (mode,operation_id) references public.billing_operations(mode,id)
);
create table if not exists public.billing_outbox (
  id bigint generated always as identity primary key,
  mode text not null,
  owner_id text not null,
  operation_id text not null,
  kind text not null check (kind in ('settle','publish')),
  completed boolean not null default false,
  created_at timestamptz not null default now(),
  foreign key (mode,owner_id) references public.billing_accounts(mode,owner_id),
  foreign key (mode,operation_id) references public.billing_operations(mode,id),
  unique (mode,operation_id,kind)
);

alter table public.billing_accounts enable row level security;
alter table public.billing_orders enable row level security;
alter table public.billing_credit_lots enable row level security;
alter table public.billing_quotes enable row level security;
alter table public.billing_operations enable row level security;
alter table public.billing_allocations enable row level security;
alter table public.billing_entries enable row level security;
alter table public.billing_webhook_inbox enable row level security;
alter table public.billing_refunds enable row level security;
alter table public.billing_provider_calls enable row level security;
alter table public.billing_outbox enable row level security;
revoke all on public.billing_accounts,public.billing_orders,public.billing_credit_lots,public.billing_quotes,public.billing_operations,public.billing_allocations,public.billing_entries,public.billing_webhook_inbox,public.billing_refunds,public.billing_provider_calls,public.billing_outbox from public,anon,authenticated;
grant select,insert,update,delete on public.billing_accounts,public.billing_orders,public.billing_credit_lots,public.billing_quotes,public.billing_operations,public.billing_allocations,public.billing_entries,public.billing_webhook_inbox,public.billing_refunds,public.billing_provider_calls,public.billing_outbox to service_role;
grant usage,select on sequence public.billing_orders_sequence_seq,public.billing_credit_lots_sequence_seq,public.billing_entries_id_seq,public.billing_outbox_id_seq to service_role;

create or replace function public.reader_billing_immutable_entry()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  raise exception using errcode='P0001',message='reader_billing:invalid_state';
end;
$$;
drop trigger if exists billing_entries_immutable on public.billing_entries;
create trigger billing_entries_immutable before update or delete on public.billing_entries for each row execute function public.reader_billing_immutable_entry();

create or replace function public.reader_billing_text(value jsonb)
returns text language plpgsql immutable security invoker set search_path=public,pg_temp as $$
declare result text;
begin
  if jsonb_typeof(value) is distinct from 'string' then raise exception using errcode='P0001',message='reader_billing:invalid_input'; end if;
  result=value#>>'{}';
  if length(result)<1 or length(result)>200 then raise exception using errcode='P0001',message='reader_billing:invalid_input'; end if;
  return result;
end;
$$;
create or replace function public.reader_billing_integer(value jsonb,minimum bigint default 0)
returns bigint language plpgsql immutable security invoker set search_path=public,pg_temp as $$
declare result bigint;
begin
  if jsonb_typeof(value) is distinct from 'number' or (value#>>'{}') !~ '^[0-9]+$' then raise exception using errcode='P0001',message='reader_billing:invalid_input'; end if;
  result=(value#>>'{}')::bigint;
  if result<minimum or result>9007199254740991 then raise exception using errcode='P0001',message='reader_billing:invalid_input'; end if;
  return result;
end;
$$;
create or replace function public.reader_billing_timestamp(value jsonb,fallback timestamptz default now())
returns timestamptz language plpgsql stable security invoker set search_path=public,pg_temp as $$
begin
  if value is null or value='null'::jsonb then return fallback; end if;
  if jsonb_typeof(value)='number' then return to_timestamp((value#>>'{}')::numeric/1000); end if;
  if jsonb_typeof(value)='string' then return (value#>>'{}')::timestamptz; end if;
  raise exception using errcode='P0001',message='reader_billing:invalid_input';
end;
$$;
create or replace function public.reader_billing_account_json(ledger_mode text,account_owner text)
returns jsonb language sql volatile security invoker set search_path=public,pg_temp as $$
  select jsonb_build_object(
    'availableUnits',coalesce((select sum(available_units) from public.billing_credit_lots where mode=ledger_mode and owner_id=account_owner),0),
    'reservedUnits',coalesce((select sum(reserved_units) from public.billing_credit_lots where mode=ledger_mode and owner_id=account_owner),0),
    'grantedUnits',coalesce((select sum(units) from public.billing_entries where mode=ledger_mode and owner_id=account_owner and type='grant'),0),
    'consumedUnits',coalesce((select -sum(units) from public.billing_entries where mode=ledger_mode and owner_id=account_owner and type in ('consume','reverse')),0),
    'trialGranted',coalesce((select trial_granted from public.billing_accounts where mode=ledger_mode and owner_id=account_owner),false),
    'frozen',coalesce((select frozen from public.billing_accounts where mode=ledger_mode and owner_id=account_owner),false),
    'sources',(select jsonb_agg(jsonb_build_object('source',sources.source,
      'availableUnits',coalesce((select sum(l.available_units) from public.billing_credit_lots l where l.mode=ledger_mode and l.owner_id=account_owner and l.source=sources.source),0),
      'reservedUnits',coalesce((select sum(l.reserved_units) from public.billing_credit_lots l where l.mode=ledger_mode and l.owner_id=account_owner and l.source=sources.source),0)))
      from (values ('trial'),('purchase'),('review')) as sources(source))
  );
$$;
create or replace function public.reader_billing_order_json(row_value public.billing_orders)
returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
  select jsonb_build_object('id',row_value.id,'ownerId',row_value.owner_id,'mode',row_value.mode,'intentKey',row_value.intent_key,
    'productKey',row_value.product_key,'productId',row_value.product_id,'amount',row_value.amount,'currency',row_value.currency,'units',row_value.units,
    'status',row_value.status,'paymentVerified',row_value.payment_verified,'checkoutId',row_value.checkout_id,'checkoutUrl',row_value.checkout_url,
    'providerOrderId',row_value.provider_order_id,'checkoutAttemptedAt',row_value.checkout_attempted_at,'paidAmount',row_value.paid_amount,'taxAmount',row_value.tax_amount,'discountAmount',row_value.discount_amount,
    'refundedAmount',row_value.refunded_amount,'revokedUnits',row_value.revoked_units,'exposureUnits',row_value.exposure_units,'createdAt',row_value.created_at,'updatedAt',row_value.updated_at);
$$;
create or replace function public.reader_billing_operation_json(row_value public.billing_operations)
returns jsonb language sql volatile security invoker set search_path=public,pg_temp as $$
  select jsonb_build_object('id',row_value.id,'ownerId',row_value.owner_id,'mode',row_value.mode,'quoteId',row_value.quote_id,
    'idempotencyKey',row_value.idempotency_key,'action',row_value.action,'units',row_value.units,'scopeHash',row_value.scope_hash,'scope',row_value.scope,
    'reservationToken',row_value.reservation_token,'status',row_value.status,'receipt',row_value.receipt,'reason',row_value.reason,
    'allocations',coalesce((select jsonb_agg(jsonb_build_object('lotId',lot_id,'units',units) order by lot_id) from public.billing_allocations where mode=row_value.mode and operation_id=row_value.id),'[]'::jsonb),
    'outbox',(select jsonb_build_object('status',case when completed then 'delivered' else 'pending' end,'resultId',row_value.receipt->>'resultId') from public.billing_outbox where mode=row_value.mode and operation_id=row_value.id order by kind='publish' desc limit 1),
    'startedAt',row_value.started_at,'settledAt',row_value.settled_at,'publishedAt',row_value.published_at,'createdAt',row_value.created_at,'updatedAt',row_value.updated_at);
$$;
create or replace function public.reader_billing_quote_json(row_value public.billing_quotes)
returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
  select jsonb_build_object('id',row_value.id,'ownerId',row_value.owner_id,'mode',row_value.mode,'action',row_value.action,'units',row_value.units,
    'scopeHash',row_value.scope_hash,'scope',row_value.scope,'priceVersion',row_value.price_version,'expiresAt',row_value.expires_at,'createdAt',row_value.created_at);
$$;

-- The caller has already locked the owning account. Refunds cancel whole active
-- operations before revoking a lot so a partially held operation cannot settle.
create or replace function public.reader_billing_release_operation(ledger_mode text,operation_key text,release_reason text,at_time timestamptz)
returns void language plpgsql security invoker set search_path=public,pg_temp as $$
declare operation_row public.billing_operations; allocation_row record; restored bigint;
begin
  select * into operation_row from public.billing_operations where mode=ledger_mode and id=operation_key for update;
  if operation_row.status in ('released','cancelled') then return; end if;
  if operation_row.status not in ('reserved','running','result_saved') then raise exception using errcode='P0001',message='reader_billing:invalid_state'; end if;
  for allocation_row in select a.*,l.units as lot_units,l.available_units,l.reserved_units,l.consumed_units,l.revoked_units
      from public.billing_allocations a join public.billing_credit_lots l on l.mode=a.mode and l.id=a.lot_id
      where a.mode=ledger_mode and a.operation_id=operation_key and a.state='held' order by l.sequence for update of a,l loop
    restored=least(allocation_row.units,greatest(0,allocation_row.lot_units-allocation_row.revoked_units-allocation_row.available_units-(allocation_row.reserved_units-allocation_row.units)-allocation_row.consumed_units));
    update public.billing_credit_lots set reserved_units=reserved_units-allocation_row.units,available_units=available_units+restored where mode=ledger_mode and id=allocation_row.lot_id;
    update public.billing_allocations set state='released' where mode=ledger_mode and operation_id=operation_key and lot_id=allocation_row.lot_id;
  end loop;
  update public.billing_operations set status=case when release_reason='cancelled' then 'cancelled' else 'released' end,
    reason=case when release_reason in ('refund','dispute') then 'payment_revoked' else release_reason end,
    reservation_token=case when release_reason in ('refund','dispute') then gen_random_uuid()::text else reservation_token end,updated_at=at_time where mode=ledger_mode and id=operation_key;
  update public.billing_outbox set completed=true where mode=ledger_mode and operation_id=operation_key;
  insert into public.billing_entries(mode,owner_id,type,units,reserved_units,operation_id,created_at) values(ledger_mode,operation_row.owner_id,'release',0,-operation_row.units,operation_key,at_time);
end;
$$;

create or replace function public.reader_billing_command(command_name text, command_payload jsonb)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  ledger_mode text; account_owner text; at_time timestamptz;
  account_row public.billing_accounts; order_row public.billing_orders; operation_row public.billing_operations;
  quote_row public.billing_quotes; lot_row public.billing_credit_lots; event_row public.billing_webhook_inbox; refund_row public.billing_refunds;
  call_row public.billing_provider_calls; allocation_row record; pending_row record;
  item_id text; quote_key text; intent text; hash_value text; checkout_key text; provider_order_key text; reason_value text;
  units_value bigint; amount_value bigint; paid_value bigint; tax_value bigint; discount_value bigint;
  refund_value bigint; cumulative_value bigint; revoked_value bigint; delta_value bigint; restore_value bigint;
  remaining_value bigint; take_value bigint; total_value bigint; page_size integer; cursor_value bigint;
  page_rows jsonb; receipt_value jsonb; scope_value jsonb; result_value jsonb; from_time timestamptz; to_time timestamptz;
begin
  if jsonb_typeof(command_payload) is distinct from 'object' or octet_length(command_payload::text)>65536 then raise exception using errcode='P0001',message='reader_billing:invalid_input'; end if;
  ledger_mode=command_payload->>'mode';
  if ledger_mode is null or ledger_mode not in ('test','live') then raise exception using errcode='P0001',message='reader_billing:invalid_input'; end if;
  at_time=public.reader_billing_timestamp(command_payload->'now');
  if command_name='readiness' then return jsonb_build_object('ready',true,'durable',true,'schemaVersion',1,'backend','postgres'); end if;
  if command_name='lookupOrder' then
    if command_payload->>'providerOrderId' is null and command_payload->>'checkoutId' is null then raise exception using errcode='P0001',message='reader_billing:invalid_input'; end if;
    if command_payload->>'providerOrderId' is not null then provider_order_key=public.reader_billing_text(command_payload->'providerOrderId'); end if;
    if command_payload->>'checkoutId' is not null then checkout_key=public.reader_billing_text(command_payload->'checkoutId'); end if;
    select * into order_row from public.billing_orders where mode=ledger_mode
      and (provider_order_key is null or provider_order_id=provider_order_key) and (checkout_key is null or checkout_id=checkout_key);
    if not found then return null; end if;return public.reader_billing_order_json(order_row);
  end if;
  if command_name='summary' then
    from_time=public.reader_billing_timestamp(command_payload->'from',null);to_time=public.reader_billing_timestamp(command_payload->'to',null);
    if from_time is null or to_time is null or from_time>=to_time or to_time-from_time>interval '366 days' then raise exception using errcode='P0001',message='reader_billing:invalid_input'; end if;
    return jsonb_build_object(
      'accounts',(select count(*) from public.billing_accounts where mode=ledger_mode),
      'orders',(select count(*) from public.billing_orders where mode=ledger_mode and created_at>=from_time and created_at<to_time),
      'paidOrders',(select count(*) from public.billing_entries where mode=ledger_mode and type='payment' and paid_amount>0 and created_at>=from_time and created_at<to_time),
      'paidUsers',(select count(distinct owner_id) from public.billing_entries where mode=ledger_mode and type='payment' and paid_amount>0 and created_at>=from_time and created_at<to_time),
      'salesByCurrency',coalesce((select jsonb_object_agg(currency,total) from (select currency,sum(paid_amount-tax_amount) total from public.billing_entries where mode=ledger_mode and type='payment' and created_at>=from_time and created_at<to_time group by currency) totals),'{}'::jsonb),
      'taxesByCurrency',coalesce((select jsonb_object_agg(currency,total) from (select currency,sum(tax_amount) total from public.billing_entries where mode=ledger_mode and type='payment' and created_at>=from_time and created_at<to_time group by currency) totals),'{}'::jsonb),
      'refundsByCurrency',coalesce((select jsonb_object_agg(currency,total) from (select currency,sum(amount) total from public.billing_entries where mode=ledger_mode and type='refund_cash' and created_at>=from_time and created_at<to_time group by currency) totals),'{}'::jsonb),
      'grantedUnits',coalesce((select sum(units) from public.billing_entries where mode=ledger_mode and type='grant' and created_at>=from_time and created_at<to_time),0),
      'grantedUnitsBySource',jsonb_build_object(
        'trial',coalesce((select sum(units) from public.billing_entries where mode=ledger_mode and type='grant' and source='trial' and created_at>=from_time and created_at<to_time),0),
        'purchase',coalesce((select sum(units) from public.billing_entries where mode=ledger_mode and type='grant' and source='purchase' and created_at>=from_time and created_at<to_time),0),
        'review',coalesce((select sum(units) from public.billing_entries where mode=ledger_mode and type='grant' and source='review' and created_at>=from_time and created_at<to_time),0)),
      'consumedUnits',coalesce((select -sum(units) from public.billing_entries where mode=ledger_mode and type in ('consume','reverse') and created_at>=from_time and created_at<to_time),0),
      'consumedUnitsBySource',jsonb_build_object(
        'trial',coalesce((select sum((source_units->>'trial')::bigint * case when type='consume' then 1 else -1 end) from public.billing_entries where mode=ledger_mode and type in ('consume','reverse') and created_at>=from_time and created_at<to_time),0),
        'purchase',coalesce((select sum((source_units->>'purchase')::bigint * case when type='consume' then 1 else -1 end) from public.billing_entries where mode=ledger_mode and type in ('consume','reverse') and created_at>=from_time and created_at<to_time),0),
        'review',coalesce((select sum((source_units->>'review')::bigint * case when type='consume' then 1 else -1 end) from public.billing_entries where mode=ledger_mode and type in ('consume','reverse') and created_at>=from_time and created_at<to_time),0)),
      'reservedUnits',coalesce((select sum(reserved_units) from public.billing_credit_lots where mode=ledger_mode),0),
      'calls',(select count(*) from public.billing_provider_calls where mode=ledger_mode and started_at>=from_time and started_at<to_time),
      'callsByFunding',coalesce((select jsonb_object_agg(funding,jsonb_build_object('calls',call_count,'knownCostMicrousd',known_cost,'unknownCostCalls',unknown_count)) from (
        select funding,count(*) as call_count,coalesce(sum(cost_microusd),0) as known_cost,count(*) filter(where cost_microusd is null or cost_status not in ('reported_usage_rated','invoice_reconciled')) as unknown_count
        from public.billing_provider_calls where mode=ledger_mode and started_at>=from_time and started_at<to_time group by funding) grouped),'{}'::jsonb),
      'callsByFeature',coalesce((select jsonb_object_agg(feature,jsonb_build_object('calls',call_count,'knownCostMicrousd',known_cost,'unknownCostCalls',unknown_count)) from (
        select feature,count(*) as call_count,coalesce(sum(cost_microusd),0) as known_cost,count(*) filter(where cost_microusd is null or cost_status not in ('reported_usage_rated','invoice_reconciled')) as unknown_count
        from public.billing_provider_calls where mode=ledger_mode and started_at>=from_time and started_at<to_time group by feature) grouped),'{}'::jsonb),
      'reviewOrders',(select count(*) from public.billing_entries where mode=ledger_mode and type='payment' and source='review' and created_at>=from_time and created_at<to_time),
      'trialGrants',(select count(*) from public.billing_entries where mode=ledger_mode and type='grant' and source='trial' and created_at>=from_time and created_at<to_time),
      'operationCounts',coalesce((select jsonb_object_agg(status,operation_count) from (select status,count(*) as operation_count from public.billing_operations where mode=ledger_mode and updated_at>=from_time and updated_at<to_time group by status) grouped),'{}'::jsonb),
      'paymentFeesStatus','unknown',
      'costCoverage',(select (count(*) filter(where cost_microusd is not null and cost_status in ('reported_usage_rated','invoice_reconciled')))::numeric/nullif(count(*),0) from public.billing_provider_calls where mode=ledger_mode and started_at>=from_time and started_at<to_time),
      'knownCostMicrousd',coalesce((select sum(cost_microusd) from public.billing_provider_calls where mode=ledger_mode and started_at>=from_time and started_at<to_time),0),
      'unknownCostCalls',(select count(*) from public.billing_provider_calls where mode=ledger_mode and (cost_microusd is null or cost_status not in ('reported_usage_rated','invoice_reconciled')) and started_at>=from_time and started_at<to_time),
      'complete',not exists(select 1 from public.billing_provider_calls where mode=ledger_mode and (cost_microusd is null or cost_status not in ('reported_usage_rated','invoice_reconciled')) and started_at>=from_time and started_at<to_time),
      'costBasis','usage_estimate','from',from_time,'to',to_time);
  end if;
  if command_name not in ('account','trial','quote','reserve','operation','running','result','settle','release','reverse','ackPublished','order','checkoutAttempt','checkout','getOrder','payment','refund','dispute','entries','orders','providerCall','recover') then raise exception using errcode='P0001',message='reader_billing:invalid_input'; end if;
  account_owner=public.reader_billing_text(command_payload->'ownerId');
  -- GET account is pure: it never silently claims the once-only trial grant.
  if command_name='account' then return public.reader_billing_account_json(ledger_mode,account_owner); end if;
  if command_name in ('operation','getOrder') then
    if command_name='operation' then
      item_id=public.reader_billing_text(command_payload->'operationId');
      -- After a typed rolled-back reservation error, an absence hint must wait
      -- for any concurrent reservation holding this same account lock. Ordinary
      -- reads remain nonlocking; this path does not create a missing account.
      if command_payload->'consistent'='true'::jsonb then
        perform 1 from public.billing_accounts where mode=ledger_mode and owner_id=account_owner for update;
      end if;
      select * into operation_row from public.billing_operations where mode=ledger_mode and id=item_id and owner_id=account_owner;
      if not found then return null; end if;return public.reader_billing_operation_json(operation_row);
    else
      item_id=public.reader_billing_text(command_payload->'orderId');
      select * into order_row from public.billing_orders where mode=ledger_mode and id=item_id and owner_id=account_owner;
      if not found then return null; end if;return public.reader_billing_order_json(order_row);
    end if;
  end if;
  if command_name in ('entries','orders') then
    page_size=least(100,public.reader_billing_integer(coalesce(command_payload->'limit','50'::jsonb),1));
    cursor_value=9223372036854775807;
    if command_payload->>'cursor' is not null then
      if command_payload->>'cursor' !~ '^[0-9]{1,18}$' then raise exception using errcode='P0001',message='reader_billing:invalid_input'; end if;
      cursor_value=(command_payload->>'cursor')::bigint;
    end if;
    if command_name='entries' then
      select coalesce(jsonb_agg(jsonb_build_object('id',id::text,'ownerId',owner_id,'mode',mode,'type',type,'units',units,'reservedUnits',reserved_units,'restoredUnits',restored_units,'operationId',operation_id,'orderId',order_id,'source',source,'unitsBySource',source_units,'amount',amount,'paidAmount',paid_amount,'taxAmount',tax_amount,'discountAmount',discount_amount,'currency',currency,'createdAt',created_at) order by id desc),'[]'::jsonb) into page_rows
        from (select * from public.billing_entries where mode=ledger_mode and owner_id=account_owner and id<cursor_value order by id desc limit page_size+1) page;
      return jsonb_build_object('entries',case when jsonb_array_length(page_rows)>page_size then page_rows-page_size else page_rows end,'nextCursor',case when jsonb_array_length(page_rows)>page_size then page_rows->(page_size-1)->>'id' else null end);
    else
      select coalesce(jsonb_agg(public.reader_billing_order_json(page::public.billing_orders) || jsonb_build_object('_cursor',page.sequence::text) order by page.sequence desc),'[]'::jsonb) into page_rows
        from (select * from public.billing_orders where mode=ledger_mode and owner_id=account_owner and sequence<cursor_value order by sequence desc limit page_size+1) page;
      result_value=jsonb_build_object('nextCursor',case when jsonb_array_length(page_rows)>page_size then page_rows->(page_size-1)->>'_cursor' else null end);
      if jsonb_array_length(page_rows)>page_size then page_rows=page_rows-page_size; end if;
      return result_value||jsonb_build_object('orders',coalesce((select jsonb_agg(value-'_cursor') from jsonb_array_elements(page_rows)),'[]'::jsonb));
    end if;
  end if;
  if command_name='recover' then
    select coalesce(jsonb_agg(public.reader_billing_operation_json(page::public.billing_operations)),'[]'::jsonb) into page_rows
      from (select o.* from public.billing_operations o where o.mode=ledger_mode and o.owner_id=account_owner and o.status in ('reserved','running','result_saved','settled')
        and not exists(select 1 from public.billing_outbox b where b.mode=o.mode and b.operation_id=o.id and b.kind='publish' and b.completed)
        order by o.updated_at,o.id limit 100) page;
    return jsonb_build_object('operations',page_rows);
  end if;
  insert into public.billing_accounts(mode,owner_id,created_at) values(ledger_mode,account_owner,at_time) on conflict do nothing;
  select * into account_row from public.billing_accounts where mode=ledger_mode and owner_id=account_owner for update;

  if command_name='trial' then
    item_id=public.reader_billing_text(command_payload->'grantId');units_value=public.reader_billing_integer(command_payload->'units',1);
    if not account_row.trial_granted then
      -- One campaign lock per environment bounds free grants across accounts.
      perform pg_advisory_xact_lock(hashtext('reader_billing_trial:'||ledger_mode));
      total_value=public.reader_billing_integer(coalesce(command_payload->'campaignBudgetUnits','0'::jsonb));
      if (select coalesce(sum(units),0) from public.billing_entries where mode=ledger_mode and type='grant' and source='trial')::numeric+units_value>total_value then
        raise exception using errcode='P0001',message='reader_billing:trial_budget_exhausted';
      end if;
      insert into public.billing_credit_lots(mode,id,owner_id,source,units,available_units,created_at) values(ledger_mode,item_id,account_owner,'trial',units_value,units_value,at_time);
      insert into public.billing_entries(mode,owner_id,type,units,lot_id,source,created_at) values(ledger_mode,account_owner,'grant',units_value,item_id,'trial',at_time);
      update public.billing_accounts set trial_granted=true where mode=ledger_mode and owner_id=account_owner;
    end if;
    return public.reader_billing_account_json(ledger_mode,account_owner);
  end if;
  if command_name='quote' then
    item_id=public.reader_billing_text(command_payload->'id');units_value=public.reader_billing_integer(command_payload->'units',1);
    scope_value=command_payload->'scope';
    if jsonb_typeof(scope_value) is distinct from 'object' or octet_length(scope_value::text)>4096
      or exists(select 1 from jsonb_object_keys(scope_value) k where k not in ('bookId','contentVersion','sourceVersion','passageId','requestId','requestHash','inputHash','contextPolicy','costLimitMicrousd'))
      or public.reader_billing_timestamp(command_payload->'expiresAt',null) is null or public.reader_billing_timestamp(command_payload->'expiresAt')<=at_time then raise exception using errcode='P0001',message='reader_billing:invalid_input'; end if;
    for pending_row in select key,value from jsonb_each(scope_value) loop
      if pending_row.key='costLimitMicrousd' then perform public.reader_billing_integer(pending_row.value,1); else perform public.reader_billing_text(pending_row.value); end if;
    end loop;
    select * into quote_row from public.billing_quotes where mode=ledger_mode and id=item_id;
    if found then
      if quote_row.owner_id<>account_owner then raise exception using errcode='P0001',message='reader_billing:owner_mismatch'; end if;
      if quote_row.units<>units_value or quote_row.action<>command_payload->>'action' or quote_row.scope_hash<>command_payload->>'scopeHash' or quote_row.scope<>scope_value or quote_row.price_version<>command_payload->>'priceVersion' or quote_row.expires_at<>public.reader_billing_timestamp(command_payload->'expiresAt') then raise exception using errcode='P0001',message='reader_billing:idempotency_conflict'; end if;
      return public.reader_billing_quote_json(quote_row);
    end if;
    insert into public.billing_quotes(mode,id,owner_id,action,units,scope_hash,scope,price_version,expires_at,created_at)
      values(ledger_mode,item_id,account_owner,public.reader_billing_text(command_payload->'action'),units_value,public.reader_billing_text(command_payload->'scopeHash'),scope_value,public.reader_billing_text(command_payload->'priceVersion'),public.reader_billing_timestamp(command_payload->'expiresAt'),at_time) returning * into quote_row;
    return public.reader_billing_quote_json(quote_row);
  end if;
  if command_name='reserve' then
    item_id=public.reader_billing_text(command_payload->'operationId');quote_key=public.reader_billing_text(command_payload->'quoteId');intent=public.reader_billing_text(command_payload->'idempotencyKey');hash_value=public.reader_billing_text(command_payload->'scopeHash');
    select * into operation_row from public.billing_operations where mode=ledger_mode and owner_id=account_owner and idempotency_key=intent;
    if found then
      if operation_row.scope_hash<>hash_value or operation_row.quote_id<>quote_key then raise exception using errcode='P0001',message='reader_billing:idempotency_conflict'; end if;
      return public.reader_billing_operation_json(operation_row);
    end if;
    if account_row.frozen then raise exception using errcode='P0001',message='reader_billing:frozen_account'; end if;
    select * into quote_row from public.billing_quotes where mode=ledger_mode and id=quote_key;
    if not found then raise exception using errcode='P0001',message='reader_billing:not_found'; end if;
    if quote_row.owner_id<>account_owner then raise exception using errcode='P0001',message='reader_billing:owner_mismatch'; end if;
    if quote_row.expires_at<=at_time then raise exception using errcode='P0001',message='reader_billing:stale_quote'; end if;
    if quote_row.scope_hash<>hash_value then raise exception using errcode='P0001',message='reader_billing:quote_changed'; end if;
    if exists(select 1 from public.billing_operations where mode=ledger_mode and quote_id=quote_key) then raise exception using errcode='P0001',message='reader_billing:quote_already_used'; end if;
    select coalesce(sum(available_units),0) into total_value from public.billing_credit_lots where mode=ledger_mode and owner_id=account_owner;
    if total_value<quote_row.units then raise exception using errcode='P0001',message='reader_billing:insufficient_credits'; end if;
    insert into public.billing_operations(mode,id,owner_id,quote_id,idempotency_key,action,units,scope_hash,scope,reservation_token,status,created_at,updated_at)
      values(ledger_mode,item_id,account_owner,quote_key,intent,quote_row.action,quote_row.units,hash_value,quote_row.scope,gen_random_uuid()::text,'reserved',at_time,at_time) returning * into operation_row;
    remaining_value=quote_row.units;
    for lot_row in select * from public.billing_credit_lots where mode=ledger_mode and owner_id=account_owner and available_units>0 order by case when source='trial' then 0 else 1 end,sequence for update loop
      take_value=least(remaining_value,lot_row.available_units);
      update public.billing_credit_lots set available_units=available_units-take_value,reserved_units=reserved_units+take_value where mode=ledger_mode and id=lot_row.id;
      insert into public.billing_allocations(mode,operation_id,lot_id,units,state) values(ledger_mode,item_id,lot_row.id,take_value,'held');
      remaining_value=remaining_value-take_value;exit when remaining_value=0;
    end loop;
    insert into public.billing_entries(mode,owner_id,type,units,reserved_units,operation_id,created_at) values(ledger_mode,account_owner,'hold',0,quote_row.units,item_id,at_time);
    return public.reader_billing_operation_json(operation_row);
  end if;
  if command_name in ('running','result','settle','release','reverse','ackPublished') then
    item_id=public.reader_billing_text(command_payload->'operationId');
    select * into operation_row from public.billing_operations where mode=ledger_mode and id=item_id for update;
    if not found then raise exception using errcode='P0001',message='reader_billing:not_found'; end if;
    if operation_row.owner_id<>account_owner then raise exception using errcode='P0001',message='reader_billing:owner_mismatch'; end if;
    if command_name not in ('reverse','ackPublished') and operation_row.reservation_token is distinct from command_payload->>'reservationToken' then raise exception using errcode='P0001',message='reader_billing:stale_worker'; end if;
    if command_name='running' then
      if operation_row.status='running' then return public.reader_billing_operation_json(operation_row)||jsonb_build_object('executionClaimed',false); end if;
      if operation_row.status<>'reserved' or account_row.frozen then raise exception using errcode='P0001',message='reader_billing:invalid_state'; end if;
      update public.billing_operations set status='running',started_at=at_time,updated_at=at_time where mode=ledger_mode and id=item_id returning * into operation_row;
      return public.reader_billing_operation_json(operation_row)||jsonb_build_object('executionClaimed',true);
    elsif command_name='ackPublished' then
      if operation_row.status<>'settled' then raise exception using errcode='P0001',message='reader_billing:invalid_state'; end if;
      update public.billing_outbox set completed=true where mode=ledger_mode and operation_id=item_id and kind='publish';
      update public.billing_operations set published_at=at_time,updated_at=at_time where mode=ledger_mode and id=item_id returning * into operation_row;
    elsif command_name='result' then
      receipt_value=command_payload->'receipt';
      if jsonb_typeof(receipt_value) is distinct from 'object' or octet_length(receipt_value::text)>4096 or receipt_value->>'ownerId' is distinct from account_owner or not receipt_value ? 'resultId'
        or exists(select 1 from jsonb_object_keys(receipt_value) k where k not in ('ownerId','bookId','contentVersion','sourceVersion','passageId','resultId','kind','operationId')) then raise exception using errcode='P0001',message='reader_billing:invalid_receipt'; end if;
      perform public.reader_billing_text(receipt_value->'resultId');
      for pending_row in select key,value from jsonb_each(receipt_value) loop perform public.reader_billing_text(pending_row.value); end loop;
      if receipt_value ? 'operationId' and receipt_value->>'operationId'<>item_id then raise exception using errcode='P0001',message='reader_billing:invalid_receipt'; end if;
      if receipt_value->>'bookId' is distinct from operation_row.scope->>'bookId'
        or receipt_value->>'passageId' is distinct from operation_row.scope->>'passageId'
        or receipt_value->>'contentVersion' is distinct from operation_row.scope->>'contentVersion'
        or receipt_value->>'sourceVersion' is distinct from operation_row.scope->>'sourceVersion' then raise exception using errcode='P0001',message='reader_billing:invalid_receipt'; end if;
      if operation_row.status in ('result_saved','settled') then
        if operation_row.receipt<>receipt_value then raise exception using errcode='P0001',message='reader_billing:idempotency_conflict'; end if;
        return public.reader_billing_operation_json(operation_row);
      end if;
      if operation_row.status not in ('reserved','running') then raise exception using errcode='P0001',message='reader_billing:invalid_state'; end if;
      update public.billing_operations set receipt=receipt_value,status='result_saved',updated_at=at_time where mode=ledger_mode and id=item_id returning * into operation_row;
      insert into public.billing_outbox(mode,owner_id,operation_id,kind,created_at) values(ledger_mode,account_owner,item_id,'settle',at_time) on conflict do nothing;
    elsif command_name='settle' then
      if operation_row.status in ('settled','reversed') then return public.reader_billing_operation_json(operation_row); end if;
      if account_row.frozen then raise exception using errcode='P0001',message='reader_billing:frozen_account'; end if;
      if operation_row.status<>'result_saved' or operation_row.receipt is null then raise exception using errcode='P0001',message='reader_billing:invalid_state'; end if;
      for allocation_row in select a.*,l.units as lot_units,l.revoked_units,l.consumed_units,l.available_units,l.reserved_units from public.billing_allocations a join public.billing_credit_lots l on l.mode=a.mode and l.id=a.lot_id where a.mode=ledger_mode and a.operation_id=item_id and a.state='held' order by l.sequence for update of a,l loop
        if allocation_row.available_units+allocation_row.reserved_units+allocation_row.consumed_units>allocation_row.lot_units-allocation_row.revoked_units then raise exception using errcode='P0001',message='reader_billing:frozen_account'; end if;
        update public.billing_credit_lots set reserved_units=reserved_units-allocation_row.units,consumed_units=consumed_units+allocation_row.units where mode=ledger_mode and id=allocation_row.lot_id;
        update public.billing_allocations set state='consumed' where mode=ledger_mode and operation_id=item_id and lot_id=allocation_row.lot_id;
      end loop;
      select coalesce(jsonb_object_agg(source,source_total),'{}'::jsonb) into scope_value from (
        select l.source,sum(a.units) as source_total from public.billing_allocations a join public.billing_credit_lots l on l.mode=a.mode and l.id=a.lot_id
        where a.mode=ledger_mode and a.operation_id=item_id and a.state='consumed' group by l.source) grouped;
      insert into public.billing_entries(mode,owner_id,type,units,reserved_units,operation_id,source_units,created_at) values(ledger_mode,account_owner,'consume',-operation_row.units,-operation_row.units,item_id,scope_value,at_time);
      update public.billing_operations set status='settled',settled_at=at_time,updated_at=at_time where mode=ledger_mode and id=item_id returning * into operation_row;
      update public.billing_outbox set completed=true where mode=ledger_mode and operation_id=item_id and kind='settle';
      insert into public.billing_outbox(mode,owner_id,operation_id,kind,created_at) values(ledger_mode,account_owner,item_id,'publish',at_time) on conflict do nothing;
    elsif command_name='release' then
      -- Recovery may release only the state it inspected. If a live worker has
      -- claimed the reservation meanwhile, this command must leave its hold alone.
      if command_payload->>'expectedStatus' is not null and operation_row.status is distinct from command_payload->>'expectedStatus' then return public.reader_billing_operation_json(operation_row); end if;
      if operation_row.status in ('settled','reversed') then return public.reader_billing_operation_json(operation_row); end if;
      reason_value=coalesce(command_payload->>'reason','failed');
      if length(reason_value)>200 then raise exception using errcode='P0001',message='reader_billing:invalid_input'; end if;
      perform public.reader_billing_release_operation(ledger_mode,item_id,reason_value,at_time);
      select * into operation_row from public.billing_operations where mode=ledger_mode and id=item_id;
    else
      if operation_row.status='reversed' then return public.reader_billing_operation_json(operation_row); end if;
      if operation_row.status<>'settled' then raise exception using errcode='P0001',message='reader_billing:invalid_state'; end if;
      restore_value=0;scope_value='{}'::jsonb;
      for allocation_row in select a.*,l.units as lot_units,l.source as lot_source,l.order_id,l.revoked_units,l.available_units,l.reserved_units,l.consumed_units from public.billing_allocations a join public.billing_credit_lots l on l.mode=a.mode and l.id=a.lot_id where a.mode=ledger_mode and a.operation_id=item_id and a.state='consumed' order by l.sequence for update of a,l loop
        take_value=least(allocation_row.units,greatest(0,allocation_row.lot_units-allocation_row.revoked_units-allocation_row.available_units-allocation_row.reserved_units-(allocation_row.consumed_units-allocation_row.units)));
        update public.billing_credit_lots set consumed_units=consumed_units-allocation_row.units,available_units=available_units+take_value where mode=ledger_mode and id=allocation_row.lot_id;
        update public.billing_allocations set state='reversed' where mode=ledger_mode and operation_id=item_id and lot_id=allocation_row.lot_id;
        restore_value=restore_value+take_value;
        scope_value=scope_value||jsonb_build_object(allocation_row.lot_source,coalesce((scope_value->>allocation_row.lot_source)::bigint,0)+allocation_row.units);
        if allocation_row.order_id is not null then
          update public.billing_orders set exposure_units=greatest(0,exposure_units-allocation_row.units),updated_at=at_time where mode=ledger_mode and id=allocation_row.order_id;
        end if;
      end loop;
      insert into public.billing_entries(mode,owner_id,type,units,restored_units,operation_id,source_units,created_at) values(ledger_mode,account_owner,'reverse',operation_row.units,restore_value,item_id,scope_value,at_time);
      update public.billing_accounts set frozen=exists(select 1 from public.billing_orders where mode=ledger_mode and owner_id=account_owner and (disputed or exposure_units>0)) where mode=ledger_mode and owner_id=account_owner;
      update public.billing_operations set status='reversed',reason=left(coalesce(command_payload->>'reason','delivery_failed'),200),updated_at=at_time where mode=ledger_mode and id=item_id returning * into operation_row;
      update public.billing_outbox set completed=true where mode=ledger_mode and operation_id=item_id;
    end if;
    return public.reader_billing_operation_json(operation_row);
  end if;

  if command_name='order' then
    item_id=public.reader_billing_text(command_payload->'id');intent=public.reader_billing_text(command_payload->'intentKey');
    amount_value=public.reader_billing_integer(command_payload->'amount');units_value=public.reader_billing_integer(command_payload->'units',1);
    select * into order_row from public.billing_orders where mode=ledger_mode and owner_id=account_owner and intent_key=intent;
    if found then
      if order_row.product_key is distinct from command_payload->>'productKey' or order_row.product_id is distinct from command_payload->>'productId' or order_row.amount<>amount_value or order_row.currency is distinct from command_payload->>'currency' or order_row.units<>units_value then raise exception using errcode='P0001',message='reader_billing:idempotency_conflict'; end if;
      return public.reader_billing_order_json(order_row);
    end if;
    insert into public.billing_orders(mode,id,owner_id,intent_key,product_key,product_id,amount,currency,units,created_at,updated_at)
      values(ledger_mode,item_id,account_owner,intent,public.reader_billing_text(command_payload->'productKey'),public.reader_billing_text(command_payload->'productId'),amount_value,command_payload->>'currency',units_value,at_time,at_time) returning * into order_row;
    return public.reader_billing_order_json(order_row);
  end if;
  if command_name in ('checkoutAttempt','checkout','payment','refund','dispute') then
    item_id=public.reader_billing_text(command_payload->'orderId');
    select * into order_row from public.billing_orders where mode=ledger_mode and id=item_id for update;
    if not found then raise exception using errcode='P0001',message='reader_billing:not_found'; end if;
    if order_row.owner_id<>account_owner then raise exception using errcode='P0001',message='reader_billing:owner_mismatch'; end if;
    if command_name='checkoutAttempt' then
      if order_row.checkout_attempted_at is not null or order_row.checkout_id is not null then return jsonb_build_object('claimed',false,'order',public.reader_billing_order_json(order_row)); end if;
      update public.billing_orders set checkout_attempted_at=at_time,updated_at=at_time where mode=ledger_mode and id=item_id returning * into order_row;
      return jsonb_build_object('claimed',true,'order',public.reader_billing_order_json(order_row));
    end if;
    if command_name='checkout' then
      checkout_key=public.reader_billing_text(command_payload->'checkoutId');
      if command_payload->>'checkoutUrl' is not null and (length(command_payload->>'checkoutUrl')>2048 or command_payload->>'checkoutUrl' !~ '^https://') then raise exception using errcode='P0001',message='reader_billing:invalid_input'; end if;
      if order_row.checkout_id is not null then
        if order_row.checkout_id<>checkout_key or order_row.checkout_url is not null and command_payload->>'checkoutUrl' is not null and order_row.checkout_url<>command_payload->>'checkoutUrl' then raise exception using errcode='P0001',message='reader_billing:idempotency_conflict'; end if;
        if order_row.checkout_url is null and command_payload->>'checkoutUrl' is not null then update public.billing_orders set checkout_url=command_payload->>'checkoutUrl',updated_at=at_time where mode=ledger_mode and id=item_id returning * into order_row; end if;
      else
        update public.billing_orders set checkout_id=checkout_key,checkout_url=command_payload->>'checkoutUrl',updated_at=at_time where mode=ledger_mode and id=item_id returning * into order_row;
      end if;
      return public.reader_billing_order_json(order_row);
    end if;
    intent=public.reader_billing_text(command_payload->'eventId');hash_value=public.reader_billing_text(command_payload->'eventHash');
    select * into event_row from public.billing_webhook_inbox where mode=ledger_mode and event_id=intent;
    if found then
      if event_row.event_hash<>hash_value or event_row.event_type<>command_name or event_row.owner_id<>account_owner or event_row.order_id<>item_id then raise exception using errcode='P0001',message='reader_billing:event_conflict'; end if;
      return public.reader_billing_order_json(order_row);
    end if;
    insert into public.billing_webhook_inbox(mode,event_id,event_hash,event_type,owner_id,order_id,created_at) values(ledger_mode,intent,hash_value,command_name,account_owner,item_id,at_time);
    if command_name='payment' then
      amount_value=public.reader_billing_integer(command_payload->'amount');units_value=public.reader_billing_integer(command_payload->'units',1);
      paid_value=public.reader_billing_integer(command_payload->'paidAmount');tax_value=public.reader_billing_integer(command_payload->'taxAmount');discount_value=public.reader_billing_integer(command_payload->'discountAmount');
      checkout_key=public.reader_billing_text(command_payload->'checkoutId');provider_order_key=public.reader_billing_text(command_payload->'providerOrderId');
      if order_row.amount<>amount_value or order_row.units<>units_value or order_row.currency is distinct from command_payload->>'currency' or order_row.product_id is distinct from command_payload->>'productId' or order_row.checkout_id is distinct from checkout_key
        or discount_value>amount_value or paid_value::numeric<>amount_value::numeric-discount_value+tax_value or order_row.paid_amount is not null and order_row.paid_amount<>paid_value then raise exception using errcode='P0001',message='reader_billing:invalid_input'; end if;
      if order_row.payment_verified then
        if order_row.provider_order_id is distinct from provider_order_key or order_row.tax_amount<>tax_value or order_row.discount_amount<>discount_value then raise exception using errcode='P0001',message='reader_billing:idempotency_conflict'; end if;
        return public.reader_billing_order_json(order_row);
      end if;
      update public.billing_orders set provider_order_id=provider_order_key,payment_verified=true,paid_amount=paid_value,tax_amount=tax_value,discount_amount=discount_value,paid_at=at_time,
        status=case when disputed then 'disputed' when revoked_units=units then 'refunded' when revoked_units>0 then 'partially_refunded' else 'paid' end,updated_at=at_time where mode=ledger_mode and id=item_id returning * into order_row;
      take_value=order_row.units-order_row.revoked_units;
      insert into public.billing_credit_lots(mode,id,owner_id,source,order_id,units,available_units,revoked_units,created_at)
        values(ledger_mode,'order:'||item_id,account_owner,case when paid_value=0 then 'review' else 'purchase' end,item_id,order_row.units,take_value,order_row.revoked_units,at_time);
      insert into public.billing_entries(mode,owner_id,type,units,order_id,source,paid_amount,tax_amount,discount_amount,currency,created_at)
        values(ledger_mode,account_owner,'payment',0,item_id,case when paid_value=0 then 'review' else 'purchase' end,paid_value,tax_value,discount_value,order_row.currency,at_time);
      if take_value>0 then insert into public.billing_entries(mode,owner_id,type,units,order_id,lot_id,source,created_at) values(ledger_mode,account_owner,'grant',take_value,item_id,'order:'||item_id,case when paid_value=0 then 'review' else 'purchase' end,at_time); end if;
      return public.reader_billing_order_json(order_row);
    end if;
    if command_name='refund' then
      intent=public.reader_billing_text(command_payload->'refundId');refund_value=public.reader_billing_integer(command_payload->'refundAmount');paid_value=public.reader_billing_integer(command_payload->'paidAmount');
      if order_row.paid_amount is not null and order_row.paid_amount<>paid_value or paid_value=0 then raise exception using errcode='P0001',message='reader_billing:invalid_input'; end if;
      select * into refund_row from public.billing_refunds where mode=ledger_mode and refund_id=intent;
      if found then
        if refund_row.order_id<>item_id or refund_row.refund_amount<>refund_value then raise exception using errcode='P0001',message='reader_billing:idempotency_conflict'; end if;
        return public.reader_billing_order_json(order_row);
      end if;
      cumulative_value=case when command_payload->>'cumulativeRefundAmount' is null then order_row.refunded_amount+refund_value else public.reader_billing_integer(command_payload->'cumulativeRefundAmount') end;
      if cumulative_value>paid_value or refund_value>paid_value then raise exception using errcode='P0001',message='reader_billing:invalid_input'; end if;
      cumulative_value=greatest(order_row.refunded_amount,cumulative_value);
      revoked_value=case when order_row.disputed then order_row.units else ceil(order_row.units::numeric*cumulative_value/paid_value)::bigint end;
      insert into public.billing_refunds(mode,refund_id,order_id,refund_amount,cumulative_refund_amount,money_delta,created_at) values(ledger_mode,intent,item_id,refund_value,cumulative_value,cumulative_value-order_row.refunded_amount,at_time);
      if cumulative_value>order_row.refunded_amount then insert into public.billing_entries(mode,owner_id,type,units,order_id,amount,currency,created_at)
        values(ledger_mode,account_owner,'refund_cash',0,item_id,cumulative_value-order_row.refunded_amount,order_row.currency,at_time); end if;
    else
      cumulative_value=order_row.refunded_amount;revoked_value=order_row.units;
      update public.billing_accounts set frozen=true where mode=ledger_mode and owner_id=account_owner;
    end if;
    delta_value=greatest(0,revoked_value-order_row.revoked_units);restore_value=0;
    select * into lot_row from public.billing_credit_lots where mode=ledger_mode and order_id=item_id for update;
    if found and delta_value>0 then
      for pending_row in select distinct a.operation_id from public.billing_allocations a where a.mode=ledger_mode and a.lot_id=lot_row.id and a.state='held' order by a.operation_id loop
        perform public.reader_billing_release_operation(ledger_mode,pending_row.operation_id,command_name,at_time);
      end loop;
      select * into lot_row from public.billing_credit_lots where mode=ledger_mode and order_id=item_id for update;
      take_value=least(delta_value,lot_row.available_units);
      restore_value=delta_value-take_value;
      update public.billing_credit_lots set available_units=available_units-take_value,revoked_units=revoked_value where mode=ledger_mode and id=lot_row.id;
      if take_value<delta_value then update public.billing_accounts set frozen=true where mode=ledger_mode and owner_id=account_owner; end if;
      if take_value>0 then insert into public.billing_entries(mode,owner_id,type,units,order_id,lot_id,source,created_at) values(ledger_mode,account_owner,'refund',-take_value,item_id,lot_row.id,lot_row.source,at_time); end if;
    end if;
    update public.billing_orders set paid_amount=coalesce(paid_amount,paid_value),refunded_amount=cumulative_value,revoked_units=revoked_value,exposure_units=exposure_units+restore_value,disputed=disputed or command_name='dispute',
      status=case when disputed or command_name='dispute' then 'disputed' when revoked_value=units then 'refunded' when revoked_value>0 then 'partially_refunded' else status end,updated_at=at_time where mode=ledger_mode and id=item_id returning * into order_row;
    return public.reader_billing_order_json(order_row);
  end if;
  if command_name='providerCall' then
    item_id=public.reader_billing_text(command_payload->'id');
    if command_payload->>'operationId' is not null and not exists(select 1 from public.billing_operations where mode=ledger_mode and id=command_payload->>'operationId' and owner_id=account_owner) then raise exception using errcode='P0001',message='reader_billing:owner_mismatch'; end if;
    if command_payload->'usage' is not null and command_payload->'usage'<>'null'::jsonb and (jsonb_typeof(command_payload->'usage')<>'object' or octet_length((command_payload->'usage')::text)>4096) then raise exception using errcode='P0001',message='reader_billing:invalid_input'; end if;
    receipt_value=null;
    if command_payload->'usage' is not null and command_payload->'usage'<>'null'::jsonb then
      receipt_value='{}'::jsonb;
      for pending_row in select unnest(array['inputTokens','outputTokens','cacheReadTokens','cacheWriteTokens']) as key loop
        receipt_value=receipt_value||jsonb_build_object(pending_row.key,case when command_payload->'usage'->>pending_row.key is null then null else public.reader_billing_integer(command_payload->'usage'->pending_row.key) end);
      end loop;
    end if;
    units_value=case when command_payload->>'costMicrousd' is null then null else public.reader_billing_integer(command_payload->'costMicrousd') end;
    select * into call_row from public.billing_provider_calls where mode=ledger_mode and id=item_id;
    if found then
      if call_row.owner_id<>account_owner then raise exception using errcode='P0001',message='reader_billing:owner_mismatch'; end if;
      -- An unfinished dispatch may receive one terminal supplier receipt. Its
      -- identity is immutable, and completed receipts remain append-only facts.
      if call_row.status='unknown' and call_row.finished_at is null and call_row.cost_status='unknown' and call_row.cost_microusd is null
        and call_row.usage='{"inputTokens":null,"outputTokens":null,"cacheReadTokens":null,"cacheWriteTokens":null}'::jsonb
        and public.reader_billing_timestamp(command_payload->'finishedAt',null) is not null then
        if call_row.operation_id is distinct from command_payload->>'operationId' or call_row.feature is distinct from command_payload->>'feature'
          or call_row.funding is distinct from command_payload->>'funding' or call_row.provider is distinct from command_payload->>'provider'
          or call_row.model is distinct from command_payload->>'model' or call_row.started_at is distinct from public.reader_billing_timestamp(command_payload->'startedAt',at_time) then
          raise exception using errcode='P0001',message='reader_billing:idempotency_conflict';
        end if;
        update public.billing_provider_calls set status=public.reader_billing_text(command_payload->'status'),usage=receipt_value,cost_microusd=units_value,
          cost_status=public.reader_billing_text(command_payload->'costStatus'),price_version=coalesce(command_payload->>'pricingVersion',command_payload->>'priceVersion'),
          finished_at=public.reader_billing_timestamp(command_payload->'finishedAt',null) where mode=ledger_mode and id=item_id returning * into call_row;
        return jsonb_build_object('id',call_row.id,'status',call_row.status,'costStatus',call_row.cost_status);
      end if;
      if call_row.operation_id is distinct from command_payload->>'operationId' or call_row.status is distinct from command_payload->>'status' or call_row.usage is distinct from receipt_value
        or call_row.feature is distinct from command_payload->>'feature' or call_row.funding is distinct from command_payload->>'funding'
        or call_row.provider is distinct from command_payload->>'provider' or call_row.model is distinct from command_payload->>'model'
        or call_row.cost_microusd is distinct from units_value or call_row.cost_status is distinct from command_payload->>'costStatus'
        or call_row.price_version is distinct from coalesce(command_payload->>'pricingVersion',command_payload->>'priceVersion')
        or call_row.started_at is distinct from public.reader_billing_timestamp(command_payload->'startedAt',at_time)
        or call_row.finished_at is distinct from public.reader_billing_timestamp(command_payload->'finishedAt',null) then raise exception using errcode='P0001',message='reader_billing:idempotency_conflict'; end if;
      return jsonb_build_object('id',call_row.id,'status',call_row.status,'costStatus',call_row.cost_status);
    end if;
    insert into public.billing_provider_calls(mode,id,owner_id,operation_id,feature,funding,provider,model,status,usage,cost_microusd,cost_status,price_version,started_at,finished_at)
      values(ledger_mode,item_id,account_owner,command_payload->>'operationId',public.reader_billing_text(command_payload->'feature'),public.reader_billing_text(command_payload->'funding'),public.reader_billing_text(command_payload->'provider'),public.reader_billing_text(command_payload->'model'),public.reader_billing_text(command_payload->'status'),receipt_value,units_value,public.reader_billing_text(command_payload->'costStatus'),case when coalesce(command_payload->>'pricingVersion',command_payload->>'priceVersion') is null then null else public.reader_billing_text(coalesce(command_payload->'pricingVersion',command_payload->'priceVersion')) end,public.reader_billing_timestamp(command_payload->'startedAt',at_time),public.reader_billing_timestamp(command_payload->'finishedAt',null)) returning * into call_row;
    return jsonb_build_object('id',call_row.id,'status',call_row.status,'costStatus',call_row.cost_status);
  end if;
  raise exception using errcode='P0001',message='reader_billing:invalid_input';
exception
  when unique_violation then raise exception using errcode='P0001',message='reader_billing:idempotency_conflict';
  when check_violation or not_null_violation or foreign_key_violation or invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format or datetime_field_overflow then raise exception using errcode='P0001',message='reader_billing:invalid_input';
end;
$$;

-- Helpers are private too: their PUBLIC default EXECUTE privilege would otherwise
-- let a browser bypass the domain's identity and administrator checks.
revoke all on function public.reader_billing_immutable_entry(),public.reader_billing_text(jsonb),public.reader_billing_integer(jsonb,bigint),public.reader_billing_timestamp(jsonb,timestamptz),public.reader_billing_account_json(text,text),public.reader_billing_order_json(public.billing_orders),public.reader_billing_operation_json(public.billing_operations),public.reader_billing_quote_json(public.billing_quotes),public.reader_billing_release_operation(text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.reader_billing_immutable_entry(),public.reader_billing_text(jsonb),public.reader_billing_integer(jsonb,bigint),public.reader_billing_timestamp(jsonb,timestamptz),public.reader_billing_account_json(text,text),public.reader_billing_order_json(public.billing_orders),public.reader_billing_operation_json(public.billing_operations),public.reader_billing_quote_json(public.billing_quotes),public.reader_billing_release_operation(text,text,text,timestamptz) to service_role;
revoke all on function public.reader_billing_command(text, jsonb) from public, anon, authenticated;
grant execute on function public.reader_billing_command(text, jsonb) to service_role;
notify pgrst,'reload schema';
commit;
