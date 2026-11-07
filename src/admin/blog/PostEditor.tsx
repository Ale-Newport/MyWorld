'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { typingTarget } from '../keys'
import { EditorFrame } from '../ui/EditorFrame'
import { Icon } from '../ui/icons'
import { Loading, Notice, PageHeader, Segmented } from '../ui/kit'
import { uniquePostSlug } from '@/cms/blog'
import type { BlogPost } from '@/cms/schema'
import { BlogPreviewPane } from './PreviewFrame'
import { BodyField, CoverField, DateField, TagsInput, TextField } from './fields'
import { mergedPosts, samePost, savedPost, useBlogStore } from './store'

/* ============================================================
   ONE POST, IN THE DEPLOYED ADMIN

   The form edits the post in this browser (kept if the tab closes);
   the preview beside it is the public blog's own page for it, fed
   the edit on every keystroke. Nothing is saved until a button
   says so:

     Save draft      saves it as a draft: in the admin, not on /blog
     Publish         saves it published: on /blog at the next request
     Publish changes the same, for a post that is already on /blog
     Unpublish       saves it back as a draft: it leaves /blog

   Each is one new version of the blog in the database
   (server/blog.ts), live at once; no build, nothing committed.
   ============================================================ */

const TABS = ['Write', 'Details'] as const
type Tab = (typeof TABS)[number]
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/

/** Where a post stands, in one badge. */
export function standing(saved: BlogPost | null, dirty: boolean): { tone?: string; text: string } {
  if (!saved) return { tone: 'warn', text: 'Not saved yet' }
  if (dirty) return { tone: 'warn', text: 'Unsaved changes' }
  return saved.status === 'published' ? { tone: 'ok', text: 'On /blog' } : { text: 'Draft — only in the admin' }
}

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

