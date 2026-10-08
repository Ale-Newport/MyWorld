/** Download bytes on intent/proximity, without creating a world or a render loop. */
type Connection = { saveData?: boolean; effectiveType?: string }
const requested = new Map<string, Promise<void>>()
const queue: Array<() => Promise<void>> = []
let running = 0
let stage = 0

const constrained = () => {
  const c = (navigator as Navigator & { connection?: Connection }).connection
  return c?.saveData || /(^|-)2g$/.test(c?.effectiveType ?? '')
}
function drain() {
  while (running < 2 && queue.length) {
    running++
    void queue.shift()!().finally(() => { running--; drain() })
  }
}
function warm(url: string) {
  if (requested.has(url)) return requested.get(url)!
  const promise = new Promise<void>((resolve) => {
    queue.push(async () => {
      try {
        const response = await fetch(url, { credentials: 'same-origin', priority: 'low' })
        if (!response.ok) throw new Error(String(response.status))
        // Drain into the HTTP cache, without keeping another large ArrayBuffer.
        const reader = response.body?.getReader()
        if (reader) { while (!(await reader.read()).done) { /* cache bytes */ } }
      } catch { requested.delete(url) }
      resolve()
    })
  })
  requested.set(url, promise)
  drain()
  return promise
}

/** P3 on approach; P4 stays with the runtime. Data saver warms only on explicit intent. */
export function prepareWorld(intent = false) {
  if (typeof window === 'undefined' || (!intent && constrained())) return
  if (stage) return
  stage = 1
  void fetch('/api/world/release', { credentials: 'same-origin', cache: 'no-cache', priority: 'low' })
    .then(async (r) => {
      if (!r.ok) throw new Error(String(r.status))
      const release = await r.json() as { world: { url: string }; assets: { url: string } }
      for (const file of [release.world, release.assets]) {
        const url = new URL(file.url, location.origin)
        if (url.origin === location.origin) void warm(url.href)
      }
    }).catch(() => { stage = 0 })
  // The main models are reusable HTTP-cache entries. Never import main.js here:
  // evaluating it would boot physics and WebGL behind the homepage.
  for (const url of [
    '/archipelago/exports/AlejandroWorld.glb.gz',
    '/archipelago/assets/environment/portfolio/models/world.glb.gz',
    '/archipelago/assets/environment/portfolio/models/vegetation.glb.gz',
    '/archipelago/preview/vendor/@dimforge/rapier3d-compat/rapier.es.js',
  ]) void warm(url)
}
