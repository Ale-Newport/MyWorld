'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { useSiteStore } from '../store/site'
import { DraftBar } from '../DraftBar'
import type { Device } from '../DraftPreview'
import { EditorFrame, PreviewPane } from '../ui/EditorFrame'
import { Loading, PageHeader, Segmented, Tabs, WEBSITE_TABS } from '../ui/kit'
import { Field, MediaPicker, TextInput, type MediaRow } from '../fields'
import { postWords, readingMinutes, uniquePostSlug } from '@/cms/blog'
import { isSafeSrc } from '@/cms/safe'
import type { BlogPost } from '@/cms/schema'

/* ============================================================
   ONE POST, EVERY FIELD

   The form edits the post in the draft; the preview beside it is
   the real /blog page for it — the same components and the same
   Markdown renderer a visitor gets — re-rendered from the draft on
   every keystroke. "Blog" shows the list the post sits in. Drafts
   appear in the preview only: the site gets a post once it is set
   to Published and the site is published.
   ============================================================ */

const TABS = ['Write', 'Details'] as const
type Tab = (typeof TABS)[number]
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/
const DATE = /^\d{4}-\d{2}-\d{2}$/

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t) }, [value, ms])
  return v
}

function Group({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="a-panel">
      <header className="a-panel-head"><div><h2>{title}</h2></div>{actions}</header>
      <div className="a-panel-body">{children}</div>
    </section>
  )
}

type Edit = (mutate: (p: BlogPost) => void, coalesce?: string) => void

export function PostEditor({ id }: { id: string }) {
  const router = useRouter()
  const { status, doc, load, apply } = useSiteStore()
  const [tab, setTab] = useState<Tab>('Write')
  const [device, setDevice] = useState<Device>('laptop')
  const [view, setView] = useState<'post' | 'index'>('post')
  useEffect(() => { void load() }, [load])

  const posts = doc?.posts ?? []
  const post = posts.find((p) => p.id === id) ?? null
  const at = `posts[id=${id}]`
  const slug = useDebounced(post?.slug ?? '', 700)

  if (status !== 'ready' || !doc) return <main className="a-page"><Loading label="Loading the draft…" /></main>
  if (!post) {
    return (
      <main className="a-page">
        <div className="empty"><b>No post with the id “{id}” in this draft.</b><span>It may have been deleted, or the draft was reloaded.</span><Link className="btn" href="/admin/blog">Back to the blog</Link></div>
      </main>
    )
  }

  const edit: Edit = (mutate, coalesce) => apply((d) => { const p = d.posts?.find((x) => x.id === id); if (p) mutate(p) }, coalesce ? { coalesce } : undefined)
  const slugTaken = posts.some((p) => p.id !== id && p.slug === post.slug)
  const fromTitle = uniquePostSlug(posts, post.title, { except: id })
  const remove = () => {
    const live = post.status === 'published' ? ' It leaves the public blog when you next publish.' : ''
    if (!confirm(`Delete “${post.title || 'Untitled'}”?${live} Earlier revisions keep a copy you can restore from History.`)) return
    apply((d) => { d.posts = (d.posts ?? []).filter((p) => p.id !== id) })
    router.push('/admin/blog')
  }

  const previewPath = view === 'post' && SLUG.test(slug) ? `/blog/${slug}` : '/blog'
  const header = (
    <PageHeader
      compact
      eyebrow="Website · Blog post"
      title={<span className="ed-title"><Link href="/admin/blog" className="ed-back" aria-label="All posts">←</Link>{post.title || 'Untitled'}<span className="badge" data-tone={post.status === 'published' ? 'ok' : 'warn'}>{post.status}</span></span>}
      actions={<DraftBar compact />}
      tabs={<Tabs label="Website" tabs={WEBSITE_TABS} />}
    />
  )
  const form = (
    <div className="ce-form">
      <nav className="ed-formtabs" role="tablist" aria-label="Post fields">
        {TABS.map((t) => <button key={t} type="button" role="tab" aria-selected={tab === t} className="a-tab" onClick={() => setTab(t)}>{t}</button>)}
      </nav>

      {tab === 'Write' && <>
        <Group title="Publishing">
          <div className="grid-2" style={{ alignItems: 'start' }}>
            <div className="field">
              <span>Status</span>
              <Segmented<BlogPost['status']> label="Status" value={post.status} onChange={(s) => edit((p) => { p.status = s })} options={[{ value: 'draft', label: 'Draft' }, { value: 'published', label: 'Published' }]} />
              <small>{post.status === 'draft' ? 'Only the preview shows it.' : 'On /blog once you publish the site.'}</small>
            </div>
            <DateField value={post.date} onChange={(v) => edit((p) => { p.date = v }, `${at}.date`)} />
          </div>
        </Group>
        <Group title="Post">
          <TextInput path={`${at}.title`} label="Title" maxLength={400} />
          {post.status === 'draft' && fromTitle !== post.slug && post.title.trim() && (
            <div className="row" style={{ gap: 6, marginTop: -6 }}>
              <span className="a-sub a-mono" style={{ fontSize: 11.5 }}>/blog/{post.slug}</span>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => edit((p) => { p.slug = fromTitle })}>Use /blog/{fromTitle}</button>
            </div>
          )}
          <TextInput path={`${at}.excerpt`} label="Excerpt" multiline rows={3} maxLength={320} placeholder="One or two sentences: shown in the list, under the title and in search results." />
          <BodyField body={post.body} onChange={(v, coalesce) => edit((p) => { p.body = v }, coalesce ? `${at}.body` : undefined)} />
        </Group>
      </>}

      {tab === 'Details' && <>
        <Group title="Address">
          <TextInput path={`${at}.slug`} label="Slug" hint={`/blog/${post.slug}`} validate={(v) => (!SLUG.test(v) ? 'Lowercase words joined by dashes' : slugTaken ? 'Another post already uses this slug' : null)} />
          <div className="row">
            <button type="button" className="btn btn-sm" disabled={fromTitle === post.slug || !post.title.trim()} onClick={() => edit((p) => { p.slug = fromTitle })}>Make it from the title</button>
            {post.status === 'published' && <span className="a-sub" style={{ fontSize: 12 }}>Changing a published post&apos;s address breaks links to it.</span>}
          </div>
        </Group>
        <Group title="Tags">
          <TagsInput tags={post.tags} onChange={(tags) => edit((p) => { p.tags = tags })} />
        </Group>
        <Group title="Cover image">
          <CoverField
            cover={post.cover}
            onChange={(v) => edit((p) => { if (v) p.cover = v; else delete p.cover }, `${at}.cover`)}
            onPick={(m) => edit((p) => { p.cover = m.url; if (!p.coverAlt && m.alt) p.coverAlt = m.alt })}
          />
          <TextInput path={`${at}.coverAlt`} label="Alternative text" optional maxLength={400} hint="What the picture shows, for people who cannot see it. Leave it empty if it is only decoration." />
        </Group>
        <Group title="Danger zone">
          <div className="row"><button type="button" className="btn btn-danger" onClick={remove}>Delete post</button><span className="a-sub" style={{ fontSize: 12 }}>Prefer Draft to take it off the site without losing it.</span></div>
        </Group>
      </>}
    </div>
  )
  return (
    <EditorFrame
      header={header}
      form={form}
      preview={<PreviewPane path={previewPath} device={device} onDevice={setDevice} tools={<Segmented<'post' | 'index'> label="Show" size="sm" value={view} onChange={setView} options={[{ value: 'post', label: 'Post' }, { value: 'index', label: 'Blog' }]} />} />}
    />
  )
}

