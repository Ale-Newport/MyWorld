'use client'

import Link from 'next/link'
import { useEffect, useRef, useSyncExternalStore } from 'react'
import { useSite } from '@/cms/context'
import { WorldEntryLink } from '@/components/world/WorldEntryLink'
import { claimEscape, holdScroll } from '@/components/ui/scrollLock'
import { Arrow } from '@/components/ui/Arrow'
import { ThemeToggle } from '@/components/site/ThemeToggle'
import { sitePages, type SitePage, type SitePageId } from './pages'
import styles from './IndexOverlay.module.css'

/* ============================================================
   THE INDEX IS THE LIST OF PAGES
   It is the phone's navigation (a desktop prints the same pages
   in its top bar: SiteNav), and it names pages only — never the
   chapters inside them, which are reached by scrolling the page
   they belong to. One row per page, the one underfoot marked.
   ============================================================ */

/* ------------------------------------------------------------
   THE WAY OUT, AND WHO IS TOLD ABOUT IT

   The gateway at the foot of the home journey is the site's one
   cinematic moment, so the world's row changes its note rather
   than its name: a first-time reader is told what it is, and a
   reader who has already pushed their way through is told it is
   still there.

   `worldUnlocked` is written by the portal at the instant it
   commits. localStorage has no server-side answer, and a panel
   that disagreed with its own HTML would be a hydration error
   for the sake of one line of type — so the flag is read through
   `useSyncExternalStore`, whose server snapshot is a flat false.
   Nothing in the tab writes the key while the panel is up (the
   portal only writes it as the route leaves), so `subscribe` has
   nobody to notify and returns an empty teardown.
   ------------------------------------------------------------ */
const UNLOCKED_KEY = 'worldUnlocked'

function subscribeUnlocked(): () => void {
  return () => {}
}

function readUnlocked(): boolean {
  try {
    return window.localStorage.getItem(UNLOCKED_KEY) === '1'
  } catch {
    // Storage denied. Everyone is a first-time visitor, which is
    // the more generous of the two mistakes available here.
    return false
  }
}

function serverUnlocked(): boolean {
  return false
}

function useWorldVisited(): boolean {
  return useSyncExternalStore(subscribeUnlocked, readUnlocked, serverUnlocked)
}

/** Full-screen list of the site's pages, and on a phone the bar's switches: sound (on a journey) and the theme. */
export function IndexOverlay({ open, onClose, current, sound }: { open: boolean; onClose: () => void; current: SitePageId | null; sound?: { on: boolean; toggle: () => void } }) {
  const site = useSite()
  const pages = sitePages(site)
  const sheet = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const visited = useWorldVisited()

  /* Focus trap + escape. The row of the page underfoot takes the focus as the panel opens. */
  useEffect(() => {
    if (!open) return
    const prev = document.activeElement as HTMLElement | null
    const rows = panel.current?.querySelectorAll<HTMLElement>('[data-page]')
    const here = Array.from(rows ?? []).find((r) => r.dataset.page === current) ?? rows?.[0]
    here?.focus()
    const release = sheet.current ? holdScroll(sheet.current) : undefined

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { if (claimEscape(sheet.current, e)) onClose(); return }
      if (e.key !== 'Tab') return
      const nodes = panel.current?.querySelectorAll<HTMLElement>('button, a[href], [tabindex]:not([tabindex="-1"])')
      if (!nodes?.length) return
      const list = Array.from(nodes)
      const first = list[0]
      const last = list[list.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      release?.()
      prev?.focus()
    }
  }, [open, onClose, current])

  const row = (p: SitePage, i: number) => {
    const here = p.id === current
    const note = p.id === 'world' && visited ? 'You have been · pick up where you left off' : p.note
    const body = (
      <>
        <span className={styles.itemNo}>{String(i + 1).padStart(2, '0')}</span>
        <span className={styles.itemTitle}>{p.id === 'world' && visited ? 'Back to the island' : p.label}</span>
        <span className={styles.itemNote}>{here ? 'You are here' : note}</span>
        <span className={styles.itemArrow}><Arrow dir="right" /></span>
      </>
    )
    const common = {
      className: styles.item,
      'data-page': p.id,
      'data-current': here,
      'aria-current': here ? ('page' as const) : undefined,
      'data-cursor': 'link',
    }
    return (
      <li key={p.id}>
        {p.id === 'world' ? (
          <WorldEntryLink href={p.href} source="index" onClick={onClose} {...common}>{body}</WorldEntryLink>
        ) : (
          <Link href={p.href} prefetch={false} onClick={onClose} {...common}>{body}</Link>
        )}
      </li>
    )
  }

  return (
    <div
      ref={sheet}
      className={styles.overlay}
      data-open={open}
      role="dialog"
      aria-modal="true"
      aria-label="Index"
      aria-hidden={!open}
      inert={!open}
      /* The smooth scroller drives the page by the wheel; over the index
         the wheel belongs to the list, not to the page behind it. */
      data-lenis-prevent=""
    >
      <div className={styles.scrim} onClick={onClose} />
      <div className={styles.panel} ref={panel}>
        <header className={styles.head}>
          <div>
            <p className="label">Index</p>
            <p className={styles.headName}>{site.profile.name}</p>
          </div>
          <button type="button" className={styles.close} onClick={onClose} data-cursor="link" data-cursor-text="CLOSE">
            <span className={styles.closeX} aria-hidden="true"><i /><i /></span>
            <span className="sr-only">Close index</span>
          </button>
        </header>

        <nav className={styles.list} aria-label="Pages">
          <ol className={styles.pages}>{pages.map(row)}</ol>
        </nav>

        <footer className={styles.foot}>
          {sound && (
            <button type="button" className={styles.switch} onClick={sound.toggle} aria-pressed={sound.on} data-cursor="link">
              <span className={styles.soundBars} data-on={sound.on} aria-hidden="true"><i /><i /><i /><i /></span>
              <span>{sound.on ? 'Sound on' : 'Sound off'}</span>
            </button>
          )}
          <ThemeToggle className={styles.switch} />
        </footer>
      </div>
    </div>
  )
}
