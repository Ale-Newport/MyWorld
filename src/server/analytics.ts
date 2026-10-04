import { createHash } from 'node:crypto'
import { cmsSecret } from './config.ts'
import { db, now } from './db.ts'

/* ============================================================
   FIRST-PARTY AUDIENCE STATISTICS

   What is stored per event: its type, the path, the referring
   site's host name (never the full URL), a coarse device class
   from the viewport width, a few event-specific values, and a
   visitor key. The visitor key is a SHA-256 of a server secret,
   the UTC day, the client address and the user agent, cut to 16
   hex characters: it changes every day and cannot be turned back
   into an address, so "visitors" here are DAILY-unique estimates
   (the same person on two days counts twice; people behind one
   address with one browser count once) and the admin says so.

   Not stored, ever: IP addresses, full user agents, cookies,
   identifiers that survive the day, query strings.

   Dropped on arrival: anything from a signed-in administrator,
   browsers sending Global Privacy Control or Do Not Track, known
   bots and headless automation, and malformed or unknown events.
   ============================================================ */

export const EVENT_TYPES = ['pageview', 'journey_progress', 'journey_complete', 'world_entry_start', 'world_ready', 'world_error', 'world_activity', 'project_open', 'map_open'] as const
type EventType = (typeof EVENT_TYPES)[number]

const BOT = /bot|crawler|spider|crawling|headless|lighthouse|preview|facebookexternalhit|slurp|embedly|quora link|pinterest|bitly|whatsapp|telegram/i
const RATE = new Map<string, { at: number; n: number }>()

export interface IncomingBatch {
  events?: unknown
  referrer?: unknown
  width?: unknown
  touch?: unknown
}

function device(width: number, touch: boolean) {
  if (width && width < 700) return 'mobile'
  if (width && width < 1100) return touch ? 'tablet' : 'desktop'
  return 'desktop'
}

function referrerHost(raw: unknown, ownHost: string | null): string {
  if (typeof raw !== 'string' || !raw) return 'direct'
  try {
    const host = new URL(raw).hostname.replace(/^www\./, '')
    if (!host || host === ownHost?.replace(/^www\./, '').split(':')[0]) return 'internal'
    return host.slice(0, 120)
  } catch {
    return 'direct'
  }
}

const clean = (v: unknown) => (typeof v === 'string' ? v.slice(0, 160) : typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 100) / 100 : typeof v === 'boolean' ? v : null)

/** Returns how many events were stored (0 when the batch was dropped). */
export function recordBatch(batch: IncomingBatch, request: { ip: string; ua: string; host: string | null; gpc: boolean; dnt: boolean; admin: boolean }): number {
  if (request.admin || request.gpc || request.dnt || !request.ua || BOT.test(request.ua)) return 0
  if (!Array.isArray(batch.events) || !batch.events.length) return 0
  const at = now()
  const day = new Date(at).toISOString().slice(0, 10)
  const visitor = createHash('sha256').update(`${cmsSecret()}|${day}|${request.ip}|${request.ua}`).digest('hex').slice(0, 16)
  const rate = RATE.get(visitor)
  if (rate && at - rate.at < 60_000 && rate.n > 120) return 0
  RATE.set(visitor, rate && at - rate.at < 60_000 ? { at: rate.at, n: rate.n + batch.events.length } : { at, n: batch.events.length })
  if (RATE.size > 5000) for (const [k, v] of RATE) if (at - v.at > 60_000) RATE.delete(k)
  const dev = device(Number(batch.width) || 0, batch.touch === true)
  const ref = referrerHost(batch.referrer, request.host)
  const insert = db().prepare('insert into events (at, day, type, path, referrer, device, visitor, session, props) values (?, ?, ?, ?, ?, ?, ?, null, ?)')
  let stored = 0
  for (const raw of batch.events.slice(0, 40)) {
    const e = raw as { type?: unknown; path?: unknown; props?: unknown }
    if (!EVENT_TYPES.includes(e?.type as EventType)) continue
    const path = typeof e.path === 'string' && e.path.startsWith('/') ? e.path.split('?')[0].slice(0, 200) : null
    if (path?.startsWith('/admin')) continue
    const props: Record<string, unknown> = {}
    if (e.props && typeof e.props === 'object') for (const [k, v] of Object.entries(e.props as Record<string, unknown>).slice(0, 8)) if (/^[a-z_]{1,24}$/i.test(k)) props[k] = clean(v)
    insert.run(at, day, e.type as string, path, e.type === 'pageview' ? ref : null, dev, visitor, Object.keys(props).length ? JSON.stringify(props) : null)
    stored++
  }
  return stored
}

