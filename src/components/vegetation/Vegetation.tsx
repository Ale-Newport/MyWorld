'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useJourney, frame, type PerformanceTier } from '@/state/journey'
import { clamp, easeOutCubic } from '@/lib/math'
import { subscribe } from '@/lib/ticker'
import { mulberry32, pickKind, sprig, type FloraKind, type FloraSprig } from './flora'
import styles from './vegetation.module.css'

/* ============================================================
   VEGETATION — THE MARGINS GROWING IN

   The page is white and stays white. What changes across a
   journey is how much has taken root at its edges: nothing at
   the top, one or two sprouts by the first chapter, and by the
   foot of the document a thin botanical frame that was never
   announced. The reader is meant to notice it has been
   growing, not to notice a plant.

   Density is therefore a function of one number — frame.progress,
   which is already journey-relative and so behaves identically
   on the home journey and on /projects. Each sprig owns a
   threshold on that number and a short ramp; crossing the
   threshold upward draws it on, crossing back down takes it
   away again. Nothing here is a one-way animation, because a
   visitor scrolling back up has not undone their reading and
   should not be left with a garden they scrolled past.

   Everything the layer does per frame is written straight to
   the DOM. React sees this component when the viewport changes
   size, when the tier changes, and never otherwise.

   ABSORBED, NOT REPLACED
   On the home journey this sheet is now the NEAR-BACKGROUND band
   of the larger nature system: same arrangement, same markup, the
   same place in the stack at z 4, and the same growth — but
   driven from that system's single ticker callback rather than
   from one of its own. Two full-viewport fixed SVGs both ticking
   is a straight doubling of the layer's cost for no gain. The
   controller asks for a driver with `managed`, and this component
   hands one over and stays out of the ticker entirely.

   On `/projects` nothing changes. That route mounts this layer
   exactly as it always has, with its own subscription, its own
   cadence and its own visibility handling, and the arrangement it
   plants is identical to the one it planted yesterday — the
   scripted openers below are gated on `scripted`, which only the
   home controller passes, and they are built from their own seeds
   after the procedural pass so they cannot disturb its RNG stream.
   ============================================================ */

/** The arrangement is fixed for the life of the site — only its
    positions reflow. Change this and the garden is replanted. */
const SEED = 0x5eed17

/** Sprigs per tier. Above thirty the margins stop reading as an
    accent; below six they read as an accident. */
const COUNT: Record<PerformanceTier, number> = { high: 30, medium: 16, low: 7 }

/** The still arrangement is smaller as well as motionless: it
    arrives all at once, and all at once is a lot of plant. */
const STILL_COUNT: Record<PerformanceTier, number> = { high: 12, medium: 10, low: 6 }

/**
 * How the thresholds are spread. Solved as count(p) ≈ N·pᴷ, so
 * the rank-th plant germinates at p = (rank/N)^(1/K): with K
 * above one the early page is nearly bare and the last third
 * does most of the filling in, which is the shape the brief
 * describes rather than a straight line.
 */
const FILL_POWER = 1.9
/** Where the first plant may appear, and how much of the journey
    the whole sequence is allowed to occupy. */
const FIRST_AT = 0.02
const FILL_SPAN = 0.9

/** Progress that must pass before a sprig is fully drawn. Long
    enough to read as growth, short enough that a plant is never
    caught half-finished for a whole chapter. */
const RAMP_MIN = 0.05
const RAMP_MAX = 0.1

/** Below this the gutters are too narrow to hold anything that
    would not sit under running text. */
const NARROW = 720

/**
 * How often the sway is allowed to redraw while the page is not
 * being scrolled. The fastest plant in the arrangement turns
 * about half a degree a second, so twelve updates a second move
 * it three hundredths of a degree at a time — finer than the eye
 * can follow at that speed, and a fifth of the repaints.
 */
const SWAY_IDLE_MS = 1000 / 12

/**
 * The box the layer actually occupies. `position: fixed; inset: 0`
 * resolves against the initial containing block, which is exactly
 * what the document element reports as its client box — with any
 * classic scrollbar already deducted. window.innerWidth is not
 * that number, and a surface a scrollbar wider than the host that
 * clips it loses its rightmost gutter.
 */
const viewport = () => ({
  w: document.documentElement.clientWidth,
  h: document.documentElement.clientHeight,
})