/* ---- pieces ------------------------------------------------------- */

function DateField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const id = useId()
  return (
    <Field label="Date" id={id} hint="Posts are listed newest first.">
      {/* A cleared date input reports "": the stored date stays until a whole one is chosen. */}
      <input id={id} type="date" className="input" value={value} required aria-describedby={`${id}-hint`} onChange={(e) => { if (DATE.test(e.target.value)) onChange(e.target.value) }} />
    </Field>
  )
}

/** The Markdown body: a large text box, a line of syntax, the length, and images from the media library dropped in at the caret. */
function BodyField({ body, onChange }: { body: string; onChange: (v: string, coalesce: boolean) => void }) {
  const id = useId()
  const area = useRef<HTMLTextAreaElement>(null)
  const [picking, setPicking] = useState(false)
  const words = useMemo(() => postWords(body), [body])

  /* An image on a line of its own is a figure on the page (its title, if any, the caption). */
  const insertImage = (m: MediaRow) => {
    const el = area.current
    const start = el?.selectionStart ?? body.length
    const end = el?.selectionEnd ?? body.length
    const before = body.slice(0, start)
    const after = body.slice(end)
    const lead = before === '' || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n'
    const trail = after === '' || after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n'
    const snippet = `![${(m.alt || m.title || '').replace(/[[\]]/g, '')}](${m.url})`
    onChange(before + lead + snippet + trail + after, false)
    const caret = (before + lead + snippet).length
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(caret, caret) })
  }

  return (
    <div className="field ce-field">
      <div className="ce-field-head">
        <label htmlFor={id}>Body</label>
        <button type="button" className="btn btn-sm" onClick={() => setPicking(true)}>+ Image</button>
      </div>
      <textarea
        ref={area}
        id={id}
        className="input a-mono"
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
      <MediaPicker open={picking} accept="image" onClose={() => setPicking(false)} onPick={(m) => { insertImage(m); setPicking(false) }} />
    </div>
  )
}

/** Tags as chips: Enter or a comma adds one, ✕ removes it. Never an empty one, never a repeat, twelve at most (the schema's rules). */
function TagsInput({ tags, onChange }: { tags: string[]; onChange: (next: string[]) => void }) {
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

/** The cover: picked from (or uploaded to) the media library, or typed as an address; previewed at the size it reads at. */
function CoverField({ cover, onChange, onPick }: { cover?: string; onChange: (v: string | undefined) => void; onPick: (m: MediaRow) => void }) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const invalid = !!cover && !isSafeSrc(cover)
  return (
    <div className="field">
      <label htmlFor={id}>Image</label>
      {cover && !invalid && <img src={cover} alt="" style={{ width: '100%', maxHeight: 220, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--a-line)', background: 'var(--a-sunk)' }} />}
      <div className="row">
        <input id={id} className="input a-mono" style={{ flex: 1, minWidth: 160 }} value={cover ?? ''} placeholder="/media/… or https://…" aria-invalid={invalid} aria-describedby={`${id}-hint`} onChange={(e) => onChange(e.target.value || undefined)} />
        <button type="button" className="btn btn-sm" onClick={() => setOpen(true)}>{cover ? 'Replace' : 'Library'}</button>
        {cover && <button type="button" className="btn btn-sm" onClick={() => onChange(undefined)}>Remove</button>}
      </div>
      {invalid
        ? <small id={`${id}-hint`} style={{ color: 'var(--a-danger)' }} role="alert">Use an uploaded file, a path on this site or an https:// address.</small>
        : <small id={`${id}-hint`}>Optional. At the top of the post and beside it in the list. Upload a new one from the library.</small>}
      <MediaPicker open={open} accept="image" onClose={() => setOpen(false)} onPick={(m) => { onPick(m); setOpen(false) }} />
    </div>
  )
}
