'use client'

import { useEffect, useRef, useState } from 'react'
import { subscribe } from '@/lib/ticker'
import { detectDevice } from '@/lib/perf'
import { frame, useJourney } from '@/state/journey'
import { portal } from '@/state/portal'
import { ROOM_CONFIG } from './config'
import { RoomEngine } from './engine'
import { growthFor } from './growth'
import { buildReadingField, footerShifts, measureReadingBoxes, settledRects } from './layout/readingField'
import styles from './room.module.css'

/* ============================================================
   HOME ROOM
   The homepage's backdrop: a white classical hall, fixed to the
   viewport, that nature takes back as the visitor scrolls. This
   component manages the layer's life — mounting, sizing, reading
   the copy's layout, following the scroll, pausing, tearing down;
   the engine draws.
   ============================================================ */

/** Jumps larger than this land at once instead of animating. */
const SNAP = 0.12

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
    try {
      engine = new RoomEngine(canvas, {
        quality: detectDevice().tier,
        onReady: () => setReady(true),
        onContextLost: () => setFallback(true),
        onContextRestored: () => {
          setFallback(false)
          setReady(false)
          setGeneration((g) => g + 1)
        },
        onBuilt: () => placeEntablature(),
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
    const placeEntablature = () => {
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
      // Every line of copy set in the lower part of any chapter's
      // stage (where it pins), and the HUD's footer: the wall's foot
      // has to fall between them.
      const raw: Array<[number, number]> = []
      const collect = (root: Element, oy: number, shifts = [0]) => {
        const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
        let t: Node | null
        while ((t = tw.nextNode())) {
          const el = (t as Text).parentElement
          if (!t.textContent?.trim() || !el || el.closest('.sr-only, [data-open="false"]')) continue
          for (const r of settledRects(t as Text, range)) {
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
        if (stage) collect(stage, stage.getBoundingClientRect().top)
      }
      // The footer stands at the foot of whichever viewport is current
      // (above a mobile toolbar, or below it once it slides away).
      const footer = document.querySelector('[data-hud] footer')
      if (footer) collect(footer, 0, footerShifts())
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
        read()
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
    let readTimer = 0
    const read = () => {
      window.clearTimeout(readTimer)
      readTimer = window.setTimeout(() => {
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
        placeEntablature()
        engine.setReadingField(buildReadingField(measureReadingBoxes(), width, height, order, ends))
      }, 120)
    }
    read()
    void document.fonts?.ready.then(read)
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
    // Chapters arrive as separate chunks; watch the story's markup
    // settle after load, then stop — hover states and reveals must
    // never re-plan the plants.
    const journey = document.getElementById('journey')
    const mo = new MutationObserver(read)
    if (journey) mo.observe(journey, { childList: true, subtree: true })
    const stopWatching = window.setTimeout(() => mo.disconnect(), 6000)
    // The copy itself changed (the admin's live preview, a section's
    // text): measure again, whenever it happens.
    window.addEventListener('cms:content', read)
    // A stage's words started or stopped travelling through it (stageFit.ts).
    window.addEventListener('journey:layout', read)
    const unsubStore = useJourney.subscribe((s, prev) => {
      if (s.quickView !== prev.quickView || s.reducedMotion !== prev.reducedMotion) read()
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
      if (!engine) return
      const t = target()
      if (current < 0 || Math.abs(t - current) > SNAP || useJourney.getState().reducedMotion) current = t
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
    })

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
      window.clearTimeout(stopWatching)
      window.removeEventListener('cms:content', read)
      window.removeEventListener('journey:layout', read)
      window.clearTimeout(readTimer)
      window.clearTimeout(resizeTimer)
      dprQuery?.removeEventListener('change', onDpr)
      window.removeEventListener('journey:leaving', onLeaving)
      engine?.dispose()
      engine = null
      canvas.remove()
      delete (window as unknown as { __room?: unknown }).__room
    }
  }, [generation])

  return (
    <div
      ref={hostRef}
      className={styles.host}
      aria-hidden="true"
      data-ready={ready ? 'true' : 'false'}
      data-fallback={fallback ? 'true' : 'false'}
    >
      {/* Only when the room cannot be drawn live: a still rendered
          from this same scene (scripts/home-room-stills.mjs). Not
          requested at all otherwise. */}
      {fallback && (
        <picture>
          <source media="(max-aspect-ratio: 4/5)" srcSet="/home-room/still-portrait.webp" />
          <img className={styles.still} src="/home-room/still-landscape.webp" alt="" decoding="async" />
        </picture>
      )}
    </div>
  )
}