/* ------------------------------------------------------------
   PLACEMENT

   Four zones, and the direction a sprig grows is (sin θ, −cos θ)
   for a placement rotation of θ — up at 0°, into the page from
   the left edge at 90°, down from the crown at 180°. That single
   identity is why the side and crown plants need no separate
   geometry: flora.ts always draws upward, and the margin decides
   what upward means.
   ------------------------------------------------------------ */
type Zone = 'bottom' | 'left' | 'right' | 'crown'

interface Plant {
  id: string
  paths: string[]
  dots: FloraSprig['dots']
  /** Static SVG transform: where the base sits and which way it grows. */
  place: string
  scale: number
  opacity: number
  far: boolean
  t0: number
  ramp: number
  swayAmp: number
  swayRate: number
  swayPhase: number
}

const between = (r: () => number, lo: number, hi: number) => lo + r() * (hi - lo)
const round = (v: number) => Math.round(v * 100) / 100

/* ------------------------------------------------------------
   THE SCRIPTED OPENERS

   The germination curve gives the prelude nothing: at high tier
   the first procedural sprig appears at 12.4 % of the journey, at
   low tier not until 24.4 %. That is deliberate and it is kept —
   lowering FIRST_AT to reach the opening would fill all four
   margins at once and destroy it. So the two plants the prelude
   needs are placed by hand, in the lower-right quadrant beneath
   and behind the BR corner label, on the field grid's own ground
   plane: the first thing growing out of the machine's floor.

   They are sorted first in the arrangement, so a tier cut never
   takes them, and they are capped at a third of a degree of sway.
   A nine-tenths-of-a-degree turn on a 26 px sprig is the only
   motion on an otherwise still screen, and it would catch exactly
   the eye it is there to escape.
   ------------------------------------------------------------ */
interface Opener {
  kind: FloraKind
  /** Viewport fractions, from the measured prelude at 1440x900. */
  x: number
  y: number
  scale: number
  opacity: number
  t0: number
  seed: number
  /** Below the narrow width two sprigs in one side band read as a clump. */
  keepNarrow: boolean
}

const OPENERS: Opener[] = [
  { kind: 'sprout', x: 0.7556, y: 0.7911, scale: 0.26, opacity: 0.5, t0: 0.015, seed: 0x5eed91, keepNarrow: true },
  { kind: 'seedhead', x: 0.6986, y: 0.8511, scale: 0.17, opacity: 0.46, t0: 0.075, seed: 0x5eed92, keepNarrow: false },
]

/** Crown sprigs hang; a fern hanging upside down reads as a mistake. */
const HANGING: FloraKind[] = ['tendril', 'grass', 'sprout']

/** How late a zone is allowed to fill. The ground goes first and
    the crown last, so the frame closes from the bottom up. */
const ZONE_LATENESS: Record<Zone, number> = { bottom: 0, left: 0.28, right: 0.28, crown: 0.55 }

