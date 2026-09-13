'use client'

import { memo, useEffect, useId, useLayoutEffect, useMemo, useRef, type CSSProperties } from 'react'
import type { SiteProject, UniverseAnimationProps } from '../types'
import { TIER_NAME, approach, byTierAndCategory, clamp01, easeOut, fitTitle, labelOf, metaOf, smooth, toneOf, useBoxSize, useHot, useTicker, type Tier } from './shared'
import styles from './Orbits.module.css'

/* ============================================================
   ORBITAL SYSTEM

   An orrery drawn in hairline. The headline work travels the
   innermost orbit, the featured work the middle one and the
   archive the outer one, around a small quiet centre. The orbits
   lie in one plane tilted away from the viewer: the half that
   passes behind the centre is dotted, the way a technical drawing
   marks a hidden edge, and a body on it is a little smaller and
   paler than one passing in front. Headline and featured bodies
   draw a short fading wake of the path they have just travelled.

   Each orbit turns at its own slow pace (inner ones faster, as in
   a real system), scrolling turns them a little further, and
   anything under the pointer or the keyboard's focus brings the
   whole system to rest, so it can be read and chosen.

   Names: every body is named where its orbit has the room. On a
   crowded orbit (a phone, a very large archive) the front of the
   orbit becomes the reading position and names take turns there,
   so none is ever printed over another.

   Intensity: how far the plane tilts and how strongly near and
   far differ. Speed: the orbits' clock.
   ============================================================ */

interface Ring {
  tier: Tier
  rx: number
  ry: number
  /** Radians per second at speed 1. */
  omega: number
  phase: number
  /** Angle between neighbours. */
  step: number
  /** Every body named, or only the one passing the front. */
  all: boolean
  /** Whether this orbit's bodies are named at all (a very small box names only the headline work). */
  named: boolean
  labelMax: number
  /** How far a name leans inward at the ends of the orbit (1: wholly inside, 0: centred). */
  lean: number
  /** How far scrolling the whole chapter turns this orbit, in radians. */
  turn: number
  /** Half the width of the orbit's caption, so it can give way to a body. */
  caption: number
  /** Length of a body's wake, in radians (0: none). */
  wake: number
}

interface Body {
  p: SiteProject
  ring: number
  theta: number
  text: string
}

interface Layout {
  cx: number
  cy: number
  rings: Ring[]
  bodies: Body[]
  depth: number
  compact: boolean
  /** Type sizes for the three tiers. */
  type: [number, number, number]
}

const PERIOD = [96, 140, 200] // seconds per revolution at speed 1
const NODE = [11, 7, 4.5]

