'use client'

import type { CSSProperties } from 'react'
import { SiteContentProvider } from '@/cms/context'
import type { SiteDocument } from '@/cms/schema'
import { BlogIndex } from '@/components/blog/BlogIndex'
import { PostPage } from '@/components/blog/PostPage'

/* ============================================================
   THE PUBLIC BLOG, INSIDE THE ADMIN'S PREVIEW FRAME

   The deployed site's pages are prerendered, so they cannot show a
   draft. The admin's preview frame loads this instead: the very
   components /blog and /blog/<slug> render (and so the same Markdown
   renderer), given the document the editor beside it posts on every
   change — GitHub's file with this browser's unsaved edits.

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
  return (
    <div style={SITE_TYPE} onClickCapture={(e) => { if ((e.target as Element).closest('a')) e.preventDefault() }}>
      {/* `editing`: drafts are shown, and the document posted by the admin around this frame replaces the deploy's. */}
      <SiteContentProvider doc={doc} editing>
        {slug ? <PostPage slug={slug} /> : <BlogIndex />}
      </SiteContentProvider>
    </div>
  )
}
