'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { Empty, Loading, Notice, PageHeader } from '../ui/kit'
import { formatPostDate, readingMinutes } from '@/cms/blog'
import type { BlogPost } from '@/cms/schema'
import { LIVE_WORDS } from './PostEditor'
import { leavingPosts, liveState, mergedPosts, pendingCount, samePost, savedPost, sortedPosts, useBlogStore } from './store'

/* ============================================================
   THE BLOG, IN THE DEPLOYED ADMIN

   Every post as it is on GitHub now — the version the next build
   shows — newest first, with what this browser has not committed
   yet and whether the live site has caught up. The site rebuilds a
   minute or two after each commit; while it has not, the list says
   so and looks again every 20 seconds.
   ============================================================ */

const POLL_MS = 20_000

export function BlogAdmin() {
  const router = useRouter()
  const s = useBlogStore()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | BlogPost['status']>('all')
  useEffect(() => { void useBlogStore.getState().load(true) }, [])

  const pending = pendingCount(s.data)
  /* Until the live site has every commit, look again now and then (only while this tab is in view). */
  useEffect(() => {
    if (!pending) return
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void useBlogStore.getState().load(true) }, POLL_MS)
    return () => window.clearInterval(timer)
  }, [pending])

  const posts = useMemo(() => sortedPosts(mergedPosts(s.data, s.working)), [s.data, s.working])
  const leaving = leavingPosts(s.data)
  const q = query.trim().toLowerCase()
  const shown = posts.filter((p) => (filter === 'all' || p.status === filter) && (!q || `${p.title} ${p.slug} ${p.tags.join(' ')}`.toLowerCase().includes(q)))

  const create = () => router.push(`/admin/blog/${encodeURIComponent(s.create())}`)
  const remove = async (post: BlogPost) => {
    const saved = savedPost(s.data, post.id)
    const words = saved
      ? `Delete “${post.title || 'Untitled'}”? This commits its removal to GitHub${saved.status === 'published' ? ' and it leaves the live site after the rebuild' : ''}. Its earlier versions stay in the repository's history.`
      : `Discard the new post “${post.title || 'Untitled'}”? It was never saved.`
    if (confirm(words)) await s.remove(post.id)
  }

  const data = s.data
  const canCommit = !!data?.configured && data.source === 'github' && !s.busy
  return (
    <main className="a-page">
      <PageHeader
        eyebrow="Content"
        title="Blog"
        description="Write, publish and unpublish the posts on /blog. Each save is a commit to the site's repository on GitHub; the live site rebuilds and shows it a minute or two later."
        actions={<div className="a-publishbar">
          {s.busy && <span className="badge" role="status">{s.busy}</span>}
          <button type="button" className="btn" disabled={s.status === 'loading'} onClick={() => void s.load(true)}>Check GitHub</button>
          <button type="button" className="btn btn-primary" disabled={s.status !== 'ready'} onClick={create}>+ New post</button>
        </div>}
      />
      {s.status === 'error' && <Notice tone="danger">{s.error}</Notice>}
      {s.status !== 'ready' || !data ? (s.status !== 'error' && <Loading label="Reading the posts from GitHub…" />) : <div className="stack">
        {!data.configured && <Notice tone="warn">{data.error}</Notice>}
        {data.configured && data.source !== 'github' && <Notice tone="danger">{data.error} The list shows the posts the live site was built with; nothing can be committed until GitHub answers.</Notice>}
        {pending > 0 && <Notice tone="info"><b>{pending === 1 ? 'One change is' : `${pending} changes are`} on GitHub but not on the live site yet.</b> It rebuilds a minute or two after each commit; this list looks again every 20 seconds.</Notice>}
        {s.conflict && <Notice tone="danger">{s.conflict.message} <button type="button" className="btn btn-sm" onClick={() => void s.load(true)}>Reload</button></Notice>}

        {posts.length === 0 && leaving.length === 0 ? (
          <Empty title="No posts yet" action={<button type="button" className="btn btn-primary" onClick={create}>+ Write the first post</button>}>
            <span className="a-sub">Write in Markdown, add pictures, and see the real page as you type. A post is only on GitHub once you save it, and only on the site once you publish it.</span>
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
                <thead><tr><th>Post</th><th>Date</th><th>Status</th><th>Live site</th><th /></tr></thead>
                <tbody>
                  {shown.map((p) => {
                    const saved = savedPost(data, p.id)
                    const dirty = !!s.working[p.id] && !samePost(s.working[p.id].post, saved)
                    const live = LIVE_WORDS[liveState(data, p.id)]
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
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <span className="badge" data-tone={saved?.status === 'published' ? 'ok' : 'warn'}>{saved ? saved.status : 'new'}</span>{' '}
                          {dirty && saved && <span className="badge" data-tone="warn">unsaved changes</span>}
                        </td>
                        <td><span className="badge" data-tone={live.tone}>{live.text}</span></td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <Link className="btn btn-sm" href={`/admin/blog/${encodeURIComponent(p.id)}`}>Edit</Link>{' '}
                          <button type="button" className="btn btn-sm btn-danger" disabled={!!saved && !canCommit} onClick={() => void remove(p)}>{saved ? 'Delete' : 'Discard'}</button>
                        </td>
                      </tr>
                    )
                  })}
                  {filter !== 'draft' && !q && leaving.map((p) => (
                    <tr key={`leaving-${p.id}`} style={{ opacity: 0.6 }}>
                      <td><span style={{ fontWeight: 500, textDecoration: 'line-through' }}>{p.title}</span><br /><span className="a-mono a-sub">/blog/{p.slug}</span></td>
                      <td className="a-mono">{formatPostDate(p.date)}</td>
                      <td><span className="badge">deleted</span></td>
                      <td><span className="badge" data-tone="accent">{LIVE_WORDS.leaving.text}</span></td>
                      <td />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {shown.length === 0 && <p className="empty">No post matches.</p>}
          </section>
        )}
        {data.configured && <p className="a-sub" style={{ fontSize: 12 }}>Commits go to <span className="a-mono">{data.repo}</span> on <span className="a-mono">{data.branch}</span>. Edits not yet saved stay in this browser, even if the tab is closed.</p>}
      </div>}
    </main>
  )
}
