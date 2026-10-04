'use client'

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useSiteStore } from './store/site'
import { getPath, setPath } from './paths'
import { api } from './api'
import { toast } from './toast'
import type { TableData } from '@/cms/schema'

/* ============================================================
   FORM CONTROLS BOUND TO THE DRAFT

   Each control reads a path of the site document from the draft
   store and writes back through apply(), so every change is
   undoable, shows in the live preview, and is validated by the
   server's schema on save. Typing into one field is one undo step.
   ============================================================ */

const useValue = <T,>(path: string) => useSiteStore((s) => getPath(s.doc, path) as T)
const write = (path: string, value: unknown, coalesce = true) => useSiteStore.getState().apply((d) => { setPath(d, path, value) }, coalesce ? { coalesce: path } : undefined)

/** A labelled control. Pass the control's `id`; the hint or error is its description. Without an id the label wraps the control. */
export function Field({ label, hint, children, error, id }: { label: string; hint?: ReactNode; children: ReactNode; error?: string | null; id?: string }) {
  const message = error ? <small id={id && `${id}-hint`} style={{ color: 'var(--a-danger)' }} role="alert">{error}</small> : hint ? <small id={id && `${id}-hint`}>{hint}</small> : null
  if (!id) return <div className="field"><label className="field"><span>{label}</span>{children}</label>{message}</div>
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {message}
    </div>
  )
}
const described = (id: string, has: unknown) => (has ? { 'aria-describedby': `${id}-hint` } : {})

export function TextInput({ path, label, hint, multiline = false, maxLength, placeholder, rows, optional = false, validate }: { path: string; label: string; hint?: ReactNode; multiline?: boolean; maxLength?: number; placeholder?: string; rows?: number; optional?: boolean; validate?: (v: string) => string | null }) {
  const raw = useValue<string | undefined>(path)
  const value = raw ?? ''
  const error = validate?.(value) ?? (maxLength && value.length > maxLength ? `${value.length}/${maxLength} characters` : null)
  const set = (v: string) => write(path, optional && v === '' ? undefined : v)
  const id = useId()
  const shownHint = hint ?? (maxLength ? `${value.length}/${maxLength}` : undefined)
  const a11y = { id, 'aria-invalid': !!error, ...described(id, error || shownHint) }
  return (
    <Field label={label} hint={shownHint} error={error} id={id}>
      {multiline
        ? <textarea className="input" value={value} rows={rows ?? 4} placeholder={placeholder} {...a11y} onChange={(e) => set(e.target.value)} />
        : <input className="input" value={value} placeholder={placeholder} {...a11y} onChange={(e) => set(e.target.value)} />}
    </Field>
  )
}

export function NumberInput({ path, label, min, max, step = 1, hint }: { path: string; label: string; min?: number; max?: number; step?: number; hint?: ReactNode }) {
  const value = useValue<number | undefined>(path)
  const id = useId()
  return (
    <Field label={label} hint={hint} id={id}>
      <input id={id} {...described(id, hint)} className="input" type="number" value={value ?? ''} min={min} max={max} step={step} onChange={(e) => { const n = e.target.valueAsNumber; if (Number.isFinite(n)) write(path, n) }} />
    </Field>
  )
}