function arrange(w: number, h: number, count: number, scripted: boolean): Plant[] {
  const r = mulberry32(SEED + count * 7919)
  const narrow = w < NARROW
  /* The margin a side plant may occupy. Tied to the viewport
     rather than to --gutter, because the gutter collapses to
     twenty pixels on a phone and a plant that size is a smudge. */
  const band = Math.min(150, Math.max(46, w * 0.1))

  const perSide = Math.round(count * (narrow ? 0.1 : 0.19))
  const crowns = narrow ? 0 : Math.round(count * 0.1)
  const grounded = Math.max(1, count - perSide * 2 - crowns)

  const drafts: { plant: Plant; order: number }[] = []

  const add = (zone: Zone, x: number, y: number, rot: number, scale: number, opacity: number) => {
    const kind = zone === 'crown' ? HANGING[Math.floor(r() * HANGING.length)] : pickKind(r)
    const shape = sprig(kind, Math.floor(r() * 0xffffff))
    /* Mirroring doubles the vocabulary for free and costs a sign. */
    const mirror = r() < 0.5 ? -1 : 1
    const far = r() < 0.42
    drafts.push({
      plant: {
        id: `f${drafts.length}`,
        paths: shape.paths,
        dots: shape.dots,
        place: `translate(${round(x)} ${round(y)}) rotate(${round(rot)}) scale(${mirror} 1)`,
        scale: round(scale),
        opacity: round(opacity * (far ? 0.9 : 1)),
        far,
        t0: 0,
        ramp: between(r, RAMP_MIN, RAMP_MAX),
        swayAmp: between(r, 0.28, 0.9),
        swayRate: between(r, 0.25, 0.55),
        swayPhase: r() * Math.PI * 2,
      },
      /* Quiet, low-lying plants come up first; a fern in the crown
         is the last thing to arrive. Mass and zone decide most of
         it and a little noise keeps the sequence from marching. */
      order: shape.mass * 0.62 + ZONE_LATENESS[zone] + r() * 0.42,
    })
  }

  /* ---- the ground ---------------------------------------- */
  for (let i = 0; i < grounded; i++) {
    // Stratified rather than uniform: uniform x on a strip this
    // wide clumps, and three sprigs in a huddle read as one shrub.
    const x = ((i + between(r, 0.15, 0.85)) / grounded) * w
    /* Nothing grows tall directly under the running text. The
       chapters are centred, so the middle three-fifths of the
       bottom edge is where legibility is actually at risk. */
    const middle = 1 - Math.min(1, Math.abs(x / w - 0.5) / 0.3)
    add(
      'bottom',
      x,
      // Rooted a hair below the fold, so no sprig shows a cut stem.
      h + between(r, 1, 9),
      between(r, -9, 9),
      ((h * between(r, 0.105, 0.2)) / 100) * (1 - 0.42 * middle),
      between(r, 0.55, 1) * (1 - 0.5 * middle),
    )
  }

  /* ---- the gutters --------------------------------------- */
  for (const side of ['left', 'right'] as const) {
    for (let i = 0; i < perSide; i++) {
      const y = (0.2 + ((i + between(r, 0.1, 0.9)) / Math.max(1, perSide)) * 0.78) * h
      const rot = between(r, 66, 92) * (side === 'left' ? 1 : -1)
      add(
        side,
        side === 'left' ? between(r, -2, band * 0.34) : w - between(r, -2, band * 0.34),
        y,
        rot,
        (band * between(r, 0.62, 1.02)) / 100,
        between(r, 0.4, 0.85),
      )
    }
  }

  /* ---- the crown ----------------------------------------- */
  for (let i = 0; i < crowns; i++) {
    const left = i % 2 === 0
    add(
      'crown',
      left ? between(r, 0.02, 0.2) * w : between(r, 0.8, 0.98) * w,
      between(r, -4, 2),
      between(r, 152, 196) * (left ? 1 : -1),
      (h * between(r, 0.06, 0.1)) / 100,
      between(r, 0.3, 0.6),
    )
  }

  /* ---- germination order --------------------------------- */
  drafts.sort((a, b) => a.order - b.order)
  const n = Math.max(1, drafts.length)
  const planted = drafts.map((d, rank) => ({
    ...d.plant,
    t0: round(FIRST_AT + FILL_SPAN * Math.pow((rank + 0.5) / n, 1 / FILL_POWER)),
  }))

  if (!scripted) return planted

  const openers: Plant[] = []
  for (const o of OPENERS) {
    if (narrow && !o.keepNarrow) continue
    // Its own generator, drawn after the procedural pass, so the
    // arrangement /projects plants is bit-for-bit what it was.
    const or = mulberry32(o.seed)
    const shape = sprig(o.kind, Math.floor(or() * 0xffffff))
    openers.push({
      id: `o${openers.length}`,
      paths: shape.paths,
      dots: shape.dots,
      place: `translate(${round(o.x * w)} ${round(o.y * h)}) rotate(${round(between(or, -5, 5))})`,
      scale: o.scale,
      opacity: o.opacity,
      far: true,
      t0: o.t0,
      ramp: between(or, RAMP_MIN, RAMP_MAX),
      swayAmp: between(or, 0.2, 0.35),
      swayRate: between(or, 0.25, 0.4),
      swayPhase: or() * Math.PI * 2,
    })
  }
  return [...openers, ...planted]
}

/* ============================================================
   THE HANDLE

   What the home controller is given in place of a subscription:
   one function that writes this layer's frame and reports how
   many properties it touched, so the nature system's per-frame
   write cap covers the sprigs as well as the canopy.
   ============================================================ */
export interface FloraHandle {
  /** Sprigs in the current arrangement. */
  count: number
  /**
   * Writes straight to the DOM and returns the number of writes
   * made. `lean` is the shared degrees of tilt the whole system
   * carries; `swaying` is the tier gate, decided by the caller.
   */
  tick: (p: number, now: number, lean: number, swaying: boolean) => number
}

