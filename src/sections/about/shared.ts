import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react'
import { subscribe } from '@/lib/ticker'
import type { SiteContent } from '@/cms/derive'

/* ============================================================
   WHAT THE FIVE "A LITTLE ABOUT ME" OPTIONS SHARE

   The box (sized by a ResizeObserver, never measured per frame),
   the shared ticker (subscribed only while the box is active),
   type measurement (once per layout, against the real fonts) and
   the readings of the site's content every option draws from.
   Nothing here invents content: each helper only selects, orders
   and formats what the site document already says.
   ============================================================ */

export interface Size { w: number; h: number }

/**
 * The element's CSS size, kept by a ResizeObserver (0 × 0 until first
 * measured). It is issued afresh when web fonts finish loading, so a
 * layout memoised on it — every option here measures type — re-runs
 * against the real faces instead of a fallback's metrics.
 */
export function useBoxSize(ref: RefObject<HTMLElement | null>): Size {
  const [size, setSize] = useState<Size>({ w: 0, h: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width)
      const h = Math.round(entry.contentRect.height)
      setSize((s) => (s.w === w && s.h === h ? s : { w, h }))
    })
    ro.observe(el)
    const fonts = document.fonts
    let live = true
    const refresh = () => {
      if (live) setSize((s) => (s.w ? { ...s } : s))
    }
    void fonts?.ready.then(refresh)
    fonts?.addEventListener('loadingdone', refresh)
    return () => {
      live = false
      ro.disconnect()
      fonts?.removeEventListener('loadingdone', refresh)
    }
  }, [ref])
  return size
}

/** Runs `fn` on the site's one ticker while `on` is true, and not at all otherwise. */
export function useTicker(on: boolean, fn: (dt: number, now: number) => void) {
  const fnRef = useRef(fn)
  useEffect(() => {
    fnRef.current = fn
  })
  useEffect(() => {
    if (!on) return
    return subscribe((dt, now) => fnRef.current(dt, now))
  }, [on])
}

/** True on a mouse or trackpad, where a quiet pointer parallax makes sense. */
export function useFinePointer(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia('(hover: hover) and (pointer: fine)')
      mq.addEventListener('change', cb)
      return () => mq.removeEventListener('change', cb)
    },
    () => window.matchMedia('(hover: hover) and (pointer: fine)').matches,
    () => false,
  )
}

/* ---- type measurement --------------------------------------------- */

let measurer: CanvasRenderingContext2D | null = null
const familyCache: Record<string, string> = {}

/** The family list a CSS custom property resolves to (`--font-display`, `--font-mono`). */
function family(token: '--font-display' | '--font-mono'): string {
  const cached = familyCache[token]
  if (cached) return cached
  const value = typeof document !== 'undefined' ? getComputedStyle(document.documentElement).getPropertyValue(token).trim() : ''
  const resolved = value || (token === '--font-mono' ? 'ui-monospace, Menlo, monospace' : 'Helvetica Neue, Arial, sans-serif')
  if (value) familyCache[token] = resolved
  return resolved
}

/**
 * Width in CSS pixels of one line of text, tracking included (CSS adds
 * letter-spacing after every character). Called when a layout is built,
 * never per frame.
 */
export function textWidth(text: string, size: number, opts: { mono?: boolean; weight?: number; tracking?: number } = {}): number {
  const tracking = (opts.tracking ?? 0) * size * text.length
  if (!measurer && typeof document !== 'undefined') measurer = document.createElement('canvas').getContext('2d')
  if (!measurer) return text.length * size * (opts.mono ? 0.6 : 0.56) + tracking
  measurer.font = `${opts.weight ?? 400} ${size}px ${family(opts.mono ? '--font-mono' : '--font-display')}`
  return measurer.measureText(text).width + tracking
}

/* ---- content readings --------------------------------------------- */

export interface Milestone {
  key: string
  kind: 'study' | 'work'
  /** YYYY-MM as stored, for ordering. */
  start: string
  /** The opening half of the entry's own dates ("Sep 2023"). */
  when: string
  /** Its year, as written in the entry. */
  year: string
  title: string
  detail: string
}

const yearOf = (...texts: string[]) => {
  for (const t of texts) {
    const m = /\b(19|20)\d{2}\b/.exec(t ?? '')
    if (m) return m[0]
  }
  return ''
}
const opening = (dates: string) => (dates ?? '').split(/\s+[–—-]\s+|\s+to\s+/i)[0]?.trim() ?? ''

/** Education and experience, in the order they began. */
export function journeyMilestones(site: SiteContent): Milestone[] {
  const list: Milestone[] = [
    // Keys carry the index: ids are not guaranteed unique across a document.
    ...site.education.map((e, i) => ({
      key: `study:${i}:${e.id}`,
      kind: 'study' as const,
      start: e.start,
      when: opening(e.dates),
      year: yearOf(e.start, e.dates),
      title: e.shortName || e.institution,
      detail: e.degree,
    })),
    ...site.experience.map((x, i) => ({
      key: `work:${i}:${x.id}`,
      kind: 'work' as const,
      start: x.start,
      when: opening(x.dates),
      year: yearOf(x.start, x.dates),
      title: x.organisation,
      detail: x.role,
    })),
  ]
  const order = (m: Milestone) => (/^\d{4}-\d{2}/.test(m.start) ? m.start : m.year ? `${m.year}-99` : '9999')
  return list.map((m, i) => ({ m, i })).sort((a, b) => order(a.m).localeCompare(order(b.m)) || a.i - b.i).map(({ m }) => m)
}

/** Technologies with public evidence, strongest first. */
export function strongestTech(site: SiteContent) {
  return site.techNodes
    .filter((t) => t.evidence.length > 0)
    .map((t, i) => ({ t, i }))
    .sort((a, b) => b.t.evidence.length - a.t.evidence.length || a.i - b.i)
    .map(({ t }) => t)
}

/** Non-empty, trimmed strings only. */
export const present = (list: readonly string[]) => list.map((s) => (s ?? '').trim()).filter(Boolean)

/* ---- small numeric helpers ---------------------------------------- */

export const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)
/** The site's --ease-out-expo, cubic-bezier(0.16, 1, 0.3, 1), closely enough for scroll-driven motion. */
export const expo = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : 1 - Math.pow(2, -10 * t))
export const smooth = (t: number) => t * t * (3 - 2 * t)
