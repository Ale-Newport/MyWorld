'use client'

import { create } from 'zustand'
import { api, AdminError } from '../api'
import { toast } from '../toast'
import { listedPosts, uniquePostSlug } from '@/cms/blog'
import type { BlogPost } from '@/cms/schema'

/* ============================================================
   THE BLOG, IN THE ADMIN'S BROWSER

   The posts as the database has them now (server/blog.ts), and the
   edits made here that are not saved yet. Those edits — a new post,
   a change to an old one — live only in this browser until Save
   draft or Publish sends them, and are kept in localStorage so a
   closed tab or a reload loses nothing.

   A save carries the revision the posts were read at and the post
   as it was then, so a post changed meanwhile somewhere else is
   never overwritten without asking. What is saved is on the site
   at once: /blog is read from the database on every request.
   ============================================================ */

export interface Working {
  post: BlogPost
  /** The post as the database had it when this edit began (null: a new post). */
  original: BlogPost | null
  at: number
}

export interface Loaded {
  /** The revision of the blog these posts were read at (null before the first post). */
  revision: string | null
  posts: BlogPost[]
}

const STORAGE = 'portfolio-admin:blog-working'
const HISTORY = 100

/** Key order does not make two posts different. */
const stable = (v: unknown): unknown => (Array.isArray(v) ? v.map(stable) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable((v as Record<string, unknown>)[k])])) : v)
export const samePost = (a: BlogPost | null | undefined, b: BlogPost | null | undefined) => JSON.stringify(stable(a ?? null)) === JSON.stringify(stable(b ?? null))

/** Today on this machine, as posts store dates — not UTC, so a post written late at night keeps its day. */
export function today(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function persist(working: Record<string, Working>) {
  try { localStorage.setItem(STORAGE, JSON.stringify(working)) } catch { /* private window or full: the edit still lives in the page */ }
}
function restore(): Record<string, Working> {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE) ?? '{}') as Record<string, Working>
    // Only edits in this shape (an earlier admin kept others under the same key).
    return Object.fromEntries(Object.entries(raw && typeof raw === 'object' ? raw : {}).filter(([, w]) => w && typeof w === 'object' && w.post && 'original' in w))
  } catch {
    return {}
  }
}

interface BlogStore {
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string | null
  data: Loaded | null
  working: Record<string, Working>
  past: Record<string, BlogPost[]>
  future: Record<string, BlogPost[]>
  lastCoalesce: { key: string; at: number } | null
  /** What is being saved, in words, or null. */
  busy: string | null
  /** A save refused because the post changed elsewhere meanwhile. */
  conflict: { id: string; message: string } | null
  load: (force?: boolean) => Promise<void>
  create: () => string
  edit: (id: string, mutate: (p: BlogPost) => void, coalesce?: string) => void
  undo: (id: string) => void
  redo: (id: string) => void
  discard: (id: string) => void
  commit: (id: string, status: BlogPost['status'], opts?: { overwrite?: boolean }) => Promise<boolean>
  remove: (id: string) => Promise<boolean>
}

/** The post as the database has it. */
export const savedPost = (data: Loaded | null, id: string) => data?.posts.find((p) => p.id === id) ?? null

/** The database's posts with this browser's edits laid over them, new posts included. */
export function mergedPosts(data: Loaded | null, working: Record<string, Working>): BlogPost[] {
  const saved = data?.posts ?? []
  const merged = saved.map((p) => working[p.id]?.post ?? p)
  for (const w of Object.values(working)) if (!saved.some((p) => p.id === w.post.id) && !w.original) merged.push(w.post)
  return merged
}

/** Newest first, drafts included, as the admin's preview of /blog lists them. */
export const sortedPosts = (posts: BlogPost[]) => listedPosts(posts, { preview: true })

