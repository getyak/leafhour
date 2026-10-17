-- Apply once to the existing Supabase project; contains no credentials.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create schema if not exists reader_internal;
revoke all on schema reader_internal from public, anon, authenticated;

create or replace function public.reader_configure_ingestion_wake(wake_origin text, derived_token text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare saved_id uuid;
begin
  if wake_origin is null or derived_token is null or wake_origin !~ '^https://[a-zA-Z0-9.-]+(:[0-9]+)?$' or derived_token !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid worker configuration';
  end if;
  select id into saved_id from vault.secrets where name = 'leafhour_ingestion_origin';
  if saved_id is null then perform vault.create_secret(wake_origin,'leafhour_ingestion_origin');
  else perform vault.update_secret(saved_id,wake_origin); end if;
  saved_id := null;
  select id into saved_id from vault.secrets where name = 'leafhour_ingestion_wake';
  if saved_id is null then perform vault.create_secret(derived_token,'leafhour_ingestion_wake');
  else perform vault.update_secret(saved_id,derived_token); end if;
  return true;
end;
$$;
revoke all on function public.reader_configure_ingestion_wake(text,text) from public, anon, authenticated;
grant execute on function public.reader_configure_ingestion_wake(text,text) to service_role;

create or replace function reader_internal.wake_ingestion()
returns bigint language plpgsql security definer set search_path = '' as $$
declare request_id bigint; origin text; token text;
begin
  if not exists (
    select 1 from public.reader_documents d,
    lateral jsonb_array_elements(coalesce(d.value->'jobs','[]'::jsonb)) j
    where d.key='ingestion/queue/v1'
      and (j->>'nextAt')::numeric <= extract(epoch from clock_timestamp())*1000
      and coalesce((d.value->'lease'->>'until')::numeric,0) <= extract(epoch from clock_timestamp())*1000
  ) then return null; end if;
  select decrypted_secret into origin from vault.decrypted_secrets where name='leafhour_ingestion_origin';
  select decrypted_secret into token from vault.decrypted_secrets where name='leafhour_ingestion_wake';
  if origin is null or token is null then return null; end if;
  select net.http_post(
    url:=origin||'/api/internal/ingestion/wake',
    headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||token),
    body:='{}'::jsonb, timeout_milliseconds:=10000
  ) into request_id;
  return request_id;
end;
$$;
revoke all on function reader_internal.wake_ingestion() from public, anon, authenticated;
select cron.schedule('leafhour-ingestion-recovery','* * * * *','select reader_internal.wake_ingestion();');
