'use client'

import { useEffect, useState, type CSSProperties } from 'react'
import { SiteContentProvider } from '@/cms/context'
import { adjacentPosts, linkTo, listedPosts, summarisePost } from '@/cms/blog'
import type { BlogPost, SiteDocument } from '@/cms/schema'
import { BlogIndex } from '@/components/blog/BlogIndex'
import { PostMissing, PostPage } from '@/components/blog/PostPage'

/* ============================================================
   THE PUBLIC BLOG, INSIDE THE ADMIN'S PREVIEW FRAME

   /blog shows only what is published. The admin's preview frame
   loads this instead: the very components /blog and /blog/<slug>
   render (and so the same Markdown renderer), given the posts the
   editor beside it posts on every change — the database's posts
   with this browser's unsaved edits, drafts included. The page's
   chrome (header, typeface) is the site's own document.

   It sits under /admin (signed in, never indexed, framed only by
   the admin), whose stylesheet sets its own type on everything; the
   wrapper gives the page back the site's. A click on a link does
   nothing here: the frame shows the post being written, not the site.
   ============================================================ */

const SITE_TYPE: CSSProperties = {
  minHeight: '100%',
  fontFamily: 'var(--font-display)',
  fontSize: 'var(--fs-body)',
  lineHeight: 'var(--lh-body)',
  color: 'var(--text-primary)',
  background: 'var(--bg-primary)',
  fontSynthesisWeight: 'none',
  WebkitFontSmoothing: 'antialiased',
  textRendering: 'optimizeLegibility',
}

export function BlogPreviewPage({ doc, slug }: { doc: SiteDocument; slug: string | null }) {
  const [posts, setPosts] = useState<BlogPost[] | null>(null)

  useEffect(() => {
    if (window.parent === window) return
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== window.parent) return
      const data = event.data as { type?: string; posts?: BlogPost[] }
      if (data?.type === 'blog:posts' && Array.isArray(data.posts)) setPosts(data.posts)
    }
    window.addEventListener('message', onMessage)
    window.parent.postMessage({ type: 'blog:preview-ready' }, window.location.origin)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  const list = listedPosts(posts, { preview: true })
  const post = slug ? list.find((p) => p.slug === slug) ?? null : null
  const around = post ? adjacentPosts(list, post.slug) : null
  return (
    <div style={SITE_TYPE} onClickCapture={(e) => { if ((e.target as Element).closest('a')) e.preventDefault() }}>
      {/* `editing`: the admin's frame (no custom cursor, no tracking). */}
      <SiteContentProvider doc={doc} editing>
        {posts === null ? null
          : !slug ? <BlogIndex posts={list.map(summarisePost)} />
          : post ? <PostPage post={post} newer={linkTo(around!.newer)} older={linkTo(around!.older)} />
          : <PostMissing slug={slug} />}
      </SiteContentProvider>
    </div>
  )
}
