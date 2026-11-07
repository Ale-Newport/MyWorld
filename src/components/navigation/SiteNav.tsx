'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useSite } from '@/cms/context'
import { WorldEntryLink } from '@/components/world/WorldEntryLink'
import { sitePages, type SitePageId } from './pages'
import styles from './SiteNav.module.css'

/* ============================================================
   THE PAGES, IN THE TOP BAR
   A desktop has the width to name every page where the eye
   already is, so it gets no index: the pages are printed in the
   chrome's own mono label, the current one marked. Home is not
   among them — the mark and the name at the left of the bar are
   the way home. (A phone gets the index instead — IndexOverlay.)

   Every link is on screen from first paint, so none is
   prefetched until it is pointed at or focused: the same bargain
   the cross-journey link always struck. The world goes through
   its own link, which grows the leaves on the way in.
   ============================================================ */

export function SiteNav({ current, className }: { current: SitePageId | null; className?: string }) {
  const site = useSite()
  const router = useRouter()
  return (
    <nav className={`${styles.nav} ${className ?? ''}`} aria-label="Pages">
      <ul className={styles.list}>
        {sitePages(site).filter((p) => p.id !== 'home').map((p) => {
          const here = p.id === current
          const common = {
            className: styles.link,
            'aria-current': here ? ('page' as const) : undefined,
            'data-cursor': 'link',
          }
          return (
            <li key={p.id}>
              {p.id === 'world' ? (
                <WorldEntryLink href={p.href} source="nav" {...common}>{p.label}</WorldEntryLink>
              ) : (
                <Link
                  href={p.href}
                  prefetch={false}
                  onPointerEnter={() => router.prefetch(p.href)}
                  onFocus={() => router.prefetch(p.href)}
                  {...common}
                >
                  {p.label}
                </Link>
              )}
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
