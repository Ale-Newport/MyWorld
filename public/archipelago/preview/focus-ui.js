/* FOCUS BAR — the way out of a focused world board (the Projects board), for a mouse, a finger, a pad and the keyboard.

   A focused board takes the camera, parks the car and swaps the input filters, and until now only Escape got you out: no
   button, nothing on a phone, nothing once the browser has used Escape to leave fullscreen. This is a small DOM bar that
   lives only while a board is focused:

     [ <- Back to the island  Esc ]   [ <  3 / 42  > ]   [ Visit site ^ ]

   It is built the first time a board is focused and styled by focus-ui.css, which this module adds itself, so neither the
   player page nor the studio's copy of it needs a line of markup. The page can be the player or the studio, an iframe or
   standalone, in fullscreen or not: it is one `position:fixed` element of the document the runtime is in.

   The board's controller owns the state; this only shows it and reports presses:

     const focus = createFocusUi()
     focus.show({ id, index, total, title, canOpen, onExit, onPrev, onNext, onOpen })   // the board took the camera
     focus.update({ index, total, title, canOpen })                                       // another project is showing
     focus.hide()                                                                         // the board gave it back
     focus.warm()                                                                         // optional: fetch the stylesheet early
     focus.dispose()                                                                      // the drive ended

   While shown it also:
   - sets body[data-focus], which the stylesheet uses to hide the touch buttons and the interact button (they would do nothing);
   - keeps Enter and Space that are pressed ON a bar button away from the game. The game binds Enter to "interact", which on
     the board opens the project's page in a new tab: Enter on Back must exit, not do that as well, and Space must press
     the button instead of hopping the car;
   - lets Tab reach the bar from the canvas (the game otherwise takes every Tab, for the map), and Tab walk it;
   - drops an Escape that arrives within 250 ms of a fullscreenchange, so one key press never both leaves fullscreen (the
     browser's own use of Escape, delivered to the page too by some browsers) and closes the board;
   - ignores presses in the first 180 ms, so the tap or click that opened the board cannot land on a button that appeared
     under it; and hands the keyboard back to the canvas after a pointer press and when it hides. */

const SHEET = new URL('./focus-ui.css', import.meta.url).href
const ARM_MS = 180
const ESCAPE_AFTER_FULLSCREEN_MS = 250

