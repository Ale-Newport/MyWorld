'use client'

import { useSyncExternalStore } from 'react'
import { THEME_KEY as KEY } from './theme-script'

/* ============================================================
   LIGHT OR DARK

   The theme is an attribute on <html> (`data-theme`), written by
   a tiny inline script (theme-script.ts) before the page paints, so a visitor who
   chose the dark never sees a light frame first. Their choice is
   kept in this browser; with none, the system's preference
   decides and is followed live. The toggle (ThemeToggle) writes
   the choice; anything that paints in JavaScript (canvases, WebGL)
   listens for `site:theme` and reads the CSS variables again.
   ============================================================ */

export type Theme = 'light' | 'dark'

export const THEME_EVENT = 'site:theme'

function stored(): Theme | null {
  try {
    const t = window.localStorage.getItem(KEY)
    return t === 'light' || t === 'dark' ? t : null
  } catch {
    return null
  }
}

function system(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/** Writes the theme on <html>, tells the page, and paints the browser's chrome to match. */
function apply(t: Theme) {
  const d = document.documentElement
  if (d.dataset.themeLock) return
  if (d.dataset.theme === t) return
  d.dataset.theme = t
  d.style.colorScheme = t
  const ground = getComputedStyle(d).getPropertyValue('--bg-primary').trim()
  if (ground) document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => { m.content = ground })
  window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: { theme: t } }))
}

export function setTheme(t: Theme) {
  try { window.localStorage.setItem(KEY, t) } catch { /* the choice lasts this page only */ }
  apply(t)
}

function subscribe(notify: () => void): () => void {
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  const follow = () => { if (!stored()) apply(system()) }
  mq.addEventListener('change', follow)
  window.addEventListener(THEME_EVENT, notify)
  return () => {
    mq.removeEventListener('change', follow)
    window.removeEventListener(THEME_EVENT, notify)
  }
}

const read = (): Theme => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')

/** The theme on screen. The server cannot know it, so its snapshot is light and the client corrects it after hydration. */
export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, read, () => 'light')
}
