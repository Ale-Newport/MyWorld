'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { ComponentProps, MouseEvent } from 'react'
import { worldTransition } from './transition'
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
 */
export function WorldEntryLink({ href = '/world', source, onClick, children, ...rest }: Omit<ComponentProps<typeof Link>, 'href' | 'prefetch'> & { href?: string; source: string }) {
  const router = useRouter()
  const editing = useEditing()
  return (
    <Link
      href={href}
      prefetch={false}
      {...rest}
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
