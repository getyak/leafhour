create table if not exists public.reader_books (
  book_id text primary key,
  content_version text not null,
  payload jsonb not null,
  experience_pack jsonb not null default '{}'::jsonb,
  experience_metrics jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.reader_states (
  owner_id text not null,
  book_id text not null references public.reader_books(book_id) on delete cascade,
  records jsonb not null,
  experiences jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (owner_id, book_id)
);

alter table public.reader_books enable row level security;
alter table public.reader_states enable row level security;

revoke all on table public.reader_books from anon, authenticated;
revoke all on table public.reader_states from anon, authenticated;

comment on table public.reader_books is 'Private book payloads. Server-side secret access only.';
comment on table public.reader_states is 'Private reader notes, progress, and interaction state.';
