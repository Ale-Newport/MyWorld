'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { useSiteStore } from '../store/site'
import { DraftBar } from '../DraftBar'
import { Empty, Loading, PageHeader, Tabs, WEBSITE_TABS } from '../ui/kit'
import { allPosts, formatPostDate, listedPosts, readingMinutes, uniquePostSlug } from '@/cms/blog'
import type { BlogPost } from '@/cms/schema'

const STATUS_TONE: Record<BlogPost['status'], string> = { published: 'ok', draft: 'warn' }

/** Today on this machine, as posts store dates — not UTC, so a post written late at night keeps its day. */
export function today(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** A new post: a draft dated today, its id and address made from the title and unique among the posts. */
export function blankPost(doc: { posts?: BlogPost[] | null }, title = 'Untitled post'): BlogPost {
  const slug = uniquePostSlug(allPosts(doc), title)
  return { id: slug, slug, title, excerpt: '', body: '', date: today(), tags: [], status: 'draft' }
}

/* Every post in the draft, newest first — the order /blog shows them in.
   A post is written in its editor; here it is found, opened, switched
   between draft and published, or deleted. Nothing reaches the site
   until the draft is published, and every change here can be undone. */
export function BlogAdmin() {
  const router = useRouter()
  const { status, doc, load, apply } = useSiteStore()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | BlogPost['status']>('all')
  useEffect(() => { void load() }, [load])

  const posts = useMemo(() => listedPosts(doc, { preview: true }), [doc])
  const q = query.trim().toLowerCase()
  const shown = posts.filter((p) => (filter === 'all' || p.status === filter) && (!q || `${p.title} ${p.slug} ${p.tags.join(' ')}`.toLowerCase().includes(q)))

  const create = () => {
    const post = blankPost(doc!)
    apply((d) => { (d.posts ??= []).push(post) })
    router.push(`/admin/blog/${encodeURIComponent(post.id)}`)
  }
  const patch = (id: string, change: Partial<BlogPost>) => apply((d) => { const p = d.posts?.find((x) => x.id === id); if (p) Object.assign(p, change) })
  const remove = (post: BlogPost) => {
    const live = post.status === 'published' ? ' It leaves the public blog when you next publish.' : ''
    if (!confirm(`Delete “${post.title || 'Untitled'}”?${live} Undo brings it back; earlier revisions keep a copy you can restore from History.`)) return
    apply((d) => { d.posts = (d.posts ?? []).filter((p) => p.id !== post.id) })
  }

  return (
    <main className="a-page">
      <PageHeader
        eyebrow="Website"
        title="Blog"
        description="The posts on /blog, newest first. A post starts as a draft that only the preview shows; switch it to Published and publish the site to put it live."
        actions={<DraftBar>
          <button type="button" className="btn btn-primary" disabled={!doc} onClick={create}>+ New post</button>
        </DraftBar>}
        tabs={<Tabs label="Website" tabs={WEBSITE_TABS} />}
      />
      {status !== 'ready' || !doc ? <Loading label="Loading the draft…" /> : posts.length === 0 ? (
        <Empty title="No posts yet" action={<button type="button" className="btn btn-primary" onClick={create}>+ Write the first post</button>}>
          <span className="a-sub">Write in Markdown, add a cover from the media library, and see it on the real page as you type. Until you publish a post, nobody else sees it.</span>
        </Empty>
      ) : (
        <section className="card">
          <div className="row" style={{ marginBottom: 12 }}>
            <input className="input" style={{ maxWidth: 320 }} placeholder="Search title, slug, tag…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search posts" />
            <div className="btn-group" role="group" aria-label="Filter">
              {(['all', 'published', 'draft'] as const).map((f) => <button key={f} type="button" className="btn btn-sm" aria-pressed={filter === f} onClick={() => setFilter(f)}>{f[0].toUpperCase() + f.slice(1)}</button>)}
            </div>
            <span className="spacer" /><span className="a-sub">{shown.length} of {posts.length}</span>
          </div>
          <div className="table-scroll">
            <table className="table">
              <thead><tr><th>Post</th><th>Date</th><th>Tags</th><th>Status</th><th /></tr></thead>
              <tbody>
                {shown.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link href={`/admin/blog/${encodeURIComponent(p.id)}`} style={{ fontWeight: 500 }}>{p.title || 'Untitled'}</Link><br />
                      <span className="a-mono a-sub">/blog/{p.slug}</span>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <span className="a-mono">{formatPostDate(p.date)}</span><br />
                      <span className="a-sub" style={{ fontSize: 12 }}>{readingMinutes(p.body)} min read</span>
                    </td>
                    <td>{p.tags.length ? p.tags.join(', ') : <span className="a-sub">—</span>}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <select className="input" style={{ minHeight: 28, width: 'auto' }} value={p.status} aria-label={`Status of ${p.title || 'Untitled'}`} onChange={(e) => patch(p.id, { status: e.target.value as BlogPost['status'] })}>
                        <option value="published">Published</option><option value="draft">Draft</option>
                      </select>{' '}
                      <span className="badge" data-tone={STATUS_TONE[p.status]}>{p.status}</span>
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <Link className="btn btn-sm" href={`/admin/blog/${encodeURIComponent(p.id)}`}>Edit</Link>{' '}
                      <button type="button" className="btn btn-sm btn-danger" onClick={() => remove(p)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {shown.length === 0 && <p className="empty">No post matches.</p>}
        </section>
      )}
    </main>
  )
}
