import { ROOM_CONFIG } from '../config'
import { rasteriseSteps } from './rasterise'
import { rasterSignature, readingGrid, readingSignature } from './readingSignature'

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
   resize, chapters arriving — never per frame.
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

/** What never counts as standing copy: text for screen readers, readouts that fill on interaction
    (`data-room-ignore`), sheets that are shut. The same list serves every walk over the page's text. */
export const ROOM_IGNORE = IGNORE

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

/** What one measuring pass has learnt of the transforms above its text: an element's entrance/exit shift
    (its own and every ancestor's, up to the stage) is read once, not once per line of text it holds. */
export type ShiftMemo = Map<Element, readonly [number, number]>
const NO_SHIFT: readonly [number, number] = [0, 0]

/** The translation an element's own `transform` and `translate` put on its content. */
function ownShift(el: Element): readonly [number, number] {
  const cs = getComputedStyle(el)
  let dx = 0
  let dy = 0
  if (cs.transform !== 'none') {
    const matrix = new DOMMatrixReadOnly(cs.transform)
    dx += matrix.m41
    dy += matrix.m42
  }
  if (cs.translate && cs.translate !== 'none') {
    const [x = '0', y = '0'] = cs.translate.split(' ')
    dx += parseFloat(x) * (x.endsWith('%') ? (el as HTMLElement).offsetWidth / 100 : 1) || 0
    dy += parseFloat(y) * (y.endsWith('%') ? (el as HTMLElement).offsetHeight / 100 : 1) || 0
  }
  return dx || dy ? [dx, dy] : NO_SHIFT
}

/** Every entrance/exit translation from `el` up to (not including) the stage; outside any stage, up to and including the HUD. */
function shiftTo(el: Element | null, stage: Element | null | undefined, memo: ShiftMemo): readonly [number, number] {
  if (!el || el === stage) return NO_SHIFT
  const hit = memo.get(el)
  if (hit) return hit
  const own = ownShift(el)
  const up = !stage && el.hasAttribute('data-hud') ? NO_SHIFT : shiftTo(el.parentElement, stage, memo)
  const sum: readonly [number, number] = own === NO_SHIFT ? up : up === NO_SHIFT ? own : [own[0] + up[0], own[1] + up[1]]
  memo.set(el, sum)
  return sum
}

/**
 * Line boxes of a text node, as they will stand once revealed. A
 * reveal slides each word up out of a clipping wrapper; until it has
 * played, the glyphs sit a line below their place. The wrapper is
 * never transformed, so the line's height comes from it and the
 * extent along the line from the glyphs.
 *
 * `memo` is shared by the lines of one pass: they read their
 * ancestors' styles once between them. Never keep one across passes
 * (the shifts it holds are the page as it was).
 */
export function settledRects(node: Text, range = document.createRange(), memo: ShiftMemo = new Map()): DOMRect[] {
  range.selectNodeContents(node)
  const rects = Array.from(range.getClientRects())
  const section = node.parentElement?.closest('#journey section[data-chapter]')
  const stage = section?.firstElementChild
  // Remove every entrance/exit translation below the pinned stage. Reading
  // a live animated rectangle made the lens and plant pruning depend on
  // which animation frame a late chunk/font happened to finish on.
  const [dx, dy] = shiftTo(node.parentElement, stage, memo)
  return rects.map(r => new DOMRect(r.left - dx, r.top - dy, r.width, r.height))
}

/** One line of copy as the room reads it. Toggled sheets and hover labels are not part of the page's standing
    layout (and bring their own ground when they open). */
function pushText(boxes: ReadingBox[], node: Text, range: Range, memo: ShiftMemo, ox: number, oy: number, chapter: string, shifts: number[] = [0]) {
  const el = node.parentElement
  if (!el || !node.textContent || !node.textContent.trim()) return
  if (el.closest(IGNORE)) return
  const cs = getComputedStyle(el)
  if (cs.visibility === 'hidden' || cs.display === 'none') return
  const px = parseFloat(cs.fontSize) || 16
  for (const r of settledRects(node, range, memo)) {
    if (r.width < 1 || r.height < 1) continue
    for (const dy of shifts) boxes.push({ x: r.left - ox, y: r.top - oy + dy, w: r.width, h: r.height, px, chapter })
  }
}

/** The chapters of the home journey, in the page's order. */
export function chapterSections(root: ParentNode = document): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('#journey section[data-chapter]'))
}