export interface VegetationProps {
  /**
   * Drive this layer from the caller's ticker instead of from one
   * of its own. The home journey's nature controller passes it;
   * `/projects` does not, and keeps today's behaviour exactly.
   */
  managed?: boolean
  /** Plant the prelude's two hand-placed openers. Home only. */
  scripted?: boolean
  onHandle?: (handle: FloraHandle | null) => void
}

/* ============================================================
   THE LAYER
   ============================================================ */
export function Vegetation({ managed = false, scripted = false, onHandle }: VegetationProps = {}) {
  const tier = useJourney((s) => s.performanceTier)
  const reducedMotion = useJourney((s) => s.reducedMotion)
  const hostRef = useRef<HTMLDivElement>(null)

  /* The store is fed from the same media query by the journey
     provider, but this layer is mounted on more than one route
     and must be able to answer the question on its own. */
  const [systemStill, setSystemStill] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const apply = () => setSystemStill(mq.matches)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])

  const still = reducedMotion || systemStill

  /* ---- viewport ------------------------------------------
     Null until measured: there is no honest server-side answer
     to how wide the margins are, and half a garden rendered at
     the wrong size then snapping is worse than a late one. */
  const [box, setBox] = useState<{ w: number; h: number } | null>(null)
  const surfaceRef = useRef<SVGSVGElement>(null)
  /** The viewport the current arrangement was planted for. Not
      state: only the surface reads it, and it must be readable
      from a resize handler that deliberately causes no render. */
  const plantedRef = useRef({ w: 0, h: 0 })

  /* ---- the drawing surface -------------------------------
     The arrangement is coarse on purpose — see measure() — but
     the surface must never be. An SVG whose viewBox is one size
     and whose box is another does not simply sit there: with the
     default preserveAspectRatio it rescales and re-centres, so a
     viewport a hundred points taller lifts the ground line off
     the bottom of the screen and a narrower one pulls the whole
     garden in from both gutters. Every value below therefore
     tracks the live viewport, and only the plant positions are
     allowed to lag.

     Width and height are written in pixels and the viewBox is
     given the same dimensions, which pins the scale at exactly
     one user unit per CSS pixel however far the arrangement has
     drifted — that is the invariant --flora-hair depends on. The
     origin is what absorbs the drift: shifted so the planted
     ground line stays welded to the bottom edge and the planted
     width stays centred, the alignment preserveAspectRatio would
     call xMidYMax, but at a fixed scale rather than a fitted one.
     Anchoring the foot rather than the head is a choice about
     where the plants are: the ground carries half the arrangement
     on a desktop and four fifths of it on a phone, and a stub of
     stem hanging in mid-air there is the failure everyone would
     see. The crown — at most three sprigs, and none at all below
     the narrow width — drifts instead.
     ------------------------------------------------------- */
  const syncSurface = useCallback(() => {
    const svg = surfaceRef.current
    if (!svg) return
    const { w, h } = viewport()
    const planted = plantedRef.current
    svg.setAttribute('width', String(w))
    svg.setAttribute('height', String(h))
    svg.setAttribute('viewBox', `${round((planted.w - w) / 2)} ${round(planted.h - h)} ${w} ${h}`)
  }, [])

  /* React writes the attributes above from `box`, which is the
     planted size and not always the live one, so every render
     has to be corrected. On the render that first mounts the
     svg the two agree and this is a no-op. */
  useEffect(syncSurface)

  useEffect(() => {
    const measure = () => {
      const { w: nw, h: nh } = viewport()
      const { w, h } = plantedRef.current
      /* A phone hiding its address bar changes the viewport height
         by a hundred points and back again, several times a scroll.
         Replanting on every one of those would be visible as a
         flicker and expensive as a habit, so only a real change
         in the shape of the page counts. */
      if (Math.abs(nw - w) < 24 && Math.abs(nh - h) < 140) return
      plantedRef.current = { w: nw, h: nh }
      setBox({ w: nw, h: nh })
    }

    let timer = 0
    measure()
    const onResize = () => {
      // The surface follows every event; only the replanting waits
      // to see whether the change was real.
      syncSurface()
      window.clearTimeout(timer)
      timer = window.setTimeout(measure, 160)
    }
    window.addEventListener('resize', onResize)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('resize', onResize)
    }
  }, [syncSurface])

  const count = still ? STILL_COUNT[tier] : COUNT[tier]
  const plants = useMemo(
    () => (box ? arrange(box.w, box.h, count, scripted) : []),
    [box, count, scripted],
  )

  /* ---- growth --------------------------------------------
     One driver for the whole layer, and inside it the only three
     things written are a group's opacity, a group's transform and
     one inherited stroke-dashoffset. Nothing is read back from the
     DOM, so no frame here can force a layout, and the node handles
     are collected once rather than queried per tick.

     The driver is built separately from the subscription that
     usually runs it, because on the home journey it is not this
     component that runs it at all — the nature controller calls it
     from the single callback that also drives the six canopy
     bands. Same arithmetic, same guards, same write caches; one
     rAF loop instead of two.
     ------------------------------------------------------- */
  useEffect(() => {
    if (still || plants.length === 0) return
    const root = hostRef.current
    if (!root) return

    const nodes = Array.from(root.querySelectorAll<SVGGElement>('g[data-flora]'))
    if (nodes.length !== plants.length) return
    const stems = nodes.map((node) => node.firstElementChild as SVGGElement | null)
    const seeds = nodes.map((node) => node.querySelector<SVGGElement>('g[data-seeds]'))

    /* ---- what the sway is allowed to cost ------------------
       Growth is a response to the reader and runs whenever the
       scroll has moved. Sway is not: it is ambient, and left
       alone it writes a transform per plant per frame forever,
       on every route, for a page nobody is scrolling. Each write
       dirties a subtree of one shared full-viewport fixed SVG
       whose plants line all four margins, so the union of those
       rectangles is the whole perimeter and the layer re-rasters
       every frame at idle.

       Three limits, and the reasoning for choosing all three
       rather than one: the tier gate is the only one that helps
       the devices that need help most, the cadence is the only
       one that helps the desktop where sway survives, and the
       visibility gate is the only one that helps a tab nobody is
       even looking at.

       Sway is high tier alone. detectDevice puts every phone not
       detected as low into medium, so 'not low' was in practice
       'every phone', and a phone is exactly where a perpetual
       full-width repaint is least affordable. Medium gets the
       still garden low already got: it still grows, it simply
       does not breathe.

       At idle the sway updates twelve times a second rather than
       sixty. The earlier note here claimed most frames round to
       the transform already on the element; they do not. The
       fastest plant turns 0.495 deg/s, which is eight tenths of
       the 1/100-degree step per frame, and the shared lean adds
       the same delta to every plant at once, so under any change
       of scroll speed the whole garden crosses together. Rate is
       what has to be limited, not equality.
       ------------------------------------------------------- */
    const grown = new Float32Array(plants.length).fill(-1)
    /* Last values actually written, in the units they are written
       in — a second line of defence, and what spares the plants
       whose own sway is slower than the cadence above. */
    const wroteAngle = new Int32Array(plants.length).fill(1 << 30)
    const wroteScale = new Int32Array(plants.length)
    let lastProgress = -1
    let nextSway = 0

    /** Returns the number of DOM writes it made. */
    const drive = (p: number, now: number, lean: number, swaying: boolean): number => {
      const moved = Math.abs(p - lastProgress) > 0.0002
      // Standing still without sway costs one comparison a frame.
      if (!moved && !swaying) return 0
      if (!moved && now < nextSway) return 0
      if (moved) lastProgress = p
      nextSway = now + SWAY_IDLE_MS

      const t = now * 0.001
      let writes = 0

      for (let i = 0; i < plants.length; i++) {
        const plant = plants[i]
        const g = clamp((p - plant.t0) / plant.ramp)
        const node = nodes[i]

        if (Math.abs(g - grown[i]) > 0.001) {
          grown[i] = g
          const drawn = easeOutCubic(g)
          node.style.strokeDashoffset = (1 - drawn).toFixed(3)
          // Opacity runs ahead of the dash so a half-drawn sprig
          // still reads as ink rather than as a fading line.
          node.style.opacity = (plant.opacity * easeOutCubic(Math.min(1, g * 1.8))).toFixed(3)
          writes += 2
          const seed = seeds[i]
          if (seed) {
            seed.style.opacity = clamp((g - 0.7) / 0.3).toFixed(3)
            writes++
          }
        }

        // Fully retracted: no transform is worth writing.
        if (g === 0) continue

        const stem = stems[i]
        if (!stem) continue
        // The last of the settle happens after the drawing is done,
        // so a finished plant is still quietly finding its height.
        const k = Math.round(plant.scale * (0.88 + 0.12 * easeOutCubic(g)) * 1e4)
        const angle = swaying
          ? Math.round((plant.swayAmp * Math.sin(t * plant.swayRate + plant.swayPhase) + lean) * 100)
          : 0
        if (angle === wroteAngle[i] && k === wroteScale[i]) continue
        wroteAngle[i] = angle
        wroteScale[i] = k
        // The attribute, not the style property: see the module CSS
        // for why a nested SVG group is pivoted this way.
        stem.setAttribute('transform', `rotate(${angle / 100}) scale(${k / 1e4})`)
        writes++
      }
      return writes
    }

    /* ---- who turns the handle ------------------------------
       Managed: nobody here. The handle goes to the controller,
       which calls it from the one subscription the nature system
       is allowed, and takes it back on unmount — module-level
       state survives a route change in the same JS context, and a
       driver left behind is a driver writing to a detached tree. */
    if (managed) {
      onHandle?.({ count: plants.length, tick: drive })
      return () => onHandle?.(null)
    }

    const swaying = tier === 'high'
    const tick = (_dt: number, now: number) => {
      /* The whole layer leans very slightly with the scroll, which
         is one number for thirty plants rather than thirty. */
      const lean = swaying ? clamp(frame.velocity * 6, -1, 1) * 1.4 : 0
      drive(frame.progress, now, lean, swaying)
    }

    /* A plant swaying in a background tab is pure waste, and the
       ticker is shared, so the only way to stop paying for it is
       to leave the subscription. Nothing is lost by doing so: the
       sway is a function of absolute time and the growth of
       frame.progress, both of which are read fresh on the way
       back in, so a hidden tab resumes rather than replays.

       What visibility may NOT do is decide whether this ever
       starts. `attach` used to require `!document.hidden`, so a
       sheet that mounted in a background tab — a link opened into
       one, a restored session, a prerender, an automated pass on a
       tab that is not the front one — waited for a
       `visibilitychange` that only ever fires on the way IN, and
       therefore never came. The sprigs were arranged and then left
       at zero for the life of the page. A subscription held while
       hidden costs a Set entry and nothing else, because a hidden
       tab is not given animation frames; the handler below is what
       lets go, and letting go is all it was ever needed for. This
       is the same correction as the one in NatureController, which
       is the other half of the same layer. */
    let stop: (() => void) | null = null
    const attach = () => {
      if (!stop) stop = subscribe(tick)
    }
    const detach = () => {
      stop?.()
      stop = null
    }
    const onVisibility = () => {
      if (document.hidden) detach()
      else attach()
    }

    attach()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      detach()
    }
  }, [plants, still, tier, managed, onHandle])

  if (!box || plants.length === 0) return null

  return (
    <div
      ref={hostRef}
      className={styles.host}
      data-still={still ? 'true' : 'false'}
      /* The density probe counts `[data-nature] *`, and on the home
         journey this sheet is one of the system's bands. It is not
         one on /projects, and does not claim to be. */
      data-nature={managed ? 'flora' : undefined}
      aria-hidden="true"
    >
      {/* The viewBox is the viewport in pixels, so one user unit is
          one CSS pixel. That is what lets the layout below think in
          pixels, and what makes --flora-hair mean what it says once
          a sprig has divided it by its own scale. These three values
          are correct only for the instant the garden was planted;
          syncSurface above keeps them level with the live viewport
          from then on. */}
      <svg
        ref={surfaceRef}
        className={styles.canvas}
        viewBox={`0 0 ${box.w} ${box.h}`}
        width={box.w}
        height={box.h}
        focusable="false"
        role="presentation"
      >
        {plants.map((plant) => (
          <g
            key={plant.id}
            data-flora=""
            transform={plant.place}
            className={plant.far ? `${styles.plant} ${styles.far}` : styles.plant}
            style={
              {
                opacity: still ? plant.opacity : 0,
                strokeDashoffset: still ? 0 : 1,
                '--sprig-scale': String(plant.scale),
              } as CSSProperties
            }
          >
            <g transform={`rotate(0) scale(${still ? plant.scale : plant.scale * 0.88})`}>
              <g transform="translate(-50 -100)">
                {plant.paths.map((d, i) => (
                  <path key={i} d={d} pathLength={1} />
                ))}
                {plant.dots.length > 0 && (
                  <g data-seeds="" className={styles.seeds} style={{ opacity: still ? 1 : 0 }}>
                    {plant.dots.map((dot, i) => (
                      <circle key={i} cx={dot.x} cy={dot.y} r={dot.r} />
                    ))}
                  </g>
                )}
              </g>
            </g>
          </g>
        ))}
      </svg>
    </div>
  )
}
