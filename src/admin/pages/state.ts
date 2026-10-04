'use client'

import { create } from 'zustand'
import { useSiteStore } from '../store/site'
import type { ElementNode } from '@/cms/schema'
import type { Device } from '../DraftPreview'
import type { Scope } from './ops'

/* The page editor's own UI state — what is selected, what the frame
   reported, which page and device — kept apart from the draft
   document, which lives in the site store and carries the undo
   history. */

export interface TreeNode { id: string; kind: string; label: string; bind?: string; added: boolean; anchored: boolean; locked: boolean; parent: string | null; section: string | null; text: string; count: number }
export interface PageDef { key: string; path: string; journey: 'home' | 'projects' | null; label: string }
export type Computed = Record<string, string>

export const scopeOf = (d: Device): Scope => (d === 'desktop' ? 'base' : d)
export const SCOPE_LABEL: Record<Scope, string> = { base: 'All sizes', tablet: 'Tablet and below (≤ 1024 px)', mobile: 'Mobile (≤ 640 px)' }

interface EditorState {
  page: PageDef
  device: Device
  mode: 'edit' | 'preview' | 'test'
  tree: TreeNode[]
  treePath: string | null
  selection: string[]
  hovered: string | null
  enteredGroup: string | null
  viewportSection: string | null
  computed: { id: string; style: Computed } | null
  clipboard: { nodes: ElementNode[] } | null
  panel: 'sections' | 'layers' | 'insert' | 'assets'
  set: (patch: Partial<EditorState>) => void
  select: (ids: string[]) => void
}

export const HOME: PageDef = { key: 'home', path: '/', journey: 'home', label: 'Home' }

export const useEditor = create<EditorState>((set) => ({
  page: HOME,
  device: 'desktop',
  mode: 'edit',
  tree: [],
  treePath: null,
  selection: [],
  hovered: null,
  enteredGroup: null,
  viewportSection: null,
  computed: null,
  clipboard: null,
  panel: 'layers',
  set: (patch) => set(patch),
  select: (ids) => set({ selection: [...new Set(ids)] }),
}))

/** Messages to the preview frame; set by the editor once the frame exists. */
export const frame = { post: (message: object): void => { void message } }

export const nodeById = (id: string) => useEditor.getState().tree.find((n) => n.id === id)

// Development only: lets the QA scripts read the editor's state and the draft.
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') Object.assign(window, { __pageEditor: useEditor, __siteStore: useSiteStore })
