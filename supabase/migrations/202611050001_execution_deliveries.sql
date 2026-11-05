begin;
create table if not exists public.reader_execution_deliveries (
 job_id uuid primary key,
 receipt_id text not null unique check (receipt_id ~ '^[a-f0-9]{64}$'),
 owner_id text not null,
 result_digest text not null check (result_digest ~ '^[a-f0-9]{64}$'),
 document_key text not null,
 document_version bigint not null,
 committed_at timestamptz not null default now()
);
alter table public.reader_execution_deliveries enable row level security;
revoke all on public.reader_execution_deliveries from public, anon, authenticated;
grant select, insert on public.reader_execution_deliveries to service_role;
create or replace function public.reader_document_cas_delivery(document_key text,expected_version bigint,document_value jsonb,execution_job_id uuid,execution_receipt_id text,execution_owner_id text,execution_result_digest text)
returns boolean language plpgsql security invoker set search_path = public as $$
declare prior public.reader_execution_deliveries; saved boolean; queue_value jsonb; candidate jsonb;
begin
 -- Lock by job even before the first receipt exists; concurrent late workers
 -- cannot deliver the same job into two different domain documents.
 perform pg_advisory_xact_lock(hashtextextended(execution_job_id::text,0));
 select * into prior from public.reader_execution_deliveries where job_id=execution_job_id;
 if found then
  if prior.receipt_id<>execution_receipt_id or prior.owner_id<>execution_owner_id or prior.result_digest<>execution_result_digest or prior.document_key<>document_key then raise exception 'execution receipt conflict'; end if;
  return true;
 end if;
 -- Lock the persisted candidate and cancellation fence in the SAME database
 -- transaction as delivery. A cancellation cannot slip between API validation
 -- and the domain CAS. The queue mirror changes version so a racing cancel CAS
 -- retries and observes the committed receipt instead of overwriting success.
 if document_key='execution/queue/v1' then raise exception 'invalid delivery target'; end if;
 select value into queue_value from public.reader_documents where key='execution/queue/v1' for update;
 select item into candidate from jsonb_array_elements(queue_value->'jobs') item where item->>'id'=execution_job_id::text;
 if candidate is null or candidate->>'status' is distinct from 'candidate_ready' or candidate->>'ownerId' is distinct from execution_owner_id or candidate->>'commitReceiptId' is distinct from execution_receipt_id or candidate->>'resultDigest' is distinct from execution_result_digest then raise exception 'execution candidate revoked'; end if;
 saved:=public.reader_document_cas(document_key,expected_version,document_value);
 if not saved then return false; end if;
 insert into public.reader_execution_deliveries(job_id,receipt_id,owner_id,result_digest,document_key,document_version)
 values(execution_job_id,execution_receipt_id,execution_owner_id,execution_result_digest,document_key,expected_version+1);
 update public.reader_documents set version=version+1,updated_at=now(),value=jsonb_set(queue_value,'{jobs}',(
  select jsonb_agg(case when item->>'id'=execution_job_id::text then
   jsonb_set(jsonb_set(item,'{status}','"succeeded"'::jsonb),'{events}',(item->'events')||jsonb_build_array(jsonb_build_object('sequence',jsonb_array_length(item->'events')+1,'kind','succeeded','at',floor(extract(epoch from clock_timestamp())*1000),'commitReceiptId',execution_receipt_id)))
   else item end order by ordinal)
  from jsonb_array_elements(queue_value->'jobs') with ordinality as entries(item,ordinal)
 )) where key='execution/queue/v1';
 return true;
end;
$$;
revoke all on function public.reader_document_cas_delivery(text,bigint,jsonb,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.reader_document_cas_delivery(text,bigint,jsonb,uuid,text,text,text) to service_role;
commit;