/* ---- queries ------------------------------------------------- */

type Row = Record<string, unknown>
function range(days: number, endDay?: string) {
  const end = endDay ? new Date(`${endDay}T23:59:59Z`).getTime() : now()
  const start = end - days * 86_400_000
  return { from: new Date(start).toISOString().slice(0, 10), to: new Date(end).toISOString().slice(0, 10) }
}

export function summary({ days = 7 }: { days?: number } = {}) {
  const { from, to } = range(days)
  const q = (sql: string) => Number((db().prepare(sql).get(from, to) as Row).n ?? 0)
  return {
    from, to,
    pageviews: q("select count(*) n from events where type = 'pageview' and day between ? and ?"),
    visitors: q("select coalesce(sum(n), 0) n from (select count(distinct visitor) n from events where day between ? and ? group by day)"),
    worldEntries: q("select count(*) n from events where type = 'world_entry_start' and day between ? and ?"),
    worldErrors: q("select count(*) n from events where type = 'world_error' and day between ? and ?"),
  }
}

export function report({ from, to }: { from: string; to: string }) {
  const all = <T = Row>(sql: string, ...args: (string | number)[]) => db().prepare(sql).all(from, to, ...args) as T[]
  const one = (sql: string) => db().prepare(sql).get(from, to) as Row
  const daily = all<{ day: string; pageviews: number; visitors: number }>("select day, sum(type = 'pageview') pageviews, count(distinct visitor) visitors from events where day between ? and ? group by day order by day")
  const pages = all<{ path: string; views: number; visitors: number }>("select path, count(*) views, count(distinct day || visitor) visitors from events where type = 'pageview' and day between ? and ? group by path order by views desc limit 20")
  const referrers = all<{ referrer: string; views: number }>("select referrer, count(*) views from events where type = 'pageview' and day between ? and ? group by referrer order by views desc limit 15")
  const devices = all<{ device: string; views: number }>("select device, count(*) views from events where type = 'pageview' and day between ? and ? group by device order by views desc")
  const projects = all<{ slug: string; opens: number }>("select json_extract(props, '$.slug') slug, count(*) opens from events where type = 'project_open' and day between ? and ? group by slug order by opens desc limit 20")
  const projectPages = all<{ path: string; views: number }>("select path, count(*) views from events where type = 'pageview' and path like '/projects/%' and day between ? and ? group by path order by views desc limit 20")
  const journey = all<{ journey: string; pct: number; n: number }>("select json_extract(props, '$.journey') journey, json_extract(props, '$.pct') pct, count(distinct day || visitor) n from events where type = 'journey_progress' and day between ? and ? group by journey, pct order by journey, pct")
  const homeViews = Number(one("select count(distinct day || visitor) n from events where type = 'pageview' and path = '/' and day between ? and ?").n ?? 0)
  const projectsViews = Number(one("select count(distinct day || visitor) n from events where type = 'pageview' and path = '/projects' and day between ? and ?").n ?? 0)
  const total = Number(one("select count(*) n from events where day between ? and ?").n ?? 0)
  const entries = all<{ source: string; n: number }>("select coalesce(json_extract(props, '$.source'), 'unknown') source, count(*) n from events where type = 'world_entry_start' and day between ? and ? group by source order by n desc")
  const ready = one("select count(*) n, avg(json_extract(props, '$.ms')) avg_ms from events where type = 'world_ready' and day between ? and ?")
  const loadTimes = all<{ ms: number }>("select json_extract(props, '$.ms') ms from events where type = 'world_ready' and day between ? and ? order by ms")
  const median = loadTimes.length ? Number(loadTimes[Math.floor(loadTimes.length / 2)].ms) : null
  const errors = all<{ message: string; n: number }>("select coalesce(json_extract(props, '$.message'), 'unknown') message, count(*) n from events where type = 'world_error' and day between ? and ? group by message order by n desc limit 10")
  const activities = all<{ name: string; action: string; n: number }>("select json_extract(props, '$.name') name, json_extract(props, '$.action') action, count(*) n from events where type = 'world_activity' and day between ? and ? group by name, action order by name, action")
  const maps = Number(one("select count(*) n from events where type = 'map_open' and day between ? and ?").n ?? 0)
  return { from, to, total, daily, pages, referrers, devices, projects, projectPages, journey, journeyBase: { home: homeViews, projects: projectsViews }, homeViews, world: { entries, ready: Number(ready.n ?? 0), medianMs: median, errors, maps }, activities }
}
