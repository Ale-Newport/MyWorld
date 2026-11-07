import type { BlogPost } from './schema'
import { markdownToPlain } from './markdown.tsx'

/* ============================================================
   THE BLOG, AS THE PAGES ASK FOR IT

   Posts live in the site document (`doc.posts`), written in the
   admin. These are the few questions the public pages, their
   metadata and the admin ask of them, answered in one place so
   the index, a post's pager, its static params and the editor
   can never disagree about which posts exist or in what order.

   The list is read tolerantly: a document saved before the blog
   existed has none. Only published posts are public; in the
   admin's preview drafts are listed too, so a post can be read
   where it will appear before it goes live.
   ============================================================ */

type WithPosts = { posts?: readonly BlogPost[] | null } | null | undefined

/** Every post in the document, drafts included, in stored order. */
export function allPosts(doc: WithPosts): BlogPost[] {
  return Array.isArray(doc?.posts) ? [...doc.posts] : []
}

/** Newest first; posts of the same day by title. Dates are YYYY-MM-DD, so they compare as text. */
const newestFirst = (a: BlogPost, b: BlogPost) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.title.localeCompare(b.title))

/** What /blog lists: published posts, newest first — and drafts as well in the admin's preview. */
export function listedPosts(doc: WithPosts, { preview = false }: { preview?: boolean } = {}): BlogPost[] {
  return allPosts(doc).filter((p) => preview || p.status === 'published').sort(newestFirst)
}

/** The post at /blog/<slug>, or null (a draft answers only in the preview). */
export function postBySlug(doc: WithPosts, slug: string, options: { preview?: boolean } = {}): BlogPost | null {
  return listedPosts(doc, options).find((p) => p.slug === slug) ?? null
}

/** A post's neighbours in a list sorted newest first. */
export function adjacentPosts(list: BlogPost[], slug: string): { newer: BlogPost | null; older: BlogPost | null } {
  const i = list.findIndex((p) => p.slug === slug)
  if (i < 0) return { newer: null, older: null }
  return { newer: list[i - 1] ?? null, older: list[i + 1] ?? null }
}

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
