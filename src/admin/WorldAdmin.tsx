'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api'
import { toast } from './toast'

interface Rev { id: string; createdAt: number; authorName: string | null; publishedAt: number | null }
interface Draft { revision: string | null; head: { draft: Rev | null; published: Rev | null }; world: { url: string; sha: string; size: number }; assets: { url: string; sha: string; size: number } }
interface Problem { severity: 'error' | 'warning'; message: string }

const when = (at?: number | null) => (at ? new Date(at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—')
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')

/* ============================================================
   /admin/world — the studio, plus what makes it a CMS editor

   The frame below is HelloWorld's editor (MAP · 3D EDIT · DRIVE,
   asset library, inspector, experience groups, terrain brushes,
   roads), running the same modules as /world on the draft world.
   This bar validates and publishes that draft, imports and exports
   world files, and resolves save conflicts.
   ============================================================ */
export function WorldAdmin() {
  const frame = useRef<HTMLIFrameElement>(null)
  const conflictDialog = useRef<HTMLDialogElement>(null)
  const problemsDialog = useRef<HTMLDialogElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [ready, setReady] = useState(false)
  const [progress, setProgress] = useState('Opening the studio')
  const [busy, setBusy] = useState<string | null>(null)
  const [problems, setProblems] = useState<Problem[] | null>(null)
  const [conflict, setConflict] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const refresh = useCallback(async () => setDraft(await api<Draft>('/api/admin/world/draft')), [])
  useEffect(() => {
    let live = true
    api<Draft>('/api/admin/world/draft').then((d) => { if (live) setDraft(d) }, (e: Error) => toast(e.message, 'danger'))
    return () => { live = false }
  }, [])

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== location.origin || e.source !== frame.current?.contentWindow) return
      const d = e.data as { type?: string; stage?: string; message?: string }
      if (d.type === 'archipelago:progress') setProgress(String(d.stage ?? ''))
      if (d.type === 'archipelago:ready') setReady(true)
      if (d.type === 'archipelago:error') { setProgress(`Error: ${d.message}`); toast(`The studio could not start: ${d.message}`, 'danger') }
      if (d.type === 'archipelago:saved') { void refresh(); toast('World draft saved', 'ok') }
      if (d.type === 'archipelago:conflict') { setConflict(String(d.message ?? 'Someone else saved this world.')); conflictDialog.current?.showModal() }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [refresh])

  const unpublished = !!draft && draft.head.draft?.id !== draft.head.published?.id
  const studio = (type: string, extra: object = {}) => frame.current?.contentWindow?.postMessage({ type, ...extra }, location.origin)

  const validate = async () => {
    setBusy('validate')
    try {
      const { problems } = await api<{ problems: Problem[] }>('/api/admin/world/validate')
      setProblems(problems)
      problemsDialog.current?.showModal()
    } catch (e) { toast((e as Error).message, 'danger') } finally { setBusy(null) }
  }
  const publish = async () => {
    setBusy('publish')
    try {
      await api('/api/admin/world/publish', { method: 'POST', json: {} })
      await refresh()
      toast('Published — /world and its map now load this world', 'ok')
    } catch (e) { toast((e as Error).message, 'danger') } finally { setBusy(null) }
  }
  const exportFiles = () => {
    if (!draft) return
    for (const [url, name] of [[draft.world.url, 'archipelago-editor-world.json.gz'], [draft.assets.url, 'archipelago-asset-definitions.json']]) {
      const a = document.createElement('a')
      a.href = url
      a.download = name
      document.body.append(a)
      a.click()
      a.remove()
    }
  }
  const importFiles = async (files: FileList | null) => {
    if (!files?.length || !draft) return
    setBusy('import')
    try {
      let worldBytes: Uint8Array<ArrayBuffer> | null = null
      let assetBytes: Uint8Array<ArrayBuffer> | null = null
      for (const file of Array.from(files)) {
        const bytes = new Uint8Array(await file.arrayBuffer())
        const gz = bytes[0] === 0x1f && bytes[1] === 0x8b
        const text = gz ? null : new TextDecoder().decode(bytes.slice(0, 200))
        if (gz || /"schema"\s*:\s*2/.test(text ?? '') || /"states"/.test(text ?? '')) worldBytes = gz ? bytes : new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer())
        else if (/"definitions"/.test(text ?? '')) assetBytes = bytes
      }
      if (!worldBytes) throw new Error('Choose a world document (editor-world.json or .json.gz), optionally with asset-definitions.json.')
      const upload = async (bytes: Uint8Array<ArrayBuffer>) => {
        const sha = hex(await crypto.subtle.digest('SHA-256', bytes))
        return api<{ sha: string; size: number }>('/api/admin/world/blobs', { method: 'POST', body: bytes as BodyInit, headers: { 'x-content-sha256': sha, 'content-type': 'application/octet-stream' } })
      }
      const world = await upload(worldBytes)
      const assets = assetBytes ? await upload(assetBytes) : { sha: draft.assets.sha, size: draft.assets.size }
      await api('/api/admin/world/draft', { method: 'PUT', json: { base: draft.revision, world, assets, message: `Imported ${files[0].name}` } })
      toast('Imported as the new draft (validated). Reloading the studio…', 'ok')
      await refresh()
      setReady(false)
      setReloadKey((k) => k + 1)
    } catch (e) { toast((e as Error).message, 'danger') } finally { setBusy(null); if (fileInput.current) fileInput.current.value = '' }
  }

  return (
    <div style={{ display: 'grid', gridTemplateRows: 'auto minmax(0, 1fr)', height: '100vh' }}>
      <header className="row" style={{ padding: '10px 14px', borderBottom: '1px solid var(--a-line)', background: 'var(--a-panel)', gap: 10 }}>
        <div style={{ display: 'grid', gap: 2, marginRight: 8 }}>
          <span className="a-label">World editor</span>
          <b style={{ fontSize: 15 }}>Archipiélago</b>
        </div>
        {draft && (unpublished
          ? <span className="badge" data-tone="accent" title={`Draft saved ${when(draft.head.draft?.createdAt)} by ${draft.head.draft?.authorName ?? '—'}`}>Draft not published · saved {when(draft.head.draft?.createdAt)}</span>
          : <span className="badge" data-tone="ok">/world shows this draft</span>)}
        {!ready && <span className="badge">{progress || 'Loading…'}</span>}
        <span className="spacer" />
        <button type="button" className="btn btn-sm" onClick={() => studio('archipelago:save')} disabled={!ready}>Save draft</button>
        <button type="button" className="btn btn-sm" onClick={() => void validate()} disabled={busy !== null}>{busy === 'validate' ? 'Checking…' : 'Validate'}</button>
        <button type="button" className="btn btn-sm" onClick={exportFiles} disabled={!draft} title="Download the draft world document and asset definitions">Export</button>
        <button type="button" className="btn btn-sm" onClick={() => fileInput.current?.click()} disabled={busy !== null} title="Replace the draft with a world document exported from here or from HelloWorld">{busy === 'import' ? 'Importing…' : 'Import'}</button>
        <input ref={fileInput} type="file" accept=".json,.gz,application/json,application/gzip" multiple hidden onChange={(e) => void importFiles(e.target.files)} />
        <Link className="btn btn-sm" href="/admin/history">History</Link>
        <a className="btn btn-sm" href="/world" target="_blank" rel="noreferrer">Open /world ↗</a>
        <button type="button" className="btn btn-sm btn-accent" onClick={() => void publish()} disabled={busy !== null || !unpublished}>{busy === 'publish' ? 'Publishing…' : 'Publish world'}</button>
      </header>
      <iframe key={reloadKey} ref={frame} src="/admin/world-studio" title="World studio" style={{ width: '100%', height: '100%', border: 0, display: 'block', background: '#141b21' }} allow="fullscreen; gamepad" />

      <dialog ref={conflictDialog} className="a-dialog" onClose={() => setConflict(null)}>
        <div className="stack">
          <h2 style={{ fontSize: 17, fontWeight: 600 }}>Someone else saved this world</h2>
          <p className="a-sub">{conflict} Reload to continue from their version (your unsaved studio edits are lost), or overwrite their draft with yours.</p>
          <div className="row">
            <button type="button" className="btn" onClick={() => { conflictDialog.current?.close(); setReady(false); setReloadKey((k) => k + 1) }}>Reload their version</button>
            <button type="button" className="btn btn-danger" onClick={() => { conflictDialog.current?.close(); studio('archipelago:save', { force: true }) }}>Overwrite with mine</button>
          </div>
        </div>
      </dialog>
      <dialog ref={problemsDialog} className="a-dialog">
        <div className="stack">
          <h2 style={{ fontSize: 17, fontWeight: 600 }}>Draft world checks</h2>
          {problems && (problems.length === 0 ? <p className="notice" data-tone="ok">No problems: the draft can be published.</p> : (
            <ul className="stack" style={{ paddingLeft: 18, margin: 0 }}>
              {problems.map((p, i) => <li key={i} style={{ color: p.severity === 'error' ? 'var(--a-danger)' : 'var(--a-warn)' }}>{p.severity === 'error' ? 'Error' : 'Warning'}: {p.message}</li>)}
            </ul>
          ))}
          <p className="a-sub">Checks run on the last saved draft. Save first if you have unsaved edits in the studio.</p>
          <div className="row"><span className="spacer" /><button type="button" className="btn" onClick={() => problemsDialog.current?.close()}>Close</button></div>
        </div>
      </dialog>
    </div>
  )
}