const SVG = (path) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${path}</svg>`
const ICON = {
  back: SVG('<path d="M20 12H5"/><path d="M11 6l-6 6 6 6"/>'),
  previous: SVG('<path d="M15 5l-7 7 7 7"/>'),
  next: SVG('<path d="M9 5l7 7-7 7"/>'),
  open: SVG('<path d="M7 17L17 7"/><path d="M8 7h9v9"/>'),
}

/** The element a pointer press hands the keyboard back to. */
const worldCanvas = () => document.getElementById('world')

export function createFocusUi({ canvas = worldCanvas, now = () => performance.now() } = {}) {
  let bar = null
  let sheet = null
  let sheetReady = false
  let reveal = null
  let spec = null
  let shownAt = 0
  let fullscreenAt = -1e9
  let shownCount = null
  let shownStatus = null
  let shownCanOpen = null
  let shownTitle = null
  const els = {}
  const listening = []

  const listen = (target, type, fn, options) => {
    target.addEventListener(type, fn, options)
    listening.push(() => target.removeEventListener(type, fn, options))
  }

  /** The stylesheet is a file of its own: the bar waits for it so it never shows up unstyled. */
  const ensureSheet = () => {
    if (sheet) return
    sheet = document.querySelector('link[data-focus-ui]')
    if (!sheet) {
      sheet = document.createElement('link')
      sheet.rel = 'stylesheet'
      sheet.href = SHEET
      sheet.dataset.focusUi = ''
      document.head.append(sheet)
    }
    const done = () => { sheetReady = true; const go = reveal; reveal = null; go?.() }
    if (sheet.sheet) done()
    else { sheet.addEventListener('load', done, { once: true }); sheet.addEventListener('error', done, { once: true }) }
  }

  const button = (act, className, html, label) => {
    const element = document.createElement('button')
    element.type = 'button'
    element.className = `focus-btn ${className}`
    element.id = `focus-${act}`
    element.dataset.act = act
    if (label) element.setAttribute('aria-label', label)
    element.innerHTML = html
    return element
  }

  const build = () => {
    if (bar) return
    bar = document.createElement('div')
    bar.id = 'focus-bar'
    bar.setAttribute('role', 'toolbar')
    bar.setAttribute('aria-label', 'Project board')
    bar.hidden = true
    els.back = button('exit', 'focus-back', `${ICON.back}<span class="focus-text"><span class="focus-long">Back to the island</span><span class="focus-short">Back</span></span><kbd>Esc</kbd>`, 'Back to the island')
    els.steps = document.createElement('div')
    els.steps.className = 'focus-steps'
    els.steps.setAttribute('role', 'group')
    els.steps.setAttribute('aria-label', 'Project')
    els.previous = button('prev', 'focus-step', ICON.previous, 'Previous project')
    els.count = document.createElement('output')
    els.count.id = 'focus-count'
    els.count.className = 'focus-count'
    els.next = button('next', 'focus-step', ICON.next, 'Next project')
    els.steps.append(els.previous, els.count, els.next)
    els.open = button('open', 'focus-open', `<span class="focus-text">Visit site</span>${ICON.open}`, 'Open the project in a new tab')
    els.status = document.createElement('span')
    els.status.className = 'focus-status'
    els.status.setAttribute('role', 'status')
    bar.append(els.back, els.steps, els.open, els.status)
    document.body.append(bar)

    // One listener for every button: a click is a pointer press, a tap, or Enter/Space on a focused button.
    bar.addEventListener('click', (event) => {
      const target = event.target.closest?.('button[data-act]')
      if (!target || !spec || now() - shownAt < ARM_MS) return
      const current = spec
      const act = target.dataset.act
      if (act === 'exit') current.onExit?.()
      else if (act === 'prev') current.onPrev?.()
      else if (act === 'next') current.onNext?.()
      else if (act === 'open') current.onOpen?.()
      // Pointer presses give the keyboard back to the world (arrows step, Enter opens, Esc leaves); a keyboard press stays put.
      if (event.detail !== 0 && spec) canvas()?.focus({ preventScroll: true })
    })
    // The game binds these to the car (Space), to "interact" (Enter) and to the map (Tab): on a bar button they are the button's.
    const own = (event) => { if (event.key === 'Enter' || event.key === ' ' || event.key === 'Tab') event.stopPropagation() }
    bar.addEventListener('keydown', own)
    bar.addEventListener('keyup', own)
  }

  const buttons = () => [els.back, els.previous, els.next, els.open].filter((b) => !b.hidden)

  /** Capture phase, so it runs ahead of the game's own key handlers. */
  const onKey = (event) => {
    if (!bar || bar.hidden) return
    if (event.key === 'Escape' && now() - fullscreenAt < ESCAPE_AFTER_FULLSCREEN_MS) {
      event.stopImmediatePropagation()
      event.preventDefault()
      return
    }
    if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey && !bar.contains(event.target)) {
      // The map and any dialog keep their Tab. From the world, Tab goes to the bar instead of opening the map (M still does).
      const inWorld = event.target === document.body || event.target === document.documentElement || event.target === canvas()
      if (!inWorld || document.body.classList.contains('map-open') || document.querySelector('dialog[open]')) return
      const list = buttons()
      if (!list.length) return
      event.preventDefault()
      event.stopImmediatePropagation()
      list[event.shiftKey ? list.length - 1 : 0].focus()
    }
  }
  const onFullscreen = () => { fullscreenAt = now() }

  const apply = (next) => {
    const count = `${next.index + 1} / ${next.total}`
    if (count !== shownCount) { shownCount = count; els.count.textContent = count }
    const title = String(next.title ?? '')
    const status = `Project ${next.index + 1} of ${next.total}${title ? `: ${title}` : ''}`
    if (status !== shownStatus) { shownStatus = status; els.status.textContent = status }
    const canOpen = !!next.canOpen
    if (canOpen !== shownCanOpen) { shownCanOpen = canOpen; els.open.hidden = !canOpen }
    if (title !== shownTitle) { shownTitle = title; els.open.setAttribute('aria-label', title ? `Open ${title} in a new tab` : 'Open the project in a new tab') }
    els.steps.hidden = next.total < 2
  }

  const api = {
    /** Fetches the stylesheet ahead of the first show, so the bar is on screen in the frame the board opens. */
    warm() { ensureSheet() },

    show(next) {
      build()
      ensureSheet()
      spec = next
      shownCount = shownStatus = shownCanOpen = shownTitle = null
      apply(next)
      document.body.dataset.focus = next.id ?? 'board'
      if (!listening.length) {
        listen(window, 'keydown', onKey, true)
        listen(document, 'fullscreenchange', onFullscreen)
        listen(document, 'webkitfullscreenchange', onFullscreen)
        try { if (window.parent !== window) listen(window.parent.document, 'fullscreenchange', onFullscreen) } catch { /* a cross-origin parent: its fullscreen is not ours to hear */ }
      }
      const go = () => {
        if (!spec || !bar) return
        shownAt = now()
        bar.hidden = false
        void bar.offsetWidth // lay it out once at its resting pose so the fade-in has somewhere to start
        bar.classList.add('is-open')
      }
      if (sheetReady) go()
      else reveal = go
    },

    /** Another project is on the board: the count, the title and whether there is a page to open. */
    update(next) {
      if (!spec) return
      spec = { ...spec, ...next }
      apply(spec)
    },

    hide() {
      if (!spec && (!bar || bar.hidden)) return
      spec = null
      reveal = null
      for (const off of listening.splice(0)) off()
      delete document.body.dataset.focus
      if (!bar) return
      const held = bar.contains(document.activeElement)
      bar.classList.remove('is-open')
      bar.hidden = true
      // The button that was pressed is gone: hand the keyboard back to the world.
      if (held || document.activeElement === document.body) canvas()?.focus({ preventScroll: true })
    },

    get visible() { return !!bar && !bar.hidden },
    get spec() { return spec },

    dispose() {
      api.hide()
      bar?.remove()
      bar = null
      sheet?.remove()
      sheet = null
      sheetReady = false
    },
  }
  return api
}
