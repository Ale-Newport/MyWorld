'use client'

import { useCallback, useEffect, useImperativeHandle, useRef, type Ref } from 'react'
import { roomView } from '../view'
import { defaultView } from './plan'
import { CanopyRenderer, type Pause } from './renderer'
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
  /**
   * Resolves once the cover is verifiably hiding the whole viewport: the
   * opaque layer computes fully opaque, its box reaches every edge of the
   * viewport, and that has held for two consecutive presented frames.
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
  onOpened?: () => void
  handleRef?: Ref<CoverHandle>
}

/** The parting's length; the CSS transitions fit inside it. */
const OPEN_MS = 1500
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

export function CanopyCover({ initial = 0, budget = 1, reduced = false, onOpened, handleRef }: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const deepRef = useRef<HTMLSpanElement>(null)
  const layersRef = useRef<HTMLDivElement>(null)
  const cover = useRef({ charge: initial, renderer: null as CanopyRenderer | null, sealed: initial >= 1 || reduced, opened: false })

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
    const r = s.renderer
    s.renderer = null
    const host = layersRef.current
    if (r && host && !r.lost) {
      // Ready or not: whatever is left of the build is done now, and
      // the full charge applied without drawing it (the frozen frame
      // is drawn band by band).
      r.finishNow()
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

  useEffect(() => {
    const s = cover.current
    deepen(s.sealed ? 1 : s.charge)
    if (s.sealed) return
    const root = rootRef.current
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
        return
      }
      const { w, h } = size()
      r.resize(w, h, window.devicePixelRatio || 1)
      r.canvas.className = styles.live
      layersRef.current?.appendChild(r.canvas)
      s.renderer = r
      r.applyCharge(s.charge)
      void r.setView(view(), pause)
    }
    const idleId = window.setTimeout(make, 0)

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
      window.clearTimeout(idleId)
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

  useImperativeHandle(handleRef, () => ({
    set(c: number) {
      const s = cover.current
      const q = clamp01(c)
      if (s.sealed || s.opened) return
      s.charge = q
      deepen(q)
      if (q >= 1) seal()
      else s.renderer?.setCharge(q)
    },
    whenCovered() {
      return new Promise<void>((resolve) => {
        let stable = 0
        const check = () => {
          const root = rootRef.current
          const deep = deepRef.current
          if (root && deep && root.isConnected) {
            const r = deep.getBoundingClientRect()
            const vw = document.documentElement.clientWidth || window.innerWidth
            const vh = window.innerHeight
            const spans = r.left <= 0.5 && r.top <= 0.5 && r.right >= vw - 0.5 && r.bottom >= vh - 0.5
            let opaque = Number(getComputedStyle(deep).opacity) >= 0.999
            for (let el: HTMLElement | null = deep; opaque && el; el = el.parentElement) {
              const cs = getComputedStyle(el)
              if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.999) opaque = false
            }
            stable = spans && opaque ? stable + 1 : 0
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
      seal()
      // The transitions are armed by the attribute; set a frame later
      // so they run rather than jump.
      requestAnimationFrame(() => {
        const root = rootRef.current
        if (root) {
          root.dataset.open = 'true'
          // The world under the parting leaves is the visitor's again.
          root.dataset.blocking = 'false'
        }
        // The charge wrote the dark's opacity inline; let the parting's
        // rule (and its transition) take it from here.
        if (deepRef.current) deepRef.current.style.opacity = ''
      })
      window.setTimeout(() => onOpened?.(), OPEN_MS)
    },
  }), [onOpened, deepen, seal])

  return (
    <div ref={rootRef} className={styles.root} aria-hidden="true" data-reduced={reduced || undefined}>
      <span ref={deepRef} className={styles.deep} />
      <div ref={layersRef} className={styles.layers} />
    </div>
  )
}
