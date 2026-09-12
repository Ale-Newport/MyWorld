'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { ComponentProps, MouseEvent } from 'react'
import { worldTransition } from './transition'
import { garden } from '@/components/home/botanical/garden'
import { useJourney } from '@/state/journey'
import { track } from '@/components/analytics/track'
import { useEditing } from '@/cms/context'

/** In the admin's preview the transition only runs in its explicit test mode (`?cms-test=transition`). */
export function transitionAllowed(editing: boolean): boolean {
  if (!editing || typeof window === 'undefined') return true
  return new URLSearchParams(window.location.search).get('cms-test') === 'transition'
}

/**
 * Every way into /world goes through the same sequence (transition.ts):
 * cover the screen, confirm it is covered, only then load the world.
 * Never prefetched — the world's route is world-exclusive. A modified
 * click (new tab, new window) is left to the browser: that tab enters
 * directly and shows the world's own loading screen.
 *
 * Pointing at the link (or focusing it) prepares the LEAVES, though:
 * the cover mounts at no charge, invisible, and plans its plants, so a
 * click finds it ready. Nothing of the world is touched by that.
 */
export function WorldEntryLink({ href = '/world', source, onClick, onPointerEnter, onFocus, children, ...rest }: Omit<ComponentProps<typeof Link>, 'href' | 'prefetch'> & { href?: string; source: string }) {
  const router = useRouter()
  const editing = useEditing()
  const prepareLeaves = () => {
    if (!transitionAllowed(editing) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    garden.show({ initial: 0, budget: useJourney.getState().performanceTier === 'low' ? 0.6 : 1 })
  }
  return (
    <Link
      href={href}
      prefetch={false}
      {...rest}
      onPointerEnter={(e) => { onPointerEnter?.(e); if (e.pointerType === 'mouse') prepareLeaves() }}
      onFocus={(e) => { onFocus?.(e); prepareLeaves() }}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(e)
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
        e.preventDefault()
        if (!transitionAllowed(editing)) {
          // The editor stays put; it offers "Test transition" for the real thing.
          window.parent.postMessage({ type: 'cms:transition-blocked' }, window.location.origin)
          return
        }
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        if (worldTransition.begin({ source, push: (h) => router.push(h), reduced, href })) track('world_entry_start', { source })
      }}
    >
      {children}
    </Link>
  )
}
