'use client'

import Link from 'next/link'
import { useEffect, useRef, useSyncExternalStore } from 'react'
import { journeys } from '@/content/chapters'
import type { Chapter, JourneyId } from '@/content/types'
import { profile, contact } from '@/content/profile'
import { useActiveChapter, useJourneyRoute } from '@/components/journey/JourneyProvider'
import { useJourney } from '@/state/journey'
import { scrollToProgress } from '@/hooks/useLenisScroll'
import styles from './IndexOverlay.module.css'

/* ============================================================
   THE INDEX IS THE MAP OF BOTH JOURNEYS
   Two routes, and the visitor is standing in one of them: an
   index listing only the chapters underfoot would make the other
   half of the site invisible. So both are printed, the mounted
   one first, each broken into its thematic groups — which is the
   whole point of the reordering, and only legible if the reader
   can see the groups named.
   ============================================================ */

interface Group {
  label: string
  chapters: Chapter[]
}

/** Consecutive runs of a shared group, in running order. */
function groupsOf(list: Chapter[]): Group[] {
  const out: Group[] = []
  for (const c of list) {
    const last = out[out.length - 1]
    if (last && last.label === c.group) last.chapters.push(c)
    else out.push({ label: c.group, chapters: [c] })
  }
  return out
}

/* ------------------------------------------------------------
   THE WAY OUT, AND WHO IS TOLD ABOUT IT

   The gateway at the foot of the home journey is the site's one
   cinematic moment, and a panel that says "here is the world,
   press this" has spent it before the visitor arrives. So the
   note under this link changes rather than the link itself: a
   first-time reader is told what it is, and a reader who has
   already pushed their way through is told it is still there.

   `world2Unlocked` is written by the portal at the instant it
   commits. localStorage has no server-side answer, and a panel
   that disagreed with its own HTML would be a hydration error
   for the sake of one line of type — so the flag is read through
   `useSyncExternalStore`, whose server snapshot is a flat false.
   That is the platform-owned way to say "React does not hold
   this": no effect, no setState on mount, no cascading render.
   Nothing in the tab writes the key while the panel is up (the
   portal only writes it as the route leaves), so `subscribe` has
   nobody to notify and returns an empty teardown.
   ------------------------------------------------------------ */
const UNLOCKED_KEY = 'world2Unlocked'

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

