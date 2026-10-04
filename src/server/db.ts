import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { config, dataPath } from './config.ts'

/* ============================================================
   THE CONTENT DATABASE

   One SQLite file, opened with Node's built-in `node:sqlite`
   (no native module to compile, no service to run, no bill).
   It holds the small, relational things: admin accounts and
   sessions, the revision index of every document, the audit
   trail, the media index and the analytics events. Large
   payloads — world documents, uploaded files — live beside it
   on disk as content-addressed blobs (see blobs.ts) and the
   database only records their hashes.

   Synchronous on purpose: a portfolio's admin has one editor at
   a time, the queries are tiny, and a synchronous transaction
   cannot interleave with another request in the same process,
   which is what makes "check the base revision, then write"
   atomic without a lock server.
   ============================================================ */

const MIGRATIONS: string[] = [
  /* 1 — initial schema */ `
  create table users (
    id text primary key,
    email text not null unique collate nocase,
    name text not null,
    password_hash text not null,
    role text not null default 'admin',
    created_at integer not null,
    last_login_at integer,
    disabled integer not null default 0
  );
  create table sessions (
    id_hash text primary key,
    user_id text not null references users(id) on delete cascade,
    csrf text not null,
    created_at integer not null,
    last_seen_at integer not null,
    expires_at integer not null,
    user_agent text
  );
  create index sessions_user on sessions(user_id);
  create table documents (
    id text primary key,
    kind text not null,
    draft_rev text,
    published_rev text,
    updated_at integer not null
  );
  create table revisions (
    id text primary key,
    doc_id text not null references documents(id),
    parent_id text,
    created_at integer not null,
    author_id text,
    author_name text,
    message text,
    schema_version integer not null,
    content text,
    blobs text,
    hash text not null,
    size integer not null,
    published_at integer
  );
  create index revisions_doc on revisions(doc_id, created_at desc);
  create table audit (
    id integer primary key autoincrement,
    at integer not null,
    actor_id text,
    actor_name text,
    action text not null,
    doc_id text,
    revision_id text,
    detail text
  );
  create index audit_at on audit(at desc);
  create table media (
    id text primary key,
    kind text not null,
    filename text not null,
    mime text not null,
    size integer not null,
    sha256 text not null,
    width integer,
    height integer,
    alt text not null default '',
    title text not null default '',
    created_at integer not null,
    created_by text
  );
  create table events (
    id integer primary key autoincrement,
    at integer not null,
    day text not null,
    type text not null,
    path text,
    referrer text,
    device text,
    visitor text,
    session text,
    props text
  );
  create index events_day_type on events(day, type);
  create index events_type_at on events(type, at);
  create table login_attempts (
    key text primary key,
    failures integer not null,
    first_at integer not null,
    locked_until integer
  );
  `,
]

type Global = typeof globalThis & { __cmsDb?: DatabaseSync }

function open(): DatabaseSync {
  fs.mkdirSync(config.dataDir, { recursive: true })
  const db = new DatabaseSync(dataPath('cms.sqlite'))
  db.exec('pragma journal_mode = wal; pragma foreign_keys = on; pragma busy_timeout = 5000;')
  db.exec('create table if not exists meta (key text primary key, value text not null)')
  const row = db.prepare("select value from meta where key = 'schema'").get() as { value: string } | undefined
  let version = row ? Number(row.value) : 0
  while (version < MIGRATIONS.length) {
    transaction(db, () => {
      db.exec(MIGRATIONS[version])
      version += 1
      db.prepare("insert into meta(key, value) values ('schema', ?) on conflict(key) do update set value = excluded.value").run(String(version))
    })
  }
  return db
}

/** The process-wide connection. Kept on globalThis so dev-mode module reloads reuse it. */
export function db(): DatabaseSync {
  const g = globalThis as Global
  g.__cmsDb ??= open()
  return g.__cmsDb
}

/** BEGIN IMMEDIATE … COMMIT, rolled back on any throw. */
export function transaction<T>(database: DatabaseSync, fn: () => T): T {
  database.exec('begin immediate')
  try {
    const result = fn()
    database.exec('commit')
    return result
  } catch (error) {
    database.exec('rollback')
    throw error
  }
}

export const tx = <T>(fn: () => T) => transaction(db(), fn)

export function now() {
  return Date.now()
}