function layout(projects: SiteProject[], w: number, h: number, intensity: number): Layout {
  const tiers = byTierAndCategory(projects)
  const present = ([0, 1, 2] as Tier[]).filter((t) => tiers[t].length > 0)
  const compact = w < 560 || h < 300
  const type: [number, number, number] = compact ? [13, 11.5, 9] : w > 1900 ? [18, 14, 10.5] : w > 1500 ? [16, 13, 10] : [15, 12.5, 9.5]
  const fractions = present.length === 3 ? [0.37, 0.69, 1] : present.length === 2 ? [0.56, 1] : [0.78]

  // Names hang below their body, so the system sits a little high.
  const top = Math.max(16, h * 0.07)
  const bottom = Math.max(compact ? 24 : 34, h * 0.09)
  const side = Math.max(18, w * 0.035)
  const cx = w / 2
  const cy = top + (h - top - bottom) / 2
  const rxMax = Math.max(10, w / 2 - side)
  const ryMax = Math.max(10, (h - top - bottom) / 2)
  // The plane's tilt, deeper with intensity. A tall box gets rounder orbits rather than wasted height.
  const tilt = 0.6 - 0.32 * intensity
  const ryOuter = rxMax * tilt >= ryMax ? ryMax : rxMax * tilt + (ryMax - rxMax * tilt) * 0.72
  const depth = 0.35 + 0.65 * intensity

  const rings: Ring[] = present.map((tier, k) => {
    const f = fractions[k]
    const rx = rxMax * f
    const ry = ryOuter * f
    const count = tiers[tier].length
    const step = (Math.PI * 2) / Math.max(1, count)
    const front = rx * step // spacing of neighbours passing in front
    const sideGap = ry * step // spacing at the ends, where they pass one above the other
    const all = !compact && (count <= 2 || (front >= 80 && sideGap >= type[tier] * 3.2))
    // The innermost orbit leans its names least: leaning fully, two names at its two ends would meet over the centre.
    const lean = k === 0 && present.length > 1 ? 0.35 : k === present.length - 1 ? 1 : 0.75
    return {
      tier,
      rx,
      ry,
      omega: (Math.PI * 2) / PERIOD[tier],
      phase: 0.55 + k * 1.1,
      step,
      all,
      named: tier === 0 || h >= 240,
      // Leaning inward at the ends, a name must stop short of the centre;
      // a name read at the front only has the width of the box to mind.
      labelMax: Math.max(56, Math.min(240, all ? Math.min(front * 1.1 - 12, (rx - 14) / (0.5 + 0.5 * lean)) : w * 0.62)),
      lean,
      turn: 0.9 - 0.22 * k,
      caption: TIER_NAME[tier].length * 4.4 + 8,
      wake: tier === 2 ? 0 : Math.min(step * 0.6, (tier === 0 ? 120 : 90) / Math.max(rx, 1)),
    }
  })

  const bodies: Body[] = []
  rings.forEach((r, k) => {
    const list = tiers[r.tier]
    list.forEach((p, i) => {
      const text = fitTitle(p, r.labelMax * 1.8, type[r.tier], r.tier === 2, r.tier === 2 ? 0.14 : 0)
      bodies.push({ p, ring: k, theta: r.phase + (i / list.length) * Math.PI * 2, text })
    })
  })
  return { cx, cy, rings, bodies, depth, compact, type }
}

/** The half of an ellipse in front of the centre (y > cy) or behind it, as a path. */
const arc = (cx: number, cy: number, rx: number, ry: number, front: boolean) =>
  front ? `M ${cx + rx} ${cy} A ${rx} ${ry} 0 0 1 ${cx - rx} ${cy}` : `M ${cx - rx} ${cy} A ${rx} ${ry} 0 0 1 ${cx + rx} ${cy}`

const f1 = (v: number) => v.toFixed(1)

