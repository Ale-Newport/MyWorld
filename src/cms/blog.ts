import type { BlogPost } from './schema'
import { markdownToPlain } from './markdown.tsx'

/* ============================================================
   THE BLOG, AS THE PAGES ASK FOR IT

   Posts live in their own document in the database (server/blog.ts);
   these are the few questions the public pages, their metadata, the
   sitemap and the admin ask of a list of them, answered in one place
   so the index, a post's pager and the editor can never disagree
   about which posts are listed or in what order.

   Visitors are only ever handed published posts; the admin's
   preview passes drafts as well, and they are listed with them.
   ============================================================ */

/** Newest first; posts of the same day by title. Dates are YYYY-MM-DD, so they compare as text. */
const newestFirst = (a: BlogPost, b: BlogPost) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.title.localeCompare(b.title))

/** What /blog lists: published posts, newest first — drafts as well in the admin's preview. Read tolerantly. */
export function listedPosts(posts: readonly BlogPost[] | null | undefined, { preview = false }: { preview?: boolean } = {}): BlogPost[] {
  return (Array.isArray(posts) ? posts : []).filter((p) => preview || p.status === 'published').sort(newestFirst)
}

/** The post at /blog/<slug>, or null (a draft answers only in the preview). */
export function findPost(posts: readonly BlogPost[] | null | undefined, slug: string, options: { preview?: boolean } = {}): BlogPost | null {
  return listedPosts(posts, options).find((p) => p.slug === slug) ?? null
}

/** A post's neighbours in a list sorted newest first. */
export function adjacentPosts(list: readonly BlogPost[], slug: string): { newer: BlogPost | null; older: BlogPost | null } {
  const i = list.findIndex((p) => p.slug === slug)
  if (i < 0) return { newer: null, older: null }
  return { newer: list[i - 1] ?? null, older: list[i + 1] ?? null }
}

/** A post as the list shows it: everything but the body, with its reading time — so a page never carries every body. */
export interface PostSummary extends Omit<BlogPost, 'body'> { minutes: number }
export function summarisePost(post: BlogPost): PostSummary {
  const { body, ...rest } = post
  return { ...rest, minutes: readingMinutes(body) }
}

/** A neighbour in a post's pager. */
export interface PostLink { slug: string; title: string }
export const linkTo = (post: BlogPost | null): PostLink | null => (post ? { slug: post.slug, title: post.title } : null)

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** 2026-11-07 → 7 November 2026. Written out by hand, not by the runtime's locale, so server and browser agree. */
export function formatPostDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  const month = m ? MONTHS[Number(m[2]) - 1] : undefined
  return m && month ? `${Number(m[3])} ${month} ${m[1]}` : date
}

/** The words a reader reads: the body without its Markdown. */
export function postWords(body: string): number {
  return markdownToPlain(body).split(/\s+/).filter(Boolean).length
}

/** Minutes at an unhurried 225 words a minute; never less than one. */
export function readingMinutes(body: string): number {
  return Math.max(1, Math.round(postWords(body) / 225))
}

/** One or two sentences for search results and shared links: the excerpt, or the opening of the body. */
export function postDescription(post: Pick<BlogPost, 'excerpt' | 'body'>, max = 160): string {
  const excerpt = post.excerpt.trim()
  if (excerpt) return excerpt
  const opening = markdownToPlain(post.body).split('\n\n')[0]?.replace(/\s+/g, ' ').trim() ?? ''
  if (opening.length <= max) return opening
  const cut = opening.slice(0, max - 1)
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max * 0.6))}…`
}

/** A title as an address: lowercase words joined by dashes, accents dropped. */
export function postSlug(title: string): string {
  return title.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '') || 'post'
}

/** The title's slug, numbered past any other post's slug or id. `except` is the post being renamed. */
export function uniquePostSlug(posts: readonly BlogPost[], title: string, { except }: { except?: string } = {}): string {
  const base = postSlug(title)
  let slug = base
  for (let i = 2; posts.some((p) => p.id !== except && (p.slug === slug || p.id === slug)); i++) slug = `${base}-${i}`
  return slug
}