/** Full-screen chapter index, plus Quick View and contact shortcuts. */
export function IndexOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  /* Which journey is underfoot comes from the route, so the panel
     prints the right one first even before a single effect has run. */
  const { id: journeyId, ranges } = useJourneyRoute()
  const chapter = useActiveChapter().id
  const quickView = useJourney((s) => s.quickView)
  const setQuickView = useJourney((s) => s.setQuickView)
  const panel = useRef<HTMLDivElement>(null)
  const firstItem = useRef<HTMLButtonElement>(null)
  const visited = useWorldVisited()

  /* Focus trap + escape. */
  useEffect(() => {
    if (!open) return
    const prev = document.activeElement as HTMLElement | null
    firstItem.current?.focus()
    document.body.style.overflow = 'hidden'

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key !== 'Tab') return
      const nodes = panel.current?.querySelectorAll<HTMLElement>(
        'button, a[href], [tabindex]:not([tabindex="-1"])',
      )
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
      document.body.style.overflow = ''
      prev?.focus()
    }
  }, [open, onClose])

  const go = (id: string) => {
    const r = ranges.find((x) => x.id === id)
    onClose()
    if (r) requestAnimationFrame(() => scrollToProgress(r.start + 0.0015, { duration: 1.1 }))
  }

  /* The journey being read comes first: it is the one whose
     chapters are one keystroke away rather than one page load. */
  const order: JourneyId[] = journeyId === 'projects' ? ['projects', 'home'] : ['home', 'projects']

  const rowBody = (c: Chapter) => (
    <>
      <span className={styles.itemNo}>{c.number}</span>
      <span className={styles.itemTitle}>{c.title}</span>
      <span className={styles.itemLabel}>{c.label}</span>
      {c.year ? <span className={styles.itemYear}>{c.year}</span> : <span aria-hidden="true" />}
    </>
  )

  return (
    <div
      className={styles.overlay}
      data-open={open}
      role="dialog"
      aria-modal="true"
      aria-label="Chapter index"
      aria-hidden={!open}
      inert={!open}
    >
      <div className={styles.scrim} onClick={onClose} />
      <div className={styles.panel} ref={panel}>
        <header className={styles.head}>
          <div>
            <p className="label">Index</p>
            <p className={styles.headName}>{profile.name}</p>
          </div>
          <button type="button" className={styles.close} onClick={onClose} data-cursor="link" data-cursor-text="CLOSE">
            <span className={styles.closeX} aria-hidden="true"><i /><i /></span>
            <span className="sr-only">Close index</span>
          </button>
        </header>

        <div className={styles.list}>
          {order.map((id) => {
            const journey = journeys[id]
            const here = id === journeyId
            return (
              <nav key={id} className={styles.journey} aria-label={`${journey.title} chapters`}>
                <header className={styles.journeyHead}>
                  <h2 className={styles.journeyLabel}>{journey.label}</h2>
                  <span className={styles.journeyPath}>{here ? 'YOU ARE HERE' : journey.path}</span>
                </header>

                {groupsOf(journey.chapters).map((group) => (
                  <section key={group.label} className={styles.group}>
                    <h3 className={styles.groupLabel}>{group.label}</h3>
                    {group.chapters.map((c) =>
                      here ? (
                        <button
                          key={c.id}
                          type="button"
                          ref={c.id === chapter ? firstItem : undefined}
                          className={styles.item}
                          data-current={c.id === chapter}
                          onClick={() => go(c.id)}
                          data-cursor="link"
                        >
                          {rowBody(c)}
                        </button>
                      ) : (
                        <Link
                          key={c.id}
                          href={`${journey.path}#chapter-${c.id}`}
                          className={`${styles.item} ${styles.itemAway}`}
                          onClick={onClose}
                          data-cursor="link"
                          data-cursor-text="OPEN"
                        >
                          {rowBody(c)}
                        </Link>
                      ),
                    )}
                  </section>
                ))}
              </nav>
            )
          })}
        </div>

        <footer className={styles.foot}>
          <div className={styles.modeRow}>
            <button
              type="button"
              className={styles.modeBtn}
              data-on={quickView}
              onClick={() => setQuickView(!quickView)}
              aria-pressed={quickView}
              data-cursor="link"
            >
              <span className={styles.modeDot} />
              <span>Quick View</span>
            </button>
            <p className={styles.modeNote}>
              {quickView
                ? 'Cinematic pauses shortened and the longer scenes trimmed. Everything a recruiter needs, in about 90 seconds.'
                : 'Short on time? Quick View condenses the journey to roughly 90 seconds.'}
            </p>
          </div>

          {/* Everything on the site points here now. /world still
              answers at its own URL for anyone who kept the link,
              but nothing leads to it: two doors onto two worlds is
              one door too many, and the second island is the one
              the gateway was built for. */}
          <Link
            href="/world2"
            className={styles.worldLink}
            data-visited={visited || undefined}
            data-cursor="link"
            data-cursor-text="DRIVE"
          >
            <span>{visited ? 'Back to the island' : 'Enter my world'}</span>
            <span className={styles.worldLinkNote}>
              {visited ? 'You have been · pick up where you left off' : 'An interactive version · WASD'}
            </span>
          </Link>

          <ul className={styles.links}>
            {contact.map((c) => {
              const pending = c.id === 'cv' && c.dataStatus === 'placeholder'
              return (
                <li key={c.id}>
                  {pending ? (
                    <span className={styles.link}>
                      <span>{c.label}</span>
                      <span className={styles.linkValue}>On request</span>
                    </span>
                  ) : (
                    <a
                      href={c.href}
                      className={styles.link}
                      target={c.href.startsWith('http') ? '_blank' : undefined}
                      rel={c.href.startsWith('http') ? 'noreferrer noopener' : undefined}
                      data-cursor="link"
                    >
                      <span>{c.label}</span>
                      <span className={styles.linkValue}>{c.value}</span>
                    </a>
                  )}
                </li>
              )
            })}
          </ul>
        </footer>
      </div>
    </div>
  )
}
