'use client'

import { useEffect, useRef, useState } from 'react'
import { Chapter } from '@/components/journey/Chapter'
import { Reveal } from '@/components/typography/Reveal'
import { TagRow } from '@/components/journey/parts'
import { TechTile } from '@/components/tech/TechTile'
import { useSite } from '@/cms/context'
import { TECH_GROUPS as techGroups } from '@/cms/derive'
import { E, useCms, useCmsText } from '@/cms/editable'
import { useJourney } from '@/state/journey'
import shared from './chapters.module.css'
import styles from './Toolbox.module.css'

/* ============================================================
   HOME · 25 – 38%  MY TECH TOOLBOX
   A wall of app icons that is not a logo wall. Every mark is
   wired to the projects that prove it: hovering one names it and
   its real evidence, and technologies with no public evidence
   sit on a dashed tile and say so out loud.

   What the wall discloses is the administrator's choice, in two
   independent switches (the section's, which each tool may
   override): the project COUNT (the badge, the "3 projects" line,
   the dashed plate) and the project NAMES (the list in the
   readout). Whatever is switched off is simply not rendered — no
   gap, no label, no tooltip — and only listed projects ever count
   (cms/derive.ts).
   ============================================================ */

export function Toolbox() {
  const { techNodes, chapterById, projectById } = useSite()
  const titleCms = useCms('toolbox.title', { kind: 'heading', label: 'Title' })
  const title = useCmsText('toolbox.title', 'Tech\ntoolbox')
  const tag = useCmsText('toolbox.tag', 'EVIDENCE, NOT KEYWORDS')
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
        <E cms="toolbox.head" as="div" kind="container" label="Heading block" className={styles.head}>
          <E cms="toolbox.tag" kind="container" label="Chapter tag"><TagRow items={[chapterById['toolbox'].number, tag]} /></E>
          <Reveal as="h2" mode="mask" className={styles.title} id="toolbox-title" attrs={titleCms}>
            {title}
          </Reveal>
          <E cms="toolbox.note" as="p" label="Instruction" className={shared.note}>
            Hover or tap a technology to light up every project that actually used it.
          </E>
        </E>

        <E cms="toolbox.board" as="div" kind="container" label="Technology board" className={styles.board} ref={boardRef} onMouseLeave={() => setHovered(null)}>
          {techGroups.map((g) => (
            <section key={g.id} className={styles.group}>
              <E cms={`toolbox.group.${g.id}`} as="h3" kind="heading" label={`Group: ${g.label}`} className={styles.groupLabel}>{g.label}</E>
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
        </E>

        {/* data-room-reserve: the home room keeps this slot clear of
            growth while it is empty, so the readout never lands on a
            leaf (see readingField.ts). */}
        <div className={styles.evidence} data-on={Boolean(activeNode)} aria-live="polite" data-room-reserve="7">
          {activeNode && (
            <>
              <p className={styles.evidenceHead}>
                <span>{activeNode.name}</span>
                {activeNode.showCount && (
                  <span className={styles.evidenceCount}>
                    {evidence.length > 0 ? `${evidence.length} project${evidence.length === 1 ? '' : 's'}` : 'no public repository yet'}
                  </span>
                )}
              </p>
              {activeNode.showNames && evidence.length > 0 && (
                <ul className={styles.evidenceList}>
                  {evidence.map((p) => (
                    <li key={p.id}>
                      <button type="button" onClick={() => setActiveProject(p.slug)} data-cursor="view">
                        {p.title}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {(activeNode.showNames || activeNode.showCount) && evidence.length === 0 && activeNode.note && (
                <p className={styles.evidenceNote}>{activeNode.note}</p>
              )}
            </>
          )}
        </div>
      </div>
    </Chapter>
  )
}
