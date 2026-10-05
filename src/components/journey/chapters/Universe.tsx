'use client'

import { useCallback, useMemo, useState } from 'react'
import Link from 'next/link'
import { Chapter } from '@/components/journey/Chapter'
import { Reveal } from '@/components/typography/Reveal'
import { TagRow } from '@/components/journey/parts'
import { universeFilters, categoryAccent } from '@/content/project-meta'
import { useSite } from '@/cms/context'
import { E, useCms, useCmsText } from '@/cms/editable'
import { useJourney } from '@/state/journey'
import { SectionAnimation } from '@/sections/SectionAnimation'
import shared from './chapters.module.css'
import styles from './Universe.module.css'

/* ============================================================
   HOME · 38 – 52%  PROJECT UNIVERSE
   Every project, in one structure. The section's animation draws
   the archive in the region between the heading and the footer;
   this layer owns the filters, the label and the accessible list,
   because the archive has to be usable by someone who never sees
   the animation at all.

   Four rows that never overlap: heading and filters, the
   animation, the footer. On a phone the filters get a row of
   their own and scroll sideways instead of wrapping into the
   animation's space.
   ============================================================ */

export function Universe() {
  const { projects, chapterById, journeys } = useSite()
  const titleCms = useCms('universe.title', { kind: 'heading', label: 'Title' })
  const title = useCmsText('universe.title', 'Everything\nI have built')
  const tag = useCmsText('universe.tag', 'PROJECT UNIVERSE')
  const [filter, setFilter] = useState('all')
  const [hovered, setHovered] = useState<string | null>(null)
  const [listOpen, setListOpen] = useState(false)
  const setActiveProject = useJourney((s) => s.setActiveProject)

  const active = universeFilters.find((f) => f.id === filter)
  const visibleList = useMemo(() => (active ? projects.filter(active.match) : projects), [active, projects])
  const visible = useMemo(() => new Set(visibleList.map((p) => p.id)), [visibleList])
  const hoveredProject = hovered ? projects.find((p) => p.slug === hovered) ?? null : null

  const onOpen = useCallback((slug: string) => setActiveProject(slug), [setActiveProject])
  const onHover = useCallback((slug: string | null) => setHovered(slug), [])
  const extra = useMemo(() => ({ projects, visible, filter, onOpen, onHover }), [projects, visible, filter, onOpen, onHover])

  return (
    <Chapter id="universe" labelledBy="universe-title">
      <div className={`${shared.stage} ${styles.stage}`}>
        <E cms="universe.head" as="div" kind="container" label="Heading block" className={styles.head}>
          <E cms="universe.tag" kind="container" label="Chapter tag"><TagRow items={[chapterById['universe'].number, tag]} /></E>
          <Reveal as="h2" mode="mask" className={styles.title} id="universe-title" attrs={titleCms}>
            {title}
          </Reveal>
          <p className={styles.count} data-count-line="">
            {visibleList.length} of {projects.length} projects
          </p>
        </E>

        <E cms="universe.filters" as="div" kind="container" label="Filters" className={styles.filters} role="group" aria-label="Filter projects" data-room-reserve="0">
          {universeFilters.map((f) => (
            <button
              key={f.id}
              type="button"
              className={styles.filter}
              data-filter-chip=""
              data-on={filter === f.id}
              onClick={() => setFilter(f.id)}
              aria-pressed={filter === f.id}
              data-cursor="link"
            >
              {f.label}
              <span className={styles.filterCount}>{projects.filter(f.match).length}</span>
            </button>
          ))}
        </E>

        <SectionAnimation section="universe" className={styles.visual} extra={extra} />

        <E cms="universe.footer" as="div" kind="container" label="Footer" className={styles.footer}>
          {/* The project under the pointer or focus takes the hint's
              place, so its name is read beside the archive and never
              printed over it. */}
          <div className={styles.readout} aria-live="polite">
            {hoveredProject ? (
              <p className={styles.label}>
                <span className={styles.labelName}>{hoveredProject.title}</span>
                <span className={styles.labelMeta} style={{ color: hoveredProject.accent ?? categoryAccent[hoveredProject.category] }}>
                  {hoveredProject.category} · {hoveredProject.year}
                </span>
                <span className={styles.labelDesc}>{hoveredProject.shortDescription}</span>
              </p>
            ) : (
              <E cms="universe.hint" as="p" label="Hint" className={styles.hint}>
                Point at a project to read it · select one to open it
              </E>
            )}
          </div>
          <div className={styles.actions}>
            <E
              cms="universe.cross"
              as={Link}
              kind="link"
              label="Link to the projects journey"
              href={journeys.projects.path}
              className={styles.cross}
              data-cross-link=""
              data-cursor="link"
            >
              {journeys.projects.chapters.length} projects, up close
              <span aria-hidden="true"> →</span>
            </E>
            <button
              type="button"
              className={styles.listToggle}
              onClick={() => setListOpen((v) => !v)}
              aria-expanded={listOpen}
              data-cursor="link"
            >
              {listOpen ? 'Close list' : 'Open as list'}
            </button>
          </div>
        </E>

        {/* Full text alternative to the animated archive. */}
        <div className={styles.list} data-open={listOpen}>
          <ul>
            {visibleList.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className={styles.listItem}
                  onClick={() => setActiveProject(p.slug)}
                  style={{ ['--row-accent' as string]: p.accent ?? categoryAccent[p.category] }}
                  data-cursor="view"
                  tabIndex={listOpen ? 0 : -1}
                >
                  <span className={styles.listYear}>{p.year}</span>
                  <span className={styles.listName}>{p.title}</span>
                  <span className={styles.listDesc}>{p.shortDescription}</span>
                  <span className={styles.listTier}>{p.importance}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Chapter>
  )
}
