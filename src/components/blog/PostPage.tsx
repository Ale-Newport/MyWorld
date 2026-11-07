'use client'

import Link from 'next/link'
import { useMemo } from 'react'
import { formatPostDate, readingMinutes, type PostLink } from '@/cms/blog'
import { renderMarkdown } from '@/cms/markdown'
import type { BlogPost } from '@/cms/schema'
import { SiteHeader } from '@/components/site/SiteHeader'
import { Arrow } from '@/components/ui/Arrow'
import styles from './PostPage.module.css'

/* ============================================================
   ONE POST
   Its title in the site's display type, the date and the time it
   takes to read in the mono labels, its cover, and the body —
   Markdown rendered by cms/markdown as React elements, never as
   HTML — set to a reading measure. Then the posts on either side
   of it in time, and the way back to the list.

   The post and its neighbours are handed in: by the page, from the
   published posts in the database; by the admin's preview, from
   the post being written (a draft says so here).
   ============================================================ */

export function PostPage({ post, newer, older }: { post: BlogPost; newer: PostLink | null; older: PostLink | null }) {
  const body = useMemo(() => renderMarkdown(post.body), [post.body])
  const minutes = readingMinutes(post.body)
  return (
    <>
      <SiteHeader current="blog" />
      <main className={styles.page}>
        <article className={styles.article}>
          <header className={styles.head}>
            <Link href="/blog" className={styles.back} data-cursor="link"><Arrow dir="left" /> All posts</Link>
            <h1 className={styles.title}>{post.title || 'Untitled'}</h1>
            {post.excerpt && <p className={styles.excerpt}>{post.excerpt}</p>}
          </header>

          <div className={styles.body}>
            <aside className={styles.aside}>
              <dl className={styles.facts}>
                <div><dt>Published</dt><dd><time dateTime={post.date}>{formatPostDate(post.date)}</time></dd></div>
                <div><dt>Reading</dt><dd>{minutes} min</dd></div>
                {post.status === 'draft' && <div><dt>Status</dt><dd className={styles.draft}>Draft · not on the site</dd></div>}
              </dl>
              {post.tags.length > 0 && (
                <ul className={styles.tags} aria-label="Tags">
                  {post.tags.map((t) => <li key={t}>{t}</li>)}
                </ul>
              )}
            </aside>

            <div className={styles.main}>
              {post.cover && (
                <figure className={styles.cover}>
                  <img src={post.cover} alt={post.coverAlt ?? ''} decoding="async" fetchPriority="high" />
                </figure>
              )}
              <div className={styles.prose}>{body}</div>
            </div>
          </div>
        </article>

        <nav className={styles.pager} aria-label="More posts">
          {older ? (
            <Link href={`/blog/${older.slug}`} className={styles.step} data-cursor="link">
              <span className={styles.stepLabel}><Arrow dir="left" /> Previous</span>
              <span className={styles.stepTitle}>{older.title}</span>
            </Link>
          ) : <span />}
          <Link href="/blog" className={styles.all} data-cursor="link">All posts</Link>
          {newer ? (
            <Link href={`/blog/${newer.slug}`} className={styles.step} data-next data-cursor="link">
              <span className={styles.stepLabel}>Next <Arrow dir="right" /></span>
              <span className={styles.stepTitle}>{newer.title}</span>
            </Link>
          ) : <span />}
        </nav>
      </main>
    </>
  )
}

/** The admin's preview, asked for an address no post has (yet): the page's frame, and why it is empty. */
export function PostMissing({ slug }: { slug: string }) {
  return (
    <>
      <SiteHeader current="blog" />
      <main className={styles.page}><p className={styles.missing}>No post answers to “{slug}” yet.</p></main>
    </>
  )
}
