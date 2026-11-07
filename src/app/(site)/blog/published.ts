import { cache } from 'react'
import { publishedPosts } from '@/server/blog'
import type { BlogPost } from '@/cms/schema'

/* The published posts for one request (the metadata and the page share
   the read), and whether the database answered at all: if it did not,
   the blog says it is unavailable instead of failing the page. */
export const readPublished = cache(async (): Promise<{ ok: boolean; posts: BlogPost[] }> => {
  try {
    return { ok: true, posts: await publishedPosts() }
  } catch (error) {
    console.error('[blog] the published posts could not be read', error)
    return { ok: false, posts: [] }
  }
})
