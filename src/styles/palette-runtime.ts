/* ============================================================
   THE PALETTE, FOR CODE THAT PAINTS

   Canvases and WebGL scenes cannot use var(--accent): they need a
   colour now. `token()` resolves a colour variable (var() and
   color-mix() included) to an `rgb()` string through a probe
   element, once, and keeps it until the palette changes — the
   theme toggled, or the editor's preview chose another accent —
   which `site:theme` announces (site/theme.ts, site/AccentStyle).
   `onPalette()` lets a scene recolour itself then.
   ============================================================ */

const EVENT = 'site:theme'
const cache = new Map<string, string>()

function resolve(name: string): string {
  if (typeof document === 'undefined' || !document.body) return ''
  const probe = document.createElement('span')
  probe.style.cssText = `position:absolute;width:0;height:0;overflow:hidden;visibility:hidden;color:var(${name})`
  document.body.appendChild(probe)
  const value = getComputedStyle(probe).color
  probe.remove()
  return value
}

/** A colour token as an rgb() string, e.g. token('--accent', '#2f6b3f'). */
export function token(name: string, fallback: string): string {
  let v = cache.get(name)
  if (v) return v
  v = resolve(name) || fallback
  if (typeof document !== 'undefined') cache.set(name, v)
  return v
}

/** "r, g, b" of a token, for rgba() strings built per frame. */
export function triplet(name: string, fallback: string): string {
  const m = token(name, fallback).match(/\d+(\.\d+)?/g)
  return m && m.length >= 3 ? `${Math.round(+m[0])}, ${Math.round(+m[1])}, ${Math.round(+m[2])}` : '47, 107, 63'
}

/** Whether the page is in its night theme: for a painter whose day and night are two drawings, not two tokens. */
export function isNight(): boolean {
  return typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark'
}

/** Calls `fn` whenever the palette changes; returns the unsubscribe. */
export function onPalette(fn: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const run = () => fn()
  window.addEventListener(EVENT, run)
  return () => window.removeEventListener(EVENT, run)
}

if (typeof window !== 'undefined') window.addEventListener(EVENT, () => cache.clear(), { capture: true })
