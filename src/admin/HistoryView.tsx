'use client'

import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { api } from './api'
import { PageHeader, Segmented, Tabs, WEBSITE_TABS } from './ui/kit'
import { toast } from './toast'
import { describeAction } from './describe'
import { useSiteStore } from './store/site'

interface Rev { id: string; createdAt: number; authorName: string | null; message: string | null; publishedAt: number | null; size: number }
interface Head { draft: Rev | null; published: Rev | null }
interface Audit { id: number; at: number; actorName: string | null; action: string; docId: string | null; detail: string | null }

const when = (at: number) => new Date(at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })

/* Every revision of the site and of the world, which one is live, which one
   is the draft, and the audit trail. Restoring copies a revision forward as
   the new draft; publishing it is a separate, explicit step. */
export function HistoryView() {
  // The world editor links here with ?tab=world.
  const initial = useSearchParams().get('tab')
  const [tab, setTab] = useState<'site' | 'world' | 'audit'>(initial === 'world' || initial === 'audit' ? initial : 'site')
  const [data, setData] = useState<{ head: Head; revisions: Rev[] } | null>(null)
  const [audit, setAudit] = useState<Audit[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const fetchTab = useCallback(async () => {
    if (tab === 'audit') return { audit: (await api<{ entries: Audit[] }>('/api/admin/audit')).entries }
    return { data: await api<{ head: Head; revisions: Rev[] }>(tab === 'site' ? '/api/admin/site/revisions' : '/api/admin/world/revisions') }
  }, [tab])
  const load = useCallback(async () => {
    const r = await fetchTab()
    if (r.audit) setAudit(r.audit)
    if (r.data) setData(r.data)
  }, [fetchTab])
  useEffect(() => {
    let live = true
    fetchTab().then((r) => { if (!live) return; if (r.audit) setAudit(r.audit); if (r.data) setData(r.data) }, (e: Error) => toast(e.message, 'danger'))
    return () => { live = false }
  }, [fetchTab])

  const restore = async (rev: Rev) => {
    if (!data) return
    setBusy(rev.id)
    try {
      await api(tab === 'site' ? '/api/admin/site/restore' : '/api/admin/world/restore', { method: 'POST', json: { revision: rev.id, base: data.head.draft?.id ?? null } })
      toast('Restored as the new draft. Review it, then publish.', 'ok')
      if (tab === 'site') await useSiteStore.getState().load(true)
      await load()
    } catch (e) {
      toast((e as Error).message, 'danger')
    } finally {
      setBusy(null)
    }
  }
  const publish = async (rev: Rev) => {
    setBusy(rev.id)
    try {
      await api(tab === 'site' ? '/api/admin/site/publish' : '/api/admin/world/publish', { method: 'POST', json: { revision: rev.id } })
      toast('Published that revision', 'ok')
      if (tab === 'site') await useSiteStore.getState().load(true)
      await load()
    } catch (e) {
      toast((e as Error).message, 'danger')
    } finally {
      setBusy(null)
    }
  }

  return (
    <main className="a-page">
      <PageHeader
        eyebrow="Website"
        title="History"
        description={<>Every saved draft and publication of the website and the world. Restoring makes an old revision the draft again; nothing is ever overwritten. <Storage /></>}
        actions={<Segmented<'site' | 'world' | 'audit'> label="History of" value={tab} onChange={(t) => { setData(null); setTab(t) }} options={[{ value: 'site', label: 'Website' }, { value: 'world', label: 'World' }, { value: 'audit', label: 'Activity log' }]} />}
        tabs={<Tabs label="Website" tabs={WEBSITE_TABS} />}
      />
      {tab === 'audit' ? (
        <section className="card">
          {!audit ? <p className="a-sub">Loading…</p> : audit.length === 0 ? <p className="empty">Nothing recorded yet.</p> : (
            <div className="table-scroll">
            <table className="table">
              <thead><tr><th>When</th><th>What</th><th>Who</th><th>Detail</th></tr></thead>
              <tbody>{audit.map((a) => <tr key={a.id}><td className="a-mono">{when(a.at)}</td><td>{describeAction(a.action, a.docId)}</td><td>{a.actorName ?? '—'}</td><td className="a-sub">{a.detail ?? ''}</td></tr>)}</tbody>
            </table></div>
          )}
        </section>
      ) : (
        <section className="card">
          {!data ? <p className="a-sub">Loading…</p> : data.revisions.length === 0 ? (
            <div className="empty"><b>No revisions yet</b>The {tab === 'site' ? 'site' : 'world'} is still the version that shipped with the code. The first save creates revision one from it.</div>
          ) : (
            <div className="table-scroll">
            <table className="table">
              <thead><tr><th>Saved</th><th>By</th><th>Note</th><th>Size</th><th>State</th><th /></tr></thead>
              <tbody>
                {data.revisions.map((r) => {
                  const live = data.head.published?.id === r.id
                  const draft = data.head.draft?.id === r.id
                  return (
                    <tr key={r.id}>
                      <td className="a-mono">{when(r.createdAt)}</td>
                      <td>{r.authorName ?? '—'}</td>
                      <td className="a-sub">{r.message ?? ''}</td>
                      <td className="a-mono">{r.size > 1e6 ? `${(r.size / 1e6).toFixed(1)} MB` : `${Math.round(r.size / 1024)} KB`}</td>
                      <td>
                        <div className="row">
                          {live && <span className="badge" data-tone="ok">Live</span>}
                          {draft && <span className="badge" data-tone="accent">Draft</span>}
                          {!live && r.publishedAt && <span className="badge">Was live {when(r.publishedAt)}</span>}
                        </div>
                      </td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {!draft && <button type="button" className="btn btn-sm" disabled={busy === r.id} onClick={() => void restore(r)}>Restore as draft</button>}{' '}
                        {!live && <button type="button" className="btn btn-sm" disabled={busy === r.id} onClick={() => void publish(r)}>Publish</button>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table></div>
          )}
        </section>
      )}
    </main>
  )
}

interface Stats { revisions: { site: number; world: number }; blobs: { files: number; bytes: number }; policy: { drafts: number; worldDrafts: number; publications: number; graceHours: number }; removedRevisions?: number; removedFiles?: number; freedBytes?: number }

/** What the history occupies on disk, the retention policy, and "clean up now". */
function Storage() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let live = true
    api<Stats>('/api/admin/maintenance').then((s) => { if (live) setStats(s) }, () => {})
    return () => { live = false }
  }, [])
  if (!stats) return null
  const mb = (b: number) => `${(b / 1e6).toFixed(0)} MB`
  return (
    <p className="a-sub" style={{ fontSize: 12.5 }}>
      Kept: {stats.revisions.site} site and {stats.revisions.world} world revisions · {mb(stats.blobs.bytes)} on disk. The live and draft revisions, the first import, the last {stats.policy.publications} publications and the last {stats.policy.drafts} site / {stats.policy.worldDrafts} world drafts are kept; older ones are removed after saves.{' '}
      <button type="button" className="btn btn-sm" disabled={busy} onClick={async () => {
        setBusy(true)
        try {
          const r = await api<Stats>('/api/admin/maintenance', { method: 'POST' })
          setStats(r)
          toast(r.removedRevisions || r.removedFiles ? `Removed ${r.removedRevisions} revision(s) and ${r.removedFiles} file(s), ${mb(r.freedBytes ?? 0)}` : 'Nothing to clean up', 'ok')
        } catch (e) { toast((e as Error).message, 'danger') } finally { setBusy(false) }
      }}>{busy ? 'Cleaning…' : 'Clean up now'}</button>
    </p>
  )
}
