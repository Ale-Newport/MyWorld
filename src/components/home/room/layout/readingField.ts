import { ROOM_CONFIG } from '../config'

/* ============================================================
   THE READING FIELD
   Where the copy actually is, measured from the DOM, so growth
   can be planned around it rather than around guessed numbers.

   Every chapter of the home journey pins a full-viewport stage,
   so the place a line of text will occupy on screen is its
   position RELATIVE TO ITS STAGE — readable for every chapter at
   once, wherever the visitor has scrolled. The fixed HUD is read
   where it stands. Each line becomes a box, inflated by a
   clearance that depends on its type (display type carries its
   own air; a 10px label needs only a little), rasterised into a
   coarse grid and blurred into a smooth field.

   The field is TIME-AWARE. Growth only ever moves forward through
   the story, so a leaf that unfurls after the hero has scrolled
   away never shares the screen with the hero's name — it only has
   to keep clear of the copy still to come. The field is therefore
   kept per chapter, and a plant born at growth g is planned
   against the union of the chapters still on screen at or after g
   (and the HUD, which is always there). That is what stops the
   field from becoming one exclusion mask over the whole viewport.

   Measurement happens on real layout events — fonts loading, a
   resize, chapters arriving, the copy changing — never per frame.

   Copy that MOVES is measured with its whole range of movement:
   an element carrying `data-room-travel="<up> <down>"` (CSS lengths,
   e.g. "14vh 0" or "3.2rem 2.4rem") has every line inflated upward
   and downward by that much, so growth keeps clear of every pose the
   scroll can put it in, not only the one it had when measured.

   The HUD's footer is read as a BAND, not as its words: the progress
   row is reserved across the width of its content, so nothing grows
   across the progress line between the chapter name and the count.
   ============================================================ */

export interface ReadingBox {
  x: number
  y: number
  w: number
  h: number
  /** Font size in CSS px. */
  px: number
  /** Chapter id, or 'hud'. */
  chapter: string
}

const IGNORE = '.sr-only, [data-room-ignore], [data-open="false"], [data-on="false"][aria-hidden="true"]'

/** Small and large viewport heights, px (they differ while a mobile
    browser's toolbar can slide away). */
export function viewportHeights() {
  const probe = document.createElement('div')
  probe.style.cssText = 'position:fixed;top:0;left:0;width:0;visibility:hidden;pointer-events:none;height:100svh'
  document.body.appendChild(probe)
  const small = probe.getBoundingClientRect().height
  probe.style.height = '100lvh'
  const large = probe.getBoundingClientRect().height
  probe.remove()
  return { small, large }
}

/**
 * Offsets that put bottom-anchored fixed text (the HUD's footer) at
 * both places it can stand: above a mobile toolbar, and at the foot
 * of the large viewport the room fills once the toolbar slides away.
 */
export function footerShifts(): number[] {
  const { small, large } = viewportHeights()
  const slack = large - small
  if (!(slack > 0.5)) return [0]
  // innerHeight is whichever of the two is current.
  return window.innerHeight >= large - 0.5 ? [0, -slack] : [0, slack]
}

/**
 * Line boxes of a text node, as they will stand once revealed. A
 * reveal slides each word up out of a clipping wrapper; until it has
 * played, the glyphs sit a line below their place. The wrapper is
 * never transformed, so the line's height comes from it and the
 * extent along the line from the glyphs.
 */
export function settledRects(node: Text, range = document.createRange()): DOMRect[] {
  range.selectNodeContents(node)
  const rects = Array.from(range.getClientRects())
  const wrap = node.parentElement?.closest<HTMLElement>('[class*="unitWrap"]')
  if (!wrap) return rects
  const w = wrap.getBoundingClientRect()
  return rects.map((r) => new DOMRect(r.left, w.top, r.width, w.height))
}

/** All text the home journey can show, in viewport px when pinned. */
/** A CSS length in px: px, rem, em (of `el`), vh, svh, lvh, dvh. */
function lengthPx(value: string, el: Element): number {
  const m = /^(-?\d*\.?\d+)(px|rem|em|vh|svh|lvh|dvh)?$/.exec(value.trim())
  if (!m) return 0
  const n = Number(m[1])
  switch (m[2]) {
    case 'rem': return n * (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16)
    case 'em': return n * (parseFloat(getComputedStyle(el).fontSize) || 16)
    case 'vh': case 'svh': case 'lvh': case 'dvh': return (n / 100) * window.innerHeight
    default: return n
  }
}

/** How far an element's copy travels up and down with the scroll (`data-room-travel`). */
function travelOf(el: Element, cache: Map<Element, [number, number]>): [number, number] {
  const host = el.closest<HTMLElement>('[data-room-travel]')
  if (!host) return [0, 0]
  const hit = cache.get(host)
  if (hit) return hit
  const [up = '0', down = '0'] = (host.dataset.roomTravel ?? '').split(/\s+/)
  const t: [number, number] = [lengthPx(up, host), lengthPx(down, host)]
  cache.set(host, t)
  return t
}

