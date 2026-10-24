import { useLayoutEffect, useRef, type CSSProperties } from 'react'
import { ETA, MARKS, copyAt, type LoadingSnapshot } from './loading'
import styles from './world-loading.module.css'

/* ============================================================
   THE ISLAND IS WAKING UP

   Not a spinner: a short sprig of the same ivy the leaves are made
   of lies across the hedge, and the island's fireflies gather on it,
   one for every real step of the world's start. A step that has
   COMPLETED lights its firefly (with a ring, once) and wakes its
   leaves; the step in progress slowly gathers light on its own, so
   the sprig is never still. When the world is ready the last
   firefly flares and the light goes out through the parting leaves.

   It draws over the cover, which is part of the page the machine
   (transition.ts) has closed, so it carries `data-world-allow`.
   Everything that moves here is `opacity` or `transform`: the world
   boots in a frame that shares this page's main thread and blocks it
   for seconds at a time, and only compositor animations keep their
   pace through that — which is also why every loop is started while
   the thread is still idle (the first server-rendered paint, or the
   cover sealing) and why nothing here is a paint, a filter or a
   layout property. Static art (the stem, the dormant leaves) is
   painted once.

   Server-rendered, so its markup is in the first paint of a direct arrival, but it is
   invisible until `started`. Through the leaves that is when the world is being made
   (the frame exists), and then only after a 0.6 s grace, so a world that starts at once
   never flashes it; the grace is a CSS animation that begins while the thread is idle,
   so it keeps its pace, and a world that is ready while it is still running never shows
   the loader at all. A direct arrival (`direct`: a reload, Forward, a shared link) has
   no page that was covered for it and a world that is seconds away: the loader is up in
   a fraction of a second, from the first paint, on the dark of the hedge — which is all
   there is until the leaves are drawn, and they come up behind it.
   ============================================================ */

/** The sprig, in a 400 × 90 box: where each firefly rests and which leaves grow from it. */
const STEM = 'M6 56.3C10 55.3 17.9 50.3 30 50.3C42.1 50.3 62.4 55.4 78.6 56.1C94.8 56.8 111 56.2 127.2 54.7C143.4 53.2 159.6 49.8 175.8 47.3C192 44.8 208.2 41.2 224.4 39.6C240.6 38 256.8 37.2 273 37.8C289.2 38.4 305.4 40.9 321.6 43.2C337.8 45.5 358.1 51 370.2 51.6C382.3 52.2 390 47.4 394 46.6'
const W = 400
const H = 90

interface LeafSpec { r: number; s: number; k: 0 | 1 }
interface NodeSpec { x: number; y: number; leaves: [LeafSpec, LeafSpec]; drift: [number, number, number]; delay: number }

/* r: degrees clockwise from straight up · s: leaf length in box units · k: lobed ivy or plain heart.
   drift: dx, dy (px) and seconds of each firefly's wander. */
const NODES: NodeSpec[] = [
  { x: 30, y: 50.3, leaves: [{ r: 38, s: 24, k: 0 }, { r: 146, s: 13.5, k: 1 }], drift: [4, -5, 9], delay: 0 },
  { x: 78.6, y: 56.1, leaves: [{ r: 153, s: 22, k: 1 }, { r: 31, s: 12.6, k: 1 }], drift: [-4, 4, 11], delay: -2.4 },
  { x: 127.2, y: 54.7, leaves: [{ r: 32, s: 25, k: 0 }, { r: 152, s: 14.4, k: 1 }], drift: [5, -3, 8], delay: -5.1 },
  { x: 175.8, y: 47.3, leaves: [{ r: 155, s: 22, k: 0 }, { r: 29, s: 12.6, k: 1 }], drift: [-3, -5, 10], delay: -1.2 },
  { x: 224.4, y: 39.6, leaves: [{ r: 34, s: 24, k: 1 }, { r: 150, s: 13.5, k: 1 }], drift: [4, 5, 9.5], delay: -6.3 },
  { x: 273, y: 37.8, leaves: [{ r: 152, s: 21, k: 0 }, { r: 32, s: 11.7, k: 1 }], drift: [-5, 3, 11.5], delay: -3.7 },
  { x: 321.6, y: 43.2, leaves: [{ r: 30, s: 24, k: 0 }, { r: 154, s: 13.5, k: 1 }], drift: [3, -4, 8.5], delay: -7.5 },
  { x: 370.2, y: 51.6, leaves: [{ r: 151, s: 26, k: 1 }, { r: 33, s: 14.4, k: 1 }], drift: [-4, -4, 10.5], delay: -4.4 },
]

