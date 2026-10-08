import fs from 'node:fs'
import { AsyncLocalStorage } from 'node:async_hooks'
import type { DatabaseSync } from 'node:sqlite'
import { Client, types } from 'pg'
import { config, dataPath } from './config.ts'
import { env } from './env.ts'

/* ============================================================
   THE CONTENT DATABASE

   The small, relational things — admin accounts and sessions,
   the revision index of every document, the audit trail, the
   media index and the analytics events — in one of two places:

     · production (Cloudflare): Supabase Postgres, through the
       Hyperdrive binding when there is one, else DATABASE_URL
       (the Supabase pooler). The schema is supabase/migrations.
     · development, tests, scripts: one SQLite file in
       CMS_DATA_DIR, opened with Node's built-in `node:sqlite`.

   The same SQL runs on both (`?` placeholders; the few dialect
   differences go through `sql` below). Large payloads — world
   documents, uploads — live in the object store (storage.ts).

   `tx()` runs its function inside one transaction; any `db()`
   called within it, however deep, joins that transaction.
   ============================================================ */

export type Value = string | number | boolean | null
export type Row = Record<string, unknown>

export interface Db {
  dialect: 'sqlite' | 'postgres'
  all<T = Row>(text: string, params?: Value[]): Promise<T[]>
  get<T = Row>(text: string, params?: Value[]): Promise<T | undefined>
  run(text: string, params?: Value[]): Promise<void>
}

/* ---- SQLite (development) --------------------------------------- */

const SQLITE_SCHEMA = `
  create table if not exists users (id text primary key, email text not null unique collate nocase, name text not null, password_hash text not null,
    role text not null default 'admin', created_at integer not null, last_login_at integer, disabled integer not null default 0);
  create table if not exists sessions (id_hash text primary key, user_id text not null references users(id) on delete cascade, csrf text not null,
    created_at integer not null, last_seen_at integer not null, expires_at integer not null, user_agent text);
  create index if not exists sessions_user on sessions(user_id);
  create table if not exists documents (id text primary key, kind text not null, draft_rev text, published_rev text, updated_at integer not null);
  create table if not exists revisions (id text primary key, doc_id text not null references documents(id), parent_id text, created_at integer not null,
    author_id text, author_name text, message text, schema_version integer not null, content text, blobs text, hash text not null, size integer not null, published_at integer);
  create index if not exists revisions_doc on revisions(doc_id, created_at desc);
  create table if not exists audit (id integer primary key autoincrement, at integer not null, actor_id text, actor_name text, action text not null,
    doc_id text, revision_id text, detail text);
  create index if not exists audit_at on audit(at desc);
  create table if not exists media (id text primary key, kind text not null, filename text not null, mime text not null, size integer not null,
    sha256 text not null, width integer, height integer, alt text not null default '', title text not null default '', created_at integer not null, created_by text);
  create table if not exists events (id integer primary key autoincrement, at integer not null, day text not null, type text not null, path text,
    referrer text, device text, visitor text, session text, props text);
  create index if not exists events_day_type on events(day, type);
  create index if not exists events_type_at on events(type, at);
  create table if not exists login_attempts (key text primary key, failures integer not null, first_at integer not null, locked_until integer);
`

type Global = typeof globalThis & { __cmsSqlite?: DatabaseSync; __cmsPg?: Promise<Client> }

async function sqlite(): Promise<Db> {
  const g = globalThis as Global
  if (!g.__cmsSqlite) {
    if (await cloudflare()) throw new Error('The database is not configured: set DATABASE_URL (or a HYPERDRIVE binding) on the Worker.')
    const { DatabaseSync } = await import(/* webpackIgnore: true */ 'node:sqlite')
    fs.mkdirSync(config.dataDir, { recursive: true })
    const database = new DatabaseSync(dataPath('cms.sqlite'))
    database.exec('pragma journal_mode = wal; pragma foreign_keys = on; pragma busy_timeout = 5000;')
    database.exec(SQLITE_SCHEMA)
    g.__cmsSqlite = database
  }
  const d = g.__cmsSqlite
  return {
    dialect: 'sqlite',
    all: async <T>(text: string, params: Value[] = []) => d.prepare(text).all(...(params as never[])) as T[],
    get: async <T>(text: string, params: Value[] = []) => d.prepare(text).get(...(params as never[])) as T | undefined,
    run: async (text: string, params: Value[] = []) => { d.prepare(text).run(...(params as never[])) },
  }
}

/* ---- Postgres (production) -------------------------------------- */

/** The Cloudflare request context, when running on Workers (OpenNext). */
async function cloudflare(): Promise<{ env: Record<string, unknown>; request: object } | null> {
  try {
    const { getCloudflareContext } = await import('@opennextjs/cloudflare')
    const c = getCloudflareContext()
    // The execution context belongs to this invocation. `cf` is request metadata,
    // so it is not a safe key for a client that owns a Worker TCP socket.
    return { env: c.env as unknown as Record<string, unknown>, request: c.ctx }
  } catch (error) {
    // Never fall back to a global Postgres client on Workers: its socket cannot
    // be used by a later request, even when the context lookup failed.
    const runtime = globalThis as { Cloudflare?: unknown; navigator?: { userAgent?: string } }
    if (runtime.Cloudflare || runtime.navigator?.userAgent?.includes('Cloudflare-Workers')) throw error
    return null
  }
}

export async function connectionString(): Promise<string | null> {
  const cf = await cloudflare()
  const hyperdrive = cf?.env.HYPERDRIVE as { connectionString?: string } | undefined
  return hyperdrive?.connectionString ?? env('DATABASE_URL') ?? null
}

types.setTypeParser(20, Number)
types.setTypeParser(1700, Number)

