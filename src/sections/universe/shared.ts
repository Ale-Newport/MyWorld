import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type FocusEvent as ReactFocusEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { subscribe } from '@/lib/ticker'
import { categoryAccent } from '@/content/project-meta'
import type { SiteProject } from '../types'

/* ============================================================
   WHAT THE FIVE UNIVERSE OPTIONS SHARE

   Small on purpose: the options are different drawings of the
   same archive, so what they share is the archive's vocabulary
   (tier, category, the accessible name), the three rules of the
   slot (measure with a ResizeObserver, tick only while active,
   report hover and focus) and the one screenshot helper.
   ============================================================ */

export type Tier = 0 | 1 | 2
export const tierOf = (p: SiteProject): Tier => (p.importance === 'hero' ? 0 : p.importance === 'featured' ? 1 : 2)
export const TIER_NAME = ['Headline', 'Featured', 'Archive'] as const

export const CATEGORY_LABEL: Record<SiteProject['category'], string> = {
  'ai-ml': 'AI / ML',
  software: 'Software',
  web: 'Web',
  mobile: 'Mobile',
  '3d': '3D',
  data: 'Data',
  university: 'University',
  experiment: 'Experiment',
  'client-work': 'Client work',
}
/** Category order, for grouping: the order the palette is written in. */
export const CATEGORY_ORDER = Object.keys(categoryAccent) as SiteProject['category'][]

/** The category's colour: the archive's narrow palette, never a client's brand. */
export const toneOf = (p: SiteProject) => categoryAccent[p.category] ?? '#8b816f'
/** The project's own accent where it has one (its brand), else its category's. */
export const accentOf = (p: SiteProject) => p.accent ?? toneOf(p)
/**
 * The accessible name of a project's button: title, then category
 * and year. When the drawing prints a short title the name carries
 * it too, so what is seen is also what a voice user can say.
 */
export const labelOf = (p: SiteProject, shown?: string) => {
  const name = shown && !p.title.toLowerCase().includes(shown.toLowerCase()) ? `${p.title} (${shown})` : p.title
  return `${name} — ${CATEGORY_LABEL[p.category] ?? p.category}, ${p.year}`
}
export const metaOf = (p: SiteProject) => `${CATEGORY_LABEL[p.category] ?? p.category} · ${p.year}`

/** Rough advance of a line of type, for fitting labels without reading layout. */
export const textWidth = (s: string, px: number, mono = false, tracking = 0) => s.length * px * ((mono ? 0.6 : 0.54) + tracking)
/** The title if it fits `max` px at `px` size, else the short title, else the title (CSS truncates it). */
export const fitTitle = (p: SiteProject, max: number, px: number, mono = false, tracking = 0) =>
  textWidth(p.title, px, mono, tracking) <= max || !p.shortTitle ? p.title : p.shortTitle

/** Projects grouped by tier, each tier in category order (display order within a category). */
export function byTierAndCategory(projects: SiteProject[]): SiteProject[][] {
  const tiers: SiteProject[][] = [[], [], []]
  for (const p of projects) tiers[tierOf(p)].push(p)
  const rank = (p: SiteProject) => {
    const i = CATEGORY_ORDER.indexOf(p.category)
    return i < 0 ? CATEGORY_ORDER.length : i
  }
  return tiers.map((list) => list.map((p, i) => ({ p, i })).sort((a, b) => rank(a.p) - rank(b.p) || a.i - b.i).map((x) => x.p))
}

/* ---- math ---------------------------------------------------- */

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
export const smooth = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a || 1e-6))
  return t * t * (3 - 2 * t)
}
export const easeOut = (t: number) => 1 - Math.pow(1 - clamp01(t), 3)
/** Frame-rate independent approach of `a` to `b`. */
export const approach = (a: number, b: number, rate: number, dt: number) => a + (b - a) * (1 - Math.exp(-rate * dt))
/** A stable pseudo-random 0..1 from a string (a project's id), so layouts never reshuffle between visits. */
export function hash01(s: string, salt = 0) {
  let h = 2166136261 ^ salt
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  h = Math.imul(h ^ (h >>> 15), 2246822507)
  h = Math.imul(h ^ (h >>> 13), 3266489909)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/* ---- the slot's rules, as hooks -------------------------------- */

/** The box's size from a ResizeObserver, in whole pixels so sub-pixel jitter never re-renders. */
export function useBoxSize(ref: RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width)
      const h = Math.round(entry.contentRect.height)
      setSize((s) => (s.w === w && s.h === h ? s : { w, h }))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return size
}