/** The two leaf outlines of the room's ivy (room/nature/sprites.ts), base at the origin, tip at -1.16. */
const LEAF = [
  'M0 0C-.16-.03-.33-.06-.41-.2C-.5-.28-.57-.28-.67-.32C-.52-.42-.44-.45-.4-.54L-.49-.76C-.28-.69-.16-.71-.1-.9L.03-1.16C.09-.99.11-.85.21-.69L.47-.83C.42-.56.47-.46.63-.38C.47-.34.43-.22.3-.16C.18-.06.11-.02 0 0Z',
  'M0 0C-.17.02-.48-.14-.44-.46C-.4-.76-.1-.85.02-1.16C.14-.87.47-.68.43-.38C.4-.12.15.02 0 0Z',
] as const
const RIB = 'M0 0L.01-1.02'

const pct = (v: number, of: number) => `${((v / of) * 100).toFixed(2)}%`
const leafWidth = (s: number) => `calc(var(--w) * ${((s * 1.4) / W).toFixed(4)})`

export function WorldLoading({ snapshot, leaving, started, direct = false }: { snapshot: LoadingSnapshot; leaving: boolean; started: boolean; direct?: boolean }) {
  const { lit, ready } = snapshot
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
    <div ref={root} className={styles.loader} data-world-allow="" data-world-loader="" data-started={started ? (direct ? 'direct' : 'true') : undefined} data-leaving={leaving || undefined} aria-hidden="true">
      <div className={styles.content}>
        <div className={styles.sprig}>
          {/* The dormant sprig: painted once. */}
          <svg className={styles.vine} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" focusable="false">
            <path d={STEM} className={styles.stem} />
            {NODES.map((n, i) => n.leaves.map((l, j) => (
              <path
                key={`${i}-${j}`}
                d={LEAF[l.k]}
                className={styles.dormant}
                transform={`translate(${n.x} ${n.y}) rotate(${l.r}) scale(${l.s})`}
              />
            )))}
          </svg>
          {NODES.map((n, i) => {
            const state = i < lit ? 'lit' : i === lit && !ready ? 'charging' : 'dormant'
            return (
              <span
                key={i}
                className={styles.node}
                data-state={state}
                data-last={i === MARKS - 1 || undefined}
                style={{ left: pct(n.x, W), top: pct(n.y, H), ['--eta' as string]: `${ETA[i]}ms`, ['--dx' as string]: `${n.drift[0]}px`, ['--dy' as string]: `${n.drift[1]}px`, ['--drift' as string]: `${n.drift[2]}s`, ['--delay' as string]: `${n.delay}s` } as CSSProperties}
              >
                {n.leaves.map((l, j) => (
                  <svg
                    key={j}
                    className={styles.leaf}
                    viewBox="-0.7 -1.2 1.4 1.25"
                    focusable="false"
                    style={{ width: leafWidth(l.s), ['--r' as string]: `${l.r}deg`, ['--k' as string]: j } as CSSProperties}
                  >
                    <path d={LEAF[l.k]} />
                    <path d={RIB} className={styles.rib} />
                  </svg>
                ))}
                <span className={styles.mote}><span className={styles.glow} /></span>
              </span>
            )
          })}
        </div>
        <p className={styles.line1}>The island is waking up</p>
        <p className={styles.line2} key={copyAt(snapshot)} data-ready={ready || undefined}>{copyAt(snapshot)}</p>
      </div>
    </div>
  )
}

