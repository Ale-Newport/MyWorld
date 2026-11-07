'use client'

import Link from 'next/link'
import { useMemo } from 'react'
import { useEditing, useSite } from '@/cms/context'
import { adjacentPosts, formatPostDate, listedPosts, readingMinutes } from '@/cms/blog'
import { renderMarkdown } from '@/cms/markdown'
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

   The admin's preview shows the editor's live document here, so
   a draft (or a post whose address was just changed) reads as it
   will before it is published.
   ============================================================ */

export function PostPage({ slug }: { slug: string }) {
  const { doc } = useSite()
  const editing = useEditing()
  const posts = useMemo(() => listedPosts(doc, { preview: editing }), [doc, editing])
  const post = posts.find((p) => p.slug === slug) ?? null
  const body = useMemo(() => (post ? renderMarkdown(post.body) : null), [post])

  if (!post) {
    return editing ? (
      <>
        <SiteHeader current="blog" />
        <main className={styles.page}><p className={styles.missing}>No post in this draft answers to “{slug}”.</p></main>
      </>
    ) : null
  }

  const { newer, older } = adjacentPosts(posts, post.slug)
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
