/* ============================================================
   KEEPING THE PAGE STILL BEHIND A SHEET

   The overlays used to set `body { overflow: hidden }`. With the page's
   `html { overflow-x: clip }` that never reached the viewport (the body is
   then an ordinary box, and the viewport keeps scrolling): a wheel over the
   part of a case study that is not a scroller moved the journey four
   screens behind it, and closing the sheet left the visitor somewhere else.

   Locking the root instead (`html { overflow: hidden }`) takes the scroll
   bar away, which widens the page behind the sheet by its 8px — the room
   takes that for a resize and lights itself again — and `scrollbar-gutter`
   does not hold that place for a bar styled with `::-webkit-scrollbar`.
   So nothing about the page's layout is touched. The sheet itself answers
   the gestures that would otherwise travel on to the page: a wheel or a
   touch that no scroller inside the sheet can take is cancelled there,
   where it starts, and only on the sheet, so nothing is listening to
   the rest of the page.

   The paging keys cannot be answered by cancelling them alone. Where the
   keyboard is decides who would have scrolled: on a row or a link inside
   the sheet's scroller the browser scrolls that scroller (and the key is
   left to it), but on the Close button — where a sheet puts focus when it
   opens — or on the body, after a click on text that cannot take focus, no
   scroller sits between the key and the sheet, and the browser would have
   scrolled the page. Cancelling those and doing nothing left a keyboard
   with nothing to read the sheet by, so the key is cancelled and carried
   out on the sheet's own scroller: a page for PageUp, PageDown and Space,
   a line for the arrows, the ends for Home and End (and, on a Mac, a page
   for Option+Up and Option+Down, which is what those chords mean there).

   With two sheets open (the index and a case study may overlap), every key
   belongs to the one drawn in front, wherever the keyboard happens to be: a
   scroller only claims a key when it lies inside that sheet. Focus that is
   in the sheet underneath (it was put there when that one opened) must not
   hand the key to the list it is standing in, which the visitor cannot see.
   Escape is the same: the front sheet answers it, once (`claimEscape`).

   Space is a paging key for everything but what uses it. A button is pressed
   by it, a field is typed in; but a link is not: Space on one does nothing
   but scroll, so a link that is not inside a scroller (the index's way into
   the world and its contact links stand in the panel's footer, below the
   list) would send the page behind on its way if the key were left to it.

   The chapter behind a sheet is not drawn while it is open (`html[data-sheet]`,
   see Journey.module.css). It used to leave the screen by accident: the
   body, made a scroll container, took the sticky stage with it. Pinned now,
   it would show through the scrim (96% opaque, which is not 100) as a ghost
   of itself, so it is hidden on purpose — by opacity, not visibility, because
   the room keeps reading the copy's layout and a hidden chapter reads as
   one that is gone.
   ============================================================ */

/** Sheets standing over the page (the index and a case study may overlap for a moment). */
const sheets: HTMLElement[] = []

function mark(sheet: HTMLElement, on: boolean) {
  const at = sheets.indexOf(sheet)
  if (on && at < 0) sheets.push(sheet)
  else if (!on && at >= 0) sheets.splice(at, 1)
  if (sheets.length > 0) document.documentElement.dataset.sheet = 'open'
  else delete document.documentElement.dataset.sheet
}

/** Whether `sheet` is the one in front: with two open, a key belongs to the one drawn over the other (the later of equals). */
function inFront(sheet: HTMLElement): boolean {
  if (sheets.length < 2) return true
  const z = (el: HTMLElement) => parseInt(getComputedStyle(el).zIndex, 10) || 0
  let front = sheets[0]
  for (const el of sheets) if (z(el) >= z(front)) front = el
  return front === sheet
}

/** The Escape presses a sheet has already answered. Kept apart from the event itself: something inside a sheet may
    have handled the key on its own and called `preventDefault` (the Library canvas clears what was typed on it), and
    that must not be taken for a sheet having closed, or the press would close nothing. */