export function measureReadingBoxes(root: ParentNode = document): ReadingBox[] {
  const boxes: ReadingBox[] = []
  const range = document.createRange()
  const travel = new Map<Element, [number, number]>()
  const push = (node: Text, ox: number, oy: number, chapter: string, shifts: number[] = [0]) => {
    const el = node.parentElement
    if (!el || !node.textContent || !node.textContent.trim()) return
    // Toggled sheets and hover labels are not part of the page's
    // standing layout (and bring their own ground when they open).
    if (el.closest(IGNORE)) return
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none') return
    const px = parseFloat(cs.fontSize) || 16
    const [up, down] = travelOf(el, travel)
    for (const r of settledRects(node, range)) {
      if (r.width < 1 || r.height < 1) continue
      for (const dy of shifts) boxes.push({ x: r.left - ox, y: r.top - oy + dy - up, w: r.width, h: r.height + up + down, px, chapter })
    }
  }
  const sections = Array.from(root.querySelectorAll<HTMLElement>('#journey section[data-chapter]'))
  for (const section of sections) {
    const stage = section.firstElementChild as HTMLElement | null
    if (!stage) continue
    const s = stage.getBoundingClientRect()
    const id = section.dataset.chapter ?? ''
    const walker = document.createTreeWalker(stage, NodeFilter.SHOW_TEXT)
    let n: Node | null
    while ((n = walker.nextNode())) push(n as Text, s.left, s.top, id)
    // Slots that fill on interaction (a readout that names the tile
    // under the pointer) keep their room while empty:
    // `data-room-reserve` gives the height to hold, in em, up from
    // the slot's foot.
    for (const slot of Array.from(stage.querySelectorAll<HTMLElement>('[data-room-reserve]'))) {
      const r = slot.getBoundingClientRect()
      if (r.width < 1) continue
      const px = parseFloat(getComputedStyle(slot).fontSize) || 16
      const h = Math.max(r.height, (Number(slot.dataset.roomReserve) || 4) * px)
      boxes.push({ x: r.left - s.left, y: r.bottom - h - s.top, w: r.width, h, px, chapter: id })
    }
  }
  const hud = root.querySelector<HTMLElement>('[data-hud]')
  if (hud) {
    const footer = hud.querySelector('footer')
    const shifts = footerShifts()
    const walker = document.createTreeWalker(hud, NodeFilter.SHOW_TEXT)
    let n: Node | null
    while ((n = walker.nextNode())) push(n as Text, 0, 0, 'hud', footer?.contains(n) ? shifts : [0])
    // The footer's row as one band, edge to edge of its content: the
    // progress line has no words to measure, and nothing should grow
    // across it.
    for (const row of [footer]) {
      if (!row) continue
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
      for (const el of Array.from(row.querySelectorAll<HTMLElement>('a, button, span, p, [role="slider"]'))) {
        const r = el.getBoundingClientRect()
        if (r.width < 1 || r.height < 1 || getComputedStyle(el).visibility === 'hidden') continue
        x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top); x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom)
      }
      if (!Number.isFinite(x0)) continue
      const px = 12
      for (const dy of row === footer ? shifts : [0]) boxes.push({ x: x0, y: y0 + dy, w: x1 - x0, h: y1 - y0, px, chapter: 'hud' })
    }
    // A label whose words change with the chapter (the HUD's chapter
    // title) keeps the ground of its longest text, whatever it says when
    // the copy is measured: `data-room-reserve-text` names that text, and
    // a hidden copy of the label measures it in the label's own type.
    for (const el of Array.from(hud.querySelectorAll<HTMLElement>('[data-room-reserve-text]'))) {
      const r = el.getBoundingClientRect()
      if (r.height < 1 || !el.parentElement) continue
      const probe = el.cloneNode(false) as HTMLElement
      probe.removeAttribute('data-room-reserve-text')
      probe.textContent = el.dataset.roomReserveText ?? ''
      probe.style.position = 'absolute'
      probe.style.visibility = 'hidden'
      probe.style.whiteSpace = 'nowrap'
      el.parentElement.appendChild(probe)
      const w = probe.getBoundingClientRect().width
      probe.remove()
      const px = parseFloat(getComputedStyle(el).fontSize) || 12
      for (const dy of footer?.contains(el) ? shifts : [0]) boxes.push({ x: r.left, y: r.top + dy, w: Math.max(r.width, w), h: r.height, px, chapter: 'hud' })
    }
  }
  return boxes
}

export interface ReadingField {
  gw: number
  gh: number
  /**
   * slices[k] = union of chapter k and every chapter after it, plus
   * the HUD. Row 0 is the TOP of the viewport. Values 0..1.
   */
  slices: Float32Array[]
  /** Growth value at which chapter k leaves the screen. */
  ends: number[]
  /** A cheap signature, to skip re-planning when nothing moved. */
  signature: number
}

