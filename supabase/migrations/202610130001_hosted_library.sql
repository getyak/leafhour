begin;

-- Separate from the existing single-owner reader_books / reader_states archive.
create table if not exists public.reader_documents (
  key text primary key,
  version bigint not null check (version > 0),
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.reader_documents enable row level security;
revoke all on public.reader_documents from anon, authenticated;
grant select, insert, update, delete on public.reader_documents to service_role;

-- Compare-and-swap survives concurrent requests in separate Vercel processes.
create or replace function public.reader_document_cas(document_key text, expected_version bigint, document_value jsonb)
returns boolean language plpgsql security invoker set search_path = public as $$
declare affected integer;
begin
  if expected_version = 0 then
    insert into public.reader_documents(key, version, value)
    values (document_key, 1, document_value) on conflict (key) do nothing;
  else
    update public.reader_documents set version = version + 1, value = document_value, updated_at = now()
    where key = document_key and version = expected_version;
  end if;
  get diagnostics affected = row_count;
  return affected = 1;
end;
$$;
revoke all on function public.reader_document_cas(text, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.reader_document_cas(text, bigint, jsonb) to service_role;

insert into storage.buckets(id, name, public, file_size_limit)
values ('reader-originals', 'reader-originals', false, 20971520)
on conflict (id) do nothing;
-- Fail instead of silently accepting an existing public bucket.
do $$ begin
  if exists (select 1 from storage.buckets where id = 'reader-originals' and public) then
    raise exception 'reader-originals must be private';
  end if;
end $$;
notify pgrst, 'reload schema';
commit;