const answered = new WeakSet<Event>()

/** Whether an Escape is for `sheet` to answer: it is the one in front, and no sheet has answered it yet (so one press closes one sheet). */
export function claimEscape(sheet: HTMLElement | null, e: KeyboardEvent): boolean {
  if (e.key !== 'Escape' || answered.has(e) || !sheet || !inFront(sheet)) return false
  answered.add(e)
  return true
}

/** What a key that moves a page asks for: which way (positive is down) and how far. */
interface Travel {
  dir: 1 | -1
  unit: 'line' | 'page' | 'end'
}

/** An arrow key moves a scroller this far, in pixels; the paging keys this share of its height. */
const LINE = 40
const PAGE = 0.9
const MAC = typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent)

function keyTravel(e: KeyboardEvent): Travel | null {
  const target = e.target instanceof HTMLElement ? e.target : null
  // A control that uses the key for itself: a button is pressed by Space, a field is typed in, a slider is moved.
  if (target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="slider"]')) return null
  // One modifier at most (Ctrl and Alt together is AltGr, and none of those chords is a scroll).
  if (+e.altKey + +e.ctrlKey + +e.metaKey > 1) return null
  const chord = e.altKey || e.ctrlKey || e.metaKey
  switch (e.key) {
    case 'ArrowDown': case 'ArrowUp': {
      const dir = e.key === 'ArrowDown' ? 1 : -1
      // On a Mac, Cmd+Up and Cmd+Down go to the ends of a page and Option+Up and Option+Down a page at a time.
      if (!chord) return { dir, unit: 'line' }
      if (e.metaKey) return { dir, unit: 'end' }
      return e.altKey && MAC ? { dir, unit: 'page' } : null
    }
    case 'PageDown': return chord ? null : { dir: 1, unit: 'page' }
    case 'PageUp': return chord ? null : { dir: -1, unit: 'page' }
    // Ctrl+End and Ctrl+Home (Cmd on a Mac) say the same.
    case 'End': return e.altKey ? null : { dir: 1, unit: 'end' }
    case 'Home': return e.altKey ? null : { dir: -1, unit: 'end' }
    case ' ': return chord || target?.closest('button, summary, [role="button"]') ? null : { dir: e.shiftKey ? -1 : 1, unit: 'page' }
    default: return null
  }
}

/** Whether `el` is a scroller that can still move in the direction of `dy` (positive scrolls down). */
function scrolls(el: HTMLElement, dy: number): boolean {
  if (el.scrollHeight <= el.clientHeight + 1) return false
  const overflow = getComputedStyle(el).overflowY
  if (overflow !== 'auto' && overflow !== 'scroll') return false
  return dy < 0 ? el.scrollTop > 0 : el.scrollTop + el.clientHeight < el.scrollHeight - 1
}

/** Whether a scroller between `from` and `sheet` takes a gesture of `dy`. */
function taken(from: EventTarget | null, sheet: HTMLElement, dy: number): boolean {
  for (let el = from instanceof HTMLElement ? from : null; el && el !== sheet; el = el.parentElement) {
    if (scrolls(el, dy)) return true
  }
  return false
}

/** The first scroller inside `sheet` that can still move in the direction of `dy`: the one a key is carried out on. */
function scrollerIn(sheet: HTMLElement, dy: number): HTMLElement | null {
  for (const el of sheet.querySelectorAll<HTMLElement>('*')) if (scrolls(el, dy)) return el
  return null
}