function rasterise(boxes: ReadingBox[], vw: number, vh: number, gw: number, gh: number): Float32Array {
  const C = ROOM_CONFIG.clearance
  const cell = vw / gw
  const data = new Float32Array(gw * gh)
  const short = Math.min(vw, vh)
  for (const b of boxes) {
    const display = b.px >= 28
    // Line boxes of display type are taller than the glyphs.
    const trim = display ? b.h * 0.14 : 0
    const em = display ? Math.min(C.displayEm * b.px, C.displayMax) : b.px >= 16 ? C.bodyEm * b.px : C.labelEm * b.px
    const m = em + C.base * short
    const x0 = b.x - m
    const x1 = b.x + b.w + m
    const y0 = b.y + trim - m
    const y1 = b.y + b.h - trim + m
    const fall = m * 0.6 + cell
    const gx0 = Math.max(0, Math.floor((x0 - fall * 2) / cell))
    const gx1 = Math.min(gw - 1, Math.ceil((x1 + fall * 2) / cell))
    const gy0 = Math.max(0, Math.floor((y0 - fall * 2) / cell))
    const gy1 = Math.min(gh - 1, Math.ceil((y1 + fall * 2) / cell))
    for (let gy = gy0; gy <= gy1; gy++) {
      const py = (gy + 0.5) * cell
      const dy = Math.max(y0 - py, 0, py - y1)
      for (let gx = gx0; gx <= gx1; gx++) {
        const px = (gx + 0.5) * cell
        const dx = Math.max(x0 - px, 0, px - x1)
        const d = Math.hypot(dx, dy)
        const v = d <= 0 ? 1 : Math.exp(-(d * d) / (fall * fall))
        const k = gy * gw + gx
        if (v > data[k]) data[k] = v
      }
    }
  }
  // A light blur: an organic edge, not a stencil of the text.
  const rad = Math.max(1, Math.round((C.blur * short) / cell))
  const kernel: number[] = []
  let ks = 0
  for (let i = -rad; i <= rad; i++) {
    const w = Math.exp(-(i * i) / (2 * (rad / 2) * (rad / 2)))
    kernel.push(w)
    ks += w
  }
  const tmp = new Float32Array(gw * gh)
  for (let y = 0; y < gh; y++)
    for (let x = 0; x < gw; x++) {
      let s = 0
      for (let i = -rad; i <= rad; i++) s += data[y * gw + Math.min(gw - 1, Math.max(0, x + i))] * kernel[i + rad]
      tmp[y * gw + x] = s / ks
    }
  const out = new Float32Array(gw * gh)
  for (let y = 0; y < gh; y++)
    for (let x = 0; x < gw; x++) {
      let s = 0
      for (let i = -rad; i <= rad; i++) s += tmp[Math.min(gh - 1, Math.max(0, y + i)) * gw + x] * kernel[i + rad]
      out[y * gw + x] = Math.max(s / ks, data[y * gw + x] * 0.9)
    }
  return out
}

/**
 * @param order  the journey's chapter ids, in scroll order
 * @param ends   growth value at which each chapter has left the screen
 */
export function buildReadingField(boxes: ReadingBox[], vw: number, vh: number, order: string[], ends: number[]): ReadingField {
  const gw = 192
  const gh = Math.max(16, Math.round((gw * vh) / vw))
  const per = order.map((id) => rasterise(boxes.filter((b) => b.chapter === id), vw, vh, gw, gh))
  const hud = rasterise(boxes.filter((b) => b.chapter === 'hud'), vw, vh, gw, gh)
  const slices: Float32Array[] = []
  let acc = hud.slice()
  for (let k = order.length - 1; k >= 0; k--) {
    const next = new Float32Array(gw * gh)
    for (let i = 0; i < next.length; i++) next[i] = Math.max(acc[i], per[k][i])
    slices[k] = next
    acc = next
  }
  let sig = gw * 31 + gh
  for (const b of boxes) sig = (sig * 33 + Math.round(b.x / 4) * 7 + Math.round(b.y / 4) * 13 + Math.round(b.w / 4) + Math.round(b.px)) | 0
  return { gw, gh, slices, ends, signature: sig }
}

/** The slice that governs growth born at `birth`. */
export function sliceFor(f: ReadingField, birth: number): Float32Array {
  for (let k = 0; k < f.ends.length; k++) if (birth < f.ends[k]) return f.slices[k]
  return f.slices[f.slices.length - 1]
}

/** Bilinear sample at viewport fractions (0..1, y down). */
export function sampleSlice(f: ReadingField, data: Float32Array, u: number, v: number): number {
  if (u < 0 || u > 1 || v < 0 || v > 1) return 0
  const x = u * f.gw - 0.5
  const y = v * f.gh - 0.5
  const x0 = Math.max(0, Math.min(f.gw - 1, Math.floor(x)))
  const y0 = Math.max(0, Math.min(f.gh - 1, Math.floor(y)))
  const x1 = Math.min(f.gw - 1, x0 + 1)
  const y1 = Math.min(f.gh - 1, y0 + 1)
  const fx = Math.min(1, Math.max(0, x - x0))
  const fy = Math.min(1, Math.max(0, y - y0))
  const a = data[y0 * f.gw + x0] + (data[y0 * f.gw + x1] - data[y0 * f.gw + x0]) * fx
  const b = data[y1 * f.gw + x0] + (data[y1 * f.gw + x1] - data[y1 * f.gw + x0]) * fx
  return a + (b - a) * fy
}
