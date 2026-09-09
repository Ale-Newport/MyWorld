'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { getLenis } from '@/hooks/useLenisScroll'
import { useJourney } from '@/state/journey'
import { clamp, easeOutCubic } from '@/lib/math'
import { subscribe } from '@/lib/ticker'
import styles from './WorldPortal.module.css'

/* ============================================================
   THE WAY OUT
   The journey ends at the foot of the document, so the last
   gesture anyone makes is the one that opens the world: keep
   pushing past the end and a veil the colour of the page
   climbs over everything behind it. It is deliberately heavy —
   a stray flick must never fire a navigation — and the route
   downloads while the effort is being spent, so the door is
   already open by the time it is pushed.
   ============================================================ */

/**
 * Charge, 0..1. Module state on purpose: the contact chapter
 * retreats ahead of the veil from its own frame loop, and two
 * subscribers sharing one number is far better behaved than two
 * loops fighting over the same inline styles. Same arrangement,
 * and same reason, as `frame`.
 */
export const portal = { pull: 0 }

/** Wheel pixels for a full charge before resistance is applied. */
const CHARGE_PX = 900
/** A finger crossing a small screen is worth more than a wheel notch. */
const TOUCH_GAIN = 1.6
/** Lines and pages, normalised to pixels. */
const LINE_PX = 16
/** How close to the foot of the document still counts as the end,
    and how much of Lenis's easing tail is forgiven on the way there. */
const ARM_PX = 2
const SETTLE_PX = 90
/** One gesture arrives in bursts; the gaps inside it are not a pause. */
const IDLE_GRACE = 0.12
/** Seconds for an abandoned charge to bleed away, and for one let go
    of by scrolling back up the page. */
const DECAY_S = 0.9
const RELEASE_S = 0.35
/** The sheet rests 112 points below the stage — its own height plus
    the soft leading edge riding above it — and a full charge is worth
    104 of them, so there is always somewhere left to travel when the
    charge is spent. Both figures are shared with the module's CSS. */
const REST_PCT = 112
const TRAVEL_PCT = 104
/** How long the sheet is left to finish before the route swaps
    underneath it. Shorter than the transition in the module's CSS
    on purpose: by here the easing is within a pixel of home, and
    waiting out the tail would only be a wait. */
const COMMIT_MS = 560

