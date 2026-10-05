'use client'

import { useEffect, type RefObject } from 'react'
import type { ChapterId } from '@/content/types'
import { writeStageShift } from '@/experience/camera/regions'
import { subscribe } from '@/lib/ticker'

/* ============================================================
   A STAGE TALLER THAN THE SCREEN

   Every chapter pins one full-viewport stage, laid out to fit its
   words between the HUD's header and footer (the stage's own top
   and bottom padding) — and normally they do. When they cannot
   (a long text from the admin, a small phone, a page zoomed to
   200 %), nothing may be cut off or left under the HUD:

     · content that fits the band but stands outside it is moved
       into it, once;
     · content taller than the band travels through it as the
       chapter is scrolled — its first line under the header when
       the stage pins, its last line above the footer when it lets
       go — like a page scrolling, because that is what the visitor
       is doing.

   While the words travel, they fade out under the HUD's header and
   footer rather than running into their labels.

   Content that fits where it stands never moves, so a chapter that
   reads well at a size is untouched by any of this. The travel is
   declared to the home room as `data-room-travel` (in both
   directions, whatever the scroll), so growth keeps clear of every
   place the words can be, and the room is asked to measure again
   whenever it changes.

   Measured on layout events only (resize, content, fonts); a frame
   costs a scroll read and, while it is moving, one style write.
   ============================================================ */

/** Overflow smaller than this is rounding, not overflow. */
const SLACK = 2

/** Where the HUD's words end at the top and begin at the bottom, in viewport px
    (its labels, not its boxes, which carry padding). Null without a HUD. */
export function hudEdges(): { top: number; bottom: number } | null {
  const extent = (selector: string) => {
    const box = document.querySelector(selector)
    if (!box) return null
    let lo = Infinity
    let hi = -Infinity
    for (const el of Array.from(box.querySelectorAll('a, button, span, p, [role="slider"]'))) {
      const r = el.getBoundingClientRect()
      if (r.width < 1 || r.height < 1) continue
      lo = Math.min(lo, r.top)
      hi = Math.max(hi, r.bottom)
    }
    return Number.isFinite(lo) ? { lo, hi } : null
  }
  const head = extent('[data-hud] header')
  const foot = extent('[data-hud] footer')
  return head && foot ? { top: head.hi, bottom: foot.lo } : null
}

export function useStageFit(id: ChapterId, section: RefObject<HTMLElement | null>, stage: RefObject<HTMLElement | null>, enabled: boolean) {
  useEffect(() => {
    const host = section.current
    const pin = stage.current
    if (!enabled || !host || !pin) return

    let from = 0
    let to = 0
    let start = 0
    let length = 1
    let applied = 0
    let declared: string | null = null
    let stopTicking: (() => void) | null = null
    let frame = 0

    const root = () => pin.firstElementChild as HTMLElement | null

    const place = () => {
      const el = root()
      if (!el) return
      const p = Math.min(1, Math.max(0, (window.scrollY - start) / length))
      const y = from + (to - from) * p
      if (Math.abs(y - applied) < 0.25) return
      applied = y
      const shift = Math.abs(y) < 0.25 ? 0 : Math.round(y * 10) / 10
      el.style.translate = shift ? `0 ${shift}px` : ''
      // A 3D subject laid out among these words moves with them.
      writeStageShift(id, shift)
    }

    const declare = (el: HTMLElement, span: number) => {
      const value = span > SLACK ? `${Math.ceil(span)}px ${Math.ceil(span)}px` : null
      if (value === declared) return
      declared = value
      if (value) el.dataset.stageTravel = value
      else delete el.dataset.stageTravel
      window.dispatchEvent(new Event('journey:layout'))
    }

    /** Fade the stage under the HUD's header and footer while its words travel. */
    const veil = (moving: boolean) => {
      const edges = moving ? hudEdges() : null
      const value = edges
        ? `linear-gradient(to bottom, transparent ${Math.round(edges.top + 2)}px, #000 ${Math.round(edges.top + 14)}px, #000 ${Math.round(edges.bottom - 14)}px, transparent ${Math.round(edges.bottom - 2)}px)`
        : ''
      pin.style.maskImage = value
      pin.style.setProperty('-webkit-mask-image', value)
    }

    const measure = () => {
      frame = 0
      const el = root()
      if (!el) return
      const cs = getComputedStyle(el)
      const padTop = parseFloat(cs.paddingTop) || 0
      const padBottom = parseFloat(cs.paddingBottom) || 0
      const height = el.clientHeight
      // The words in the stage's flow, where layout put them (offsets ignore every transform,
      // this one and the chapters' own reveals). Corner notes and sheets stand on their own.
      let lo = Infinity
      let hi = -Infinity
      for (const child of Array.from(el.children) as HTMLElement[]) {
        const c = getComputedStyle(child)
        if (c.display === 'none' || c.position === 'absolute' || c.position === 'fixed') continue
        const y = child.offsetParent === el ? child.offsetTop : child.offsetTop - el.offsetTop
        lo = Math.min(lo, y)
        hi = Math.max(hi, y + child.offsetHeight)
      }
      const band = height - padTop - padBottom
      if (!Number.isFinite(lo) || band <= 0) {
        from = to = 0
      } else if (hi - lo <= band + SLACK) {
        // Fits: only ever nudged back inside the band.
        from = to = lo < padTop - SLACK ? padTop - lo : hi > height - padBottom + SLACK ? height - padBottom - hi : 0
      } else {
        from = padTop - lo
        to = height - padBottom - hi
      }
      start = host.getBoundingClientRect().top + window.scrollY
      length = Math.max(1, host.offsetHeight - pin.offsetHeight)
      declare(el, Math.abs(to - from))
      applied = Number.NaN
      place()
      const moving = from !== to
      veil(moving)
      if (moving && !stopTicking) stopTicking = subscribe(place)
      if (!moving && stopTicking) { stopTicking(); stopTicking = null }
    }

    const soon = () => { if (!frame) frame = requestAnimationFrame(measure) }
    const ro = new ResizeObserver(soon)
    ro.observe(host)
    ro.observe(pin)
    const el = root()
    if (el) for (const child of Array.from(el.children)) ro.observe(child)
    window.addEventListener('resize', soon)
    window.addEventListener('cms:content', soon)
    void document.fonts?.ready.then(soon)
    soon()

    return () => {
      ro.disconnect()
      window.removeEventListener('resize', soon)
      window.removeEventListener('cms:content', soon)
      if (frame) cancelAnimationFrame(frame)
      stopTicking?.()
      veil(false)
      const node = root()
      if (node) {
        node.style.translate = ''
        delete node.dataset.stageTravel
      }
      writeStageShift(id, 0)
    }
  }, [id, section, stage, enabled])
}
