import Link from 'next/link'
import { PageHeader } from '@/admin/ui/kit'
import { report } from '@/server/analytics'
import { publishedSite } from '@/server/site'
import { deriveSite } from '@/cms/derive'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Audience' }

/* ============================================================
   AUDIENCE — only what was actually recorded

   Read straight from the event store for the chosen period. No
   sampling, no modelling, no invented baselines: a period with no
   visits says so. "Visitors" are daily-unique estimates (see
   server/analytics.ts), and the page explains it where the number
   is shown.
   ============================================================ */

const RANGES = [{ days: 7, label: '7 days' }, { days: 30, label: '30 days' }, { days: 90, label: '90 days' }, { days: 365, label: '12 months' }]
const fmt = (n: number) => n.toLocaleString('en-GB')
/** The last `days` UTC days, today included. Read per request (the page is dynamic). */
function period(days: number) {
  const end = Date.now()
  return { from: new Date(end - (days - 1) * 86_400_000).toISOString().slice(0, 10), to: new Date(end).toISOString().slice(0, 10) }
}
const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : '—')

function Daily({ data, from, to }: { data: { day: string; pageviews: number; visitors: number }[]; from: string; to: string }) {
  const days: string[] = []
  for (let t = new Date(`${from}T00:00:00Z`).getTime(); t <= new Date(`${to}T00:00:00Z`).getTime(); t += 86_400_000) days.push(new Date(t).toISOString().slice(0, 10))
  const by = new Map(data.map((d) => [d.day, d]))
  const max = Math.max(1, ...data.map((d) => d.pageviews))
  const W = 720, H = 160, bw = W / days.length
  const line = days.map((d, i) => `${i ? 'L' : 'M'}${(i + 0.5) * bw},${H - ((by.get(d)?.visitors ?? 0) / max) * (H - 12)}`).join(' ')
  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${W} ${H + 18}`} style={{ width: '100%', height: 'auto' }} role="img" aria-label={`Daily page views and visitors from ${from} to ${to}`}>
        {days.map((d, i) => { const v = by.get(d)?.pageviews ?? 0; const h = (v / max) * (H - 12); return <rect key={d} x={i * bw + bw * 0.15} y={H - h} width={bw * 0.7} height={Math.max(v ? 1 : 0, h)} fill="var(--a-accent)" opacity="0.75"><title>{`${d}: ${v} page views, ${by.get(d)?.visitors ?? 0} visitors`}</title></rect> })}
        <path d={line} fill="none" stroke="var(--a-ink)" strokeWidth="1.5" />
        <line x1="0" x2={W} y1={H} y2={H} stroke="var(--a-line-strong)" />
        <text x="0" y={H + 14} fontSize="10" fill="var(--a-muted)">{from}</text>
        <text x={W} y={H + 14} fontSize="10" fill="var(--a-muted)" textAnchor="end">{to}</text>
      </svg>
      <figcaption className="a-sub" style={{ fontSize: 12 }}><span style={{ color: 'var(--a-accent)' }}>■</span> page views · <span>━</span> visitors (daily unique)</figcaption>
    </figure>
  )
}

function Table({ head, rows, empty = 'Nothing recorded.' }: { head: string[]; rows: (string | number)[][]; empty?: string }) {
  if (!rows.length) return <p className="a-sub" style={{ fontSize: 12.5 }}>{empty}</p>
  return (
    <table className="table">
      <thead><tr>{head.map((h, i) => <th key={h} style={{ textAlign: i ? 'right' : 'left' }}>{h}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} style={{ textAlign: j ? 'right' : 'left', fontVariantNumeric: 'tabular-nums' }}>{typeof c === 'number' ? fmt(c) : c}</td>)}</tr>)}</tbody>
    </table>
  )
}

export default async function Audience({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const { days: raw } = await searchParams
  const days = RANGES.some((r) => String(r.days) === raw) ? Number(raw) : 30
  const { from, to } = period(days)
  const r = report({ from, to })
  const site = publishedSite().doc
  const titles = Object.fromEntries(deriveSite(site).allProjects.map((p) => [p.slug, p.title]))
  const collecting = site.settings.options.analytics
  const pageviews = r.daily.reduce((s, d) => s + d.pageviews, 0)
  const visitors = r.daily.reduce((s, d) => s + d.visitors, 0)
  const opens = r.projects.reduce((s, p) => s + p.opens, 0)
  const entries = r.world.entries.reduce((s, e) => s + e.n, 0)
  const devTotal = r.devices.reduce((s, d) => s + d.views, 0)
  const reach = (journey: 'home' | 'projects') => [25, 50, 75, 100].map((m) => ({ m, n: r.journey.find((j) => j.journey === journey && Number(j.pct) === m)?.n ?? 0 }))

  return (
    <main className="a-page">
      <PageHeader
        eyebrow="Site"
        title="Audience"
        description={<>{from} – {to} · first-party, cookieless · {collecting ? 'collection is on' : <b>collection is off</b>} (<Link href="/admin/settings">Settings</Link>)</>}
        actions={<nav className="a-seg" aria-label="Period">{RANGES.map((x) => <Link key={x.days} href={`/admin/analytics?days=${x.days}`} className="a-seg-link" aria-current={x.days === days ? 'page' : undefined}>{x.label}</Link>)}</nav>}
      />

      <p className="notice" style={{ marginBottom: 16 }}>
        What is counted: page views and a few named events (journey progress, project opens, entering the world and how it loaded, the world map, world activities). Visits from signed-in administrators, the admin’s previews, automation and browsers asking not to be tracked are never recorded. <b>Visitors</b> are daily-unique estimates from a key that changes every day and cannot be reversed: someone returning tomorrow counts again, and people sharing a connection and browser count once.
      </p>

      {r.total === 0 ? (
        <div className="empty">
          <b>No visits recorded in this period.</b>
          <span>{collecting ? 'Nothing has been collected yet for these dates. Numbers appear here as soon as real visitors arrive; none are estimated or filled in.' : 'Collection is switched off in Settings, so nothing is recorded.'}</span>
        </div>
      ) : (
        <div className="stack" style={{ gap: 16 }}>
          <section className="cards" aria-label="Totals">
            <article className="card stat"><span className="a-label">Page views</span><b>{fmt(pageviews)}</b></article>
            <article className="card stat"><span className="a-label">Visitors (daily unique)</span><b>{fmt(visitors)}</b><span className="a-sub" style={{ fontSize: 12 }}>Summed per day</span></article>
            <article className="card stat"><span className="a-label">Project opens</span><b>{fmt(opens)}</b><span className="a-sub" style={{ fontSize: 12 }}>Case studies and project pages</span></article>
            <article className="card stat"><span className="a-label">World entries</span><b>{fmt(entries)}</b><span className="a-sub" style={{ fontSize: 12 }}>{r.world.ready} loaded{r.world.medianMs ? ` · median ${(r.world.medianMs / 1000).toFixed(1)} s` : ''}{r.world.errors.length ? ` · ${r.world.errors.reduce((s, e) => s + e.n, 0)} errors` : ''}</span></article>
          </section>
          <section className="card"><div className="card-head"><h2>Daily</h2></div><Daily data={r.daily} from={from} to={to} /></section>
          <div className="grid-2" style={{ alignItems: 'start' }}>
            <section className="card"><div className="card-head"><h2>Pages</h2></div><Table head={['Path', 'Views', 'Visitors']} rows={r.pages.map((p) => [p.path ?? '—', p.views, p.visitors])} /></section>
            <section className="card"><div className="card-head"><h2>Where visits came from</h2></div><Table head={['Source', 'Views']} rows={r.referrers.map((x) => [x.referrer === 'internal' ? 'This site' : x.referrer === 'direct' ? 'Direct / unknown' : x.referrer, x.views])} /></section>
            <section className="card"><div className="card-head"><h2>Devices</h2></div><Table head={['Device', 'Views', 'Share']} rows={r.devices.map((d) => [d.device, d.views, pct(d.views, devTotal)])} /><p className="a-sub" style={{ fontSize: 11.5, marginTop: 8 }}>From the viewport width only.</p></section>
            <section className="card"><div className="card-head"><h2>Projects opened</h2></div><Table head={['Project', 'Opens']} rows={r.projects.map((p) => [titles[p.slug] ?? p.slug, p.opens])} /></section>
            <section className="card">
              <div className="card-head"><h2>How far visitors read</h2></div>
              {(['home', 'projects'] as const).map((j) => (
                <div key={j} style={{ marginBottom: 10 }}>
                  <p className="a-label" style={{ marginBottom: 4 }}>{j === 'home' ? 'Homepage' : 'Projects'} · {fmt(r.journeyBase[j])} visitors</p>
                  <Table head={['Reached', 'Visitors', 'Share']} rows={reach(j).map(({ m, n }) => [`${m}%`, n, pct(n, r.journeyBase[j])])} />
                </div>
              ))}
            </section>
            <section className="card stack" style={{ gap: 10 }}>
              <div className="card-head" style={{ marginBottom: 0 }}><h2>The world</h2></div>
              <Table head={['Entered from', 'Times']} rows={r.world.entries.map((e) => [e.source, e.n])} empty="Nobody entered the world in this period." />
              <Table head={['Map opened', 'Times']} rows={r.world.maps ? [['M map', r.world.maps]] : []} empty="The map was not opened." />
              <Table head={['Activity', 'Action', 'Times']} rows={r.activities.map((a) => [a.name ?? '—', a.action ?? '—', a.n])} empty="No activities played." />
              {r.world.errors.length > 0 && <Table head={['Load error', 'Times']} rows={r.world.errors.map((e) => [e.message, e.n])} />}
            </section>
          </div>
        </div>
      )}
    </main>
  )
}
