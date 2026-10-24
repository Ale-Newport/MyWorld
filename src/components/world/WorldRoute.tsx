'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { garden } from '@/components/home/botanical/garden'
import { endWarm } from './prepare'
import { worldTransition } from './transition'
import { NO_START, QUIET_MS, copyAt, createLoadingStore, plainError } from './loading'
import { WorldLoading } from './WorldLoading'
import { track } from '@/components/analytics/track'
import styles from './archipelago.module.css'

/* ============================================================
   /world

   The Archipelago runtime runs in a same-origin frame: its own
   document, its own WebGL context, import map and render loop,
   isolated from React and torn down completely (GPU memory,
   physics, listeners) when the frame is removed.

   The frame is created as soon as this route mounts — for a
   visitor coming through the leaves, that is after the cover was
   verified on screen; for a direct arrival (a reload, Forward, a
   shared link) it is at once, with the canopy built beside it, in
   the first moments there are (see CanopyCover) — and the runtime
   posts its progress and, when its first fully prepared frame has
   been drawn, `ready`. Both in-app entry and direct URLs use the
   persistent foliage cover, and the leaves part only after the
   cover has been verified AND the runtime has presented a complete
   frame, whichever comes last. A direct arrival has no homepage to
   have been covering for it: its loader is in the first paint of
   the document, on the dark of the hedge, and the leaves come up
   behind it; they are held for a moment, fully drawn, before they
   part, so that what opens is always leaves, never a dark dissolve.
   Errors keep the leaves closed and offer recovery, in plain words.

   Mounted by the route's layout, not its page: the layout needs no
   data, so it commits as soon as the route is chosen instead of
   after the server has rendered the page (see world/layout.tsx).

   Parent ↔ runtime (same origin, postMessage):
     runtime → here   hello · progress {stage, value, step?, of?} · ready · error
     here → runtime   live      the first frame of the parting: the world takes input
                      revealed  the leaves are gone: start judging its own frame rate
   A runtime that predates `live` and `revealed` ignores them; one
   that never sends `step`/`of` is read by `value` (loading.ts).
   ============================================================ */

const RUNTIME = '/archipelago/preview/index.html'
/** The document finished loading and the runtime still has not introduced itself: that is a failure. Its first act is
    to say hello, at module evaluation and so before the frame's `load`; this only outlasts a message still in flight
    (and a parent busy with the world's first seconds), not a slow link — a slow link delays `load` itself. */
const HELLO_MS = 2_500
/** A message already on its way is read before an error is declared. */
const HELLO_RECHECK_MS = 300
/** Least time the leaves of a direct arrival are on the screen, fully drawn, before they part: they are there to be seen go. */
const LEAF_DWELL_MS = 700
/** Most the reveal waits for a cover that will not verify (it was put away, the canopy cannot draw): the world is ready. */
const COVER_WAIT_MS = 6_000

