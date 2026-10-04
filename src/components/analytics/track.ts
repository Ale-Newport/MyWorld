/* ============================================================
   FIRST-PARTY AUDIENCE EVENTS — the client half

   No cookies, no storage of identifiers, no third parties. A few
   named events are batched and sent to /api/analytics/collect
   with sendBeacon. The server derives a daily-rotating, salted
   visitor hash from the request (never stored raw) and drops
   anything sent by a signed-in administrator.

   Nothing is sent when the visitor's browser asks not to be
   tracked (Global Privacy Control or Do Not Track), when the
   site's analytics setting is off (the <Analytics> component is
   then not mounted and `data-analytics` is absent), inside the
   admin or its preview frame, or under automation (QA runs).
   ============================================================ */

type Props = Record<string, string | number | boolean | null | undefined>
interface Event { type: string; path: string; props: Props; at: number }

let queue: Event[] = []
let timer = 0
let allowed: boolean | null = null

function permitted(): boolean {
  if (typeof window === 'undefined') return false
  if (allowed !== null) return allowed
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean; webdriver?: boolean }
  const optOut = nav.globalPrivacyControl === true || navigator.doNotTrack === '1'
  const excluded = document.documentElement.dataset.analytics !== 'on' || location.pathname.startsWith('/admin') || window.parent !== window || nav.webdriver === true
  allowed = !optOut && !excluded
  return allowed
}

/** Re-evaluated when the <Analytics> component mounts or unmounts. */
export function resetConsent() {
  allowed = null
}

function flush() {
  timer = 0
  if (!queue.length) return
  const body = JSON.stringify({ events: queue.slice(0, 40), referrer: document.referrer.slice(0, 300), width: window.innerWidth, touch: matchMedia('(pointer: coarse)').matches })
  queue = queue.slice(40)
  const sent = navigator.sendBeacon?.('/api/analytics/collect', new Blob([body], { type: 'application/json' }))
  if (!sent) void fetch('/api/analytics/collect', { method: 'POST', body, keepalive: true, headers: { 'content-type': 'application/json' } }).catch(() => {})
  if (queue.length) timer = window.setTimeout(flush, 1000)
}

export function track(type: string, props: Props = {}) {
  if (!permitted()) return
  queue.push({ type, path: location.pathname, props, at: Date.now() })
  if (!timer) timer = window.setTimeout(flush, type === 'pageview' ? 300 : 2000)
}

if (typeof window !== 'undefined') {
  addEventListener('pagehide', flush)
  addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush() })
}
