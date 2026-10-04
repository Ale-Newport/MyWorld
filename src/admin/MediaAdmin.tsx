'use client'

import { useMemo, useState, type DragEvent } from 'react'
import { api } from './api'
import { toast } from './toast'
import { uploadMedia, useMedia, type MediaRow } from './fields'

/* ============================================================
   MEDIA

   Uploads are checked on the server by their bytes (not their
   name or the browser's claim), size-limited per type, SVGs are
   sanitised and then served sandboxed, and nothing is executed.
   A file can only be deleted when neither the draft nor the live
   site refers to it; the list says where each one is used.
   ============================================================ */

const KINDS = ['all', 'image', 'video', 'icon', 'texture', 'model'] as const
const fmtSize = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

function Preview({ m, large = false }: { m: MediaRow; large?: boolean }) {
  if (m.mime.startsWith('image/')) return <img src={m.url} alt={large ? m.alt : ''} loading="lazy" style={{ width: '100%', height: '100%', objectFit: large ? 'contain' : 'cover', display: 'block' }} />
  if (m.mime.startsWith('video/')) return <video src={m.url} preload="metadata" muted playsInline controls={large} style={{ width: '100%', height: '100%', objectFit: large ? 'contain' : 'cover', display: 'block' }} />
  return <span className="a-mono" style={{ fontSize: large ? 28 : 14, color: 'var(--a-muted)' }}>{m.filename.split('.').pop()?.toUpperCase()}</span>
}