export function WorldRoute() {
  const router = useRouter()
  const host = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLIFrameElement | null>(null)
  const phase = useSyncExternalStore(worldTransition.subscribe, () => worldTransition.get().phase, () => 'HOME' as const)
  /* Decided once, at mount: through the leaves, or direct. */
  const [arrival] = useState(() => worldTransition.get().phase === 'COVERED')
  /* When the leaves of a direct arrival were first verified, fully drawn, on the screen. */
  const leafSince = useRef(0)
  /* Progress lives outside React: a message that changes nothing on screen renders nothing. */
  const [store] = useState(createLoadingStore)
  const load = useSyncExternalStore(store.subscribe, store.get, store.server)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const beganAt = useRef(0)

  /* ---- the frame -------------------------------------------- */
  useEffect(() => {
    const el = host.current
    if (!el) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    worldTransition.arrive(reduced)
    let cancelled = false
    let helloTimer = 0
    let quietTimer = 0
    let hello = false
    let lastWord = 0
    /* Silence is measured from the last word, by one timer that looks again when it
       fires — no timer is cleared and set again per message. */
    const heard = () => {
      lastWord = performance.now()
      store.quiet(false)
      if (quietTimer) return
      const look = () => {
        quietTimer = 0
        const silent = performance.now() - lastWord
        if (silent >= QUIET_MS) store.quiet(true)
        else quietTimer = window.setTimeout(look, QUIET_MS - silent)
      }
      quietTimer = window.setTimeout(look, QUIET_MS)
    }
    const stopListening = () => { window.clearTimeout(quietTimer); quietTimer = 0 }
    /* The visitor reads plain words; the analytics keep the runtime's own. */
    const fail = (message: string) => {
      const plain = plainError(message)
      setError(plain)
      worldTransition.fail(plain)
      track('world_error', { message: message.slice(0, 120), arrival })
    }
    const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms))
    /* What the reveal waits for. Through the leaves, a cover verified long ago (it says so at once). A direct arrival
       builds its leaves beside the world: they are verified once drawn and opaque, and then held on the screen for
       LEAF_DWELL_MS — a world that is ready first still parts leaves, not the dark behind where they are not yet. */
    const seen = arrival ? null : garden.whenCovered().then(() => { leafSince.current ||= performance.now() })
    const coverReady = async () => {
      if (!seen) return garden.whenCovered()
      await seen
      if (!reduced) await wait(LEAF_DWELL_MS - (performance.now() - leafSince.current))
    }
    const tell = (type: string) => frame.current?.contentWindow?.postMessage({ type }, window.location.origin)
    /* The first frame of the parting: the world is the visitor's. */
    const goLive = () => {
      const iframe = frame.current
      if (!iframe) return
      iframe.removeAttribute('tabindex')
      iframe.focus()
      iframe.contentWindow?.focus()
      tell('archipelago:live')
    }
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== frame.current?.contentWindow) return
      const data = event.data as { type?: string; stage?: string; value?: number; step?: number; of?: number; message?: string }
      if (data?.type === 'archipelago:hello') { hello = true; window.clearTimeout(helloTimer); heard() }
      if (data?.type === 'archipelago:progress') { heard(); store.report(data) }
      if (data?.type === 'archipelago:navigate' && typeof (data as { href?: unknown }).href === 'string') {
        const href = (data as { href: string }).href
        if (href.startsWith('/') && !href.startsWith('//')) router.push(href)
      }
      if (data?.type === 'archipelago:error') { stopListening(); fail(String(data.message ?? 'The world could not start.')) }
      // What visitors do in the world, as named events only (see server/analytics.ts).
      if (data?.type === 'archipelago:event') {
        const e = data as { event?: unknown; name?: unknown; action?: unknown }
        if (e.event === 'map_open') track('map_open')
        if (e.event === 'world_activity' && typeof e.name === 'string' && typeof e.action === 'string') track('world_activity', { name: e.name.slice(0, 40), action: e.action.slice(0, 20) })
      }
      if (data?.type === 'archipelago:ready') {
        stopListening()
        store.ready()
        track('world_ready', { ms: Math.round(performance.now() - beganAt.current), arrival, attempt })
        void Promise.race([coverReady(), wait(COVER_WAIT_MS)]).then(() => {
          if (!cancelled && worldTransition.get().phase === 'LOADING_WORLD') worldTransition.ready(goLive, () => tell('archipelago:revealed'))
        })
      }
    }
    window.addEventListener('message', onMessage)
    // Deferred a task so React's development double-mount never creates two worlds.
    const create = window.setTimeout(() => {
      if (cancelled) return
      // From here the frame fetches its own files: nothing more is started on the page's behalf (prepare.ts).
      endWarm()
      const iframe = document.createElement('iframe')
      iframe.className = styles.player
      iframe.src = RUNTIME
      iframe.title = 'Archipiélago — drive around Alejandro Newport’s island'
      // `allow` alone: with the legacy `allowfullscreen` attribute beside it the browser warns that `allow` wins.
      iframe.allow = 'autoplay; fullscreen; gamepad'
      // Nothing to tab to behind the leaves; it becomes a tab stop when the world goes live.
      iframe.tabIndex = -1
      iframe.addEventListener('load', () => {
        if (hello) return
        // Its first act is hello, before this event: a frame that loaded without one has failed (its script did not load or
        // threw), and the visitor is not left watching a loader that is going nowhere.
        helloTimer = window.setTimeout(() => {
          if (hello) return
          helloTimer = window.setTimeout(() => { if (!hello) fail(NO_START) }, HELLO_RECHECK_MS)
        }, HELLO_MS)
      })
      frame.current = iframe
      el.append(iframe)
      beganAt.current = performance.now()
      worldTransition.loading()
      heard()
    }, 0)
    return () => {
      cancelled = true
      window.clearTimeout(create)
      window.clearTimeout(helloTimer)
      stopListening()
      window.removeEventListener('message', onMessage)
      frame.current?.remove()
      frame.current = null
    }
  }, [attempt, arrival, router, store])

  /* Leaving before the leaves have parted (Back, a link) uncovers the page left for. */
  useEffect(() => () => {
    window.setTimeout(() => {
      if (!document.querySelector('[data-world-shell]')) worldTransition.abort()
    }, 0)
  }, [])

  /* After a completed visit, the machine is home again for the next way in. */
  useEffect(() => {
    if (phase === 'IN_WORLD') return () => worldTransition.reset()
  }, [phase])

  const retry = useCallback(() => {
    if (worldTransition.get().phase !== 'ERROR') return
    setError(null)
    store.reset()
    worldTransition.retry()
    setAttempt((n) => n + 1)
  }, [store])

  const home = useCallback(() => {
    worldTransition.abort()
    router.push('/')
  }, [router])

  /* The loader leaves when the leaves do. (Not at `ready`: a direct arrival's leaves may still be coming up, or held for a
     moment, and the loader — now saying the island is ready — stays with them until they part.) */
  const leaving = phase === 'REVEALING' || phase === 'IN_WORLD'
  /* A direct arrival's loader is in the first paint of the document, on the dark of the hedge, with the leaves coming up
     behind it (`direct`). Through the leaves it waits for the world to be made, and its grace starts then. */
  const started = !arrival || phase === 'LOADING_WORLD' || phase === 'WORLD_READY' || phase === 'REVEALING'
  return (
    <>
      <div className={styles.route} data-world-shell="" data-ready={load.ready || undefined}>
        <div ref={host} className={styles.stage} aria-busy={!load.ready} />
      </div>
      {!error && phase !== 'IN_WORLD' && <WorldLoading snapshot={load} leaving={leaving} started={started} direct={!arrival} />}
      <noscript><style>{'[data-world-loader]{display:none}'}</style></noscript>
      {/* Always mounted — a live region created with its text is not reliably announced —
          and told only the names of the stages, never a percentage. */}
      <p className="sr-only" role="status" aria-live="polite" data-world-allow="">{error ? '' : copyAt(load)}</p>
      {error && createPortal(<ErrorDialog message={error} onRetry={retry} onHome={home} />, document.body)}
    </>
  )
}

/** The way out when the island cannot start: over the leaves, which stay closed behind it. */
function ErrorDialog({ message, onRetry, onHome }: { message: string; onRetry: () => void; onHome: () => void }) {
  const primary = useRef<HTMLButtonElement>(null)
  useEffect(() => { primary.current?.focus() }, [])
  return (
    <div
      className={styles.errorLayer}
      data-world-allow=""
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onHome() } }}
    >
      <div className={styles.error} role="alertdialog" aria-modal="true" aria-labelledby="world-error-title" aria-describedby="world-error-text">
        <p className={styles.eyebrow}>Archipiélago</p>
        <h1 className={styles.title} id="world-error-title">The island did not load.</h1>
        <p className={styles.stageText} id="world-error-text">{message}</p>
        <div className={styles.actions}>
          <button type="button" ref={primary} onClick={onRetry} className={styles.primary}>Try again</button>
          <button type="button" onClick={onHome} className={styles.secondary}>Return to the portfolio</button>
        </div>
      </div>
    </div>
  )
}