function Orbits({ projects, visible, progress, active, reducedMotion, intensity, speed, onOpen, onHover }: UniverseAnimationProps) {
  const root = useRef<HTMLDivElement>(null)
  const { w, h } = useBoxSize(root)
  const model = useMemo(() => (w > 0 && h > 0 ? layout(projects, w, h, intensity) : null), [projects, w, h, intensity])
  const { hot, bind } = useHot(onHover)
  const uid = useId().replace(/:/g, '')

  const els = useRef<(HTMLButtonElement | null)[]>([])
  const labels = useRef<(HTMLSpanElement | null)[]>([])
  const wakes = useRef<(SVGPathElement | null)[]>([])
  const grads = useRef<(SVGLinearGradientElement | null)[]>([])
  const captions = useRef<(SVGTextElement | null)[]>([])
  const system = useRef<SVGSVGElement>(null)
  const leader = useRef<SVGLineElement>(null)
  const sim = useRef({ spin: [0, 0, 0], pace: 1, open: -1, z: [] as number[], hot: null as string | null })

  useEffect(() => {
    sim.current.hot = hot
  }, [hot])

  /** Writes the pose for the current clock and scroll. Called per frame, and once for a still state. */
  const pose = (still: boolean) => {
    if (!model) return
    const s = sim.current
    const t = still ? 0.5 : progress.current
    const open = still ? 1 : easeOut((t + 0.06) / 0.22)
    const grow = 0.84 + 0.16 * open
    if (system.current && Math.abs(open - s.open) > 1e-4) {
      s.open = open
      system.current.style.transform = `scale(${grow.toFixed(4)})`
      system.current.style.opacity = open.toFixed(3)
    }
    let hotIndex = -1
    let hx = 0
    let hy = 0
    const clear = [Infinity, Infinity, Infinity]
    model.bodies.forEach((b, i) => {
      const el = els.current[i]
      if (!el) return
      const r = model.rings[b.ring]
      const th = b.theta - s.spin[b.ring] - (still ? 0 : clamp01(t) * r.turn)
      const c = Math.cos(th)
      const z = Math.sin(th) // +1: nearest the viewer (the bottom of the ellipse)
      const x = model.cx + r.rx * c * grow
      const y = model.cy + r.ry * z * grow
      const scale = 1 + model.depth * 0.17 * z
      const alpha = (1 - model.depth * 0.5 * (1 - z) * 0.5) * open
      el.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) scale(${scale.toFixed(4)})`
      el.style.opacity = alpha.toFixed(3)
      const zi = 10 + Math.round((z + 1) * 20) + (r.tier === 0 ? 1 : 0)
      if (s.z[i] !== zi) {
        s.z[i] = zi
        el.style.zIndex = String(zi)
      }

      const label = labels.current[i]
      if (label) {
        const isHot = s.hot === b.p.slug
        let la = 1
        let lean = c * r.lean
        if (!isHot && !r.named) la = 0
        else if (!isHot && r.all) la = 0.5 + 0.25 * (z + 1)
        else if (!isHot) {
          // Distance from the front of the orbit, in steps between neighbours: one name at a time.
          const off = Math.abs(Math.atan2(Math.sin(th - Math.PI / 2), Math.cos(th - Math.PI / 2))) / r.step
          la = 1 - smooth(0.14, 0.42, off)
          lean = 0
        }
        label.style.opacity = la.toFixed(3)
        // At the ends of an orbit a name leans inward, so it never needs a margin outside the system.
        label.style.transform = `translateX(${f1(-50 - 50 * lean)}%)`
      }

      const wake = wakes.current[i]
      const grad = grads.current[i]
      if (wake && grad && r.wake > 0) {
        // The wake trails behind the body: bodies travel towards smaller angles.
        const tx = model.cx + r.rx * Math.cos(th + r.wake) * grow
        const ty = model.cy + r.ry * Math.sin(th + r.wake) * grow
        wake.setAttribute('d', `M ${f1(tx)} ${f1(ty)} A ${f1(r.rx * grow)} ${f1(r.ry * grow)} 0 0 0 ${f1(x)} ${f1(y)}`)
        grad.setAttribute('x1', f1(x))
        grad.setAttribute('y1', f1(y))
        grad.setAttribute('x2', f1(tx))
        grad.setAttribute('y2', f1(ty))
        wake.style.opacity = (alpha * (0.55 + 0.45 * (z + 1) * 0.5)).toFixed(3)
      }

      if (z < -0.4) clear[b.ring] = Math.min(clear[b.ring], Math.abs(x - model.cx))
      if (s.hot === b.p.slug) {
        hotIndex = i
        hx = x
        hy = y
      }
    })

    // An orbit's caption gives way to a body passing behind it.
    model.rings.forEach((r, k) => {
      const cap = captions.current[k]
      if (!cap) return
      const a = smooth(r.caption, r.caption + 26, clear[k]).toFixed(2)
      if (cap.style.opacity !== a) cap.style.opacity = a
    })

    const line = leader.current
    if (line) {
      line.style.opacity = hotIndex >= 0 ? '1' : '0'
      if (hotIndex >= 0) {
        line.setAttribute('x2', f1(hx))
        line.setAttribute('y2', f1(hy))
      }
    }
  }

  // The still pose: before the first frame, after every render, and the whole of reduced motion.
  useLayoutEffect(() => {
    sim.current.open = -1
    sim.current.z = []
    pose(reducedMotion)
  })

  useTicker(active && !reducedMotion && !!model, (dt) => {
    const s = sim.current
    s.pace = approach(s.pace, s.hot ? 0 : 1, s.hot ? 7 : 1.6, dt)
    model?.rings.forEach((r, k) => {
      s.spin[k] += r.omega * dt * speed * s.pace
    })
    pose(false)
  })

  const style = useMemo(() => {
    if (!model) return undefined
    const [a, b, c] = model.type
    return { '--t0': `${a}px`, '--t1': `${b}px`, '--t2': `${c}px` } as CSSProperties
  }, [model])

  const hotRing = model ? model.bodies.find((b) => b.p.slug === hot)?.ring ?? -1 : -1

  return (
    <div ref={root} className={styles.root} role="group" aria-label="Project archive" style={style}>
      {model && (
        <>
          {/* The drawing that holds still (orbits, captions, centre) is its own
              layer, so the bodies' per-frame wakes never repaint it. */}
          <svg ref={system} className={styles.chart} width={w} height={h} aria-hidden="true" style={{ transformOrigin: `${model.cx}px ${model.cy}px` }}>
            <g>
              {model.rings.map((r, k) => (
                <g key={r.tier} data-hot={hotRing === k || undefined} className={styles.orbit}>
                  <path className={styles.back} d={arc(model.cx, model.cy, r.rx, r.ry, false)} />
                  <path className={styles.front} d={arc(model.cx, model.cy, r.rx, r.ry, true)} />
                </g>
              ))}
              {!model.compact &&
                model.rings.map((r, k) => (
                  <text
                    key={r.tier}
                    ref={(el) => {
                      captions.current[k] = el
                    }}
                    className={styles.caption}
                    x={model.cx}
                    y={model.cy - r.ry - 8}
                    textAnchor="middle"
                  >
                    {TIER_NAME[r.tier]}
                  </text>
                ))}
              <circle className={styles.halo} cx={model.cx} cy={model.cy} r={model.compact ? 7 : 10} />
              <circle className={styles.sun} cx={model.cx} cy={model.cy} r={model.compact ? 2.5 : 3.5} />
            </g>
          </svg>
          <svg className={styles.motion} width={w} height={h} aria-hidden="true">
            <defs>
              {model.bodies.map((b, i) =>
                model.rings[b.ring].wake > 0 ? (
                  <linearGradient
                    key={b.p.id}
                    id={`${uid}-w${i}`}
                    gradientUnits="userSpaceOnUse"
                    ref={(el) => {
                      grads.current[i] = el
                    }}
                  >
                    <stop offset="0" stopColor={toneOf(b.p)} stopOpacity="0.85" />
                    <stop offset="1" stopColor={toneOf(b.p)} stopOpacity="0" />
                  </linearGradient>
                ) : null,
              )}
            </defs>
            {model.bodies.map((b, i) =>
              model.rings[b.ring].wake > 0 ? (
                <g key={b.p.id} className={styles.wakeHost} data-dim={!visible.has(b.p.id) || undefined}>
                  <path
                    ref={(el) => {
                      wakes.current[i] = el
                    }}
                    className={styles.wake}
                    stroke={`url(#${uid}-w${i})`}
                    strokeWidth={b.ring === 0 && model.rings[0].tier === 0 ? 2 : 1.5}
                  />
                </g>
              ) : null,
            )}
            <line ref={leader} className={styles.leader} x1={model.cx} y1={model.cy} x2={model.cx} y2={model.cy} />
          </svg>
          {model.bodies.map((b, i) => {
            const dim = !visible.has(b.p.id)
            const tier = model.rings[b.ring].tier
            return (
              <button
                key={b.p.id}
                ref={(el) => {
                  els.current[i] = el
                }}
                type="button"
                className={styles.body}
                data-tier={tier}
                data-dim={dim || undefined}
                data-hot={hot === b.p.slug || undefined}
                aria-hidden={dim || undefined}
                tabIndex={dim ? -1 : 0}
                aria-label={labelOf(b.p, b.text)}
                data-cursor="view"
                onClick={() => onOpen(b.p.slug)}
                style={{ '--tone': toneOf(b.p), '--d': `${NODE[tier]}px`, '--lw': `${model.rings[b.ring].labelMax}px` } as CSSProperties}
                {...bind(b.p.slug)}
              >
                <span className={styles.inner}>
                  <span className={styles.node} />
                  <span
                    className={styles.label}
                    ref={(el) => {
                      labels.current[i] = el
                    }}
                  >
                    <span className={styles.name}>{b.text}</span>
                    {tier === 0 && !model.compact && <span className={styles.meta}>{metaOf(b.p)}</span>}
                  </span>
                </span>
              </button>
            )
          })}
        </>
      )}
    </div>
  )
}

export default memo(Orbits)
