'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { getLenis, scrollToProgress } from '@/hooks/useLenisScroll'
import { frame, useJourney, type PerformanceTier } from '@/state/journey'
import { portal } from '@/state/portal'
import { clamp, damp } from '@/lib/math'
import { subscribe } from '@/lib/ticker'
import { garden } from '@/components/home/botanical/garden'
import { inTransition, worldTransition } from '@/components/world/transition'
import { WorldEntryLink, transitionAllowed } from '@/components/world/WorldEntryLink'
import { track } from '@/components/analytics/track'
import { useEditing, useSite } from '@/cms/context'
import styles from './WorldPortal.module.css'

/* ============================================================
   THE WAY OUT
   The journey ends at the foot of the document, so the last
   gesture anyone makes is the one that opens the world: keep
   pushing past the end and the garden closes in over everything —
   first the room behind the page, whose ivy runs on over the wall
   the copy had kept clear, then the ivy itself, come loose of the
   wall and grown out towards the eye over the page and the chrome
   — until there is nothing left but leaves. The world is behind
   them.

   Three things make the effort honest rather than decorative.
   The page is HELD BACK while it is being spent, so a hundred
   pixels of wheel buy visibly fewer than a hundred pixels of
   movement, and fewer still the closer the charge gets to full.
   The canopy grows inward layer by layer, the nearest last and
   largest, so the last scroll is something being pushed through
   rather than a bar being filled. And a phone TICKS under the
   finger at milestones that crowd together as the end approaches.

   NOTHING OF THE WORLD BEFORE THE LEAVES HAVE CLOSED
   The world is not prefetched, downloaded or evaluated on the
   approach. When the charge is spent the cover is completed and
   verified on screen, and only then does the URL become /world
   and the world start loading — under the very same leaves, which
   live in the public layout (see `garden.ts`), and which part only
   when the world has drawn its first prepared frame. The sequence
   is a state machine shared by every way in: components/world/
   transition.ts.

   THE PAGE IS FINISHED UNTIL IT IS PUSHED
   Nothing grows over the copy on the approach: at the foot, unspent,
   the room alone frames the page. The canopy is prepared there, out
   of sight, and the charge alone grows it.
   ============================================================ */

/**
 * The gateway's intent, 0..1, and the stretch in pixels the page is
 * currently being held back by. Module state on purpose (it lives in
 * `state/portal`): the contact chapter retreats and the home room is
 * taken over from their own frame loops by reading the same numbers,
 * and subscribers sharing one value are better behaved than loops
 * fighting over the same inline styles.
 */
export { portal }

/** Wheel pixels for a full charge before resistance is applied. */
const CHARGE_PX = 1250
/** The admin's "leaf growth" setting scales the push a full charge takes.
    It changes how quickly the leaves grow, never how far: coverage is
    still completed and verified by the cover itself. */
const LEAF_CHARGE = { gentle: 1.35, standard: 1, brisk: 0.72 } as const
/** A finger crossing a small screen is worth more than a wheel notch. */
const TOUCH_GAIN = 1.6
/** Lines and pages, normalised to pixels. */
const LINE_PX = 16
/** How close to the foot of the document still counts as the end,
    and how much of Lenis's easing tail is forgiven on the way there. */
const ARM_PX = 2
const SETTLE_PX = 90
/**
 * AND THE PAGE HAS TO HAVE STOPPED. Reaching the foot at speed is one
 * gesture running out of document, not a reader asking for a door —
 * measured, an uninterrupted ride used to enter the world during the
 * descent. So intent counts only once the page has come to rest at
 * the limit with no wheel or touch for this long: longer than any
 * pause inside one continuous scroll, far shorter than the beat a
 * reader spends deciding to push.
 */
const REST_MS = 180
/** One gesture arrives in bursts; the gaps inside it are not a pause. */
const IDLE_GRACE = 0.12
/** Seconds for an abandoned charge to bleed away, and for one let go
    of by scrolling back up the page. */
const DECAY_S = 0.9
const RELEASE_S = 0.35
/** Viewport heights of document over which the approach arrives,
    measured from the foot so `?quick` and a phone's address bar give
    the same answer. */
const REVEAL_VH = 1.35
/** Viewport heights from the foot at which the canopy is PREPARED:
    mounted at no charge (invisible, letting every click through), its
    plants planned and its programs compiled in idle moments, so that
    the leaves start on the very next frame once someone pushes — even
    after a fast scroll straight to the foot. Roughly the start of the
    last chapter. */
