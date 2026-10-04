'use client'

import { useEffect, useRef, useState } from 'react'
import { Chapter } from '@/components/journey/Chapter'
import { Reveal } from '@/components/typography/Reveal'
import { TagRow } from '@/components/journey/parts'
import { TechTile } from '@/components/tech/TechTile'
import { techNodes, techGroups } from '@/content/skills'
import { chapterById } from '@/content/chapters'
import { projectById } from '@/content/projects'
import { useJourney } from '@/state/journey'
import shared from './chapters.module.css'
import styles from './Toolbox.module.css'

/* ============================================================
   HOME · 25 – 38%  MY TECH TOOLBOX
   A wall of app icons that is not a logo wall. Every mark is
   wired to the projects that prove it: hovering one lights only
   its real evidence, and technologies with no public evidence
   sit on a dashed tile and say so out loud.
   ============================================================ */

export function Toolbox() {
  /* Hover previews, click pins. Keeping these separate matters:
     with one piece of state, a click on an already-hovered tile
     toggles it straight back off — and on touch there is no hover
     at all, so a tap has to be what selects. */
  const [hovered, setHovered] = useState<string | null>(null)
  const [pinned, setPinned] = useState<string | null>(null)
  const active = pinned ?? hovered
  const boardRef = useRef<HTMLDivElement>(null)
  const setActiveProject = useJourney((s) => s.setActiveProject)

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('toolbox:hover', { detail: { id: active } }))
  }, [active])

  const activeNode = active ? techNodes.find((n) => n.id === active) : null
  const evidence = activeNode?.evidence.map((id) => projectById[id]).filter(Boolean) ?? []

  return (
    <Chapter id="toolbox" labelledBy="toolbox-title">
      <div className={`${shared.stage} ${styles.stage}`}>
        <div className={styles.head}>
          <TagRow items={[chapterById['toolbox'].number, 'EVIDENCE, NOT KEYWORDS']} />
          <Reveal as="h2" mode="mask" className={styles.title} id="toolbox-title">
            {'Tech\ntoolbox'}
          </Reveal>
          <p className={shared.note}>
            Hover or tap a technology to light up every project that actually used it.
          </p>
        </div>

        <div className={styles.board} ref={boardRef} onMouseLeave={() => setHovered(null)}>
          {techGroups.map((g) => (
            <section key={g.id} className={styles.group}>
              <h3 className={styles.groupLabel}>{g.label}</h3>
              <ul className={styles.tiles}>
                {techNodes.filter((n) => n.group === g.id).map((n) => (
                  /* The id is on the row rather than only on the
                     button: the vine layer measures these boxes to
                     find the grid's real gutters, and it has to be
                     able to say which mark a tendril is answering
                     without reading a label back out of the DOM. */
                  <li key={n.id} data-tech={n.id}>
                    <TechTile
                      node={n}
                      active={active}
                      pinned={pinned === n.id}
                      onPreview={setHovered}
                      onToggle={(id) => setPinned((v) => (v === id ? null : id))}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        {/* data-room-reserve: the home room keeps this slot clear of
            growth while it is empty, so the readout never lands on a
            leaf (see readingField.ts). */}
        <div className={styles.evidence} data-on={Boolean(activeNode)} aria-live="polite" data-room-reserve="7">
          {activeNode && (
            <>
              <p className={styles.evidenceHead}>
                <span>{activeNode.name}</span>
                <span className={styles.evidenceCount}>
                  {evidence.length > 0 ? `${evidence.length} project${evidence.length === 1 ? '' : 's'}` : 'no public repository yet'}
                </span>
              </p>
              {evidence.length > 0 ? (
                <ul className={styles.evidenceList}>
                  {evidence.map((p) => (
                    <li key={p.id}>
                      <button type="button" onClick={() => setActiveProject(p.slug)} data-cursor="view">
                        {p.title}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.evidenceNote}>{activeNode.note}</p>
              )}
            </>
          )}
        </div>
      </div>
    </Chapter>
  )
}
