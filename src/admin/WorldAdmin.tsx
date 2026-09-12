'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api'
import { toast } from './toast'
import { Dialog, Notice, PageHeader } from './ui/kit'
import { Icon } from './ui/icons'

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
  const fileInput = useRef<HTMLInputElement>(null)
  const [dirty, setDirty] = useState(false)
  const dirtyRef = useRef(false)
  const [focus, setFocus] = useState(false)
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
      if (d.type === 'archipelago:saved') { void refresh(); setDirty(false); dirtyRef.current = false; toast('World draft saved', 'ok') }
      if (d.type === 'archipelago:conflict') setConflict(String(d.message ?? 'Someone else saved this world.'))
      if (d.type === 'archipelago:dirty') { const v = !!(d as { dirty?: boolean }).dirty; setDirty(v); dirtyRef.current = v }
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

  /* The studio reports whether it holds edits it has not saved yet
     (`archipelago:dirty`); until it says, nothing is assumed. */
  useEffect(() => {
    const onLeave = (e: BeforeUnloadEvent) => { if (dirtyRef.current) e.preventDefault() }
    window.addEventListener('beforeunload', onLeave)
    return () => window.removeEventListener('beforeunload', onLeave)
  }, [])

  /* Full screen: the admin's navigation and this header step aside
     for the canvas; the studio itself is never reloaded by it, so
     nothing in progress is lost. Escape (outside the studio) or the
     button in the corner brings everything back. */
  useEffect(() => {
    const shell = document.querySelector<HTMLElement>('.a-shell')
    if (shell) shell.dataset.focus = focus ? 'true' : 'false'
    if (!focus) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFocus(false) }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (shell) shell.dataset.focus = 'false'
    }
  }, [focus])

  const draftState = !draft ? null : dirty ? 'Unsaved changes in the studio' : unpublished ? `Draft differs from the live world · saved ${when(draft.head.draft?.createdAt)}` : 'Live world is up to date'
  const tone = dirty ? 'warn' : unpublished ? 'accent' : 'ok'

  return (
    <div className="wa" data-focus={focus || undefined}>
      <div className="wa-head">
        <PageHeader
          compact
          eyebrow="World"
          title="Archipiélago"
          description="The world's map, terrain, objects, places and activities. Save a draft, test-drive it, then publish."
          actions={
            <div className="a-publishbar" role="toolbar" aria-label="World draft">
              {!ready && <span className="badge" role="status">{progress || 'Loading…'}</span>}
              {draftState && <span className="badge" data-tone={tone} role="status" title={draft?.head.draft ? `Saved ${when(draft.head.draft.createdAt)} by ${draft.head.draft.authorName ?? '—'}` : undefined}>{draftState}</span>}
              <details className="a-menu">
                <summary className="btn btn-sm">More<Icon name="chevron" size={14} /></summary>
                <div className="a-menu-list" role="menu">
                  <button type="button" role="menuitem" onClick={() => void validate()} disabled={busy !== null}>{busy === 'validate' ? 'Checking…' : 'Check the draft'}</button>
                  <button type="button" role="menuitem" onClick={exportFiles} disabled={!draft}>Export world files</button>
                  <button type="button" role="menuitem" onClick={() => fileInput.current?.click()} disabled={busy !== null}>{busy === 'import' ? 'Importing…' : 'Import world files…'}</button>
                  <Link role="menuitem" href="/admin/history?tab=world">World history</Link>
                  <a role="menuitem" href="/world" target="_blank" rel="noreferrer">Open /world <Icon name="external" size={14} /></a>
                </div>
              </details>
              <input ref={fileInput} type="file" accept=".json,.gz,application/json,application/gzip" multiple hidden onChange={(e) => void importFiles(e.target.files)} />
              <button type="button" className="btn btn-sm" onClick={() => setFocus(true)} title="Give the canvas the whole window"><Icon name="expand" size={15} />Full screen</button>
              <button type="button" className="btn" onClick={() => studio('archipelago:save')} disabled={!ready}>Save draft</button>
              <button type="button" className="btn btn-accent" onClick={() => void publish()} disabled={busy !== null || !unpublished || dirty}>{busy === 'publish' ? 'Publishing…' : 'Publish world'}</button>
            </div>
          }
        />
      </div>
      {focus && (
        <div className="wa-focusbar" role="toolbar" aria-label="Full screen">
          <button type="button" className="btn btn-sm" onClick={() => setFocus(false)}><Icon name="collapse" size={15} />Back to the admin</button>
          {draftState && <span className="badge" data-tone={tone} role="status">{draftState}</span>}
          <button type="button" className="btn btn-sm" onClick={() => studio('archipelago:save')} disabled={!ready}>Save draft</button>
        </div>
      )}
      <iframe key={reloadKey} ref={frame} src="/admin/world-studio" title="World studio" className="wa-frame" allow="fullscreen; gamepad" />

      <Dialog
        open={conflict !== null}
        onClose={() => setConflict(null)}
        title="Someone else saved this world"
        actions={<>
          <button type="button" className="btn" onClick={() => { setConflict(null); setReady(false); setReloadKey((k) => k + 1) }}>Reload their version</button>
          <button type="button" className="btn btn-danger" onClick={() => { setConflict(null); studio('archipelago:save', { force: true }) }}>Overwrite with mine</button>
          <span className="spacer" />
          <button type="button" className="btn btn-ghost" onClick={() => setConflict(null)}>Cancel</button>
        </>}
      >
        <p className="a-sub">{conflict} Reload to continue from their version (your unsaved studio edits are lost), or overwrite their draft with yours.</p>
      </Dialog>
      <Dialog open={problems !== null} onClose={() => setProblems(null)} title="Draft world checks" actions={<><span className="spacer" /><button type="button" className="btn" onClick={() => setProblems(null)}>Close</button></>}>
        {problems && (problems.length === 0 ? <Notice tone="ok">No problems: the draft can be published.</Notice> : (
          <ul className="stack" style={{ paddingLeft: 18, margin: 0 }}>
            {problems.map((p, i) => <li key={i} style={{ color: p.severity === 'error' ? 'var(--a-danger)' : 'var(--a-warn)' }}>{p.severity === 'error' ? 'Error' : 'Warning'}: {p.message}</li>)}
          </ul>
        ))}
        <p className="a-sub">Checks run on the last saved draft. Save first if you have unsaved edits in the studio.</p>
      </Dialog>
    </div>
  )
}
