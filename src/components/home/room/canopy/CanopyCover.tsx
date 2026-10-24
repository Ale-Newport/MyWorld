'use client'

import { useCallback, useEffect, useImperativeHandle, useRef, type Ref } from 'react'
import { roomView } from '../view'
import { defaultView } from './plan'
import { CanopyRenderer, type Pause } from './renderer'
import { standing } from './standing'
import styles from './canopy.module.css'

/* ============================================================
   THE CANOPY COVER
   The leaves that close over the whole screen — page, HUD and all —
   as the visitor pushes past the end, and that part again when the
   world behind them is ready. Mounted once in the root layout (see
   `botanical/garden.ts`), so the route changes underneath it.

   While the charge builds, the canopy is drawn live, in 3D, through
   the room's lens (CanopyRenderer). The moment it is full, its last
   frame is handed to plain canvases — the deep, middle and near
   leaves, each split down the middle by the side their stems came
   in from (whole plants, so no leaf is ever cut) — and its WebGL
   context is let go before the world asks for one. Parting is then
   a CSS transition of those canvases' transforms and opacity: the
   compositor's work alone, so it keeps its pace however busy the
   world's first seconds are. The ivy opens down the middle, the near
   leaves sweeping out first and furthest, the deep ones last and
   least: the visitor goes through it, onto the world.
   ============================================================ */

export interface CoverHandle {
  /** The charge, 0..1. */
  set(charge: number): void
  /** Part the leaves. */
  open(): void
  /** Close them again, from wherever the parting has got to (the way in is taken again while they part). False if they were not parting. */
  close(): boolean
  /**
   * Resolves once the cover is verifiably hiding the whole viewport: the
   * opaque layer computes fully opaque, its box reaches every edge of the
   * viewport, and that has held for two consecutive presented frames — and,
   * for an arrival whose leaves come up out of the dark, once they have.
   */
  whenCovered(): Promise<void>
}

interface Props {
  /** Starting charge: 1 for an arrival nobody watched grow. */
  initial?: number
  /** Below 1 on devices the journey judged slow: fewer leaves and pixels. */
  budget?: number
  /** Reduced motion: no leaves are grown; the dark of the hedge fades in and out. */
  reduced?: boolean
  /** Settings → Leaf parting: multiplies the parting's durations (1 = as designed). */
  partScale?: number
  onOpened?: () => void
  handleRef?: Ref<CoverHandle>
}

/** From this charge on the canopy stands over the page: it takes the
    clicks too, so nothing hidden under the leaves can be followed. */
const BLOCK_AT = 0.35