/** Cancels the scrolling gestures on `sheet` that nothing inside it can take, so they never move the page. Returns the release. */
export function holdScroll(sheet: HTMLElement): () => void {
  mark(sheet, true)
  /* Where the last key was sent (from where, to where, and when): a key pressed while the smooth scroll of the one
     before is still on its way adds to where that is going, not to where it has got to, so ten arrows held down
     travel ten lines. Only while it is on its way: it is forgotten when that scroll ends, when the pointer takes the
     sheet (the scroll bar, a drag), after any key that is not a scrolling one (Tab moves the focus, and the scroller
     with it), and when the scroller is found outside the way the key was sending it (a find, an anchor, a focus). */
  let aim: { el: HTMLElement; from: number; top: number; at: number } | null = null
  // `cancelable` is false once a gesture is already scrolling the page (and cancelling it then only logs a warning).
  const onWheel = (e: WheelEvent) => {
    aim = null
    if (e.ctrlKey) return // a pinch-zoom, not a scroll
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return // sideways: the page has nowhere to go that way
    if (e.cancelable && !taken(e.target, sheet, e.deltaY)) e.preventDefault()
  }
  const travel = (el: HTMLElement, { dir, unit }: Travel) => {
    const room = el.scrollHeight - el.clientHeight
    const now = performance.now()
    const here = el.scrollTop
    const onWay = aim && aim.el === el && now - aim.at < 800 && here >= Math.min(aim.from, aim.top) - 2 && here <= Math.max(aim.from, aim.top) + 2
    const from = onWay && aim ? aim.top : here
    const step = unit === 'page' ? Math.round(el.clientHeight * PAGE) : LINE
    const top = Math.min(room, Math.max(0, unit === 'end' ? (dir > 0 ? room : 0) : from + dir * step))
    aim = { el, from: here, top, at: now }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) el.scrollTop = top
    else el.scrollTo({ top, behavior: 'smooth' })
  }
  /* Paging keys, from wherever focus is inside the sheet (or on the page, when the sheet was opened by a click that left it there).
     Left alone when a scroller between the key and the sheet takes it: the browser scrolls that one. Otherwise cancelled, and
     carried out on the sheet's scroller (see the head of this file); with none that can move that way, it simply stops here. */
  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented || !e.cancelable || !inFront(sheet)) return
    const k = keyTravel(e)
    if (!k) { aim = null; return }
    // A scroller claims the key only inside this sheet: focus under another sheet, or on the page, has none to hand it to.
    if (e.target instanceof Node && sheet.contains(e.target) && taken(e.target, sheet, k.dir)) return
    e.preventDefault()
    const el = scrollerIn(sheet, k.dir)
    if (el) travel(el, k)
  }
  let x = 0
  let y = 0
  const onTouchStart = (e: TouchEvent) => {
    aim = null
    x = e.touches[0]?.clientX ?? 0
    y = e.touches[0]?.clientY ?? 0
  }
  const onTouchMove = (e: TouchEvent) => {
    const nx = e.touches[0]?.clientX ?? x
    const ny = e.touches[0]?.clientY ?? y
    const dx = x - nx
    const dy = y - ny // positive: the content is being pulled up (scrolling down)
    x = nx
    y = ny
    // One finger, going mostly up or down, that no scroller inside takes: it would carry on to the page.
    if (e.cancelable && e.touches.length === 1 && Math.abs(dy) >= Math.abs(dx) && !taken(e.target, sheet, dy)) e.preventDefault()
  }
  const forget = () => { aim = null }
  sheet.addEventListener('wheel', onWheel, { passive: false })
  sheet.addEventListener('pointerdown', forget, { passive: true })
  sheet.addEventListener('scrollend', forget, { capture: true, passive: true }) // it does not bubble
  sheet.addEventListener('touchstart', onTouchStart, { passive: true })
  sheet.addEventListener('touchmove', onTouchMove, { passive: false })
  document.addEventListener('keydown', onKey)
  return () => {
    sheet.removeEventListener('wheel', onWheel)
    sheet.removeEventListener('pointerdown', forget)
    sheet.removeEventListener('scrollend', forget, true)
    sheet.removeEventListener('touchstart', onTouchStart)
    sheet.removeEventListener('touchmove', onTouchMove)
    document.removeEventListener('keydown', onKey)
    mark(sheet, false)
  }
}
