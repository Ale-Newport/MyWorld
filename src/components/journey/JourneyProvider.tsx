'use client'

import { useEffect } from 'react'
import { useJourney } from '@/state/journey'
import { useLenisScroll } from '@/hooks/useLenisScroll'
import { detectDevice } from '@/lib/perf'
import { totalVh } from '@/content/chapters'

/**
 * Owns the global side effects of the experience:
 * device tiering, reduced-motion, scroll driver, document
 * height and deep-link restore.
 */
export function JourneyProvider({ children }: { children: React.ReactNode }) {
  const quickView = useJourney((s) => s.quickView)
  const reducedMotion = useJourney((s) => s.reducedMotion)
  const setReducedMotion = useJourney((s) => s.setReducedMotion)
  const setPerformanceTier = useJourney((s) => s.setPerformanceTier)
  const setQuickView = useJourney((s) => s.setQuickView)
  const setReady = useJourney((s) => s.setReady)

  useLenisScroll(true)

  /* ---- device + preferences ------------------------------ */
  useEffect(() => {
    // Own scroll restoration: the browser dropping the visitor into
    // the middle of a pinned chapter reads as a broken page.
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual'
    const device = detectDevice()
    setPerformanceTier(device.tier)

    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const apply = () => setReducedMotion(mq.matches)
    apply()
    mq.addEventListener('change', apply)

    // Deep-link: ?quick or #quick enables recruiter mode.
    const params = new URLSearchParams(window.location.search)
    if (params.has('quick') || window.location.hash === '#quick') setQuickView(true)

    setReady(true)
    return () => mq.removeEventListener('change', apply)
  }, [setPerformanceTier, setReducedMotion, setQuickView, setReady])

  /* ---- reduced motion ------------------------------------ */
  useEffect(() => {
    document.documentElement.setAttribute('data-reduced', reducedMotion ? 'true' : 'false')
  }, [reducedMotion])

  /* ---- document height ----------------------------------- */
  useEffect(() => {
    const vh = totalVh(quickView)
    document.documentElement.style.setProperty('--journey-vh', String(vh))
  }, [quickView])

  return <>{children}</>
}