export function SelectInput({ path, label, options, hint }: { path: string; label: string; options: readonly (string | { value: string; label: string })[]; hint?: ReactNode }) {
  const value = useValue<string>(path)
  const id = useId()
  return (
    <Field label={label} hint={hint} id={id}>
      <select id={id} {...described(id, hint)} className="input" value={value ?? ''} onChange={(e) => write(path, e.target.value, false)}>
        {options.map((o) => typeof o === 'string' ? <option key={o} value={o}>{o}</option> : <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </Field>
  )
}

export function Toggle({ path, label, hint }: { path: string; label: string; hint?: ReactNode }) {
  const value = useValue<boolean>(path)
  const id = useId()
  return (
    <div className="stack" style={{ gap: 2 }}>
      <label className="check"><input type="checkbox" checked={!!value} {...described(id, hint)} onChange={(e) => write(path, e.target.checked, false)} /> {label}</label>
      {hint && <small id={`${id}-hint`} className="a-sub" style={{ fontSize: 11.5 }}>{hint}</small>}
    </div>
  )
}

export function ColorInput({ path, label, optional = true }: { path: string; label: string; optional?: boolean }) {
  const value = useValue<string | undefined>(path)
  const id = useId()
  return (
    <Field label={label} id={id}>
      <div className="row">
        <input type="color" value={/^#[0-9a-f]{6}$/i.test(value ?? '') ? value : '#bf4f27'} onChange={(e) => write(path, e.target.value)} aria-label={`${label} colour`} style={{ width: 40, height: 32, padding: 0, border: '1px solid var(--a-line-strong)', borderRadius: 6, background: 'none' }} />
        <input id={id} className="input" style={{ flex: 1 }} value={value ?? ''} placeholder="#bf4f27" onChange={(e) => write(path, e.target.value || (optional ? undefined : '#000000'))} />
      </div>
    </Field>
  )
}

/** An ordered list of strings (facts, roles, keywords). */
export function StringList({ path, label, addLabel = 'Add', multiline = false, hint }: { path: string; label: string; addLabel?: string; multiline?: boolean; hint?: ReactNode }) {
  const list = useValue<string[]>(path) ?? []
  const set = (next: string[], coalesce = false) => useSiteStore.getState().apply((d) => { setPath(d, path, next) }, coalesce ? { coalesce: path } : undefined)
  return (
    <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0, gap: 8 }}>
      <legend className="field" style={{ marginBottom: 6 }}><span>{label}</span></legend>
      {hint && <small className="a-sub">{hint}</small>}
      {list.map((item, i) => (
        <div key={i} className="row" style={{ alignItems: 'start' }}>
          {multiline
            ? <textarea className="input" style={{ flex: 1 }} rows={2} value={item} aria-label={`${label} ${i + 1}`} onChange={(e) => set(list.map((x, j) => (j === i ? e.target.value : x)), true)} />
            : <input className="input" style={{ flex: 1 }} value={item} aria-label={`${label} ${i + 1}`} onChange={(e) => set(list.map((x, j) => (j === i ? e.target.value : x)), true)} />}
          <button type="button" className="btn btn-sm btn-icon" title="Move up" aria-label="Move up" disabled={i === 0} onClick={() => { const n = [...list]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; set(n) }}>↑</button>
          <button type="button" className="btn btn-sm btn-icon" title="Remove" aria-label="Remove" onClick={() => set(list.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <div><button type="button" className="btn btn-sm" onClick={() => set([...list, ''])}>+ {addLabel}</button></div>
    </fieldset>
  )
}

/* ---- media ------------------------------------------------------ */
export interface MediaRow { id: string; kind: string; filename: string; mime: string; size: number; width: number | null; height: number | null; alt: string; title: string; url: string; usages: string[] }

export function useMedia() {
  const [items, setItems] = useState<MediaRow[] | null>(null)
  const fetchItems = () => api<{ items: MediaRow[] }>('/api/admin/media').then((r) => r.items)
  const reload = async () => setItems(await fetchItems())
  useEffect(() => {
    let live = true
    fetchItems().then((list) => { if (live) setItems(list) }, () => {})
    return () => { live = false }
  }, [])
  return { items, reload, setItems }
}

export async function uploadMedia(file: File, kind?: string): Promise<MediaRow> {
  const form = new FormData()
  form.append('file', file)
  if (kind) form.append('kind', kind)
  const { item } = await api<{ item: MediaRow }>('/api/admin/media', { method: 'POST', body: form })
  return item
}

/** Choose (or upload) a file from the media library. */
export function MediaPicker({ open, onClose, onPick, accept = 'image' }: { open: boolean; onClose: () => void; onPick: (item: MediaRow) => void; accept?: 'image' | 'video' | 'any' }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const { items, reload } = useMedia()
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (open) dialog.current?.showModal(); else dialog.current?.close() }, [open])
  const fits = (m: MediaRow) => accept === 'any' || (accept === 'image' ? m.mime.startsWith('image/') : m.mime.startsWith('video/'))
  return (
    <dialog ref={dialog} className="a-dialog" style={{ width: 'min(860px, calc(100vw - 32px))' }} onClose={onClose}>
      <div className="stack">
        <div className="row"><h2 style={{ fontSize: 17, fontWeight: 600 }}>Media library</h2><span className="spacer" />
          <label className="btn btn-sm">{busy ? 'Uploading…' : 'Upload'}<input type="file" hidden accept={accept === 'video' ? 'video/mp4,video/webm' : accept === 'image' ? 'image/*' : undefined} onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; setBusy(true); try { const item = await uploadMedia(f); await reload(); onPick(item) } catch (err) { toast((err as Error).message, 'danger') } finally { setBusy(false) } }} /></label>
          <button type="button" className="btn btn-sm" onClick={onClose}>Close</button>
        </div>
        {!items ? <p className="a-sub">Loading…</p> : items.filter(fits).length === 0 ? <p className="empty">Nothing uploaded yet. Upload a file to use it here.</p> : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10, maxHeight: '60vh', overflow: 'auto' }}>
            {items.filter(fits).map((m) => (
              <button key={m.id} type="button" className="card" style={{ padding: 8, textAlign: 'left', cursor: 'pointer' }} onClick={() => onPick(m)}>
                {m.mime.startsWith('image/') ? <img src={m.url} alt={m.alt} style={{ width: '100%', aspectRatio: '4/3', objectFit: 'cover', borderRadius: 6, background: 'var(--a-sunk)' }} /> : <div style={{ aspectRatio: '4/3', display: 'grid', placeItems: 'center', background: 'var(--a-sunk)', borderRadius: 6 }} className="a-mono">{m.filename.split('.').pop()?.toUpperCase()}</div>}
                <span className="a-sub" style={{ fontSize: 12, display: 'block', marginTop: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.title || m.filename}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </dialog>
  )
}

/** A URL field with a library picker and preview. */
export function MediaInput({ path, label, accept = 'image', hint }: { path: string; label: string; accept?: 'image' | 'video' | 'any'; hint?: ReactNode }) {
  const value = useValue<string | undefined>(path)
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <Field label={label} hint={hint} id={id}>
      <div className="row">
        {value && accept === 'image' && <img src={value} alt="" style={{ width: 44, height: 34, objectFit: 'cover', borderRadius: 4, border: '1px solid var(--a-line)' }} />}
        <input id={id} {...described(id, hint)} className="input" style={{ flex: 1 }} value={value ?? ''} placeholder="/media/… or https://…" onChange={(e) => write(path, e.target.value || undefined)} />
        <button type="button" className="btn btn-sm" onClick={() => setOpen(true)}>Library</button>
      </div>
      <MediaPicker open={open} accept={accept} onClose={() => setOpen(false)} onPick={(m) => { write(path, m.url, false); setOpen(false) }} />
    </Field>
  )
}

/* ---- tables -------------------------------------------------------- */
let uid = 0
const newId = (p: string) => `${p}${Date.now().toString(36)}${(uid++).toString(36)}`

/** Rows, columns, header, caption, per-column alignment and width, cell text. Public output is a semantic <table>. */
export function TableEditor({ value, onChange }: { value: TableData; onChange: (next: TableData, coalesce?: string) => void }) {
  const t = value
  const set = (patch: Partial<TableData>, coalesce?: string) => onChange({ ...t, ...patch }, coalesce)
  return (
    <div className="stack">
      <div className="grid-2">
        <Field label="Caption"><input className="input" value={t.caption ?? ''} onChange={(e) => set({ caption: e.target.value || undefined }, 'caption')} /></Field>
        <label className="check" style={{ alignSelf: 'end' }}><input type="checkbox" checked={t.header} onChange={(e) => set({ header: e.target.checked })} /> First row and column are headers</label>
      </div>
      <div style={{ overflow: 'auto', border: '1px solid var(--a-line)', borderRadius: 8 }}>
        <table className="table" style={{ minWidth: t.columns.length * 140 }}>
          <thead>
            <tr>
              {t.columns.map((c, ci) => (
                <th key={c.id} style={{ minWidth: 130 }}>
                  <input className="input" value={c.label} aria-label={`Column ${ci + 1} heading`} onChange={(e) => set({ columns: t.columns.map((x) => (x.id === c.id ? { ...x, label: e.target.value } : x)) }, `col-${c.id}`)} />
                  <div className="row" style={{ marginTop: 4, gap: 4 }}>
                    <select className="input" style={{ minHeight: 26, padding: '2px 6px', width: 'auto' }} value={c.align} aria-label="Alignment" onChange={(e) => set({ columns: t.columns.map((x) => (x.id === c.id ? { ...x, align: e.target.value as 'left' | 'center' | 'right' } : x)) })}>
                      <option value="left">Left</option><option value="center">Centre</option><option value="right">Right</option>
                    </select>
                    <input className="input" style={{ minHeight: 26, padding: '2px 6px', width: 70 }} placeholder="width" value={c.width ?? ''} aria-label="Column width" onChange={(e) => set({ columns: t.columns.map((x) => (x.id === c.id ? { ...x, width: e.target.value || undefined } : x)) }, `w-${c.id}`)} />
                    <button type="button" className="btn btn-sm btn-icon" title="Remove column" aria-label="Remove column" disabled={t.columns.length < 2} onClick={() => set({ columns: t.columns.filter((x) => x.id !== c.id), rows: t.rows.map((r) => { const cells = { ...r.cells }; delete cells[c.id]; return { ...r, cells } }) })}>✕</button>
                  </div>
                </th>
              ))}
              <th><button type="button" className="btn btn-sm" onClick={() => set({ columns: [...t.columns, { id: newId('c'), label: `Column ${t.columns.length + 1}`, align: 'left' }] })}>+ Column</button></th>
            </tr>
          </thead>
          <tbody>
            {t.rows.map((r, ri) => (
              <tr key={r.id}>
                {t.columns.map((c) => (
                  <td key={c.id}><input className="input" value={r.cells[c.id] ?? ''} aria-label={`Row ${ri + 1}, ${c.label}`} onChange={(e) => set({ rows: t.rows.map((x) => (x.id === r.id ? { ...x, cells: { ...x.cells, [c.id]: e.target.value } } : x)) }, `cell-${r.id}-${c.id}`)} /></td>
                ))}
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button type="button" className="btn btn-sm btn-icon" title="Move row up" aria-label="Move row up" disabled={ri === 0} onClick={() => { const rows = [...t.rows]; [rows[ri - 1], rows[ri]] = [rows[ri], rows[ri - 1]]; set({ rows }) }}>↑</button>{' '}
                  <button type="button" className="btn btn-sm btn-icon" title="Remove row" aria-label="Remove row" onClick={() => set({ rows: t.rows.filter((x) => x.id !== r.id) })}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div><button type="button" className="btn btn-sm" onClick={() => set({ rows: [...t.rows, { id: newId('r'), cells: {} }] })}>+ Row</button></div>
    </div>
  )
}

export const emptyTable = (): TableData => ({ header: true, columns: [{ id: newId('c'), label: 'Item', align: 'left' }, { id: newId('c'), label: 'Detail', align: 'left' }], rows: [{ id: newId('r'), cells: {} }, { id: newId('r'), cells: {} }] })
export { newId }
