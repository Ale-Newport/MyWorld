'use client'

import Link from 'next/link'
import { formatPostDate, type PostSummary } from '@/cms/blog'
import { SiteHeader } from '@/components/site/SiteHeader'
import { Arrow } from '@/components/ui/Arrow'
import styles from './BlogIndex.module.css'

/* ============================================================
   /blog
   Every published post, newest first: its date, how long it
   takes to read, its title, its excerpt and its tags, and its
   cover where it has one. A row is one link — the title is the
   link's name, the rest of the row answers the pointer too.

   The posts are handed in already listed (cms/blog listedPosts):
   the published ones for a visitor, drafts as well (marked) in the
   admin's preview. `unavailable`: the database could not be read,
   and the page says so calmly instead of failing.
   ============================================================ */

export function BlogIndex({ posts, unavailable = false }: { posts: PostSummary[]; unavailable?: boolean }) {
  return (
    <>
      <SiteHeader current="blog" />
      <main className={styles.page}>
        <header className={styles.head}>
          <p className={styles.eyebrow}>
            <span>Notes and writing</span>
            {posts.length > 0 && <span className={styles.count}>{String(posts.length).padStart(2, '0')} {posts.length === 1 ? 'post' : 'posts'}</span>}
          </p>
          <h1 className={styles.title}>Blog</h1>
        </header>

        {unavailable ? (
          <section className={styles.empty} aria-labelledby="blog-unavailable">
            <h2 id="blog-unavailable" className={styles.emptyLabel}>The blog is unavailable right now</h2>
            <p className={styles.emptyText}>The posts could not be read just now. Please try again in a moment; the rest of the site is here as usual.</p>
            <Link href="/projects" className={styles.emptyLink} data-cursor="link">See the projects <Arrow dir="right" /></Link>
          </section>
        ) : posts.length === 0 ? (
          <section className={styles.empty} aria-labelledby="blog-empty">
            <h2 id="blog-empty" className={styles.emptyLabel}>Nothing published yet</h2>
            <p className={styles.emptyText}>Posts will appear here as they are published. In the meantime, the work is on the projects page.</p>
            <Link href="/projects" className={styles.emptyLink} data-cursor="link">See the projects <Arrow dir="right" /></Link>
          </section>
        ) : (
          <ol className={styles.list}>
            {posts.map((p) => (
              <li key={p.id}>
                <article className={styles.post} data-cover={p.cover ? true : undefined}>
                  <p className={styles.meta}>
                    <time dateTime={p.date}>{formatPostDate(p.date)}</time>
                    <span>{p.minutes} min read</span>
                    {p.status === 'draft' && <span className={styles.draft}>Draft</span>}
                  </p>
                  <div className={styles.text}>
                    <h2 className={styles.postTitle}>
                      <Link href={`/blog/${p.slug}`} className={styles.link} data-cursor="link" data-cursor-text="READ">{p.title || 'Untitled'}</Link>
                    </h2>
                    {p.excerpt && <p className={styles.excerpt}>{p.excerpt}</p>}
                    {p.tags.length > 0 && (
                      <ul className={styles.tags} aria-label="Tags">
                        {p.tags.map((t) => <li key={t}>{t}</li>)}
                      </ul>
                    )}
                  </div>
                  {p.cover && (
                    <div className={styles.cover}>
                      <img src={p.cover} alt={p.coverAlt ?? ''} loading="lazy" decoding="async" />
                    </div>
                  )}
                  <span className={styles.arrow} aria-hidden="true"><Arrow dir="right" /></span>
                </article>
              </li>
            ))}
          </ol>
        )}
      </main>
    </>
  )
}
