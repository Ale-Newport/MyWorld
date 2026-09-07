'use client'

import { useEffect } from 'react'
import { useJourney } from '@/state/journey'
import { profile, contact } from '@/content/profile'
import { projects } from '@/content/projects'

const KONAMI = [
  'ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown',
  'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight',
  'b', 'a',
]

/**
 * Small rewards for curiosity. None of them obstruct the site,
 * and every one is reversible.
 */
export function useEasterEggs() {
  const setActiveProject = useJourney((s) => s.setActiveProject)

  /* Console note for anyone who opens devtools. */
  useEffect(() => {
    const gh = contact.find((c) => c.id === 'github')?.href ?? ''
    console.log(
      `%c${profile.name}%c\nStill checking under the hood?\n\n` +
      `${projects.length} projects · ${projects.filter((p) => p.importance === 'hero').length} hero case studies\n` +
      `Built with Next.js · React Three Fiber · GLSL · zero UI kit.\n\n` +
      `Source & more: ${gh}\n` +
      `Try the Konami code. Or press I for the index.`,
      'font: 600 22px/1.2 system-ui; letter-spacing:-0.03em',
      'font: 12px/1.6 ui-monospace, monospace; color:#888',
    )
  }, [])

  /* Konami — flips the world into its inverse for a while. */
  useEffect(() => {
    let buf: string[] = []
    const onKey = (e: KeyboardEvent) => {
      buf.push(e.key)
      if (buf.length > KONAMI.length) buf = buf.slice(-KONAMI.length)
      if (buf.length !== KONAMI.length) return
      if (!buf.every((k, i) => k.toLowerCase() === KONAMI[i].toLowerCase())) return
      buf = []
      document.documentElement.setAttribute('data-konami', 'true')
      window.setTimeout(() => document.documentElement.removeAttribute('data-konami'), 7000)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  /* Deep link: #project/<slug> opens a case study directly. */
  useEffect(() => {
    const onHash = () => {
      const h = window.location.hash
      if (h.startsWith('#project/')) setActiveProject(h.slice('#project/'.length))
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [setActiveProject])
}
