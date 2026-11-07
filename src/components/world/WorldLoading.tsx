import { useLayoutEffect, useRef, type CSSProperties } from 'react'
import { ETA, MARKS, copyAt, type LoadingSnapshot } from './loading'
import styles from './world-loading.module.css'

/* ============================================================
   THE ISLAND IS WAKING UP

   Not a spinner, and no longer a string of fireflies: a readout set
   like the rest of the site — a label in the small tracked capitals,
   a step counter in tabular figures, and one hairline rule — with
   the ivy the leaves are made of growing along it. The rule is the
   vine. It has one knot for every real step of the world's start;
   a step that has COMPLETED draws the vine up to its knot and opens
   a leaf there, and the step in progress reaches a faint tendril
   towards the next knot on its own clock (`ETA`, an ease that never
   arrives by itself — only the runtime can say a step is done). A
   small light rides the tip of the vine, the last of the fireflies.
   When the world is ready the vine reaches the end of the rule, the
   last pair of leaves opens, and the light goes out through the
   parting leaves.

   The counter names the step in progress ("04 / 08", the line under
   it says what it is), never a percentage: only completed steps are
   claims about the world (loading.ts), and a percentage that sits
   still for five seconds of one synchronous block reads as a hang.

   It draws over the cover, which is part of the page the machine
   (transition.ts) has closed, so it carries `data-world-allow`.
   Everything that moves here is `opacity` or `transform`: the world
   boots in a frame that shares this page's main thread and blocks it
   for seconds at a time, and only compositor animations keep their
   pace through that — which is also why every loop is started while
   the thread is still idle (the first server-rendered paint, or the
   cover sealing) and why nothing here is a paint, a filter or a
   layout property. The vine grows by `scaleX` and the light rides it
   by `translateX` of the same length, with the same ease, so the two
   never part company; the rule, the knots and the words are painted
   once.

   Server-rendered, so its markup is in the first paint of a direct arrival, but it is
   invisible until `started`. Through the leaves that is when the world is being made
   (the frame exists), and then only after a 0.6 s grace, so a world that starts at once
   never flashes it; the grace is a CSS animation that begins while the thread is idle,
   so it keeps its pace, and a world that is ready while it is still running never shows
   the loader at all. A direct arrival (`direct`: a reload, Forward, a shared link) has
   no page that was covered for it and a world that is seconds away: the loader is up in
   a fraction of a second, from the first paint, on the dark of the hedge — which is all
   there is until the leaves are drawn, and they come up behind it.

   For assistive technology the rule is a `progressbar` (steps completed of MARKS, with
   the step's name as its value text); the words drawn around it are hidden from it, so
   nothing is read twice. Changes are announced by the route's own status line
   (WorldRoute), which is always mounted and names stages only.
   ============================================================ */

/** Which leaves open at each knot: `r` degrees clockwise from straight up, `k` plain heart (1) or lobed ivy (0),
    `s` its size against the others. They alternate above and below the rule, leaning the way the vine grows,
    as ivy does — plain hearts, which stay clean at this size; the last knot, the world itself, opens a pair,
    and the lobed leaf of the room's ivy is kept for it. */
interface LeafSpec { r: number; k: 0 | 1; s: number }
/* One entry per mark (MARKS, loading.ts). */
const SPRIGS: LeafSpec[][] = [
  [{ r: 40, k: 1, s: 1 }],
  [{ r: 142, k: 1, s: 0.86 }],
  [{ r: 36, k: 1, s: 0.94 }],
  [{ r: 146, k: 1, s: 0.9 }],
  [{ r: 42, k: 1, s: 0.98 }],
  [{ r: 140, k: 1, s: 0.86 }],
  [{ r: 38, k: 1, s: 0.94 }],
  [{ r: 30, k: 0, s: 1.18 }, { r: 148, k: 1, s: 0.96 }],
]

/** The two leaf outlines of the room's ivy (room/nature/sprites.ts), base at the origin, tip at -1.16. */
const LEAF = [
  'M0 0C-.16-.03-.33-.06-.41-.2C-.5-.28-.57-.28-.67-.32C-.52-.42-.44-.45-.4-.54L-.49-.76C-.28-.69-.16-.71-.1-.9L.03-1.16C.09-.99.11-.85.21-.69L.47-.83C.42-.56.47-.46.63-.38C.47-.34.43-.22.3-.16C.18-.06.11-.02 0 0Z',
  'M0 0C-.17.02-.48-.14-.44-.46C-.4-.76-.1-.85.02-1.16C.14-.87.47-.68.43-.38C.4-.12.15.02 0 0Z',
] as const
const RIB = 'M0 0L.01-1.02'