const PREPARE_VH = 3.4
/** On a device judged slow, put the prepared canopy (and its WebGL
    context) away after this long well away from the foot; elsewhere it
    is kept for the rest of the visit, so coming back to the foot finds
    it ready again. */
const PARK_MS = 4000

/* ---- resistance -------------------------------------------
   GIVE is how much of a spent pixel the page hands back as
   movement, multiplied by the same curve the charge uses, so the
   stretch shortens exactly as the charge gets heavy. RELAX pulls
   the stretch home continuously: a sustained push settles at an
   offset proportional to how hard it is, a stopped one springs
   back. */
const DRAG_GIVE = 0.3
const DRAG_MAX = 72
const DRAG_RELAX = 7

/* ---- momentum ---------------------------------------------
   A trackpad fling keeps delivering wheel events after the fingers
   leave the glass, and inertia has one signature no hand has: it
   only ever gets smaller. A run of non-increasing notches once a
   burst is past its peak is scored as coasting and worth a fraction
   of its pixels; the moment a delta rises again, full value returns. */
const MOMENTUM_RUN = 6
const MOMENTUM_FALL = 0.99
const MOMENTUM_GAIN = 0.3

/* ---- haptics ----------------------------------------------
   Milestones, not frames, crowding together toward the end so the
   wrist feels the charge accelerating. */
const MILESTONES = [0.18, 0.33, 0.46, 0.57, 0.66, 0.74, 0.81, 0.87, 0.92, 0.96]
/** Backing off past a milestone re-arms it, with slack against rattling. */
const MILESTONE_SLACK = 0.04

/**
 * `?nature-tier=high` in development: headless Chromium reports
 * SwiftShader, the store scores that `low`, and an acceptance run
 * would otherwise measure a composition no visitor is shown.
 */
function forcedTier(): PerformanceTier | null {
  if (process.env.NODE_ENV !== 'development' || typeof window === 'undefined') return null
  const v = new URLSearchParams(window.location.search).get('nature-tier')
  return v === 'high' || v === 'medium' || v === 'low' ? v : null
}

/** A key older builds wrote for the world to read; removed on sight. */
const ARRIVAL_KEY = 'portal:arrival'
/**
 * Where the visitor was when they went through, so Back is a return
 * rather than a reset — `history.scrollRestoration` is manual for the
 * whole site, so the browser restores nothing on its own.
 */
const RETURN_KEY = 'journey:return'
/** Set the first time anyone goes through; the index reads it. */
const UNLOCKED_KEY = 'world2Unlocked'
/**
 * Where a returning visitor is put down: the last chapter on screen
 * and the portal NOT armed, so the tail of a fling still in flight
 * cannot charge a door the visitor is not touching.
 */
const RETURN_TO = 0.93
/** And a lock-out on top of that, for the fling that arrives anyway. */
const DISARM_MS = 500

/** Read once and held: Strict Mode mounts effects twice in development. */
let consumed: { at: number; value: string | null } | null = null

function consumeReturn(): string | null {
  const now = Date.now()
  if (consumed && now - consumed.at < 2000) return consumed.value
  let value: string | null = null
  try {
    value = window.sessionStorage.getItem(RETURN_KEY)
    window.sessionStorage.removeItem(RETURN_KEY)
    /* A visitor who went through and came straight back still holds
       a live arrival key; a plain click on the link inside that window
       would otherwise arrive under a cover nobody pushed for. */
    window.sessionStorage.removeItem(ARRIVAL_KEY)
  } catch {
    // Storage denied. There is nothing to restore and nothing to clear.
  }
  consumed = { at: now, value }
  return value
}

function markArrival() {
  try {
    window.sessionStorage.setItem(RETURN_KEY, String(frame.progress))
    window.localStorage.setItem(UNLOCKED_KEY, '1')
  } catch {
    // Private mode, or storage denied. The world simply shows its
    // own gate and the return simply starts at the top.
  }
}

/** A browser that ignores vibration must cost exactly nothing. */
function buzz(pattern: number | number[]) {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return
  try {
    navigator.vibrate(pattern)
  } catch {
    // Some engines expose the method and refuse the call.
  }
}

