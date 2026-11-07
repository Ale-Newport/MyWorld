'use client'

import { useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { Field } from '../fields'
import { toast } from '../toast'
import { postWords, readingMinutes } from '@/cms/blog'
import { isSafeSrc } from '@/cms/safe'
import { ACCEPT, uploadImage } from './upload'
import { throughAdmin, useBlogStore } from './store'

/* ============================================================
   THE POST'S FIELDS

   The admin's shared controls (fields.tsx) are bound to the site
   draft; a post in the deployed admin is an edit in this browser
   until it is committed (store.ts), so these are the same controls,
   in the same markup and classes, given a value and a setter.
   ============================================================ */

export function TextField({ label, value, onChange, hint, maxLength, multiline = false, rows, placeholder, validate }: { label: string; value: string; onChange: (v: string) => void; hint?: ReactNode; maxLength?: number; multiline?: boolean; rows?: number; placeholder?: string; validate?: (v: string) => string | null }) {
  const id = useId()
  const error = validate?.(value) ?? (maxLength && value.length > maxLength ? `${value.length}/${maxLength} characters` : null)
  const shown = hint ?? (maxLength ? `${value.length}/${maxLength}` : undefined)
  const a11y = { id, 'aria-invalid': !!error, 'aria-describedby': error || shown ? `${id}-hint` : undefined }
  return (
    <Field label={label} hint={shown} error={error} id={id}>
      {multiline
        ? <textarea className="input" value={value} rows={rows ?? 4} placeholder={placeholder} {...a11y} onChange={(e) => onChange(e.target.value)} />
        : <input className="input" value={value} placeholder={placeholder} {...a11y} onChange={(e) => onChange(e.target.value)} />}
    </Field>
  )
}

export function DateField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const id = useId()
  return (
    <Field label="Date" id={id} hint="Posts are listed newest first.">
      {/* A cleared date input reports "": the stored date stays until a whole one is chosen. */}
      <input id={id} type="date" className="input" value={value} required aria-describedby={`${id}-hint`} onChange={(e) => { if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) onChange(e.target.value) }} />
    </Field>
  )
}

/** A picture uploaded in this session is shown from memory; one committed earlier is read back through the admin until the site has it. */
function useShown(url: string | undefined) {
  const previews = useBlogStore((s) => s.previews)
  return url ? previews[url] ?? throughAdmin(url) : undefined
}

/** A button that uploads one image and hands back its address. */
export function UploadButton({ label, onUploaded, small = true }: { label: string; onUploaded: (url: string) => void; small?: boolean }) {
  const [busy, setBusy] = useState(false)
  const remember = useBlogStore((s) => s.rememberPreview)
  return (
    <label className={`btn${small ? ' btn-sm' : ''}`} aria-busy={busy || undefined}>
      {busy ? 'Uploading…' : label}
      <input type="file" hidden accept={ACCEPT} disabled={busy} onChange={async (e) => {
        const file = e.target.files?.[0]
        e.target.value = ''
        if (!file) return
        setBusy(true)
        try {
          const { url, blob } = await uploadImage(file)
          remember(url, blob)
          onUploaded(url)
        } catch (error) {
          toast((error as Error).message, 'danger')
        } finally {
          setBusy(false)
        }
      }} />
    </label>
  )
}

/** The Markdown body: a large text box, a line of syntax, the length, and pictures uploaded straight into the text at the caret. */
export function BodyField({ body, onChange }: { body: string; onChange: (v: string, coalesce: boolean) => void }) {
  const id = useId()
  const area = useRef<HTMLTextAreaElement>(null)
  const words = useMemo(() => postWords(body), [body])

  /* On a line of its own, so the page sets it as a figure; the words for it selected, ready to be typed over. */
  const insertImage = (url: string) => {
    const el = area.current
    const start = el?.selectionStart ?? body.length
    const end = el?.selectionEnd ?? body.length
    const before = body.slice(0, start)
    const after = body.slice(end)
    const lead = before === '' || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n'
    const trail = after === '' || after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n'
    const alt = 'Describe the picture'
    onChange(`${before}${lead}![${alt}](${url})${trail}${after}`, false)
    const from = (before + lead).length + 2
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(from, from + alt.length) })
  }

  return (
    <div className="field ce-field">
      <div className="ce-field-head">
        <label htmlFor={id}>Body</label>
        <UploadButton label="+ Image" onUploaded={insertImage} />
      </div>
      <textarea
        ref={area}
        id={id}
        className="input"
        value={body}
        rows={24}
        spellCheck
        placeholder={'Write in Markdown.\n\n## A heading\n\nA paragraph with **bold**, *italic* and a [link](https://…).\n\n- a list\n- of things'}
        aria-describedby={`${id}-hint`}
        style={{ minHeight: '52vh', fontFamily: 'var(--a-mono)', fontSize: 12.5, lineHeight: 1.7 }}
        onChange={(e) => onChange(e.target.value, true)}
      />
      <div id={`${id}-hint`} className="ce-field-foot">
        <small className="a-hint">
          Markdown: <span className="a-mono" style={{ fontSize: 11 }}>**bold** · *italic* · `code` · [link](https://…) · ## Heading · - list · 1. list · &gt; quote · ``` code block · ---</span>. A blank line starts a new paragraph; a single line break is kept. HTML is shown as text.
        </small>
        <small className="ce-count">{words.toLocaleString('en-GB')} {words === 1 ? 'word' : 'words'} · {readingMinutes(body)} min read</small>
      </div>
    </div>
  )
}

