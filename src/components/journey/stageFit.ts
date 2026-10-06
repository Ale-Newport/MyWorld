'use client'

import { useEffect, type RefObject } from 'react'
import type { ChapterId } from '@/content/types'
import { writeStageShift } from '@/experience/camera/regions'
import { subscribe } from '@/lib/ticker'
import shared from './chapters/chapters.module.css'

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

   Corner notes stand apart from the flow, so a long one can grow into
   the words beside it: the band then starts below it (or ends above
   it), and the corners keep their designed places while the words
   move — the top ones as the stage pins, the bottom ones as it lets
   go, where the words have finished travelling.

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
/** The air a corner note keeps from the words beside it, px. */
const GAP = 12

/** The stage's corner notes (the shared `.corner`) that stand apart from its flow. A chapter may set one in its grid
    instead, and a note that is never on screen together with the words sharing its place says so (`data-corner-apart`). */
function cornersOf(el: HTMLElement): HTMLElement[] {
  return (Array.from(el.children) as HTMLElement[]).filter((c) => {
    if (!c.classList.contains(shared.corner) || c.hasAttribute('data-corner-apart') || !c.textContent?.trim()) return false
    const cs = getComputedStyle(c)
    return cs.display !== 'none' && cs.position === 'absolute'
  })
}

/** What stands at the stage's foot apart from its flow (`data-stage-foot`), such as the world portal's readout. */
function feetOf(el: HTMLElement): HTMLElement[] {
  return (Array.from(el.children) as HTMLElement[]).filter((c) => c.hasAttribute('data-stage-foot'))
}

/** The ink of the lines of text in the stage's flow where they are read: relative to the stage's box, with every
    transform between a line and the stage taken out — an entrance still to play or an exit under way puts a line
    where it will not be read. A line box of display type carries air above and below its glyphs, so only its
    middle counts. */
function flowLines(el: HTMLElement): DOMRect[] {
  const base = el.getBoundingClientRect()
  const range = document.createRange()
  const shifts = new Map<Element, number>()
  const shiftOf = (node: Element): number => {
    const hit = shifts.get(node)
    if (hit !== undefined) return hit
    const cs = getComputedStyle(node)
    const own = cs.transform && cs.transform !== 'none' ? new DOMMatrixReadOnly(cs.transform).m42 : 0
    const y = own + (node.parentElement && node.parentElement !== el ? shiftOf(node.parentElement) : 0)
    shifts.set(node, y)
    return y
  }
  const out: DOMRect[] = []
  for (const child of Array.from(el.children)) {
    const cs = getComputedStyle(child)
    if (cs.display === 'none' || cs.position === 'absolute' || cs.position === 'fixed') continue
    const walker = document.createTreeWalker(child, NodeFilter.SHOW_TEXT)
    let n: Node | null
    while ((n = walker.nextNode())) {
      const parent = n.parentElement
      if (!n.textContent?.trim() || !parent || parent.closest('.sr-only')) continue
      const dy = shiftOf(parent)
      range.selectNodeContents(n)
      for (const r of Array.from(range.getClientRects())) {
        if (r.width < 2 || r.height < 2) continue
        out.push(new DOMRect(r.left - base.left, r.top - base.top - dy + r.height * 0.18, r.width, r.height * 0.64))
      }
    }
  }
  return out
}

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
      // The design's own layout first: no clearance, corners where they were put.
      el.style.removeProperty('--stage-clear-top')
      el.style.removeProperty('--stage-clear-bottom')
      const corners = cornersOf(el)
      for (const c of [...corners, ...feetOf(el)]) c.style.translate = ''
      const height = el.clientHeight
      // A corner note that has grown into the words beside it moves the band's edge past itself.
      const lines = corners.length ? flowLines(el) : []
      let clearTop = 0
      let clearBottom = 0
      const tops: HTMLElement[] = []
      const bottoms: HTMLElement[] = []
      for (const c of corners) {
        const top = c.offsetTop
        const bottom = top + c.offsetHeight
        const left = c.offsetLeft
        const right = left + c.offsetWidth
        const isTop = top + bottom < height
        ;(isTop ? tops : bottoms).push(c)
        // Only a real collision counts: a design may set a note close beside its words.
        const hit = lines.some((r) => r.left < right - 1 && r.right > left + 1 && r.top < bottom - 1 && r.bottom > top + 1)
        if (!hit) continue
        if (isTop) clearTop = Math.max(clearTop, bottom + GAP)
        else clearBottom = Math.max(clearBottom, height - top + GAP)
      }
      if (clearTop) el.style.setProperty('--stage-clear-top', `${Math.ceil(clearTop)}px`)
      if (clearBottom) el.style.setProperty('--stage-clear-bottom', `${Math.ceil(clearBottom)}px`)
      const cs = getComputedStyle(el)
      const padTop = parseFloat(cs.paddingTop) || 0
      const padBottom = parseFloat(cs.paddingBottom) || 0
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
      // The corners keep their designed places while the words move: the top
      // ones where the words start, the bottom ones (and anything standing at
      // the stage's foot, `data-stage-foot`) where they finish.
      for (const c of tops) c.style.translate = from ? `0 ${(-from).toFixed(1)}px` : ''
      for (const c of [...bottoms, ...feetOf(el)]) c.style.translate = to ? `0 ${(-to).toFixed(1)}px` : ''
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
        node.style.removeProperty('--stage-clear-top')
        node.style.removeProperty('--stage-clear-bottom')
        for (const c of [...cornersOf(node), ...feetOf(node)]) c.style.translate = ''
        delete node.dataset.stageTravel
      }
      writeStageShift(id, 0)
    }
  }, [id, section, stage, enabled])
}
