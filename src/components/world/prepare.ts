/** Download bytes on intent/proximity, without creating a world or a render loop. */
type Connection = { saveData?: boolean; effectiveType?: string }
/** 0: small · 1: a model, the physics engine or the asset definitions · 2: the saved world document (the biggest by far). */
type Tier = 0 | 1 | 2
const requested = new Map<string, Promise<void>>()
const queue: Array<{ url: string; tier: Tier; job: () => Promise<void> }> = []
let running = 0
let stage = 0
/** The world's frame exists: from here it fetches for itself, and nothing new is started on its behalf. */
let ended = false

/** Data saver or a 2G link: nothing is fetched on a guess, only on intent. */
export const dataConstrained = () => {
  if (typeof navigator === 'undefined') return false
  const c = (navigator as Navigator & { connection?: Connection }).connection
  return !!c?.saveData || /(^|-)2g$/.test(c?.effectiveType ?? '')
}
function drain() {
  while (running < 2 && queue.length) {
    running++
    void queue.shift()!.job().finally(() => { running--; drain() })
  }
}
/** Smallest first, first come first served within a tier. */
function warm(url: string, tier: Tier) {
  if (ended) return Promise.resolve()
  if (requested.has(url)) return requested.get(url)!
  const promise = new Promise<void>((resolve) => {
    const job = async () => {
      try {
        const response = await fetch(url, { credentials: 'same-origin', priority: 'low' })
        if (!response.ok) throw new Error(String(response.status))
        // Drain into the HTTP cache, without keeping another large ArrayBuffer.
        const reader = response.body?.getReader()
        if (reader) { while (!(await reader.read()).done) { /* cache bytes */ } }
      } catch { requested.delete(url) }
      resolve()
    }
    let at = queue.length
    while (at > 0 && queue[at - 1].tier > tier) at--
    queue.splice(at, 0, { url, tier, job })
  })
  requested.set(url, promise)
  drain()
  return promise
}

/**
 * What the world's frame asks for in its own document head the instant it exists
 * (archipelago/preview/index.html), besides the release's two files. Nothing the frame
 * never draws is listed: the vegetation library is for the editor, and the plane is the
 * compressed model the runtime asks for.
 */
const WARM: ReadonlyArray<readonly [url: string, tier: Tier]> = [
  ['/archipelago/exports/navigation.json', 0],
  ['/archipelago/assets/environment/portfolio/interactions.json', 0],
  ['/archipelago/assets/environment/portfolio/world-manifest.json', 0],
  ['/archipelago/assets/vehicles/plane/corsair.glb.gz', 0],
  ['/archipelago/preview/vendor/@dimforge/rapier3d-compat/rapier.es.js', 1],
  ['/archipelago/assets/environment/portfolio/models/world.glb.gz', 1],
  ['/archipelago/exports/AlejandroWorld.glb.gz', 1],
]

/**
 * Bytes for the world while the visitor is still on the way — and only then: the scroll
 * approaching the leaves, the pointer or the keyboard arriving at a link to the world. A
 * click, a tap, a reload or a shared link starts the world's frame within a second or two and
 * the frame fetches all of this itself, so it warms nothing (worldTransition does not call this).
 *
 * The queue goes smallest first and the saved world document (6.8 MB, the longest pole) last:
 * what has finished when the visitor arrives is whole files, and the document is the least
 * likely to be mid-transfer then. Mid-transfer is harmless in a normal profile — the frame's
 * request for the same URL joins the one on its way, which is why nothing is cut here — but a
 * private window's in-memory cache cannot keep an entry of that size at all, and there a copy
 * still arriving would be fetched again in full; measured on a throttled link.
 */
export function prepareWorld() {
  if (typeof window === 'undefined' || dataConstrained() || ended) return
  if (stage) return
  stage = 1
  void fetch('/api/world/release', { credentials: 'same-origin', cache: 'no-cache', priority: 'low' })
    .then(async (r) => {
      if (!r.ok) throw new Error(String(r.status))
      const release = await r.json() as { world: { url: string }; assets: { url: string } }
      for (const [file, tier] of [[release.assets, 1], [release.world, 2]] as const) {
        const url = new URL(file.url, location.origin)
        if (url.origin === location.origin) void warm(url.href, tier)
      }
    }).catch(() => { stage = 0 })
  // The main models are reusable HTTP-cache entries. Never import main.js here:
  // evaluating it would boot physics and WebGL behind the homepage.
  for (const [url, tier] of WARM) void warm(url, tier)
}

/**
 * The world's frame is about to be created. Whatever was queued and has not started is dropped, and
 * nothing is started on the page's behalf from here: the frame fetches its own files within its
 * first moments, and a transfer the page began after that (the document, which goes last) would only
 * compete with them — or, in a private window, repeat them. What is already on its way is left alone:
 * the frame's request for the same URL joins it. A visit leaves every file in the HTTP cache, so
 * there is nothing to warm again for the rest of the session.
 */
export function endWarm() {
  ended = true
  for (const { url } of queue) requested.delete(url)
  queue.length = 0
}