/** Tags as chips: Enter or a comma adds one, ✕ removes it. Never an empty one, never a repeat, twelve at most (the schema's rules). */
export function TagsInput({ tags, onChange }: { tags: string[]; onChange: (next: string[]) => void }) {
  const id = useId()
  const [draft, setDraft] = useState('')
  const full = tags.length >= 12
  const add = (raw: string) => {
    const next = [...tags]
    for (const t of raw.split(',').map((s) => s.trim().replace(/\s+/g, ' ').slice(0, 40)).filter(Boolean)) {
      if (next.length < 12 && !next.some((x) => x.toLowerCase() === t.toLowerCase())) next.push(t)
    }
    if (next.length !== tags.length) onChange(next)
    setDraft('')
  }
  return (
    <div className="field">
      <label htmlFor={id}>Tags</label>
      {tags.length > 0 && (
        <div className="row" style={{ gap: 6 }}>
          {tags.map((t, i) => (
            <span key={t} className="badge" style={{ paddingRight: 3 }}>
              {t}
              <button type="button" className="btn btn-sm btn-ghost btn-icon" style={{ minHeight: 20, width: 20 }} aria-label={`Remove the tag ${t}`} onClick={() => onChange(tags.filter((_, j) => j !== i))}>✕</button>
            </span>
          ))}
        </div>
      )}
      <input
        id={id}
        className="input"
        value={draft}
        disabled={full}
        placeholder={full ? 'Twelve tags at most' : 'Add a tag and press Enter'}
        aria-describedby={`${id}-hint`}
        onChange={(e) => { if (e.target.value.includes(',')) add(e.target.value); else setDraft(e.target.value) }}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(draft) } }}
        onBlur={() => { if (draft.trim()) add(draft) }}
      />
      <small id={`${id}-hint`}>Shown with the post and in the list. Enter or a comma adds one.</small>
    </div>
  )
}

/** The cover: uploaded here, or typed as an address; previewed at the size it reads at. */
export function CoverField({ cover, onChange }: { cover?: string; onChange: (v: string | undefined) => void }) {
  const id = useId()
  const shown = useShown(cover)
  const invalid = !!cover && !isSafeSrc(cover)
  return (
    <div className="field">
      <label htmlFor={id}>Image</label>
      {shown && !invalid && <img src={shown} alt="" style={{ width: '100%', maxHeight: 220, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--a-line)', background: 'var(--a-sunk)' }} />}
      <div className="row">
        <input id={id} className="input a-mono" style={{ flex: 1, minWidth: 160 }} value={cover ?? ''} placeholder="/uploads/blog/… or https://…" aria-invalid={invalid} aria-describedby={`${id}-hint`} onChange={(e) => onChange(e.target.value || undefined)} />
        <UploadButton label={cover ? 'Replace' : 'Upload'} onUploaded={onChange} />
        {cover && <button type="button" className="btn btn-sm" onClick={() => onChange(undefined)}>Remove</button>}
      </div>
      {invalid
        ? <small id={`${id}-hint`} style={{ color: 'var(--a-danger)' }} role="alert">Use an uploaded image, a path on this site or an https:// address.</small>
        : <small id={`${id}-hint`}>Optional. At the top of the post and beside it in the list. PNG, JPEG, WebP, GIF or AVIF; large photos are resized before they are sent.</small>}
    </div>
  )
}
