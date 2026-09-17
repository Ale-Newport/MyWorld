import { useEffect, useRef, useState, type RefObject } from 'react'
import { subscribe } from '@/lib/ticker'

/* ============================================================
   WHAT THE FIVE "A LITTLE ABOUT ME" OPTIONS SHARE

   The box (sized by a ResizeObserver, never measured per frame),
   the shared ticker (subscribed only while the box is active),
   type measurement (once per layout, against the real fonts) and
   the easings. Turbopack inlines this module into each option's
   chunk, so a helper only one option uses lives in that option.
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

/** Non-empty, trimmed strings only. */
export const present = (list: readonly string[]) => list.map((s) => (s ?? '').trim()).filter(Boolean)

/* ---- small numeric helpers ---------------------------------------- */

/** The site's --ease-out-expo, cubic-bezier(0.16, 1, 0.3, 1), closely enough for scroll-driven motion. */
export const expo = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : 1 - Math.pow(2, -10 * t))
export const smooth = (t: number) => t * t * (3 - 2 * t)