export function WorldPortal() {
  const reducedMotion = useJourney((s) => s.reducedMotion)
  const router = useRouter()
  const [committed, setCommitted] = useState(false)
  const { settings } = useSite()
  const worldNav = settings.navigation.find((n) => n.id === 'world')
  const worldHref = worldNav?.href ?? '/world'

  const hostRef = useRef<HTMLDivElement>(null)
  const fillRef = useRef<HTMLSpanElement>(null)
  const idleWordRef = useRef<HTMLSpanElement>(null)
  const goWordRef = useRef<HTMLSpanElement>(null)
  const liveRef = useRef<HTMLParagraphElement>(null)
  /* The charge can cross 1 on consecutive frames; it is a one-way door. */
  const sealed = useRef(false)

  /* ============================================================
     THE RETURN
     Back from the world lands here; the position recorded at commit
     is spent once the document has its height, and the seam colour
     painted on <html> for the swap is taken away again.
     ============================================================ */
  useEffect(() => {
    let raf = 0
    let tries = 0
    const stored = consumeReturn()
    const nav = performance.getEntriesByType('navigation')[0] as
      | PerformanceNavigationTiming
      | undefined
    const back = nav?.type === 'back_forward'
    document.documentElement.style.background = ''

    if (stored === null && !back) return
    const target = Number(stored)
    const to = Number.isFinite(target) && target > 0 ? Math.min(target, RETURN_TO) : RETURN_TO

    const settle = () => {
      const tall = document.documentElement.scrollHeight > window.innerHeight * 4
      if (!tall && tries++ < 40) {
        raf = requestAnimationFrame(settle)
        return
      }
      scrollToProgress(to, { immediate: true })
    }
    raf = requestAnimationFrame(settle)
    return () => cancelAnimationFrame(raf)
  }, [])

  const leafCharge = settings.options.leafCharge
  const editing = useEditing()

  /* The HOMEPAGE's own transition — never anything of the world — is
     made ready once the page has settled: its code fetched, and, on
     any device not judged slow, the canopy itself prepared (mounted at
     no charge: invisible, letting every click through) in idle
     moments. A visitor who flings straight to the foot then finds the
     leaves ready to answer the first push; one who never gets there
     has spent a few idle milliseconds and one more context. On a slow
     device the canopy waits for the last chapter (PREPARE_VH). */
  useEffect(() => {
    if (reducedMotion || !settings.options.worldEntrance) return
    if (!transitionAllowed(editing)) return
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }
    const later = (fn: () => void, timeout: number) => (w.requestIdleCallback ? w.requestIdleCallback(fn, { timeout }) : window.setTimeout(fn, 0))
    let cancelled = false
    const timer = window.setTimeout(() => {
      later(() => {
        void import('@/components/home/room/canopy/CanopyCover').then(() => {
          if (cancelled || (forcedTier() ?? useJourney.getState().performanceTier) === 'low') return
          later(() => { if (!cancelled && !inTransition()) garden.show({ initial: 0, budget: 1 }) }, 3000)
        }).catch(() => {})
      }, 4000)
    }, 2500)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [reducedMotion, settings.options.worldEntrance, editing])

  useEffect(() => {
    if (reducedMotion || !settings.options.worldEntrance) return
    // Scrolling the admin's preview must not carry the editor off to /world.
    if (!transitionAllowed(editing)) return
    portal.pull = 0
    portal.drag = 0
    const chargePx = CHARGE_PX * (LEAF_CHARGE[leafCharge] ?? 1)

    let pull = 0
    let drag = 0
    let lastCharge = -1
    let lastFill = -1
    let lastReveal = -1
    let idle = 0
    let armed = false
    let rested = false
    let lastInput = performance.now()
    let milestone = 0
    let touchY = 0
    let touchId: number | null = null
    let vh = window.innerHeight
    let stopped = false
    let parkedSince = 0
    let isNear = false

    let burstPeak = 0
    let burstLast = 0
    let burstFall = 0
    let lastEvent = 0

    const mounted = performance.now()

    const announce = (message: string) => {
      const live = liveRef.current
      if (live && live.textContent !== message) live.textContent = message
    }

    /* An overlay locks the page with `overflow: hidden`, which Lenis
       never hears about: scrolling the index open over the last
       chapter must not charge the portal. */
    const overlaid = () => {
      const journey = useJourney.getState()
      return journey.indexOpen || journey.activeProject !== null
    }

    /** Pixels of document left below the fold. */
    const remaining = () => {
      const lenis = getLenis()
      if (lenis) return lenis.limit - lenis.scroll
      return document.documentElement.scrollHeight - window.innerHeight - window.scrollY
    }

    const atFoot = () => {
      if (overlaid() || inTransition()) return false
      if (performance.now() - mounted < DISARM_MS) return false
      const lenis = getLenis()
      if (!lenis) return remaining() <= ARM_PX
      return lenis.limit - lenis.targetScroll <= ARM_PX && lenis.limit - lenis.scroll <= SETTLE_PX
    }

    let unsubscribe: (() => void) | null = null
    const teardown = () => {
      if (stopped) return
      stopped = true
      unsubscribe?.()
      unsubscribe = null
      window.removeEventListener('wheel', onWheel)
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onTouchEnd)
      window.removeEventListener('touchcancel', onTouchEnd)
      window.removeEventListener('resize', onResize)
    }

    const commit = () => {
      if (sealed.current) return
      // Another way in (the index link) may already be running.
      if (!worldTransition.begin({ source: 'scroll', push: (href) => router.push(href), href: worldHref })) return
      sealed.current = true
      announce('Entering the world')
      // Two short knocks and a long one: the door opened, not another milestone.
      buzz([16, 40, 90])
      markArrival()
      setCommitted(true)
      track('world_entry_start', { source: 'scroll' })
    }

    /** One notch or one finger's travel, scored for intent. */
    const intent = (delta: number, now: number): number => {
      if (now - lastEvent > IDLE_GRACE * 1000) {
        burstPeak = 0
        burstFall = 0
        burstLast = 0
      }
      lastEvent = now
      const size = Math.abs(delta)
      if (size > burstPeak) burstPeak = size
      if (burstLast > 0 && size < burstLast * MOMENTUM_FALL) burstFall++
      else burstFall = 0
      burstLast = size
      const coasting = burstFall >= MOMENTUM_RUN && size < burstPeak * 0.6
      return coasting ? delta * MOMENTUM_GAIN : delta
    }

    const charge = (delta: number) => {
      lastInput = performance.now()
      if (sealed.current) return
      if (delta <= 0) {
        // Pushing back up lets go of the charge faster than it was gathered.
        pull = clamp(pull + (delta / chargePx) * 1.5)
        return
      }
      if (!armed) return
      const spent = intent(delta, performance.now())
      // Resistance grows with the charge: the last stretch is the one paid for.
      const resistance = 1 - 0.68 * pull * pull
      pull = clamp(pull + (spent / chargePx) * resistance)
      drag = Math.min(DRAG_MAX, drag + spent * DRAG_GIVE * resistance)
      idle = 0

      while (milestone < MILESTONES.length && pull >= MILESTONES[milestone]) {
        buzz(4 + milestone)
        milestone++
      }
      if (pull > 0.7) announce('Almost there — keep scrolling')
      else if (pull > 0.25) announce('Keep scrolling to enter the world')
    }

    function onWheel(e: WheelEvent) {
      const d =
        e.deltaMode === 1 ? e.deltaY * LINE_PX
        : e.deltaMode === 2 ? e.deltaY * vh
        : e.deltaY
      charge(d)
    }

    /* One finger, followed by identity rather than array position. */
    function onTouchStart(e: TouchEvent) {
      if (touchId !== null) return
      const t = e.changedTouches[0]
      if (!t) return
      touchId = t.identifier
      touchY = t.clientY
    }

    function onTouchMove(e: TouchEvent) {
      if (touchId === null) return
      const t = Array.from(e.touches).find((x) => x.identifier === touchId)
      if (!t) return
      charge((touchY - t.clientY) * TOUCH_GAIN)
      touchY = t.clientY
    }

    function onTouchEnd(e: TouchEvent) {
      if (Array.from(e.changedTouches).some((t) => t.identifier === touchId)) touchId = null
    }

    function onResize() {
      vh = window.innerHeight
    }

    unsubscribe = subscribe((dt) => {
      if (sealed.current) {
        // The charge is over; let the held-back page relax under the leaves.
        if (portal.drag !== 0) {
          drag = damp(drag, 0, DRAG_RELAX, dt)
          portal.drag = drag < 0.05 ? 0 : drag
        }
        return
      }
      const foot = atFoot()
      if (!foot) rested = false
      else if (!rested && remaining() <= ARM_PX && performance.now() - lastInput >= REST_MS) {
        rested = true
      }
      armed = foot && rested

      if (!armed) pull = clamp(pull - dt / RELEASE_S)
      else {
        idle += dt
        if (idle > IDLE_GRACE) pull = clamp(pull - dt / DECAY_S)
      }

      drag = damp(drag, 0, DRAG_RELAX, dt)
      if (drag < 0.05) drag = 0
      while (milestone > 0 && pull < MILESTONES[milestone - 1] - MILESTONE_SLACK) milestone--

      portal.pull = pull
      portal.drag = drag

      /* ---- the approach ------------------------------------ */
      const reveal = overlaid() ? 0 : clamp(1 - remaining() / (vh * REVEAL_VH))
      /* The canopy only exists in the last chapter: a WebGL context is
         not something to carry through the whole journey. It is
         prepared well before the foot, so it is ready before anyone
         pushes (see PREPARE_VH). */
      const prepare = !overlaid() && remaining() < vh * PREPARE_VH
      // The tier is read now, not subscribed to: a demotion in the
      // middle of a push must not re-run (and reset) this gesture.
      const low = (forcedTier() ?? useJourney.getState().performanceTier) === 'low'
      if (prepare) {
        parkedSince = 0
        if (!isNear) {
          isNear = true
          garden.show({ initial: 0, budget: low ? 0.6 : 1 })
        }
      } else if (isNear && low) {
        parkedSince ||= performance.now()
        if (performance.now() - parkedSince > PARK_MS) {
          isNear = false
          garden.hide()
        }
      }
      /* The garden holds the value until the canopy has mounted. */
      const cq = Math.round(pull * 400)
      if (isNear && cq !== lastCharge) {
        lastCharge = cq
        garden.set(cq / 400)
      }

      const fq = Math.round(pull * 200)
      const rq = Math.round(reveal * 100)
      if (fq === lastFill && rq === lastReveal) {
        if (pull >= 1) commit()
        return
      }
      lastFill = fq
      lastReveal = rq
      if (fillRef.current) fillRef.current.style.transform = `scaleX(${pull})`

      /* The instruction appears only once the page has run out, and
         changes its mind through a one-line mask as the charge builds. */
      // Early enough to be read: the canopy closes over the foot of the
      // screen from about half way.
      const swap = clamp((pull - 0.3) / 0.15)
      const appear = clamp((reveal - 0.55) / 0.35)
      if (idleWordRef.current) {
        idleWordRef.current.style.opacity = String((1 - swap) * appear)
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
    window.addEventListener('resize', onResize)

    /* `frame` and `portal` survive a route change in the same JS
       context; reset them on the way out so a return does not start
       from the final frame of the page it left. */
    return () => {
      teardown()
      /* Leaving any other way than through the door — the index, a
         link — takes the leaves with it. Through the door, the world
         takes them over. */
      if (!sealed.current && !inTransition()) garden.hide()
      portal.pull = 0
      portal.drag = 0
      frame.progress = 0
      frame.velocity = 0
      frame.chapterProgress = 0
    }
  }, [reducedMotion, router, settings.options.worldEntrance, worldHref, leafCharge, editing])

  return (
    <div
      className={styles.host}
      ref={hostRef}
      data-phase={committed ? 'entering' : 'idle'}
      data-plain={reducedMotion ? 'true' : undefined}
    >
      {!reducedMotion && <p className="sr-only" role="status" aria-live="polite" ref={liveRef} />}

      <div className={styles.readout}>
        {!reducedMotion && (
          <span className={styles.state} aria-hidden="true">
            <span className={styles.word} ref={idleWordRef}>
              Keep scrolling<span className={styles.wordTail}> — the garden takes over</span>
            </span>
            <span className={`${styles.word} ${styles.wordGo}`} ref={goWordRef}>Almost through</span>
          </span>
        )}

        {/* The scroll is an enhancement; this is the way through. */}
        <WorldEntryLink
          href={worldHref}
          source="portal-link"
          className={styles.enter}
          data-cursor="link"
          data-cursor-text="DRIVE"
        >
          {worldNav?.label ?? 'Enter my world'}
          <span className={styles.enterArrow} aria-hidden="true">→</span>
        </WorldEntryLink>

        {!reducedMotion && (
          <span className={styles.rule} aria-hidden="true">
            <span className={styles.ruleFill} ref={fillRef} />
          </span>
        )}
      </div>
    </div>
  )
}
