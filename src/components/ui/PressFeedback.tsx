'use client'

import { useEffect } from 'react'

/* ============================================================
   THE FRAME OF THE PRESS

   A control that is pressed should look pressed on the frame the
   finger or the button goes down. The browser's own `:active` is
   later than that on a touch screen (it waits to be sure a touch
   is not the start of a scroll), so the page's controls are given
   `data-press` here, on the pointerdown itself, and their styles
   read `:active, [data-press]` (see Hud.module.css, the world's
   HUD does the same).

   One listener on the document, no React render, nothing written
   but one attribute. It is taken off again when the pointer is
   released (kept for a few frames at least, so a click quicker
   than a frame still shows) or taken away — a touch that turns
   into a scroll is a `pointercancel`.
   ============================================================ */

const TARGET = 'a[href], button, [role="button"], summary'
/** A press is shown for at least this long (ms), however quick the click. */
const SHOWN_MS = 90

export function PressFeedback() {
  useEffect(() => {
    let pressed: Element | null = null
    let since = 0
    let timer = 0
    const release = () => {
      window.clearTimeout(timer)
      pressed?.removeAttribute('data-press')
      pressed = null
    }
    const down = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      const el = (e.target as Element | null)?.closest?.(TARGET)
      if (!el || (el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') return
      release()
      pressed = el
      since = performance.now()
      el.setAttribute('data-press', '')
    }
    const up = () => {
      if (!pressed) return
      window.clearTimeout(timer)
      timer = window.setTimeout(release, Math.max(0, SHOWN_MS - (performance.now() - since)))
    }
    document.addEventListener('pointerdown', down, { capture: true, passive: true })
    window.addEventListener('pointerup', up, true)
    window.addEventListener('pointercancel', release, true)
    window.addEventListener('blur', release)
    return () => {
      release()
      document.removeEventListener('pointerdown', down, true)
      window.removeEventListener('pointerup', up, true)
      window.removeEventListener('pointercancel', release, true)
      window.removeEventListener('blur', release)
    }
  }, [])
  return null
}
