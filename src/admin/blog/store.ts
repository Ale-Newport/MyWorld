'use client'

import { create } from 'zustand'
import { api, AdminError } from '../api'
import { toast } from '../toast'
import { listedPosts, uniquePostSlug } from '@/cms/blog'
import type { BlogPost, SiteDocument } from '@/cms/schema'

/* ============================================================
   THE BLOG, IN THE DEPLOYED ADMIN'S BROWSER

   What GitHub has now (the posts the next build will show), what
   this deploy was built with (what visitors see now), and the
   edits made here that are not committed yet. Those edits — a new
   post, a change to an old one — live only in this browser until
   Save draft or Publish commits them, and are kept in localStorage
   so a closed tab or a reload loses nothing.

   Each commit sends the post together with the version it was
   started from, so a post changed meanwhile somewhere else is
   never overwritten without asking.
   ============================================================ */

export interface Working {
  post: BlogPost
  /** The post as it was on GitHub when this edit began (null: a new post). */
  base: BlogPost | null
  at: number
}

export interface Loaded {
  configured: boolean
  repo: string | null
  branch: string | null
  /** Where `doc` came from: GitHub's branch head, or (without settings, or offline) this deploy. */
  source: 'github' | 'deploy'
  doc: SiteDocument
  sha: string | null
  /** The posts this deploy was built with. */
  deployed: BlogPost[]
  error: string | null
}

/** Where a post stands between this browser, GitHub and the live site. */
export type LiveState = 'live' | 'pending' | 'leaving' | 'draft' | 'new'

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
    return raw && typeof raw === 'object' ? raw : {}
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
  /** What is being committed, in words, or null. */
  busy: string | null
  /** A commit refused because the post changed on GitHub meanwhile. */
  conflict: { id: string; message: string } | null
  /** Pictures uploaded in this session, by their site address: shown from memory until the site has rebuilt. */
  previews: Record<string, string>
  load: (force?: boolean) => Promise<void>
  create: () => string
  edit: (id: string, mutate: (p: BlogPost) => void, coalesce?: string) => void
  undo: (id: string) => void
  redo: (id: string) => void
  discard: (id: string) => void
  commit: (id: string, status: BlogPost['status'], opts?: { overwrite?: boolean }) => Promise<boolean>
  remove: (id: string) => Promise<boolean>
  rememberPreview: (url: string, file: Blob) => void
}

/** The post as GitHub has it (or the deploy, when GitHub could not be read). */
export const savedPost = (data: Loaded | null, id: string) => data?.doc.posts?.find((p) => p.id === id) ?? null
export const deployedPost = (data: Loaded | null, id: string) => data?.deployed.find((p) => p.id === id) ?? null

/** GitHub's posts with this browser's edits laid over them, new posts included. */
export function mergedPosts(data: Loaded | null, working: Record<string, Working>): BlogPost[] {
  const saved = data?.doc.posts ?? []
  const merged = saved.map((p) => working[p.id]?.post ?? p)
  for (const w of Object.values(working)) if (!saved.some((p) => p.id === w.post.id) && !w.base) merged.push(w.post)
  return merged
}

export function liveState(data: Loaded | null, id: string): LiveState {
  const saved = savedPost(data, id)
  const deployed = deployedPost(data, id)
  if (!saved) return deployed?.status === 'published' ? 'leaving' : 'new'
  if (saved.status === 'published') return samePost(saved, deployed) ? 'live' : 'pending'
  return deployed?.status === 'published' ? 'leaving' : 'draft'
}

/** Posts deleted on GitHub that visitors still see until the rebuild. */
export const leavingPosts = (data: Loaded | null) => (data?.deployed ?? []).filter((d) => d.status === 'published' && !savedPost(data, d.id))

/** How many commits the live site has not caught up with. */
export function pendingCount(data: Loaded | null): number {
  if (!data || data.source !== 'github') return 0
  const states = (data.doc.posts ?? []).map((p) => liveState(data, p.id))
  return states.filter((s) => s === 'pending' || s === 'leaving').length + leavingPosts(data).length
}