/** The text of one chapter's pinned stage, relative to the stage. */
export function measureChapter(section: HTMLElement, memo: ShiftMemo = new Map(), range = document.createRange()): ReadingBox[] {
  const boxes: ReadingBox[] = []
  const stage = section.firstElementChild as HTMLElement | null
  if (!stage) return boxes
  const s = stage.getBoundingClientRect()
  const id = section.dataset.chapter ?? ''
  const walker = document.createTreeWalker(stage, NodeFilter.SHOW_TEXT)
  let n: Node | null
  while ((n = walker.nextNode())) pushText(boxes, n as Text, range, memo, s.left, s.top, id)
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
  return boxes
}

/** The fixed HUD's text, where it stands. */
export function measureHud(hud: HTMLElement, memo: ShiftMemo = new Map(), range = document.createRange()): ReadingBox[] {
  const boxes: ReadingBox[] = []
  const footer = hud.querySelector('footer')
  const shifts = footerShifts()
  const walker = document.createTreeWalker(hud, NodeFilter.SHOW_TEXT)
  let n: Node | null
  while ((n = walker.nextNode())) pushText(boxes, n as Text, range, memo, 0, 0, 'hud', footer?.contains(n) ? shifts : [0])
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
  return boxes
}

/** All text the home journey can show, in viewport px when pinned. */
export function measureReadingBoxes(root: ParentNode = document): ReadingBox[] {
  const memo: ShiftMemo = new Map()
  const range = document.createRange()
  const boxes: ReadingBox[] = []
  for (const section of chapterSections(root)) boxes.push(...measureChapter(section, memo, range))
  const hud = root.querySelector<HTMLElement>('[data-hud]')
  if (hud) boxes.push(...measureHud(hud, memo, range))
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

/**
 * The rasters of the chapters, kept from one read to the next. A chapter's copy changes on its own (its
 * animation arrives, its words wrap differently), so a read that finds a chapter where it was reuses what it
 * made of it and rasterises only the chapters that moved.
 */
export class RasterCache {
  private geometry = ''
  private entries = new Map<string, { key: number; data: Float32Array }>()

  /** The raster of `id`'s boxes: the last one made if its copy stands where it did. */
  get(id: string, boxes: ReadingBox[], vw: number, vh: number, gw: number, gh: number): Float32Array {
    const steps = this.steps(id, boxes, vw, vh, gw, gh)
    for (;;) {
      const r = steps.next()
      if (r.done) return r.value
    }
  }

  /** The same, in pieces: it yields while it rasterises, and returns the raster. */
  *steps(id: string, boxes: ReadingBox[], vw: number, vh: number, gw: number, gh: number): Generator<void, Float32Array> {
    const geometry = `${vw}x${vh}|${gw}x${gh}`
    if (geometry !== this.geometry) {
      this.geometry = geometry
      this.entries.clear()
    }
    const key = rasterSignature(boxes)
    const hit = this.entries.get(id)
    if (hit && hit.key === key) return hit.data
    const data = yield* rasteriseSteps(boxes, vw, vh, gw, gh, ROOM_CONFIG.clearance)
    this.entries.set(id, { key, data })
    return data
  }
}

/**
 * The field's time slices from the rasters of its chapters: slice k is chapter k and every chapter after it,
 * plus the HUD.
 *
 * @param per  one raster per chapter, in the journey's order
 * @param ends growth value at which each chapter has left the screen
 */
export function assembleField(per: Float32Array[], hud: Float32Array, ends: number[], gw: number, gh: number, signature: number): ReadingField {
  const slices: Float32Array[] = []
  let acc = hud
  for (let k = per.length - 1; k >= 0; k--) {
    const next = new Float32Array(gw * gh)
    const cur = per[k]
    for (let i = 0; i < next.length; i++) next[i] = Math.max(acc[i], cur[i])
    slices[k] = next
    acc = next
  }
  return { gw, gh, slices, ends, signature }
}

/** The boxes of each chapter (and the HUD's, under `hud`), in one pass over them. */
export function groupByChapter(boxes: ReadingBox[]): Map<string, ReadingBox[]> {
  const by = new Map<string, ReadingBox[]>()
  for (const b of boxes) {
    const list = by.get(b.chapter)
    if (list) list.push(b)
    else by.set(b.chapter, [b])
  }
  return by
}

/**
 * @param order  the journey's chapter ids, in scroll order
 * @param ends   growth value at which each chapter has left the screen
 * @param cache  the rasters of an earlier read, to reuse the chapters that have not moved
 */
export function buildReadingField(boxes: ReadingBox[], vw: number, vh: number, order: string[], ends: number[], cache = new RasterCache()): ReadingField {
  const { gw, gh } = readingGrid(vw, vh)
  const by = groupByChapter(boxes)
  const per = order.map((id) => cache.get(id, by.get(id) ?? [], vw, vh, gw, gh))
  const hud = cache.get('hud', by.get('hud') ?? [], vw, vh, gw, gh)
  return assembleField(per, hud, ends, gw, gh, readingSignature(boxes, gw, gh))
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
