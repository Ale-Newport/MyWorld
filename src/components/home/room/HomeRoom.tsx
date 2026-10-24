'use client'

import { useEffect, useRef, useState } from 'react'
import { IDLE, subscribe, wake } from '@/lib/ticker'
import { detectDevice } from '@/lib/perf'
import { frame, useJourney } from '@/state/journey'
import { portal } from '@/state/portal'
import { ROOM_CONFIG } from './config'
import { RoomEngine } from './engine'
import { growthFor } from './growth'
import { RoomStill } from './RoomStill'
import {
  ROOM_IGNORE, RasterCache, assembleField, chapterSections, footerShifts, groupByChapter, measureChapter, measureHud, settledRects,
  type ReadingBox, type ShiftMemo,
} from './layout/readingField'
import { readingGrid, readingSignature } from './layout/readingSignature'
import { sliced, type Sliced } from './layout/slices'
import styles from './room.module.css'

/* ============================================================
   HOME ROOM
   The homepage's backdrop: a white classical hall, fixed to the
   viewport, that nature takes back as the visitor scrolls. This
   component manages the layer's life — mounting, sizing, reading
   the copy's layout, following the scroll, pausing, tearing down;
   the engine draws.
   ============================================================ */

export function HomeRoom() {
  const hostRef = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)
  const [fallback, setFallback] = useState(false)
  // Bumped when the browser gives back a lost context: the layer
  // starts again from a fresh canvas.
  const [generation, setGeneration] = useState(0)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    // A fresh canvas per mount: the engine releases its context on
    // teardown, and a released context can never be had back from
    // the same element (React's development double-mount included).
    const canvas = document.createElement('canvas')
    canvas.className = styles.canvas
    host.appendChild(canvas)
    let engine: RoomEngine | null
    // True once the first frame is out: from then on the room does its re-planning between frames (see `run`).
    let up = false
    try {
      engine = new RoomEngine(canvas, {
        quality: detectDevice().tier,
        onReady: () => { up = true; setReady(true); window.dispatchEvent(new Event('room:ready')) },
        onContextLost: () => setFallback(true),
        onContextRestored: () => {
          setFallback(false)
          setReady(false)
          setGeneration((g) => g + 1)
        },
        onBuilt: () => placeEntablature(),
        // Anything the next frame must draw wakes the shared loop, which sleeps while the room is at rest.
        onInvalidate: wake,
      })
    } catch {
      // No WebGL2 (or no context to be had): the still stands in.
      canvas.remove()
      queueMicrotask(() => setFallback(true))
      return
    }

    const params = new URLSearchParams(window.location.search)
    const capture = params.has('room-capture')
    let width = 0
    let height = 0
    // The entablature's soffit goes between the HUD's top row and the
    // chapters' corner labels (measured, never guessed).
    const entablature = function* (memo: ShiftMemo): Generator<void> {
      const top = document.querySelector<HTMLElement>('[data-hud] header')
      const h = host.getBoundingClientRect().height || window.innerHeight
      if (!top || !engine) return
      // The HUD's own glyphs, not its padded box.
      let hudBottom = 0
      let hudTop = Infinity
      const range = document.createRange()
      const walker = document.createTreeWalker(top, NodeFilter.SHOW_TEXT)
      let n: Node | null
      while ((n = walker.nextNode())) {
        if (!n.textContent?.trim()) continue
        range.selectNodeContents(n)
        for (const r of Array.from(range.getClientRects())) {
          if (r.height <= 0) continue
          hudBottom = Math.max(hudBottom, r.bottom)
          hudTop = Math.min(hudTop, r.top)
        }
      }
      if (!hudBottom) return
      yield
      // The architrave carries the HUD's row: its soffit sits just
      // below the row, so the frieze above — in the cornice's shade —
      // stays clear of the type, and the corner labels further down
      // read off open plaster.
      // The copy's gutter: the nearest any glyph of the HUD or of a
      // chapter's corner labels comes to either side of the screen.
      const w = host.getBoundingClientRect().width || window.innerWidth
      let gutter = Infinity
      const edges = [top, ...Array.from(document.querySelectorAll<HTMLElement>('#journey section[data-chapter] [class*="corner"]'))]
      for (const el of edges) {
        const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
        let t: Node | null
        while ((t = tw.nextNode())) {
          if (!t.textContent?.trim()) continue
          range.selectNodeContents(t)
          for (const r of Array.from(range.getClientRects())) {
            if (r.width <= 0) continue
            gutter = Math.min(gutter, r.left, w - r.right)
          }
        }
      }
      if (!Number.isFinite(gutter) || gutter <= 0) gutter = w * 0.04
      yield
      // Every line of copy set in the lower part of any chapter's
      // stage (where it pins), and the HUD's footer: the wall's foot
      // has to fall between them.
      const raw: Array<[number, number]> = []
      const collect = (root: Element, oy: number, shifts = [0]) => {
        const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
        let t: Node | null
        while ((t = tw.nextNode())) {
          const el = (t as Text).parentElement
          if (!t.textContent?.trim() || !el || el.closest(ROOM_IGNORE)) continue
          for (const r of settledRects(t as Text, range, memo)) {
            if (r.height <= 0 || r.width <= 0) continue
            for (const dy of shifts) {
              const y0 = r.top - oy + dy
              if (y0 > h * 0.55) raw.push([y0 / h, (r.bottom - oy + dy) / h])
            }
          }
        }
      }
      for (const section of Array.from(document.querySelectorAll<HTMLElement>('#journey section[data-chapter]'))) {
        const stage = section.firstElementChild as HTMLElement | null
        if (stage) {
          collect(stage, stage.getBoundingClientRect().top)
          yield
        }
      }
      // The footer stands at the foot of whichever viewport is current
      // (above a mobile toolbar, or below it once it slides away).
      const footer = document.querySelector('[data-hud] footer')
      if (footer) collect(footer, 0, footerShifts())
      // A read in pieces may have been overtaken by the room's end.
      if (!engine) return
      raw.sort((a, b) => a[0] - b[0])
      const rows: Array<[number, number]> = []
      for (const r of raw) {
        const last = rows[rows.length - 1]
        if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1])
        else rows.push([r[0], r[1]])
      }
      // Capturing the fallback stills (see frameForStill).
      if (capture) engine.frameForStill(Math.max(2, gutter - 8) / w)
      else engine.setFasciaBand(hudTop / h, hudBottom / h, Math.max(2, gutter - 8) / w, rows)
    }
    const drain = (steps: Generator<void>) => { while (!steps.next().done); }
    const placeEntablature = () => drain(entablature(new Map()))
    const measure = () => {
      const r = host.getBoundingClientRect()
      width = Math.max(1, Math.round(r.width))
      height = Math.max(1, Math.round(r.height))
      engine?.setViewport(width, height, window.devicePixelRatio || 1)
      placeEntablature()
    }
    measure()
    // A window being dragged to size resizes the layer every frame;
    // the room is refitted once it settles (the last frame, stretched,
    // stands in meanwhile).
    let resizeTimer = 0
    const settle = () => {
      window.clearTimeout(resizeTimer)
      resizeTimer = window.setTimeout(() => {
        measure()
        read(true)
      }, 150)
    }
    // Moving the window to a screen of another pixel density changes
    // nothing the observer sees.
    let dprQuery: MediaQueryList | null = null
    const watchDpr = () => {
      dprQuery?.removeEventListener('change', onDpr)
      dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`)
      dprQuery.addEventListener('change', onDpr)
    }
    const onDpr = () => {
      watchDpr()
      settle()
    }
    watchDpr()

    /* ---- the copy's layout ----------------------------------- */
    const takeoverRaw = params.has('room-takeover') ? Number(params.get('room-takeover')) : null
    const pinnedTakeover = takeoverRaw !== null && Number.isFinite(takeoverRaw) ? takeoverRaw : null
    const pinnedRaw = params.has('room-g') ? Number(params.get('room-g')) : null
    const pinned = pinnedRaw !== null && Number.isFinite(pinnedRaw) ? pinnedRaw : null
    /* Reading the page is a walk over every line of copy (a few hundred
       text nodes, a thousand-odd line boxes) and a rasterised field on
       top: tens of milliseconds, more on a phone. So it runs when the
       copy really changed and not before:
         · an urgent read (fonts, a resize, the editor, the mode) takes
           the next frame;
         · a structural one (a chunk arrives, a section's animation
           mounts) is a trailing debounce that lets the burst of changes
           settle (and a scroll pause, up to a limit), and then is read in
           pieces between frames (see `readSteps`), so a read never lands
           in a gesture as one long task;
         · and a read that finds the copy exactly where the last one left
           it stops before the field is rasterised or the wall's foot is
           placed again. */
    const QUIET_MS = 120
    const MAX_WAIT_MS = 600
    let readFrame = 0
    let readWait = 0
    let readSince = 0
    let scrolledAt = -Infinity
    let fieldKey = ''
    const onScroll = () => { scrolledAt = performance.now() }
    window.addEventListener('scroll', onScroll, { passive: true })
    /* The read itself is a generator: a piece of the measuring, of the rasterising, of the wall's foot. Before the
       first frame, or when something urgent asked for it (a resize, the fonts), the pieces run one after the other;
       otherwise they are given the page's slack a few milliseconds at a time (see layout/slices.ts), because the copy
       changes under a page that is being scrolled — a chapter's animation mounts a screen or two ahead of it — and a
       read of the whole page in one task was a dropped frame or three. Chapters whose copy has not moved are not
       rasterised again. */
    const rasters = new RasterCache()
    function* readSteps(): Generator<void> {
      if (!engine) return
      const s = useJourney.getState()
      const ranges = s.ranges
      const order = ranges.map((r) => r.id)
      // Growth that follows the scroll only has to keep clear of the
      // copy still to come. Held growth (reduced motion, a pinned
      // value, the stills) sits behind every chapter in turn, so it
      // keeps clear of all of them.
      const held = s.reducedMotion || pinned !== null || capture
      /* A chapter's copy is on screen until its section has scrolled
         out entirely, which in scroll progress (fractions of the
         document's height minus one viewport) is later than its range
         ends (fractions of the whole). Planning against the earlier
         figure let growth born while the copy was still leaving the
         top of the screen land on it. */
      const total = s.chapters.reduce((a, c) => a + (s.quickView ? c.quickVh : c.vh), 0)
      const stretch = total > 1 ? total / (total - 1) : 1
      const ends = ranges.map((r) => (held ? 1 : growthFor(Math.min(1, r.end * stretch), ranges)))
      // One pass over the page's lines shares what it learns of their ancestors' transforms.
      const memo: ShiftMemo = new Map()
      const range = document.createRange()
      const boxes: ReadingBox[] = []
      for (const section of chapterSections()) {
        boxes.push(...measureChapter(section, memo, range))
        yield
      }
      const hud = document.querySelector<HTMLElement>('[data-hud]')
      if (hud) boxes.push(...measureHud(hud, memo, range))
      yield
      if (!engine) return
      const { gw, gh } = readingGrid(width, height)
      const key = `${width}x${height}|${order.join()}|${ends.join()}|${readingSignature(boxes, gw, gh)}`
      if (key === fieldKey) return
      yield* entablature(memo)
      if (!engine) return
      const by = groupByChapter(boxes)
      const per: Float32Array[] = []
      for (const id of order) {
        per.push(yield* rasters.steps(id, by.get(id) ?? [], width, height, gw, gh))
        yield
      }
      const hudRaster = yield* rasters.steps('hud', by.get('hud') ?? [], width, height, gw, gh)
      yield
      const field = assembleField(per, hudRaster, ends, gw, gh, readingSignature(boxes, gw, gh))
      yield
      if (!engine) return
      // Only a read that has gone all the way counts as having read this copy.
      fieldKey = key
      engine.setReadingField(field)
    }
    // For the QA scripts: how the reads have gone (see scripts/qa/home-chapter-hitch.mjs).
    const probe = { reads: 0, sync: 0, slices: 0, longestSlice: 0, longestPiece: 0 }
    ;(window as unknown as { __roomRead?: typeof probe }).__roomRead = probe
    let reading: Sliced | null = null
    let readAgain = false
    let urgentRead = false
    const run = () => {
      readFrame = 0
      readSince = 0
      if (!engine) return
      const now = urgentRead || !up
      urgentRead = false
      if (reading) {
        // A read in pieces is under way: it finishes, and one more follows if the copy changed meanwhile.
        if (!now) { readAgain = true; return }
        reading.cancel()
        reading = null
      }
      readAgain = false
      probe.reads++
      if (now) { probe.sync++; drain(readSteps()); return }
      reading = sliced(readSteps(), {
        onSlice: (ms, pieces) => {
          probe.slices++
          if (ms > probe.longestSlice) probe.longestSlice = Math.round(ms * 10) / 10
          if (pieces === 1 && ms > probe.longestPiece) probe.longestPiece = Math.round(ms * 10) / 10
        },
        timeout: ROOM_CONFIG.readBudget.patience,
        budget: () => (performance.now() - scrolledAt < 250 ? ROOM_CONFIG.readBudget.scrolling : ROOM_CONFIG.readBudget.still),
        onDone: () => {
          reading = null
          if (readAgain) { readAgain = false; read(false) }
        },
        onError: (e) => { reading = null; console.error('[room]', e) },
      })
    }
    const read = (urgent: boolean) => {
      if (urgent) {
        urgentRead = true
        window.clearTimeout(readWait)
        readWait = 0
        cancelAnimationFrame(readFrame)
        readFrame = requestAnimationFrame(run)
        return
      }
      if (readFrame) return
      const now = performance.now()
      if (!readSince) readSince = now
      // A debounce that is kept waiting by a stream of changes still ends.
      if (readWait && now - readSince >= MAX_WAIT_MS) return
      window.clearTimeout(readWait)
      const fire = () => {
        readWait = 0
        if (performance.now() - scrolledAt < QUIET_MS && performance.now() - readSince < MAX_WAIT_MS) {
          readWait = window.setTimeout(fire, QUIET_MS)
          return
        }
        readFrame = requestAnimationFrame(run)
      }
      readWait = window.setTimeout(fire, QUIET_MS)
    }
    const readSoon = () => read(false)
    // The first visible frame uses the final font metrics.
    void document.fonts.ready.then(() => { if (engine) read(true) })
    let observed = false
    const ro = new ResizeObserver(() => {
      // The first callback is the observer's initial report.
      if (!observed) {
        observed = true
        return
      }
      settle()
    })
    ro.observe(host)
    // Chapters arrive as separate chunks; watch structural additions.
    // Hover states, reveal transforms and counters never re-plan the plants:
    // a readout that fills on interaction (`data-room-ignore`) is not part of
    // the standing copy, so its coming and going is not a change to it.
    const journey = document.getElementById('journey')
    const mo = new MutationObserver((records) => {
      // Rotating labels and animation counters replace text nodes while
      // scrolling. They do not change the chapter layout or the room lens.
      for (const r of records) {
        if (r.target instanceof Element && r.target.closest(ROOM_IGNORE)) continue
        for (const list of [r.addedNodes, r.removedNodes]) {
          for (const n of Array.from(list)) {
            if (n.nodeType === Node.ELEMENT_NODE && !(n as Element).matches(ROOM_IGNORE)) { readSoon(); return }
          }
        }
      }
    })
    if (journey) mo.observe(journey, { childList: true, subtree: true })
    // The copy itself changed (the admin's live preview, a section's
    // text): measure again, whenever it happens.
    window.addEventListener('cms:content', readSoon)
    // A stage's words started or stopped travelling through it (stageFit.ts).
    window.addEventListener('journey:layout', readSoon)
    const unsubStore = useJourney.subscribe((s, prev) => {
      // What the growth follows (the mode, the running order) is read by the loop, which may be asleep.
      if (s.quickView !== prev.quickView || s.reducedMotion !== prev.reducedMotion || s.ranges !== prev.ranges) wake()
      if (s.quickView !== prev.quickView || s.reducedMotion !== prev.reducedMotion) read(true)
      if (s.reducedMotion !== prev.reducedMotion || s.indexOpen !== prev.indexOpen || s.activeProject !== prev.activeProject) applyMotion()
    })

    /* ---- growth ---------------------------------------------- */
    const debug = params.get('room-debug')
    if (process.env.NODE_ENV !== 'production' && (debug === 'field' || debug === 'irradiance')) engine.setDebug(debug)
    let current = -1
    const target = () => {
      if (pinned !== null) return pinned
      const s = useJourney.getState()
      if (s.reducedMotion) return ROOM_CONFIG.growth.reducedMotion
      return growthFor(frame.progress, s.ranges)
    }
    // `?room-still` holds the air still (repeatable QA captures).
    const still = params.has('room-still')
    // The air is still under reduced motion, and while the index or a
    // project sheet covers the page (nothing to see moving behind it).
    const applyMotion = () => {
      const s = useJourney.getState()
      engine?.setSway(!still && !s.reducedMotion && !s.indexOpen && !s.activeProject)
    }
    applyMotion()

    // Frame-time watchdog: if most of the frames the room draws over a
    // couple of seconds come in under ~25 fps, step its quality down.
    let slow = 0
    let drawn = 0
    let windowStart = 0
    let lastDemote = -Infinity
    const unsub = subscribe((dt, now) => {
      if (!engine) return IDLE
      const t = target()
      // Only the first frame or reduced-motion mode lands immediately.
      // Snapping a large live scroll delta made the vegetation jump.
      if (current < 0 || useJourney.getState().reducedMotion) current = t
      else current += (t - current) * (1 - Math.exp(-ROOM_CONFIG.growth.follow * dt))
      if (Math.abs(t - current) < 1e-4) current = t
      engine.setGrowth(current)
      // Pushing past the end: the room is taken back over the copy
      // before the canopy closes in front of it (see WorldPortal).
      engine.setTakeover(pinnedTakeover ?? Math.min(1, portal.pull / ROOM_CONFIG.growth.takeoverAt))
      if (engine.frame(dt)) {
        drawn++
        if (dt > 0.04) slow++
      }
      if (!windowStart) windowStart = now
      // Never mid-push: a relight there would show, and the push is a
      // few seconds of extra drawing that ends in leaving the page.
      if (portal.pull > 0) {
        slow = 0
        drawn = 0
        windowStart = now
      }
      if (now - windowStart > 2500) {
        if (drawn > 20 && slow / drawn > 0.5 && now - lastDemote > 5000 && engine.demote()) lastDemote = now
        slow = 0
        drawn = 0
        windowStart = now
      }
      // At rest (growth where the scroll wants it, nothing to draw, the air settled, no push
      // under way) the loop may sleep; the next scroll, resize or invalidation wakes it.
      return engine.resting && current === t && portal.pull === 0 ? IDLE : undefined
    }, 'room')

    /* ---- leaving --------------------------------------------- */
    // The portal hands the GPU to the world: release the context
    // the moment the hand-over starts, not when React gets round to
    // unmounting.
    const onLeaving = () => {
      engine?.dispose()
      engine = null
    }
    window.addEventListener('journey:leaving', onLeaving)
    ;(window as unknown as { __room?: () => unknown }).__room = () => engine?.state

    return () => {
      unsub()
      unsubStore()
      ro.disconnect()
      mo.disconnect()
      window.removeEventListener('cms:content', readSoon)
      window.removeEventListener('journey:layout', readSoon)
      window.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(readFrame)
      reading?.cancel()
      window.clearTimeout(readWait)
      window.clearTimeout(resizeTimer)
      dprQuery?.removeEventListener('change', onDpr)
      window.removeEventListener('journey:leaving', onLeaving)
      engine?.dispose()
      engine = null
      canvas.remove()
      delete (window as unknown as { __room?: unknown }).__room
      delete (window as unknown as { __roomRead?: unknown }).__roomRead
    }
  }, [generation])

  return (
    <div
      ref={hostRef}
      data-room-host=""
      className={styles.host}
      aria-hidden="true"
      data-ready={ready ? 'true' : 'false'}
      data-fallback={fallback ? 'true' : 'false'}
    >
      {/* The first frame stays under the canvas through its fade-in. */}
      <RoomStill start={!fallback} />
    </div>
  )
}