export function PostEditor({ id }: { id: string }) {
  const router = useRouter()
  const s = useBlogStore()
  const [tab, setTab] = useState<Tab>('Write')
  const [view, setView] = useState<'post' | 'index'>('post')
  useEffect(() => { void useBlogStore.getState().load() }, [])

  const saved = savedPost(s.data, id)
  const working = s.working[id]
  const post = working?.post ?? saved
  const slug = useDebounced(post?.slug ?? '', 700)
  const previewPosts = useMemo(() => (s.data ? mergedPosts(s.data, s.working) : null), [s.data, s.working])

  /* ⌘Z / ⇧⌘Z outside a text field (a field keeps its own undo). */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || typingTarget(e.target)) return
      const k = e.key.toLowerCase()
      if (k === 'z') { e.preventDefault(); if (e.shiftKey) useBlogStore.getState().redo(id); else useBlogStore.getState().undo(id) }
      if (k === 'y') { e.preventDefault(); useBlogStore.getState().redo(id) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [id])

  if (s.status !== 'ready' || !s.data) {
    return <main className="a-page">{s.status === 'error' ? <Notice tone="danger">{s.error}</Notice> : <Loading label="Reading the posts…" />}</main>
  }
  if (!post) {
    return (
      <main className="a-page">
        <div className="empty"><b>No post with the id “{id}”.</b><span>It may have been deleted, or it was a new post that was discarded.</span><Link className="btn" href="/admin/blog">Back to the blog</Link></div>
      </main>
    )
  }

  const data = s.data
  const edit = (mutate: (p: BlogPost) => void, coalesce?: string) => s.edit(id, mutate, coalesce)
  const dirty = !!working && !samePost(working.post, saved)
  const badge = standing(saved, dirty)
  const others = mergedPosts(data, s.working).filter((p) => p.id !== id)
  const slugTaken = others.some((p) => p.slug === post.slug)
  const fromTitle = uniquePostSlug(others, post.title || 'post')
  const published = saved?.status === 'published'
  const canCommit = !s.busy

  const commit = (status: BlogPost['status'], overwrite = false) => s.commit(id, status, { overwrite })
  // The address the preview opens: the slug once typing pauses (from the first render, the post's own).
  const shownSlug = SLUG.test(slug) ? slug : SLUG.test(post.slug) ? post.slug : null
  const remove = async () => {
    const words = saved
      ? `Delete “${post.title || 'Untitled'}”?${published ? ' It leaves /blog at once.' : ''} Earlier versions of the blog are kept in the database for a while.`
      : `Discard the new post “${post.title || 'Untitled'}”? It was never saved.`
    if (!confirm(words)) return
    if (await s.remove(id)) router.push('/admin/blog')
  }

  const actions = (
    <div className="a-publishbar" role="toolbar" aria-label="Post">
      <span className="badge" data-tone={s.busy ? undefined : badge.tone} role="status" aria-live="polite">{s.busy ?? badge.text}</span>
      {published && saved && <a className="btn btn-ghost" href={`/blog/${saved.slug}`} target="_blank" rel="noreferrer" title="The post on the site, as visitors see it">View <Icon name="external" size={14} /></a>}
      <div className="btn-group">
        <button type="button" className="btn btn-icon" onClick={() => s.undo(id)} disabled={!s.past[id]?.length} title="Undo (⌘Z)" aria-label="Undo"><Icon name="undo" size={16} /></button>
        <button type="button" className="btn btn-icon" onClick={() => s.redo(id)} disabled={!s.future[id]?.length} title="Redo (⇧⌘Z)" aria-label="Redo"><Icon name="redo" size={16} /></button>
      </div>
      {dirty && saved && <button type="button" className="btn btn-ghost" disabled={!!s.busy} onClick={() => { if (confirm('Discard your changes to this post? The saved version stays.')) s.discard(id) }}>Discard</button>}
      {published
        ? <button type="button" className="btn" disabled={!canCommit} onClick={() => { if (confirm(`Unpublish “${post.title}”? It stays here as a draft and leaves /blog at once.`)) void commit('draft') }}>Unpublish</button>
        : <button type="button" className="btn" disabled={!canCommit || (!dirty && !!saved)} onClick={() => void commit('draft')}>Save draft</button>}
      <button type="button" className="btn btn-accent" disabled={!canCommit || (published && !dirty)} onClick={() => void commit('published')}>{published ? 'Publish changes' : 'Publish'}</button>
    </div>
  )

  const header = (
    <PageHeader
      compact
      eyebrow="Blog · Post"
      title={<span className="ed-title"><Link href="/admin/blog" className="ed-back" aria-label="All posts">←</Link>{post.title || 'Untitled'}<span className="badge" data-tone={post.status === 'published' ? 'ok' : 'warn'}>{saved ? saved.status : 'new'}</span></span>}
      actions={actions}
    />
  )

  const form = (
    <div className="ce-form">
      {s.conflict?.id === id && (
        <Notice tone="danger">
          <b>Not saved.</b> {s.conflict.message}
          <div className="row" style={{ marginTop: 8 }}>
            <button type="button" className="btn btn-sm" onClick={() => { s.discard(id); void s.load(true) }}>Take the other version</button>
            {saved && <button type="button" className="btn btn-sm btn-danger" onClick={() => void commit(post.status, true)}>Overwrite it with mine</button>}
          </div>
        </Notice>
      )}
      <nav className="ed-formtabs" role="tablist" aria-label="Post fields">
        {TABS.map((t) => <button key={t} type="button" role="tab" aria-selected={tab === t} className="a-tab" onClick={() => setTab(t)}>{t}</button>)}
      </nav>

      {tab === 'Write' && <>
        <Group title="Post">
          <TextField label="Title" value={post.title} maxLength={400} onChange={(v) => edit((p) => { p.title = v }, 'title')} />
          {!published && fromTitle !== post.slug && post.title.trim() && (
            <div className="row" style={{ gap: 6, marginTop: -6 }}>
              <span className="a-sub a-mono" style={{ fontSize: 11.5 }}>/blog/{post.slug}</span>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => edit((p) => { p.slug = fromTitle })}>Use /blog/{fromTitle}</button>
            </div>
          )}
          <DateField value={post.date} onChange={(v) => edit((p) => { p.date = v }, 'date')} />
          <TextField label="Excerpt" multiline rows={3} maxLength={320} value={post.excerpt} placeholder="One or two sentences: shown in the list, under the title and in search results." onChange={(v) => edit((p) => { p.excerpt = v }, 'excerpt')} />
          <BodyField body={post.body} onChange={(v, coalesce) => edit((p) => { p.body = v }, coalesce ? 'body' : undefined)} />
        </Group>
      </>}

      {tab === 'Details' && <>
        <Group title="Address">
          <TextField label="Slug" value={post.slug} hint={`/blog/${post.slug}`} onChange={(v) => edit((p) => { p.slug = v }, 'slug')} validate={(v) => (!SLUG.test(v) ? 'Lowercase words joined by dashes' : slugTaken ? 'Another post already uses this slug' : null)} />
          <div className="row">
            <button type="button" className="btn btn-sm" disabled={fromTitle === post.slug || !post.title.trim()} onClick={() => edit((p) => { p.slug = fromTitle })}>Make it from the title</button>
            {published && <span className="a-sub" style={{ fontSize: 12 }}>Changing a published post&apos;s address breaks links to it.</span>}
          </div>
        </Group>
        <Group title="Tags">
          <TagsInput tags={post.tags} onChange={(tags) => edit((p) => { p.tags = tags })} />
        </Group>
        <Group title="Cover image">
          <CoverField cover={post.cover} onChange={(v) => edit((p) => { if (v) p.cover = v; else delete p.cover }, 'cover')} />
          <TextField label="Alternative text" value={post.coverAlt ?? ''} maxLength={400} hint="What the picture shows, for people who cannot see it. Leave it empty if it is only decoration." onChange={(v) => edit((p) => { if (v) p.coverAlt = v; else delete p.coverAlt }, 'coverAlt')} />
        </Group>
        <Group title="Danger zone">
          <div className="row">
            <button type="button" className="btn btn-danger" disabled={!!s.busy || (!!saved && !canCommit)} onClick={() => void remove()}>{saved ? 'Delete post' : 'Discard new post'}</button>
            <span className="a-sub" style={{ fontSize: 12 }}>{saved ? 'Prefer Unpublish to take it off the site without losing it.' : 'It has not been saved yet.'}</span>
          </div>
        </Group>
      </>}
    </div>
  )

  return (
    <EditorFrame
      header={header}
      form={form}
      preview={<BlogPreviewPane posts={previewPosts} slug={view === 'post' ? shownSlug : null} tools={<Segmented<'post' | 'index'> label="Show" size="sm" value={view} onChange={setView} options={[{ value: 'post', label: 'Post' }, { value: 'index', label: 'Blog' }]} />} />}
    />
  )
}
