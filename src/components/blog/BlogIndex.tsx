'use client'

import Link from 'next/link'
import { useMemo } from 'react'
import { useEditing, useSite } from '@/cms/context'
import { formatPostDate, listedPosts, readingMinutes } from '@/cms/blog'
import { SiteHeader } from '@/components/site/SiteHeader'
import { Arrow } from '@/components/ui/Arrow'
import styles from './BlogIndex.module.css'

/* ============================================================
   /blog
   Every published post, newest first: its date, how long it
   takes to read, its title, its excerpt and its tags, and its
   cover where it has one. A row is one link — the title is the
   link's name, the rest of the row answers the pointer too.

   Read from the document the layout hands down, so in the
   admin's preview a draft appears here (marked) while it is
   being written; nothing else ever sees one.
   ============================================================ */

export function BlogIndex() {
  const { doc } = useSite()
  const editing = useEditing()
  const posts = useMemo(() => listedPosts(doc, { preview: editing }).map((p) => ({ ...p, minutes: readingMinutes(p.body) })), [doc, editing])

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

        {posts.length === 0 ? (
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