export function MediaAdmin() {
  const { items, reload, setItems } = useMedia()
  const [kind, setKind] = useState<(typeof KINDS)[number]>('all')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [uploading, setUploading] = useState<string[]>([])
  const [over, setOver] = useState(false)
  const [uploadAs, setUploadAs] = useState<'image' | 'texture' | 'icon'>('image')

  const shown = useMemo(() => (items ?? []).filter((m) => (kind === 'all' || m.kind === kind) && (!query || `${m.filename} ${m.title} ${m.alt}`.toLowerCase().includes(query.toLowerCase()))), [items, kind, query])
  const current = items?.find((m) => m.id === selected) ?? null
  const total = (items ?? []).reduce((s, m) => s + m.size, 0)

  const upload = async (files: FileList | File[]) => {
    const list = [...files]
    if (!list.length) return
    setUploading(list.map((f) => f.name))
    let last: MediaRow | null = null
    for (const f of list) {
      try { last = await uploadMedia(f, uploadAs === 'image' ? undefined : uploadAs); toast(`Uploaded ${f.name}`, 'ok') } catch (e) { toast(`${f.name}: ${(e as Error).message}`, 'danger') }
      setUploading((u) => u.filter((n) => n !== f.name))
    }
    await reload()
    if (last) setSelected(last.id)
  }

  const save = async (patch: { alt?: string; title?: string }) => {
    if (!current) return
    try {
      const { item } = await api<{ item: MediaRow }>(`/api/admin/media/${current.id}`, { method: 'PATCH', json: patch })
      setItems((list) => list?.map((m) => (m.id === item.id ? item : m)) ?? null)
      toast('Saved', 'ok')
    } catch (e) { toast((e as Error).message, 'danger') }
  }

  const remove = async () => {
    if (!current) return
    if (!confirm(`Delete “${current.filename}” permanently?`)) return
    try {
      await api(`/api/admin/media/${current.id}`, { method: 'DELETE' })
      setSelected(null)
      await reload()
      toast('Deleted', 'ok')
    } catch (e) { toast((e as Error).message, 'danger') }
  }

  return (
    <main className="a-page" style={{ maxWidth: 1400 }}>
      <header className="a-head">
        <div>
          <p className="a-label">Site</p>
          <h1 className="a-title">Media</h1>
          <p className="a-sub">{items ? `${items.length} files · ${fmtSize(total)}` : 'Loading…'} · PNG, JPEG, WebP, AVIF, GIF, SVG, ICO, MP4, WebM, GLB</p>
        </div>
        <div className="row">
          <select className="input" style={{ width: 'auto' }} value={uploadAs} onChange={(e) => setUploadAs(e.target.value as typeof uploadAs)} aria-label="Upload images as">
            <option value="image">Images as images</option><option value="texture">Images as textures</option><option value="icon">Images as icons</option>
          </select>
          <label className="btn btn-primary">{uploading.length ? `Uploading ${uploading.length}…` : 'Upload files'}<input type="file" multiple hidden onChange={(e) => { if (e.target.files) void upload(e.target.files); e.target.value = '' }} /></label>
        </div>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: current ? 'minmax(0, 1fr) 360px' : '1fr', gap: 16, alignItems: 'start' }}>
        <section
          className="card stack"
          data-over={over || undefined}
          onDragOver={(e: DragEvent) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true) } }}
          onDragLeave={() => setOver(false)}
          onDrop={(e: DragEvent) => { e.preventDefault(); setOver(false); void upload(e.dataTransfer.files) }}
          style={{ outline: over ? '2px dashed var(--a-accent)' : undefined, outlineOffset: -6 }}
        >
          <div className="row">
            <input className="input" style={{ maxWidth: 280 }} placeholder="Search name, title, alt text…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search media" />
            <div className="btn-group" role="group" aria-label="Kind">{KINDS.map((k) => <button key={k} type="button" className="btn btn-sm" aria-pressed={kind === k} onClick={() => setKind(k)}>{k[0].toUpperCase() + k.slice(1)}</button>)}</div>
          </div>
          {items && !items.length ? (
            <div className="empty"><b>No media yet.</b><span>Drop files here or use Upload. Everything uploaded is checked by its contents and served from this site.</span></div>
          ) : (
            <div className="media-grid">
              {shown.map((m) => (
                <button key={m.id} type="button" className="media-tile" data-selected={m.id === selected || undefined} onClick={() => setSelected(m.id)} aria-pressed={m.id === selected}>
                  <span className="media-thumb"><Preview m={m} /></span>
                  <span className="media-name">{m.title || m.filename}</span>
                  <span className="media-info">{m.kind} · {fmtSize(m.size)}{m.width ? ` · ${m.width}×${m.height}` : ''}</span>
                  {m.usages.length > 0 ? <span className="badge" data-tone="ok">used ×{m.usages.length}</span> : <span className="badge">unused</span>}
                  {m.mime.startsWith('image/') && !m.alt && <span className="badge" data-tone="warn">no alt text</span>}
                </button>
              ))}
              {uploading.map((n) => <div key={n} className="media-tile" aria-busy="true"><span className="media-thumb"><span className="a-sub">Uploading…</span></span><span className="media-name">{n}</span></div>)}
            </div>
          )}
          {items && items.length > 0 && !shown.length && <p className="empty">Nothing matches.</p>}
        </section>

        {current && (
          <aside className="card stack" style={{ position: 'sticky', top: 16 }} key={current.id}>
            <div className="row"><h2 style={{ fontSize: 15, fontWeight: 600, wordBreak: 'break-all' }}>{current.filename}</h2><span className="spacer" /><button type="button" className="btn btn-sm btn-ghost" onClick={() => setSelected(null)} aria-label="Close details">✕</button></div>
            <div style={{ aspectRatio: '4 / 3', background: 'var(--a-sunk)', borderRadius: 8, display: 'grid', placeItems: 'center', overflow: 'hidden' }}><Preview m={current} large /></div>
            <label className="field"><span>Title</span><input className="input" defaultValue={current.title} onBlur={(e) => { if (e.target.value !== current.title) void save({ title: e.target.value }) }} /></label>
            {(current.mime.startsWith('image/') || current.mime.startsWith('video/')) && (
              <label className="field"><span>Alternative text</span><textarea className="input" rows={3} defaultValue={current.alt} placeholder="What it shows, for people who can’t see it. Leave empty only if it is decorative." onBlur={(e) => { if (e.target.value !== current.alt) void save({ alt: e.target.value }) }} /><small>Used wherever this file is placed without its own alt text.</small></label>
            )}
            <dl className="lib-facts">
              <div><dt>Type</dt><dd>{current.mime} · {current.kind}</dd></div>
              <div><dt>Size</dt><dd>{fmtSize(current.size)}{current.width ? ` · ${current.width}×${current.height}px` : ''}</dd></div>
              <div><dt>Address</dt><dd><code className="a-mono" style={{ wordBreak: 'break-all' }}>{current.url}</code> <button type="button" className="btn btn-sm" onClick={() => { void navigator.clipboard?.writeText(current.url); toast('Address copied', 'ok') }}>Copy</button></dd></div>
            </dl>
            <div className="stack" style={{ gap: 6 }}>
              <p className="a-label">Used in</p>
              {current.usages.length ? <ul className="lib-inputs">{current.usages.map((u) => <li key={u}>{u}</li>)}</ul> : <p className="a-sub" style={{ fontSize: 12.5 }}>Not used by the draft or the live site.</p>}
            </div>
            <button type="button" className="btn btn-danger" onClick={remove} disabled={current.usages.length > 0} title={current.usages.length ? 'Remove it from the places above first' : 'Delete permanently'}>Delete</button>
            {current.usages.length > 0 && <small className="a-sub">It can be deleted once nothing in the draft or on the live site uses it.</small>}
          </aside>
        )}
      </div>
    </main>
  )
}
