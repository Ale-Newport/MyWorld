/* ============================================================
   ONE TICKER
   Every non-React animation on the site shares a single
   requestAnimationFrame loop. Fifteen chapters, the HUD, the
   cursor and the world theme would otherwise open nineteen of
   them — each cheap on its own, collectively pure waste.
   ============================================================ */

type TickFn = (dt: number, now: number) => void

const subscribers = new Set<TickFn>()
let raf = 0
let last = 0

function loop(now: number) {
  const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60
  last = now
  // Iterate a snapshot so a subscriber can unsubscribe mid-tick.
  for (const fn of Array.from(subscribers)) fn(dt, now)
  raf = requestAnimationFrame(loop)
}

export function subscribe(fn: TickFn): () => void {
  subscribers.add(fn)
  if (!raf && typeof window !== 'undefined') {
    last = 0
    raf = requestAnimationFrame(loop)
  }
  return () => {
    subscribers.delete(fn)
    if (subscribers.size === 0 && raf) {
      cancelAnimationFrame(raf)
      raf = 0
    }
  }
}

/** Subscriber count — used by the dev overlay only. */
export const tickerSize = () => subscribers.size
