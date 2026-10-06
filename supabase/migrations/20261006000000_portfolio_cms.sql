-- The portfolio's content store on Supabase (see src/server/db.ts and storage.ts).
--
-- Only the site's server reads and writes these tables, through DATABASE_URL (or a
-- Hyperdrive config for it). Row Level Security is enabled on every table with NO
-- policies, so the public Data API (the anon / publishable key) can read or change
-- nothing here. The same goes for the private storage bucket.
--
-- Apply with the Supabase CLI (`supabase db push`) or paste into the SQL Editor.

create table if not exists public.users (
  id text primary key,
  email text not null unique,
  name text not null,
  password_hash text not null,
  role text not null default 'admin',
  created_at bigint not null,
  last_login_at bigint,
  disabled integer not null default 0
);

create table if not exists public.sessions (
  id_hash text primary key,
  user_id text not null references public.users(id) on delete cascade,
  csrf text not null,
  created_at bigint not null,
  last_seen_at bigint not null,
  expires_at bigint not null,
  user_agent text
);
create index if not exists sessions_user on public.sessions(user_id);

create table if not exists public.documents (
  id text primary key,
  kind text not null,
  draft_rev text,
  published_rev text,
  updated_at bigint not null
);

create table if not exists public.revisions (
  id text primary key,
  doc_id text not null references public.documents(id),
  parent_id text,
  created_at bigint not null,
  author_id text,
  author_name text,
  message text,
  schema_version integer not null,
  content text,
  blobs text,
  hash text not null,
  size bigint not null,
  published_at bigint
);
create index if not exists revisions_doc on public.revisions(doc_id, created_at desc);

create table if not exists public.audit (
  id bigint generated always as identity primary key,
  at bigint not null,
  actor_id text,
  actor_name text,
  action text not null,
  doc_id text,
  revision_id text,
  detail text
);
create index if not exists audit_at on public.audit(at desc);

create table if not exists public.media (
  id text primary key,
  kind text not null,
  filename text not null,
  mime text not null,
  size bigint not null,
  sha256 text not null,
  width integer,
  height integer,
  alt text not null default '',
  title text not null default '',
  created_at bigint not null,
  created_by text
);

create table if not exists public.events (
  id bigint generated always as identity primary key,
  at bigint not null,
  day text not null,
  type text not null,
  path text,
  referrer text,
  device text,
  visitor text,
  session text,
  props text
);
create index if not exists events_day_type on public.events(day, type);
create index if not exists events_type_at on public.events(type, at);

create table if not exists public.login_attempts (
  key text primary key,
  failures integer not null,
  first_at bigint not null,
  locked_until bigint
);

-- Deny the Data API everything: no policies, and no grants to its roles.
do $$
declare t text;
begin
  foreach t in array array['users', 'sessions', 'documents', 'revisions', 'audit', 'media', 'events', 'login_attempts'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
  end loop;
end $$;

-- World documents (~17 MB each) and uploads, 50 MB at most per file. Private: only the server (service-role
-- key) reaches it; visitors get files through the site's own routes.
insert into storage.buckets (id, name, public, file_size_limit)
values ('cms', 'cms', false, 52428800)
on conflict (id) do update set public = false;
