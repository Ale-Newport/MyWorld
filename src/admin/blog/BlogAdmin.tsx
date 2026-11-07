'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { Icon } from '../ui/icons'
import { Empty, Loading, Notice, PageHeader } from '../ui/kit'
import { formatPostDate, readingMinutes } from '@/cms/blog'
import type { BlogPost } from '@/cms/schema'
import { standing } from './PostEditor'
import { mergedPosts, samePost, savedPost, sortedPosts, useBlogStore } from './store'

/* ============================================================
   THE BLOG, IN THE DEPLOYED ADMIN

   Every post as the database has it — what /blog shows, drafts
   included — newest first, with the edits this browser has not
   saved yet. A post is opened in its editor; here it can also be
   looked at on the site or deleted. Saving is publishing: /blog is
   read from the database on every request.
   ============================================================ */

export function BlogAdmin() {
  const router = useRouter()
  const s = useBlogStore()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | BlogPost['status']>('all')
  useEffect(() => { void useBlogStore.getState().load(true) }, [])

  const posts = useMemo(() => sortedPosts(mergedPosts(s.data, s.working)), [s.data, s.working])
  const q = query.trim().toLowerCase()
  const shown = posts.filter((p) => (filter === 'all' || p.status === filter) && (!q || `${p.title} ${p.slug} ${p.tags.join(' ')}`.toLowerCase().includes(q)))

  const create = () => router.push(`/admin/blog/${encodeURIComponent(s.create())}`)
  const remove = async (post: BlogPost) => {
    const saved = savedPost(s.data, post.id)
    const words = saved
      ? `Delete “${post.title || 'Untitled'}”?${saved.status === 'published' ? ' It leaves /blog at once.' : ''} Earlier versions of the blog are kept in the database for a while.`
      : `Discard the new post “${post.title || 'Untitled'}”? It was never saved.`
    if (confirm(words)) await s.remove(post.id)
  }

  const data = s.data
  return (
    <main className="a-page">
      <PageHeader
        eyebrow="Content"
        title="Blog"
        description="Write, publish and unpublish the posts on /blog. A post is saved in the site's database and is on the site as soon as you publish it."
        actions={<div className="a-publishbar">
          {s.busy && <span className="badge" role="status">{s.busy}</span>}
          <a className="btn" href="/blog" target="_blank" rel="noreferrer">View /blog <Icon name="external" size={14} /></a>
          <button type="button" className="btn btn-primary" disabled={s.status !== 'ready'} onClick={create}>+ New post</button>
        </div>}
      />
      {s.status === 'error' && <Notice tone="danger">The posts could not be read: {s.error}</Notice>}
      {s.status !== 'ready' || !data ? (s.status !== 'error' && <Loading label="Reading the posts…" />) : <div className="stack">
        {s.conflict && <Notice tone="danger">{s.conflict.message} <button type="button" className="btn btn-sm" onClick={() => void s.load(true)}>Reload</button></Notice>}

        {posts.length === 0 ? (
          <Empty title="No posts yet" action={<button type="button" className="btn btn-primary" onClick={create}>+ Write the first post</button>}>
            <span className="a-sub">Write in Markdown, add pictures, and see the real page as you type. A draft stays in the admin; a published post is on /blog at once.</span>
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
                <thead><tr><th>Post</th><th>Date</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {shown.map((p) => {
                    const saved = savedPost(data, p.id)
                    const dirty = !!s.working[p.id] && !samePost(s.working[p.id].post, saved)
                    const badge = standing(saved, dirty)
                    return (
                      <tr key={p.id}>
                        <td>
                          <Link href={`/admin/blog/${encodeURIComponent(p.id)}`} style={{ fontWeight: 500 }}>{p.title || 'Untitled'}</Link><br />
                          <span className="a-mono a-sub">/blog/{p.slug}</span>
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <span className="a-mono">{formatPostDate(p.date)}</span><br />
                          <span className="a-sub" style={{ fontSize: 12 }}>{readingMinutes(p.body)} min read</span>
                        </td>
                        <td><span className="badge" data-tone={badge.tone}>{badge.text}</span></td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {saved?.status === 'published' && <><a className="btn btn-sm" href={`/blog/${saved.slug}`} target="_blank" rel="noreferrer">View</a>{' '}</>}
                          <Link className="btn btn-sm" href={`/admin/blog/${encodeURIComponent(p.id)}`}>Edit</Link>{' '}
                          <button type="button" className="btn btn-sm btn-danger" disabled={!!s.busy} onClick={() => void remove(p)}>{saved ? 'Delete' : 'Discard'}</button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {shown.length === 0 && <p className="empty">No post matches.</p>}
          </section>
        )}
        <p className="a-sub" style={{ fontSize: 12 }}>Edits not yet saved stay in this browser, even if the tab is closed.</p>
      </div>}
    </main>
  )
}