/** Pictures in posts are read back from GitHub (through the admin) until the site has rebuilt with them. */
export const UPLOAD = /\/uploads\/blog\/([a-f0-9]{20}\.(?:webp|png|jpg|gif|avif))/g
export const throughAdmin = (text: string) => text.replace(UPLOAD, (_m, name: string) => `/api/admin/blog/image?name=${name}`)

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
  previews: {},

  async load(force = false) {
    if (!force && (get().status === 'loading' || get().status === 'ready')) return
    set({ status: get().data ? get().status : 'loading', error: null })
    try {
      const data = await api<Loaded>('/api/admin/blog')
      // The browser's unsaved edits come back with the page (first load only: later ones keep the live state).
      const working = get().status === 'ready' ? get().working : { ...restore(), ...get().working }
      set({ status: 'ready', data, working })
    } catch (error) {
      set({ status: get().data ? 'ready' : 'error', error: (error as Error).message })
    }
  },

  create() {
    const { data, working } = get()
    const posts = mergedPosts(data, working)
    const slug = uniquePostSlug(posts, 'Untitled post')
    const post: BlogPost = { id: slug, slug, title: 'Untitled post', excerpt: '', body: '', date: today(), tags: [], status: 'draft' }
    const next = { ...working, [slug]: { post, base: null, at: Date.now() } }
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
    const next = { ...working, [id]: { post, base: working[id] ? working[id].base : savedPost(data, id), at: now } }
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
    const post = stack[stack.length - 1]
    const next = { ...working, [id]: { post, base: working[id]?.base ?? savedPost(data, id), at: Date.now() } }
    persist(next)
    set({ working: next, past: { ...past, [id]: stack.slice(0, -1) }, future: { ...future, [id]: [current, ...(future[id] ?? [])] }, lastCoalesce: null })
  },

  redo(id) {
    const { past, future, working, data } = get()
    const stack = future[id] ?? []
    const current = working[id]?.post ?? savedPost(data, id)
    if (!stack.length || !current) return
    const next = { ...working, [id]: { post: stack[0], base: working[id]?.base ?? savedPost(data, id), at: Date.now() } }
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
    // Overwriting: against the version GitHub has now, so the refusal is not met again.
    if (opts.overwrite) await get().load(true)
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
    const base = opts.overwrite ? saved : w ? w.base : saved
    const verb = status === 'published' ? (saved?.status === 'published' ? 'Publishing the changes' : 'Publishing') : saved?.status === 'published' ? 'Unpublishing' : 'Saving the draft'
    set({ busy: `${verb}…`, conflict: null })
    try {
      const result = await api<{ commit: string; url: string; doc: SiteDocument }>('/api/admin/blog', { json: { type: 'save', post, base } })
      const rest = { ...get().working }
      delete rest[id]
      persist(rest)
      set({ data: { ...data, doc: result.doc, source: 'github' }, working: rest, past: { ...get().past, [id]: [] }, future: { ...get().future, [id]: [] } })
      toast(status === 'published' ? 'Committed — the live site shows it in a minute or two' : saved?.status === 'published' ? 'Unpublished — it leaves the live site in a minute or two' : 'Draft saved on GitHub', 'ok')
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
    const { data, working } = get()
    const saved = savedPost(data, id)
    if (!saved) { get().discard(id); return true }
    set({ busy: 'Deleting…', conflict: null })
    try {
      const result = await api<{ doc: SiteDocument }>('/api/admin/blog', { json: { type: 'delete', id, base: saved } })
      const rest = { ...working }
      delete rest[id]
      persist(rest)
      set({ data: { ...data!, doc: result.doc, source: 'github' }, working: rest })
      toast(saved.status === 'published' ? 'Deleted — it leaves the live site in a minute or two' : 'Draft deleted', 'ok')
      return true
    } catch (error) {
      if (error instanceof AdminError && error.status === 409) set({ conflict: { id, message: error.message } })
      else toast((error as Error).message, 'danger')
      return false
    } finally {
      set({ busy: null })
    }
  },

  rememberPreview(url, file) {
    set({ previews: { ...get().previews, [url]: URL.createObjectURL(file) } })
  },
}))

/** The document the preview renders: GitHub's, with this browser's edits, every post listed (drafts too) and pictures read through the admin. */
export function previewDocument(data: Loaded | null, working: Record<string, Working>): SiteDocument | null {
  if (!data) return null
  const posts = mergedPosts(data, working).map((p) => ({ ...p, body: throughAdmin(p.body), ...(p.cover ? { cover: throughAdmin(p.cover) } : {}) }))
  return { ...data.doc, posts }
}

/** Newest first, as /blog lists them. */
export const sortedPosts = (posts: BlogPost[]) => listedPosts({ posts }, { preview: true })
