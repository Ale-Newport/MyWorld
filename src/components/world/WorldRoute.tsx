'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { garden } from '@/components/home/botanical/garden'
import { worldTransition } from './transition'
import { track } from '@/components/analytics/track'
import styles from './archipelago.module.css'

/* ============================================================
   /world

   The Archipelago runtime runs in a same-origin frame: its own
   document, its own WebGL context, import map and render loop,
   isolated from React and torn down completely (GPU memory,
   physics, listeners) when the frame is removed.

   The frame is created only when this route mounts — which, for a
   visitor coming through the leaves, is after the cover was
   verified on screen — and the runtime posts its progress and,
   when its first fully prepared frame has been drawn, `ready`.
   Both in-app entry and direct URLs use the persistent foliage cover.
   Errors keep it closed and offer recovery; ready parts it only after
   the runtime has presented a complete frame.
   ============================================================ */

const RUNTIME = '/archipelago/preview/index.html'
/** No word from the runtime for this long: say so (it is not a failure, and it is not "ready"). */
const QUIET_MS = 25_000
/** The document loaded but the runtime never introduced itself: that is a failure. */
const HELLO_MS = 12_000

interface Progress { stage: string; value: number }

export function WorldRoute() {
  const router = useRouter()
  const host = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLIFrameElement | null>(null)
  const phase = useSyncExternalStore(worldTransition.subscribe, () => worldTransition.get().phase, () => 'HOME' as const)
  /* Decided once, at mount: through the leaves, or direct. */
  const [arrival] = useState(() => worldTransition.get().phase === 'COVERED')
  const [progress, setProgress] = useState<Progress>({ stage: 'Opening the island', value: 0 })
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [quiet, setQuiet] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const started = useRef(0)

  /* ---- the frame -------------------------------------------- */
  useEffect(() => {
    const el = host.current
    if (!el) return
    worldTransition.arrive(window.matchMedia('(prefers-reduced-motion: reduce)').matches)
    let cancelled = false
    let helloTimer = 0
    let quietTimer = 0
    let hello = false
    const resetQuiet = () => {
      window.clearTimeout(quietTimer)
      setQuiet(false)
      quietTimer = window.setTimeout(() => setQuiet(true), QUIET_MS)
    }
    const fail = (message: string) => {
      setError(message)
      worldTransition.fail(message)
      track('world_error', { message: message.slice(0, 120), arrival })
    }
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== frame.current?.contentWindow) return
      const data = event.data as { type?: string; stage?: string; value?: number; message?: string }
      if (data?.type === 'archipelago:hello') { hello = true; window.clearTimeout(helloTimer); resetQuiet() }
      if (data?.type === 'archipelago:progress') { resetQuiet(); setProgress({ stage: String(data.stage ?? ''), value: Math.min(1, Math.max(0, Number(data.value) || 0)) }) }
      if (data?.type === 'archipelago:navigate' && typeof (data as { href?: unknown }).href === 'string') {
        const href = (data as { href: string }).href
        if (href.startsWith('/') && !href.startsWith('//')) router.push(href)
      }
      if (data?.type === 'archipelago:error') { window.clearTimeout(quietTimer); fail(String(data.message ?? 'The world could not start.')) }
      // What visitors do in the world, as named events only (see server/analytics.ts).
      if (data?.type === 'archipelago:event') {
        const e = data as { event?: unknown; name?: unknown; action?: unknown }
        if (e.event === 'map_open') track('map_open')
        if (e.event === 'world_activity' && typeof e.name === 'string' && typeof e.action === 'string') track('world_activity', { name: e.name.slice(0, 40), action: e.action.slice(0, 20) })
      }
      if (data?.type === 'archipelago:ready') {
        window.clearTimeout(quietTimer)
        setReady(true)
        setQuiet(false)
        track('world_ready', { ms: Math.round(performance.now() - started.current), arrival, attempt })
        const focus = () => { frame.current?.focus(); frame.current?.contentWindow?.focus() }
        void garden.whenCovered().then(() => {
          if (!cancelled && worldTransition.get().phase === 'LOADING_WORLD') worldTransition.ready(focus)
        })
      }
    }
    window.addEventListener('message', onMessage)
    // Deferred a task so React's development double-mount never creates two worlds.
    const create = window.setTimeout(() => {
      const iframe = document.createElement('iframe')
      iframe.className = styles.player
      iframe.src = RUNTIME
      iframe.title = 'Archipiélago — drive around Alejandro Newport’s island'
      iframe.allow = 'autoplay; fullscreen; gamepad'
      iframe.setAttribute('allowfullscreen', '')
      iframe.addEventListener('load', () => {
        if (!hello) helloTimer = window.setTimeout(() => { if (!hello) fail('The world’s runtime did not start.') }, HELLO_MS)
      })
      frame.current = iframe
      el.append(iframe)
      started.current = performance.now()
      worldTransition.loading()
      resetQuiet()
    }, 0)
    return () => {
      cancelled = true
      window.clearTimeout(create)
      window.clearTimeout(helloTimer)
      window.clearTimeout(quietTimer)
      window.removeEventListener('message', onMessage)
      frame.current?.remove()
      frame.current = null
    }
  }, [attempt, arrival, router])

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
    setReady(false)
    setProgress({ stage: 'Opening the island', value: 0 })
    worldTransition.retry()
    setAttempt((n) => n + 1)
  }, [])

  const home = useCallback(() => {
    worldTransition.abort()
    router.push('/')
  }, [router])

  const covered = phase !== 'IN_WORLD' && phase !== 'HOME'
  return (
    <div className={styles.route} data-world-shell="" data-ready={ready || undefined}>
      <div ref={host} className={styles.stage} aria-busy={!ready} />
      {covered && !ready && !error && createPortal(
        <p className={quiet ? styles.coverNote : 'sr-only'} role="status">
          {quiet ? 'The island is still loading…' : `${progress.stage || 'Opening the island'} · ${Math.round(progress.value * 100)}%`}
        </p>, document.body,
      )}
      {error && createPortal(
        <div className={styles.error} role="alert">
          <p className={styles.eyebrow}>Archipiélago</p>
          <h1 className={styles.title}>The island did not load.</h1>
          <p className={styles.stageText}>{error}</p>
          <div className={styles.actions}>
            <button type="button" onClick={retry} className={styles.primary}>Try again</button>
            <button type="button" onClick={home} className={styles.secondary}>Return to the portfolio</button>
          </div>
        </div>, document.body,
      )}
    </div>
  )
}
