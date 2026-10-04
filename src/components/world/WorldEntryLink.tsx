'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { ComponentProps, MouseEvent } from 'react'
import { worldTransition } from './transition'
import { track } from '@/components/analytics/track'

/**
 * Every way into /world goes through the same sequence (transition.ts):
 * cover the screen, confirm it is covered, only then load the world.
 * Never prefetched — the world's route is world-exclusive. A modified
 * click (new tab, new window) is left to the browser: that tab enters
 * directly and shows the world's own loading screen.
 */
export function WorldEntryLink({ href = '/world', source, onClick, children, ...rest }: Omit<ComponentProps<typeof Link>, 'href' | 'prefetch'> & { href?: string; source: string }) {
  const router = useRouter()
  return (
    <Link
      href={href}
      prefetch={false}
      {...rest}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(e)
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
        e.preventDefault()
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        if (worldTransition.begin({ source, push: (h) => router.push(h), reduced, href })) track('world_entry_start', { source })
      }}
    >
      {children}
    </Link>
  )
}
