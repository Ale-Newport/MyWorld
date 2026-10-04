import Link from 'next/link'
import { head, history, exists } from '@/server/revisions'
import { recentAudit } from '@/server/audit'
import { publishedSite } from '@/server/site'
import { publishedWorld } from '@/server/world'
import { summary } from '@/server/analytics'
import { mediaStats } from '@/server/media'
import { deriveSite } from '@/cms/derive'
import { describeAction } from '@/admin/describe'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Dashboard' }

const when = (at: number | null | undefined) => (at ? new Date(at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—')

export default function Dashboard() {
  const siteHead = head('site')
  const worldHead = head('world')
  const site = publishedSite()
  const world = publishedWorld()
  const content = deriveSite(site.doc)
  const byStatus = { published: 0, draft: 0, archived: 0, hidden: 0 }
  for (const p of site.doc.projects) { byStatus[p.status]++; if (p.hidden && p.status === 'published') byStatus.hidden++ }
  const stats = summary({ days: 7 })
  const media = mediaStats()
  const activity = recentAudit({ limit: 12 })
  const failures = recentAudit({ limit: 6, action: 'error' })
  const siteRevs = exists('site') ? history('site', 1000).length : 0
  return (
    <main className="a-page">
      <header className="a-head">
        <div>
          <p className="a-label">Overview</p>
          <h1 className="a-title">Dashboard</h1>
        </div>
        <div className="row">
          <Link className="btn" href="/admin/pages">Edit pages</Link>
          <Link className="btn" href="/admin/world">Edit the world</Link>
        </div>
      </header>

      <section className="cards" aria-label="Publishing state">
        <article className="card stat">
          <span className="a-label">Site content</span>
          <b>{siteHead.published ? 'Published' : 'Shipped seed'}</b>
          <span className="a-sub">{siteHead.published ? `Live since ${when(siteHead.published.publishedAt)} · ${siteRevs} revisions` : 'Serving the content shipped in src/content until the first save'}</span>
          {siteHead.draft && siteHead.draft.id !== siteHead.published?.id ? <span className="badge" data-tone="accent">Unpublished draft · {when(siteHead.draft.createdAt)}</span> : <span className="badge" data-tone="ok">No pending draft</span>}
        </article>
        <article className="card stat">
          <span className="a-label">World</span>
          <b>{world.revision ? 'Published' : 'Shipped seed'}</b>
          <span className="a-sub">{world.revision ? `Live since ${when(world.revision.publishedAt)}` : 'Shipped seed · HelloWorld 4ccab18 + portfolio areas'} · {(world.refs.world.size / 1e6).toFixed(1)} MB</span>
          {worldHead.draft && worldHead.draft.id !== worldHead.published?.id ? <span className="badge" data-tone="accent">Unpublished world draft</span> : <span className="badge" data-tone="ok">No pending draft</span>}
        </article>
        <article className="card stat">
          <span className="a-label">Projects</span>
          <b>{content.allProjects.length}</b>
          <span className="a-sub">{byStatus.published} published · {byStatus.hidden} hidden · {byStatus.draft} draft · {byStatus.archived} archived</span>
          <Link className="a-sub" href="/admin/projects">Manage projects →</Link>
        </article>
        <article className="card stat">
          <span className="a-label">Audience · 7 days</span>
          {stats.pageviews === 0 ? <><b>—</b><span className="a-sub">No visits recorded yet. Counting starts once the site is visited with analytics on.</span></> : <>
            <b>{stats.pageviews.toLocaleString('en-GB')}</b>
            <span className="a-sub">page views · ~{stats.visitors.toLocaleString('en-GB')} daily-unique visitors (estimate) · {stats.worldEntries} world entries</span>
          </>}
          <Link className="a-sub" href="/admin/analytics">Audience →</Link>
        </article>
        <article className="card stat">
          <span className="a-label">Media</span>
          <b>{media.count}</b>
          <span className="a-sub">{(media.bytes / 1e6).toFixed(1)} MB uploaded</span>
          <Link className="a-sub" href="/admin/media">Media library →</Link>
        </article>
      </section>

      <div className="grid-2" style={{ marginTop: 18, alignItems: 'start' }}>
        <section className="card" aria-labelledby="activity-title">
          <div className="card-head"><h2 id="activity-title">Recent activity</h2><Link className="btn btn-sm" href="/admin/history">History</Link></div>
          {activity.length === 0 ? <p className="empty">Nothing has been changed yet.</p> : (
            <table className="table">
              <tbody>
                {activity.map((a) => (
                  <tr key={a.id}>
                    <td className="a-mono" style={{ whiteSpace: 'nowrap' }}>{when(a.at)}</td>
                    <td>{describeAction(a.action, a.docId)}</td>
                    <td className="a-sub">{a.actorName ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <section className="card" aria-labelledby="errors-title">
          <div className="card-head"><h2 id="errors-title">Problems</h2></div>
          {failures.length === 0 && stats.worldErrors === 0 ? <p className="empty">No failed publishes and no world loading failures recorded.</p> : (
            <div className="stack">
              {stats.worldErrors > 0 && <p className="notice" data-tone="danger">{stats.worldErrors} visitor(s) saw /world fail to load in the last 7 days. See Audience → World.</p>}
              {failures.map((f) => <p key={f.id} className="notice" data-tone="danger">{when(f.at)} — {describeAction(f.action, f.docId)}: {f.detail}</p>)}
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