export function WorldPortal() {
  const reducedMotion = useJourney((s) => s.reducedMotion)
  const router = useRouter()
  const [committed, setCommitted] = useState(false)

  const veilRef = useRef<HTMLDivElement>(null)
  const fillRef = useRef<HTMLSpanElement>(null)
  const idleWordRef = useRef<HTMLSpanElement>(null)
  const goWordRef = useRef<HTMLSpanElement>(null)
  const liveRef = useRef<HTMLParagraphElement>(null)
  /* The charge can cross 1 on consecutive frames, and pointer
     intent can fire many times; both are one-way doors. */
  const sealed = useRef(false)
  const warmed = useRef(false)

  const warm = useCallback(() => {
    if (warmed.current) return
    warmed.current = true
    router.prefetch('/world')
  }, [router])

  useEffect(() => {
    if (reducedMotion) return
    portal.pull = 0

    let pull = 0
    let lastPull = 0
    let idle = 0
    let armed = false
    let touchY = 0
    let touchId: number | null = null
    let timer = 0

    const announce = (message: string) => {
      const live = liveRef.current
      if (live && live.textContent !== message) live.textContent = message
    }

    /* Lenis owns the scroll position, so ask Lenis rather than the
       document. Two readings, because one is not enough: the target
       says the visitor has asked for the end of the page, which the
       easing may still be a few pixels short of, and the rendered
       position says the page has very nearly arrived, so a long
       fling cannot arm the portal in mid-air. */
    const atFoot = () => {
      // An overlay locks the page with `body { overflow: hidden }`, which
      // Lenis never hears about: without this the visitor scrolling the
      // chapter index open over the last chapter would charge the portal
      // and be navigated somewhere they were not going.
      const journey = useJourney.getState()
      if (journey.indexOpen || journey.activeProject) return false

      const lenis = getLenis()
      if (!lenis) {
        return document.documentElement.scrollHeight - window.innerHeight - window.scrollY <= ARM_PX
      }
      return lenis.limit - lenis.targetScroll <= ARM_PX && lenis.limit - lenis.scroll <= SETTLE_PX
    }

    const commit = () => {
      if (sealed.current) return
      sealed.current = true
      announce('Entering the world')
      setCommitted(true)
      timer = window.setTimeout(() => router.push('/world'), COMMIT_MS)
    }

    const charge = (delta: number) => {
      if (sealed.current) return
      if (delta <= 0) {
        // Pushing back up the page lets go of the charge faster than
        // it was gathered.
        pull = clamp(pull + (delta / CHARGE_PX) * 1.5)
        return
      }
      if (!armed) return
      // Resistance grows with the charge, so the last stretch is the
      // one the visitor feels paying for.
      pull = clamp(pull + (delta / CHARGE_PX) * (1 - 0.55 * pull * pull))
      idle = 0
      warm()
      if (pull > 0.25) announce('Keep scrolling to enter the world')
    }

    const onWheel = (e: WheelEvent) => {
      const d =
        e.deltaMode === 1 ? e.deltaY * LINE_PX
        : e.deltaMode === 2 ? e.deltaY * window.innerHeight
        : e.deltaY
      charge(d)
    }

    /* One finger, followed by identity rather than by array position:
       a second finger landing reindexes `touches`, and the gap between
       two fingers would otherwise arrive as a single huge charge. */
    const onTouchStart = (e: TouchEvent) => {
      if (touchId !== null) return
      const t = e.changedTouches[0]
      if (!t) return
      touchId = t.identifier
      touchY = t.clientY
    }

    const onTouchMove = (e: TouchEvent) => {
      if (touchId === null) return
      const t = Array.from(e.touches).find((x) => x.identifier === touchId)
      if (!t) return
      charge((touchY - t.clientY) * TOUCH_GAIN)
      touchY = t.clientY
    }

    const onTouchEnd = (e: TouchEvent) => {
      if (Array.from(e.changedTouches).some((t) => t.identifier === touchId)) touchId = null
    }

    const stop = subscribe((dt) => {
      if (sealed.current) return
      armed = atFoot()

      if (!armed) pull = clamp(pull - dt / RELEASE_S)
      else {
        idle += dt
        if (idle > IDLE_GRACE) pull = clamp(pull - dt / DECAY_S)
      }

      portal.pull = pull
      if (pull === 0 && lastPull === 0) return
      lastPull = pull

      /* Ahead of linear at the start, so the first flick plainly does
         something, and honest afterwards, so the last stretch looks
         like the work it costs. */
      const rise = pull * 0.7 + easeOutCubic(pull) * 0.3
      if (veilRef.current) {
        veilRef.current.style.transform = `translate3d(0, ${REST_PCT - rise * TRAVEL_PCT}%, 0)`
      }
      if (fillRef.current) fillRef.current.style.transform = `scaleX(${pull})`

      /* The two words share one cell, so a plain cross-fade blends
         them into an unreadable hybrid for the length of the swap.
         They ride through a mask instead — the site's own idiom for
         one piece of type replacing another. */
      const swap = clamp((pull - 0.7) / 0.2)
      if (idleWordRef.current) {
        idleWordRef.current.style.opacity = String(1 - swap)
        idleWordRef.current.style.transform = `translate3d(0, ${-swap * 100}%, 0)`
      }
      if (goWordRef.current) {
        goWordRef.current.style.opacity = String(swap)
        goWordRef.current.style.transform = `translate3d(0, ${(1 - swap) * 100}%, 0)`
      }

      if (pull >= 1) commit()
    })

    window.addEventListener('wheel', onWheel, { passive: true })
    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchmove', onTouchMove, { passive: true })
    window.addEventListener('touchend', onTouchEnd, { passive: true })
    window.addEventListener('touchcancel', onTouchEnd, { passive: true })

    return () => {
      stop()
      window.removeEventListener('wheel', onWheel)
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onTouchEnd)
      window.removeEventListener('touchcancel', onTouchEnd)
      if (timer) window.clearTimeout(timer)
      portal.pull = 0
    }
  }, [reducedMotion, router, warm])

  /* Once sealed the frame loop lets go, so the closing values are
     written here exactly once and the transition armed by the phase
     attribute carries them home. */
  useEffect(() => {
    if (!committed) return
    if (veilRef.current) veilRef.current.style.transform = 'translate3d(0, 0, 0)'
    if (fillRef.current) fillRef.current.style.transform = 'scaleX(1)'
    if (idleWordRef.current) {
      idleWordRef.current.style.opacity = '0'
      idleWordRef.current.style.transform = 'translate3d(0, -100%, 0)'
    }
    if (goWordRef.current) {
      goWordRef.current.style.opacity = '1'
      goWordRef.current.style.transform = 'translate3d(0, 0, 0)'
    }
  }, [committed])

  return (
    <div
      className={styles.host}
      data-phase={committed ? 'entering' : 'idle'}
      data-plain={reducedMotion ? 'true' : undefined}
    >
      {!reducedMotion && (
        <>
          <div className={styles.veil} ref={veilRef} aria-hidden="true">
            <span className={styles.veilFade} />
            <span className={styles.veilEdge} />
          </div>
          <p className="sr-only" role="status" aria-live="polite" ref={liveRef} />
        </>
      )}

      <div className={styles.readout}>
        {!reducedMotion && (
          <span className={styles.state} aria-hidden="true">
            <span className={styles.word} ref={idleWordRef}>Keep scrolling</span>
            <span className={`${styles.word} ${styles.wordGo}`} ref={goWordRef}>Entering</span>
          </span>
        )}

        {/* The scroll is an enhancement; this is the way through.
            Prefetching is deliberately tied to intent rather than to
            the link merely being on screen — the world is a large
            download for a visitor who may never open it. */}
        <Link
          href="/world"
          prefetch={false}
          className={styles.enter}
          onPointerEnter={warm}
          onFocus={warm}
          data-cursor="link"
          data-cursor-text="DRIVE"
        >
          Enter my world
          <span className={styles.enterArrow} aria-hidden="true">→</span>
        </Link>

        {!reducedMotion && (
          <span className={styles.rule} aria-hidden="true">
            <span className={styles.ruleFill} ref={fillRef} />
          </span>
        )}
      </div>
    </div>
  )
}
