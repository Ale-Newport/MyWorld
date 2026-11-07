'use client'

import { useEffect, useRef } from 'react'
import { useSite } from '@/cms/context'
import { accentCss } from '@/styles/accent'
import { THEME_EVENT } from './theme'

/* The editor's accent, as the four shades (styles/accent.ts), for the pages and their dark theme. Rendered from the
   site document in the client tree rather than the server layout, so the editor's preview recolours as the colour is
   picked; anything that paints in JavaScript is told to read its colours again. */
export function AccentStyle() {
  const { settings } = useSite()
  const accent = (settings as { accent?: string }).accent
  const css = accentCss(accent)
  const first = useRef(true)
  useEffect(() => {
    if (first.current) { first.current = false; return }
    window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: { accent } }))
  }, [accent])
  return css ? <style>{css}</style> : null
}