type IdleWindow = Window & {
  requestIdleCallback?: (cb: (deadline: { timeRemaining(): number }) => void, o?: { timeout: number }) => number
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/** An idle moment (and how much of it is left), or a frame's worth. */
const pause: Pause = () =>
  new Promise((resolve) => {
    const win = window as IdleWindow
    if (typeof win.requestIdleCallback === 'function') win.requestIdleCallback((d) => resolve(d), { timeout: 250 })
    else window.setTimeout(() => resolve({ timeRemaining: () => 0 }), 16)
  })

/** For an arrival nobody is scrolling toward (a reload, Forward, a shared link): the world's frame is created beside this page
    at once and keeps the main thread busy for seconds, and an idle moment may not come in all that time. Nothing here needs
    to stay smooth — the page is the dark of the hedge — so the canopy is built in the first moments there are, in one or
    two generous slices (about 50 ms each) instead of waiting for idle time that the world's boot never leaves. */
const hurry: Pause = () =>
  new Promise((resolve) => {
    window.setTimeout(() => {
      const t0 = performance.now()
      resolve({ timeRemaining: () => 50 - (performance.now() - t0) })
    }, 0)
  })

export function CanopyCover({ initial = 0, budget = 1, reduced = false, partScale = 1, onOpened, handleRef }: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const deepRef = useRef<HTMLSpanElement>(null)
  const layersRef = useRef<HTMLDivElement>(null)
  const cover = useRef({ charge: initial, renderer: null as CanopyRenderer | null, sealed: reduced, fallback: false, opened: false, parting: 0, sealFrame: 0 })

  /* The dark of the leaves behind the last ones — from late in the
     charge no gap between leaves can show the page — and, once the
     canopy stands over the page, its hold on the clicks. */
  const deepen = useCallback((c: number) => {
    const el = deepRef.current
    if (el) el.style.opacity = clamp01((c - 0.8) / 0.17).toFixed(3)
    const root = rootRef.current
    if (root && !cover.current.opened) root.dataset.blocking = c >= BLOCK_AT ? 'true' : 'false'
  }, [])

  /* The last frame, handed to the DOM; the context let go. */
  const seal = useCallback(() => {
    const s = cover.current
    if (s.sealed) return
    s.sealed = true
    if (rootRef.current) rootRef.current.dataset.sealed = 'true'
    const r = s.renderer
    s.renderer = null
    const host = layersRef.current
    if (r && host && !r.lost) {
      // Only a prepared renderer is sealed; no synchronous build lands
      // on the gesture that completes the cover.
      r.applyCharge(1)
      const shots = r.snapshot()
      for (const { canvas, band, side } of shots) {
        canvas.className = styles.layer
        canvas.dataset.band = String(band)
        canvas.dataset.side = side ? 'right' : 'left'
      }
      host.replaceChildren(...shots.map((shot) => shot.canvas))
    } else if (host) host.replaceChildren()
    r?.dispose()
    deepen(1)
  }, [deepen])

  /* The charge is full: the canopy is frozen in the frame AFTER the one that completed it. The frame that completes
     the charge also closes the door (the machine writes the lock on <html> and the page's body — style and layout
     for the whole page), and the freeze is six draws and six copies: in one frame they are one long one, and nothing
     is lost by splitting them — the live canvas already shows the full canopy (the dark behind it is at full), and the
     frozen one is the same picture. */
  const sealNextFrame = useCallback(() => {
    const s = cover.current
    if (s.sealed || s.sealFrame) return
    s.sealFrame = requestAnimationFrame(() => {
      s.sealFrame = 0
      if (s.charge >= 1) seal()
    })
  }, [seal])

  useEffect(() => {
    const s = cover.current
    deepen(s.sealed ? 1 : s.charge)
    if (s.sealed) return
    const root = rootRef.current
    /* An arrival nobody watched grow: built at once, not in idle time (see `hurry`). */
    const eager = s.charge >= 1
    let disposed = false
    let made = false
    let retry = 0
    const size = () => {
      const r = root?.getBoundingClientRect()
      return { w: Math.max(1, Math.round(r?.width || window.innerWidth)), h: Math.max(1, Math.round(r?.height || window.innerHeight)) }
    }
    /* The room's own lens (the layer is sized as the room is, to the
       large viewport, so the two agree), or a default one. */
    const view = () => {
      const v = roomView.get()
      if (v) return v
      const { w, h } = size()
      return defaultView(w / h)
    }
    /* Built near the foot, before anyone pushes, in idle slices. */
    const make = () => {
      if (made || disposed || s.sealed) return
      made = true
      let r: CanopyRenderer
      try {
        r = new CanopyRenderer({
          budget,
          // A lost context: let this one go and build afresh.
          onLost: () => {
            if (disposed || s.sealed || s.renderer !== r) return
            s.renderer = null
            r.canvas.remove()
            r.dispose()
            made = false
            retry = window.setTimeout(make, 400)
          },
        })
      } catch {
        // No WebGL2: the dark of the canopy alone covers the page.
        s.sealed = true
        s.fallback = true
        deepen(s.charge)
        return
      }
      const { w, h } = size()
      r.resize(w, h, window.devicePixelRatio || 1)
      r.canvas.className = styles.live
      layersRef.current?.appendChild(r.canvas)
      s.renderer = r
      r.applyCharge(s.charge)
      void r.setView(view(), eager ? hurry : pause).then(() => {
        if (!disposed && s.charge >= 1 && !s.sealed) seal()
      })
      // Read-only probe for the QA scripts: when the canopy was made and when it could first draw.
      const madeAt = performance.now()
      ;(window as unknown as { __canopy?: () => unknown }).__canopy = () => ({ madeAt, ready: r.ready, readyAt: r.readyAt, lost: r.lost })
    }
    /* The context and the plan are made in an idle moment: the cover is
       mounted (at no charge, invisible) a chapter before the foot, so
       there is time to wait for one rather than take a frame from the
       scroll. An arrival that needs it at once (a link into the world)
       gets it within a few frames regardless. */
    const win = window as IdleWindow
    const idleId = !eager && typeof win.requestIdleCallback === 'function'
      ? win.requestIdleCallback(() => make(), { timeout: 120 })
      : window.setTimeout(make, 0)

    let timer = 0
    const onResize = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        const r = s.renderer
        if (!r) return
        const { w, h } = size()
        r.resize(w, h, window.devicePixelRatio || 1)
        void r.setView(view(), pause)
      }, 160)
    }
    window.addEventListener('resize', onResize)
    const unsubscribe = roomView.subscribe(() => {
      const r = s.renderer
      if (r) void r.setView(view(), pause)
    })
    /* The homepage gives its contexts back just before the route
       changes; if the charge has not sealed the canopy by then, it
       is sealed now. */
    const onLeaving = () => {
      if (s.charge >= 0.999) seal()
    }
    window.addEventListener('journey:leaving', onLeaving)

    return () => {
      disposed = true
      cancelAnimationFrame(s.sealFrame)
      s.sealFrame = 0
      if (!eager && typeof win.requestIdleCallback === 'function') (win as IdleWindow & { cancelIdleCallback: (h: number) => void }).cancelIdleCallback(idleId)
      else window.clearTimeout(idleId)
      window.clearTimeout(retry)
      window.clearTimeout(timer)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('journey:leaving', onLeaving)
      unsubscribe()
      s.renderer?.canvas.remove()
      s.renderer?.dispose()
      s.renderer = null
    }
  }, [budget, deepen, seal])

  /* Is the page verifiably hidden right now: the opaque layer computes fully opaque,
     its box reaches every edge of the viewport and the cover wins every hit test. */
  const covers = useCallback((): boolean => {
    const root = rootRef.current
    const deep = deepRef.current
    if (!root?.isConnected || !deep) return false
    const r = deep.getBoundingClientRect()
    const vw = document.documentElement.clientWidth || window.innerWidth
    const vh = window.innerHeight
    const spans = r.left <= 0.5 && r.top <= 0.5 && r.right >= vw - 0.5 && r.bottom >= vh - 0.5
    let opaque = Number(getComputedStyle(deep).opacity) >= 0.999
    for (let el: HTMLElement | null = deep; opaque && el; el = el.parentElement) {
      const cs = getComputedStyle(el)
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.999) opaque = false
    }
    // A menu above an opaque cover would still hide the vegetation.
    // WebKit's visual viewport can exclude a scrollbar from innerWidth.
    const visibleW = Math.min(vw, window.visualViewport?.width ?? vw)
    const visibleH = Math.min(vh, window.visualViewport?.height ?? vh)
    const onTop = [[1, 1], [visibleW - 2, 1], [1, visibleH - 2], [visibleW - 2, visibleH - 2], [visibleW / 2, visibleH / 2]]
      .every(([x, y]) => root.contains(document.elementFromPoint(x, y)))
    return spans && opaque && onTop
  }, [])

  /* An arrival's leaves come up out of the dark over a few tenths of a second (canopy.module.css, `layer-in`): until they
     have, the page is hidden by the dark of the hedge alone, and a parting started now would open on nothing. */
  const arriving = useCallback((): boolean => {
    const host = layersRef.current
    if (!host || typeof host.getAnimations !== 'function') return false
    return host.getAnimations({ subtree: true }).some((a) => a.playState !== 'finished' && a.effect?.getTiming().iterations !== Infinity)
  }, [])

  /* A parting taken back: the leaves close again from where they are. */
  const closeParting = useCallback((): boolean => {
    const s = cover.current
    if (!s.opened) return false
    s.opened = false
    s.parting++
    const root = rootRef.current
    if (root) {
      // `closing` carries the transitions back (the parting's own rules are keyed on `open`, which goes).
      root.dataset.closing = 'true'
      delete root.dataset.open
    }
    // The dark of the hedge back to full (it takes the clicks again), as a full charge leaves it.
    deepen(1)
    return true
  }, [deepen])

  useImperativeHandle(handleRef, () => ({
    set(c: number) {
      const s = cover.current
      const q = clamp01(c)
      if (s.opened) return
      if (s.sealed) {
        if (s.fallback) { s.charge = q; deepen(q) }
        return
      }
      s.charge = q
      deepen(q)
      if (q >= 1 && s.renderer?.ready) sealNextFrame()
      else s.renderer?.setCharge(q)
    },
    whenCovered() {
      return new Promise<void>((resolve) => {
        // Verified before, still sealed and still hiding everything: the two presented
        // frames were spent the first time, so say so again at once (the world's ready
        // signal then parts the leaves without a further two frames of dead time).
        const first = rootRef.current
        if (first?.dataset.covered === 'true' && cover.current.sealed && !cover.current.opened && covers()) {
          resolve()
          return
        }
        let stable = 0
        const check = () => {
          const root = rootRef.current
          if (!root?.isConnected) return
          if (deepRef.current && cover.current.sealed) {
            stable = !arriving() && covers() ? stable + 1 : 0
            // Two in a row: the covered frame has been presented, not merely laid out.
            if (stable >= 2) {
              root.dataset.covered = 'true'
              resolve()
              return
            }
          }
          requestAnimationFrame(check)
        }
        requestAnimationFrame(check)
      })
    },
    open() {
      const s = cover.current
      if (s.opened) return
      s.opened = true
      // A parting that is closed again (close()) must not be finished by the frames this one scheduled.
      const turn = ++s.parting
      seal()
      // The transitions are armed by the attribute; set a frame later
      // so they run rather than jump.
      requestAnimationFrame(() => {
        const root = rootRef.current
        if (turn !== s.parting) return
        if (root) {
          delete root.dataset.closing
          root.dataset.open = 'true'
          // The world under the parting leaves is the visitor's again.
          root.dataset.blocking = 'false'
        }
        // The charge wrote the dark's opacity inline; let the parting's
        // rule (and its transition) take it from here.
        if (deepRef.current) deepRef.current.style.opacity = ''
      })
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const root = rootRef.current
        if (!root || turn !== s.parting) return
        void Promise.allSettled(root.getAnimations({ subtree: true }).filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished)).then(() => {
          if (root.isConnected && s.opened && turn === s.parting) onOpened?.()
        })
      }))
    },
    close: closeParting,
  }), [onOpened, deepen, seal, sealNextFrame, covers, arriving, closeParting])

  /* While this cover is the one standing, the machine may ask it to take a parting back. */
  useEffect(() => {
    standing.close = closeParting
    return () => { if (standing.close === closeParting) standing.close = null }
  }, [closeParting])

  return (
    <div ref={rootRef} className={styles.root} aria-hidden="true" data-world-cover="" data-reduced={reduced || undefined} data-arrival={initial >= 1 || undefined} style={{ ['--part' as string]: partScale }}>
      <span ref={deepRef} className={styles.deep} />
      <div ref={layersRef} className={styles.layers} />
    </div>
  )
}
