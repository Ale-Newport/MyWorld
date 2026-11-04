'use client'

import { useEffect, useState } from 'react'
import type { LegacyStats } from '@/server/legacy'
import { api } from './api'
import { toast } from './toast'
import { Dialog } from './ui/kit'

const mb = (bytes: number) => `${(bytes / 1e6).toFixed(bytes < 1e7 ? 1 : 0)} MB`

/* What is left of the old content store (see server/legacy.ts), and removing it. Shown only while there is something to remove. */
export function LegacyData() {
  const [stats, setStats] = useState<LegacyStats | null>(null)
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let live = true
    api<LegacyStats>('/api/admin/legacy').then((s) => { if (live) setStats(s) }, () => {})
    return () => { live = false }
  }, [])
  if (!stats || (stats.revisions + stats.documents + stats.media + stats.files === 0)) return null
  const remove = async () => {
    setBusy(true)
    try {
      await api('/api/admin/legacy', { method: 'POST', json: { confirm: 'delete-old-content' } })
      setStats({ revisions: 0, revisionBytes: 0, documents: 0, media: 0, files: 0, fileBytes: 0 })
      setAsking(false)
      toast(`Removed the old content: ${mb(stats.fileBytes)} of files and ${stats.revisions} revision(s)`, 'ok')
    } catch (e) {
      toast((e as Error).message, 'danger')
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="card stack">
      <h2>Old content data</h2>
      <p className="a-sub" style={{ fontSize: 13 }}>
        The website is now published through git, so the database no longer holds anything it shows. What is left of the old content store takes space and is never read:
      </p>
      <ul className="a-sub" style={{ fontSize: 13, paddingLeft: 18, margin: 0 }}>
        <li>{stats.revisions} revision(s) of the website and the world ({mb(stats.revisionBytes)})</li>
        <li>{stats.files} stored file(s), {mb(stats.fileBytes)}: old world documents and uploads</li>
        <li>{stats.media} media library item(s)</li>
      </ul>
      <div className="row"><button type="button" className="btn btn-danger btn-sm" onClick={() => setAsking(true)}>Delete old content data…</button></div>
      <Dialog
        open={asking}
        onClose={() => !busy && setAsking(false)}
        title="Delete the old content data?"
        actions={<>
          <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void remove()}>{busy ? 'Deleting…' : 'Delete it for good'}</button>
          <span className="spacer" />
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setAsking(false)}>Cancel</button>
        </>}
      >
        <p className="a-sub">This cannot be undone. The current website and world are safe: they are files in the repository, and the live site does not read this data. Users, sessions, the activity log and the audience statistics are kept.</p>
        <p className="a-sub">Old revisions and uploaded files that only existed here are gone for good.</p>
      </Dialog>
    </section>
  )
}
