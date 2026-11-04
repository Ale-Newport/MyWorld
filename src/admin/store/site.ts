'use client'

import { create } from 'zustand'
import type { SiteDocument } from '@/cms/schema'
import type { Head } from '@/server/revisions'
import { api, AdminError } from '../api'
import { toast } from '../toast'
import { announceGit } from '../git'
import type { GitResult } from '@/server/git-publish'

/* ============================================================
   THE DRAFT, IN THE BROWSER

   One store for the site document across every admin section —
   page editor, projects, library, settings — so an edit in one is
   part of the same draft as an edit in another. Every change goes
   through apply(), which keeps an undo history (typing into one
   field coalesces into one step). save() writes a draft revision
   on top of the revision this copy was loaded from; if another tab
   or session saved first, the server refuses and the conflict is
   offered to the user instead of being overwritten.
   ============================================================ */

type Mutator = (doc: SiteDocument) => void

interface Conflict { head: Head; message: string }

interface SiteStore {
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string | null
  doc: SiteDocument | null
  base: string | null
  head: Head | null
  published: SiteDocument | null
  /** The deployed admin: no drafts, only the settings, published as a commit on GitHub. */
  live: { canPublish: boolean } | null
  version: number
  savedVersion: number
  past: SiteDocument[]
  future: SiteDocument[]
  lastCoalesce: { key: string; at: number } | null
  saving: boolean
  publishing: boolean
  conflict: Conflict | null
  load: (force?: boolean) => Promise<void>
  apply: (mutate: Mutator, opts?: { coalesce?: string }) => void
  undo: () => void
  redo: () => void
  save: (message?: string, opts?: { force?: boolean }) => Promise<boolean>
  publish: () => Promise<boolean>
  dismissConflict: () => void
}

const HISTORY = 120

export const useSiteStore = create<SiteStore>((set, get) => ({
  status: 'idle',
  error: null,
  doc: null,
  base: null,
  head: null,
  published: null,
  live: null,
  version: 0,
  savedVersion: 0,
  past: [],
  future: [],
  lastCoalesce: null,
  saving: false,
  publishing: false,
  conflict: null,

  async load(force = false) {
    if (!force && (get().status === 'loading' || get().status === 'ready')) return
    set({ status: 'loading', error: null })
    try {
      const data = await api<{ doc: SiteDocument; head: Head; published: { revision: string; doc: SiteDocument } | null; live?: { canPublish: boolean } }>('/api/admin/site')
      set({ status: 'ready', doc: data.doc, base: data.head.draft?.id ?? null, head: data.head, published: data.published?.doc ?? null, live: data.live ?? null, version: 0, savedVersion: 0, past: [], future: [], conflict: null })
    } catch (error) {
      set({ status: 'error', error: (error as Error).message })
    }
  },

  apply(mutate, opts = {}) {
    const { doc, past, version, lastCoalesce } = get()
    if (!doc) return
    const next = structuredClone(doc)
    mutate(next)
    const now = Date.now()
    const merge = !!opts.coalesce && lastCoalesce?.key === opts.coalesce && now - lastCoalesce.at < 900
    set({
      doc: next,
      past: merge ? past : [...past, doc].slice(-HISTORY),
      future: [],
      version: version + 1,
      lastCoalesce: opts.coalesce ? { key: opts.coalesce, at: now } : null,
    })
  },

  undo() {
    const { past, doc, future, version } = get()
    if (!past.length || !doc) return
    set({ doc: past[past.length - 1], past: past.slice(0, -1), future: [doc, ...future].slice(0, HISTORY), version: version + 1, lastCoalesce: null })
  },

  redo() {
    const { past, doc, future, version } = get()
    if (!future.length || !doc) return
    set({ doc: future[0], future: future.slice(1), past: [...past, doc].slice(-HISTORY), version: version + 1, lastCoalesce: null })
  },

  async save(message, opts = {}) {
    const { doc, base, version, live } = get()
    if (!doc || live) return false
    set({ saving: true })
    try {
      const { revision } = await api<{ revision: { id: string } }>('/api/admin/site/draft', { method: 'PUT', json: { base, doc, message, force: opts.force } })
      const head = await api<{ head: Head }>('/api/admin/site/revisions').then((r) => r.head).catch(() => get().head)
      set({ base: revision.id, savedVersion: version, saving: false, conflict: null, head })
      toast('Draft saved', 'ok')
      return true
    } catch (error) {
      set({ saving: false })
      if (error instanceof AdminError && error.status === 409) {
        set({ conflict: { head: error.data.head as Head, message: error.message } })
        return false
      }
      toast((error as Error).message, 'danger')
      return false
    }
  },

  async publish() {
    const s = get()
    if (s.live) {
      // The deployed admin has no draft: the settings go straight into a commit.
      set({ publishing: true })
      try {
        await api('/api/admin/site/publish', { method: 'POST', json: { doc: { settings: s.doc?.settings } } })
        set({ savedVersion: s.version })
        toast('Published — the website updates in a minute or two', 'ok')
        return true
      } catch (error) {
        toast((error as Error).message, 'danger')
        return false
      } finally {
        set({ publishing: false })
      }
    }
    if (s.version !== s.savedVersion && !(await s.save('Saved before publishing'))) return false
    set({ publishing: true })
    try {
      const { git } = await api<{ git?: GitResult }>('/api/admin/site/publish', { method: 'POST', json: {} })
      await get().load(true)
      announceGit('the site', git)
      return true
    } catch (error) {
      toast((error as Error).message, 'danger')
      return false
    } finally {
      set({ publishing: false })
    }
  },

  dismissConflict: () => set({ conflict: null }),
}))

export const useDirty = () => useSiteStore((s) => s.version !== s.savedVersion)
export const useUnpublished = () => useSiteStore((s) => !!s.head && s.head.draft?.id !== s.head.published?.id)