/* A Worker socket belongs to one invocation. Cache the connection promise so
   concurrent db() calls in that invocation cannot open duplicate clients. */
const perRequest = new WeakMap<object, Promise<Client>>()

async function pgClient(url: string): Promise<Client> {
  const cf = await cloudflare()
  if (cf) {
    let client = perRequest.get(cf.request)
    if (!client) {
      const pg = new Client({ connectionString: url, connectionTimeoutMillis: 10_000 })
      pg.on('error', () => { perRequest.delete(cf.request) })
      pg.on('end', () => {
        perRequest.delete(cf.request)
      })
      client = pg.connect().then(() => pg)
      client.catch(() => { perRequest.delete(cf.request) })
      perRequest.set(cf.request, client)
    }
    return client
  }
  const g = globalThis as Global
  if (!g.__cmsPg) {
    const pg = new Client({ connectionString: url, connectionTimeoutMillis: 10_000 })
    pg.on('error', () => { delete g.__cmsPg })
    pg.on('end', () => { delete g.__cmsPg })
    g.__cmsPg = pg.connect().then(() => pg)
    g.__cmsPg.catch(() => { delete g.__cmsPg })
  }
  return g.__cmsPg
}

/** `?` placeholders become `$1, $2…`. */
const numbered = (text: string) => {
  let n = 0
  return text.replace(/\?/g, () => `$${++n}`)
}

function pgDb(client: Client): Db {
  const q = async <T>(text: string, params: Value[] = []) => {
    try {
      return (await client.query(numbered(text), params)).rows as T[]
    } catch (error) {
      // SQL parameters can contain private content; log only the operation.
      console.error('[db query]', text.trim().split(/\s+/).slice(0, 4).join(' '), error)
      throw error
    }
  }
  return {
    dialect: 'postgres',
    all: <T>(text: string, params?: Value[]) => q<T>(text, params),
    get: async <T>(text: string, params?: Value[]) => (await q<T>(text, params))[0],
    run: async (text: string, params?: Value[]) => { await q(text, params) },
  }
}

/* ---- the handle -------------------------------------------------- */

const current = new AsyncLocalStorage<Db>()

/** The database, or the transaction this call is running inside. */
/** A socket the runtime or database closed under us. */
const closed = (error: unknown) => {
  const e = error as { code?: string; message?: string }
  return e?.code === 'ECONNRESET' || e?.code === 'EPIPE' || /different request|connection.*closed|connection terminated|not queryable/i.test(e?.message ?? '')
}

/** The pooler can drop a newly opened TCP socket before PostgreSQL is ready. */
async function connected(url: string): Promise<Client> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await pgClient(url)
    } catch (error) {
      if (attempt >= 2 || !closed(error)) throw error
      await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)))
    }
  }
}

/** Outside a transaction, a query that meets a closed connection is retried once on a fresh one. */
async function resilient(url: string): Promise<Db> {
  const first = pgDb(await connected(url))
  const again = async <T>(fn: (d: Db) => Promise<T>): Promise<T> => {
    try {
      return await fn(first)
    } catch (error) {
      if (!closed(error)) throw error
      const cf = await cloudflare()
      if (cf) perRequest.delete(cf.request)
      else delete (globalThis as Global).__cmsPg
      return fn(pgDb(await connected(url)))
    }
  }
  return {
    dialect: 'postgres',
    all: (text, params) => again((d) => d.all(text, params)),
    get: (text, params) => again((d) => d.get(text, params)),
    run: (text, params) => again((d) => d.run(text, params)),
  }
}

export async function db(): Promise<Db> {
  const inTx = current.getStore()
  if (inTx) return inTx
  const url = await connectionString()
  return url ? resilient(url) : sqlite()
}

/** Runs `fn` in one transaction (BEGIN … COMMIT, rolled back on any throw). */
export async function tx<T>(fn: () => Promise<T>): Promise<T> {
  const outer = current.getStore()
  if (outer) return fn()
  const url = await connectionString()
  if (url) {
    let begun = false
    const run = async (): Promise<T> => {
      const client = await connected(url)
      let stage = 'BEGIN'
      try {
        await client.query('BEGIN')
        begun = true
        stage = 'callback'
        const result = await current.run(pgDb(client), fn)
        stage = 'COMMIT'
        await client.query('COMMIT')
        return result
      } catch (error) {
        console.error('[db transaction]', stage, error)
        if (begun) await client.query('ROLLBACK').catch(() => {})
        throw error
      }
    }
    try {
      return await run()
    } catch (error) {
      // A failed BEGIN is safe to retry; after it succeeds, COMMIT may already
      // have reached the server, so replaying the callback could duplicate writes.
      if (begun || !closed(error)) throw error
      const cf = await cloudflare()
      if (cf) perRequest.delete(cf.request)
      else delete (globalThis as Global).__cmsPg
      return run()
    }
  }
  const d = await sqlite()
  const raw = (globalThis as Global).__cmsSqlite!
  raw.exec('begin immediate')
  try {
    const result = await current.run(d, fn)
    raw.exec('commit')
    return result
  } catch (error) {
    raw.exec('rollback')
    throw error
  }
}

/** Dialect-specific SQL fragments. */
export const sql = {
  /** A field of a JSON text column. */
  json: (d: Db, column: string, key: string) => (d.dialect === 'postgres' ? `(${column}::jsonb ->> '${key}')` : `json_extract(${column}, '$.${key}')`),
  /** A numeric field of a JSON text column. */
  jsonNumber: (d: Db, column: string, key: string) => (d.dialect === 'postgres' ? `((${column}::jsonb ->> '${key}')::float)` : `json_extract(${column}, '$.${key}')`),
}

export function now() {
  return Date.now()
}
