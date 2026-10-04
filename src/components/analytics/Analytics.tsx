'use client'

import { usePathname } from 'next/navigation'
import { useEffect } from 'react'
import { resetConsent, track } from './track'

/* Mounted by the public layout only when the site's analytics option
   is on and the page is not an admin preview. It marks the document
   as measurable and counts one page view per route. */
export function Analytics() {
  const pathname = usePathname()
  useEffect(() => {
    document.documentElement.dataset.analytics = 'on'
    resetConsent()
    return () => {
      delete document.documentElement.dataset.analytics
      resetConsent()
    }
  }, [])
  useEffect(() => {
    track('pageview')
  }, [pathname])
  return null
}