/** Calls the latest `fn` on the shared ticker while `on` is true; never a loop of its own. */
export function useTicker(on: boolean, fn: (dt: number, now: number) => void) {
  const latest = useRef(fn)
  useEffect(() => {
    latest.current = fn
  })
  useEffect(() => {
    if (!on) return
    return subscribe((dt, now) => latest.current(dt, now))
  }, [on])
}

const FINE = '(hover: hover) and (pointer: fine)'
const onMediaChange = (cb: () => void) => {
  const mq = window.matchMedia(FINE)
  mq.addEventListener('change', cb)
  return () => mq.removeEventListener('change', cb)
}
/** True on a mouse or trackpad: pointer parallax and magnetism are for those only. */
export const useFinePointer = () => useSyncExternalStore(onMediaChange, () => window.matchMedia(FINE).matches, () => false)

/**
 * Hover and focus, reported as one "hot" project. The pointer wins
 * while it is over an item; when it leaves, a focused item takes
 * the readout back. Touch never hovers: a tap opens the project.
 */
export function useHot(onHover: (slug: string | null) => void) {
  const state = useRef<{ pointer: string | null; focus: string | null; keys: boolean; last: string | null; lastKeys: boolean }>({
    pointer: null,
    focus: null,
    keys: false,
    last: null,
    lastKeys: false,
  })
  const [hot, setHot] = useState<{ slug: string | null; keys: boolean }>({ slug: null, keys: false })
  const report = useCallback(() => {
    const s = state.current
    const next = s.pointer ?? s.focus
    // Whether the hot project came by keyboard (focus-visible, nothing pointed at): an option may bring it into view.
    const keys = !s.pointer && !!s.focus && s.keys
    if (next === s.last && keys === s.lastKeys) return
    if (next !== s.last) onHover(next)
    s.last = next
    s.lastKeys = keys
    setHot({ slug: next, keys })
  }, [onHover])
  const bind = useCallback(
    (slug: string) => ({
      onPointerEnter: (e: ReactPointerEvent) => {
        if (e.pointerType === 'touch') return
        state.current.pointer = slug
        report()
      },
      onPointerLeave: (e: ReactPointerEvent) => {
        if (e.pointerType === 'touch' || state.current.pointer !== slug) return
        state.current.pointer = null
        report()
      },
      onFocus: (e: ReactFocusEvent) => {
        state.current.focus = slug
        state.current.keys = e.currentTarget.matches(':focus-visible')
        report()
      },
      onBlur: () => {
        if (state.current.focus !== slug) return
        state.current.focus = null
        report()
      },
    }),
    [report],
  )
  /* Leaving the page section with an item hot must not leave the chapter's readout stuck. */
  useEffect(() => () => {
    if (state.current.last !== null) onHover(null)
  }, [onHover])
  return { hot: hot.slug, byKeys: hot.keys, bind }
}

/* ---- screenshots ------------------------------------------------ */

const CAPTURE = /^\/assets\/client-work\/.+\.webp$/

/**
 * The capture to hang for a project, or null when it has none.
 * Narrow frames take the phone capture when the project has one:
 * it is portrait like the frames, legible at that size and a
 * fifth of the desktop capture's weight once decoded.
 */
export function shotOf(p: SiteProject, narrow: boolean): { src: string; avif: string | null } | null {
  const list = p.assets?.screenshots ?? []
  if (!list.length) return null
  const src = (narrow && list.find((s) => /-mobile\.\w+$/.test(s))) || list[0]
  return { src, avif: CAPTURE.test(src) ? src.replace(/\.webp$/, '.avif') : null }
}

/**
 * A capture that came back as one flat colour (a page that had not
 * painted when it was taken) is not a picture of the site; the
 * frame shows the project's type instead. Read once, on load, from
 * a 12-pixel thumbnail; a cross-origin image simply counts as real.
 */
export function isBlankCapture(img: HTMLImageElement): boolean {
  try {
    const c = document.createElement('canvas')
    c.width = 12
    c.height = 12
    const g = c.getContext('2d', { willReadFrequently: true })
    if (!g) return false
    g.drawImage(img, 0, 0, 12, 12)
    const d = g.getImageData(0, 0, 12, 12).data
    let lo = 255
    let hi = 0
    for (let i = 0; i < d.length; i += 4) {
      const l = (d[i] * 3 + d[i + 1] * 6 + d[i + 2]) / 10
      if (l < lo) lo = l
      if (l > hi) hi = l
    }
    return hi - lo < 6
  } catch {
    return false
  }
}
