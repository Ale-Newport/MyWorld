'use client'

import { useLayoutEffect } from 'react'
import { THEME_KEY } from '@/components/site/theme-script'

/* ============================================================
   THE WORLD KEEPS ITS DAYLIGHT

   The island is lit by its own sun, and its UI and minimap read
   the day's tokens (see world/core/palette.ts), so /world opts out
   of the site's dark theme. While the route is mounted <html>
   carries `data-theme-lock` and the light theme; the first-paint
   script and the toggle (site/theme*.ts) leave a locked page
   alone. A hard load is locked by the inline script in the layout
   (daylight-script.ts), before the first paint; a client
   navigation in, by the effect below. Leaving gives the page back
   the visitor's own theme — their choice, else their system's —
   and each change is announced (`site:theme`), so whatever paints
   in JavaScript draws itself again.
   ============================================================ */

export function Daylight() {
  useLayoutEffect(() => {
    const d = document.documentElement
    const set = (t: string) => {
      d.style.colorScheme = t
      if (d.dataset.theme === t) return
      d.dataset.theme = t
      window.dispatchEvent(new CustomEvent('site:theme', { detail: { theme: t } }))
    }
    d.dataset.themeLock = '1'
    set('light')
    return () => {
      delete d.dataset.themeLock
      let t: string | null = null
      try { t = window.localStorage.getItem(THEME_KEY) } catch { /* no storage: the system decides */ }
      if (t !== 'light' && t !== 'dark') t = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
      set(t)
    }
  }, [])
  return null
}