export const useBlogStore = create<BlogStore>((set, get) => ({
  status: 'idle',
  error: null,
  data: null,
  working: {},
  past: {},
  future: {},
  lastCoalesce: null,
  busy: null,
  conflict: null,

  async load(force = false) {
    if (!force && (get().status === 'loading' || get().status === 'ready')) return
    const first = !get().data
    if (first) set({ status: 'loading', error: null })
    try {
      const data = await api<Loaded>('/api/admin/blog')
      // The browser's unsaved edits come back with the page (on the first load; later loads keep the live ones).
      set({ status: 'ready', error: null, data, working: first ? { ...restore(), ...get().working } : get().working })
    } catch (error) {
      set({ status: first ? 'error' : 'ready', error: (error as Error).message })
      if (!first) toast((error as Error).message, 'danger')
    }
  },

  create() {
    const { data, working } = get()
    const slug = uniquePostSlug(mergedPosts(data, working), 'Untitled post')
    const post: BlogPost = { id: slug, slug, title: 'Untitled post', excerpt: '', body: '', date: today(), tags: [], status: 'draft' }
    const next = { ...working, [slug]: { post, original: null, at: Date.now() } }
    persist(next)
    set({ working: next })
    return slug
  },

  edit(id, mutate, coalesce) {
    const { data, working, past, lastCoalesce } = get()
    const current = working[id]?.post ?? savedPost(data, id)
    if (!current) return
    const post = structuredClone(current)
    mutate(post)
    const now = Date.now()
    const merge = !!coalesce && lastCoalesce?.key === `${id}:${coalesce}` && now - lastCoalesce.at < 900
    const next = { ...working, [id]: { post, original: working[id] ? working[id].original : savedPost(data, id), at: now } }
    persist(next)
    set({
      working: next,
      past: merge ? past : { ...past, [id]: [...(past[id] ?? []), current].slice(-HISTORY) },
      future: { ...get().future, [id]: [] },
      lastCoalesce: coalesce ? { key: `${id}:${coalesce}`, at: now } : null,
    })
  },

  undo(id) {
    const { past, future, working, data } = get()
    const stack = past[id] ?? []
    const current = working[id]?.post ?? savedPost(data, id)
    if (!stack.length || !current) return
    const next = { ...working, [id]: { post: stack[stack.length - 1], original: working[id]?.original ?? savedPost(data, id), at: Date.now() } }
    persist(next)
    set({ working: next, past: { ...past, [id]: stack.slice(0, -1) }, future: { ...future, [id]: [current, ...(future[id] ?? [])] }, lastCoalesce: null })
  },

  redo(id) {
    const { past, future, working, data } = get()
    const stack = future[id] ?? []
    const current = working[id]?.post ?? savedPost(data, id)
    if (!stack.length || !current) return
    const next = { ...working, [id]: { post: stack[0], original: working[id]?.original ?? savedPost(data, id), at: Date.now() } }
    persist(next)
    set({ working: next, future: { ...future, [id]: stack.slice(1) }, past: { ...past, [id]: [...(past[id] ?? []), current] }, lastCoalesce: null })
  },

  discard(id) {
    const working = { ...get().working }
    delete working[id]
    persist(working)
    set({ working, past: { ...get().past, [id]: [] }, future: { ...get().future, [id]: [] }, conflict: null })
  },

  async commit(id, status, opts = {}) {
    const { data, working } = get()
    const saved = savedPost(data, id)
    const w = working[id]
    const source = w?.post ?? saved
    if (!data || !source) return false
    const post = { ...source, status }
    const others = mergedPosts(data, working).filter((p) => p.id !== id)
    const problem =
      !post.title.trim() ? 'Give the post a title first.'
      : !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(post.slug) ? 'The address (Details › Slug) must be lowercase words joined by dashes.'
      : others.some((p) => p.slug === post.slug) ? 'Another post already uses this address (Details › Slug).'
      : null
    if (problem) { toast(problem, 'danger'); return false }
    const verb = status === 'published' ? (saved?.status === 'published' ? 'Saving the changes' : 'Publishing') : saved?.status === 'published' ? 'Unpublishing' : 'Saving the draft'
    set({ busy: `${verb}…`, conflict: null })
    try {
      const result = await api<Loaded>('/api/admin/blog', { json: { type: 'save', post, original: w ? w.original : saved, base: data.revision, force: !!opts.overwrite } })
      const rest = { ...get().working }
      delete rest[id]
      persist(rest)
      set({ data: result, working: rest, past: { ...get().past, [id]: [] }, future: { ...get().future, [id]: [] } })
      toast(status === 'published' ? 'Published — it is on /blog now' : saved?.status === 'published' ? 'Unpublished — it has left /blog' : 'Draft saved — only the admin sees it', 'ok')
      return true
    } catch (error) {
      if (error instanceof AdminError && error.status === 409) set({ conflict: { id, message: error.message } })
      else toast((error as Error).message, 'danger')
      return false
    } finally {
      set({ busy: null })
    }
  },

  async remove(id) {
    const { data } = get()
    const saved = savedPost(data, id)
    if (!saved) { get().discard(id); return true }
    set({ busy: 'Deleting…', conflict: null })
    try {
      const result = await api<Loaded>('/api/admin/blog', { json: { type: 'delete', id, original: saved, base: data!.revision } })
      const rest = { ...get().working }
      delete rest[id]
      persist(rest)
      set({ data: result, working: rest })
      toast(saved.status === 'published' ? 'Deleted — it has left /blog' : 'Draft deleted', 'ok')
      return true
    } catch (error) {
      if (error instanceof AdminError && error.status === 409) set({ conflict: { id, message: error.message } })
      else toast((error as Error).message, 'danger')
      return false
    } finally {
      set({ busy: null })
    }
  },
}))
