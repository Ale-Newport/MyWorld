'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { useSite, useEditing } from '@/cms/context'
import { SiteNav } from '@/components/navigation/SiteNav'
import { IndexOverlay } from '@/components/navigation/IndexOverlay'
import type { SitePageId } from '@/components/navigation/pages'
import { Cursor } from '@/components/ui/Cursor'
import { PressFeedback } from '@/components/ui/PressFeedback'
import { useJourney } from '@/state/journey'
import styles from './SiteHeader.module.css'

/* ============================================================
   THE CHROME OF A PAGE THAT IS NOT A JOURNEY
   Contact and the blog are ordinary pages: they scroll natively,
   with no scrub, no chapters and no room behind them. They keep
   the journeys' top bar all the same — the mark and name on the
   left, the pages on the right (an index on a phone) — so moving
   between any two pages never changes where the navigation is.

   The pointer and the press feedback come along too. The journey
   store's reduced-motion flag is what the cursor reads; outside a
   journey nobody else sets it, so this does.
   ============================================================ */

export function SiteHeader({ current }: { current: SitePageId }) {
  const { profile } = useSite()
  const editing = useEditing()
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const setReducedMotion = useJourney((s) => s.setReducedMotion)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const apply = () => setReducedMotion(mq.matches)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [setReducedMotion])

  return (
    <>
      {!editing && <Cursor />}
      <PressFeedback />
      <header className={styles.bar} data-hidden={open || undefined}>
        <Link href="/" className={styles.brand} data-cursor="link" data-cursor-text="HOME">
          <span className={styles.mark} aria-hidden="true">{profile.initials}</span>
          <span className={styles.brandName}>{profile.name}</span>
        </Link>
        <SiteNav current={current} className={styles.pages} />
        <button type="button" className={styles.indexBtn} onClick={() => setOpen(true)} aria-haspopup="dialog" data-cursor="link">
          <span className={styles.indexLines} aria-hidden="true"><i /><i /><i /></span>
          <span className={styles.btnLabel}>INDEX</span>
        </button>
      </header>
      <IndexOverlay open={open} onClose={close} current={current} />
    </>
  )
}