function Leaf({ l, j }: { l: LeafSpec; j: number }) {
  return (
    <svg
      className={styles.leaf}
      viewBox="-0.7 -1.2 1.4 1.25"
      focusable="false"
      aria-hidden="true"
      style={{ ['--r' as string]: `${l.r}deg`, ['--r0' as string]: `${l.r < 90 ? l.r + 42 : l.r - 42}deg`, ['--s' as string]: l.s, ['--k' as string]: j } as CSSProperties}
    >
      <path d={LEAF[l.k]} />
      <path d={RIB} className={styles.rib} />
    </svg>
  )
}

const two = (n: number) => String(n).padStart(2, '0')

export function WorldLoading({ snapshot, leaving, started, direct = false }: { snapshot: LoadingSnapshot; leaving: boolean; started: boolean; direct?: boolean }) {
  const { lit, ready } = snapshot
  const copy = copyAt(snapshot)
  /* The step in progress, counted from one; once the world is ready, the last. */
  const step = Math.min(MARKS, lit + 1)
  const root = useRef<HTMLDivElement>(null)
  /* Ready before the loader was fully there. Before its grace is over it has not appeared and now
     never will: cancelling its fade-in (rather than letting it rise under a content that is already
     fading out) leaves the leaves alone to part. Part-way through the fade-in it is already faintly
     on the screen: it is turned round from where it stands, so it only ever gets fainter while the
     world opens (a ghost that kept rising to full would hang over the first frames of the parting).
     The animation's own clock decides, not a timer: the main thread may have been blocked for the
     whole grace, and the compositor will have shown the loader meanwhile. */
  useLayoutEffect(() => {
    const el = root.current
    if (!leaving || !el || typeof el.getAnimations !== 'function') return
    for (const a of el.getAnimations()) {
      const timing = a.effect?.getComputedTiming()
      const now = Number(a.currentTime ?? 0)
      if (!timing || a.playState !== 'running') continue
      if (now < Number(timing.delay ?? 0)) a.cancel()
      else if (now < Number(timing.endTime ?? 0)) a.reverse()
    }
  }, [leaving])
  return (
    <div ref={root} className={styles.loader} data-world-allow="" data-world-loader="" data-started={started ? (direct ? 'direct' : 'true') : undefined} data-leaving={leaving || undefined}>
      <div className={styles.content}>
        <p className={styles.caption} aria-hidden="true">
          <span className={styles.title}>The island is waking up</span>
          <span className={styles.count}>
            <span className={styles.now}>{two(step)}</span>
            <span className={styles.of}>{` / ${two(MARKS)}`}</span>
          </span>
        </p>
        {/* The rule. `--p` is the share of it the vine has grown along — whole steps only — and `--marks` how many
            knots it is cut into, so the CSS never has to be told the count again. */}
        <div
          className={styles.vine}
          role="progressbar"
          aria-label="Loading the island"
          aria-valuemin={0}
          aria-valuemax={MARKS}
          aria-valuenow={lit}
          aria-valuetext={ready ? copy : `Step ${step} of ${MARKS}: ${copy}`}
          style={{ ['--p' as string]: lit / MARKS, ['--marks' as string]: MARKS } as CSSProperties}
        >
          <span className={styles.track} />
          <span className={styles.fill} />
          {SPRIGS.map((leaves, i) => {
            const state = i < lit ? 'lit' : i === lit && !ready ? 'charging' : 'dormant'
            return (
              <span
                key={i}
                className={styles.node}
                data-state={state}
                style={{ left: `${(((i + 1) / MARKS) * 100).toFixed(3)}%`, ['--eta' as string]: `${ETA[i]}ms` } as CSSProperties}
              >
                {/* The tendril the step in progress reaches towards this knot. */}
                <span className={styles.charge} />
                {leaves.map((l, j) => <Leaf key={j} l={l} j={j} />)}
                <span className={styles.knot} />
              </span>
            )
          })}
          {/* The light at the tip of the vine: it rides the same length as the fill, by the same ease. */}
          <span className={styles.head}>
            <span className={styles.bud}><span className={styles.glow} /></span>
          </span>
        </div>
        <p className={styles.stage} key={copy} data-ready={ready || undefined} aria-hidden="true">{copy}</p>
      </div>
    </div>
  )
}
