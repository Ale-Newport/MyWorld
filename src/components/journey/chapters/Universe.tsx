'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Chapter } from '@/components/journey/Chapter'
import { Reveal } from '@/components/typography/Reveal'
import { TagRow } from '@/components/journey/parts'
import { projects, universeFilters, categoryAccent } from '@/content/projects'
import { chapterById, journeys } from '@/content/chapters'
import { useJourney } from '@/state/journey'
import shared from './chapters.module.css'
import styles from './Universe.module.css'

/* ============================================================
   HOME · 38 – 52%  PROJECT UNIVERSE
   Every project, in one structure. The WebGL layer draws the
   constellation; this layer owns filters, labels and the
   accessible list — because the archive has to be usable by
   someone who never sees the canvas at all.
   ============================================================ */

export function Universe() {
  const [filter, setFilter] = useState('all')
  const [hovered, setHovered] = useState(-1)
  const [listOpen, setListOpen] = useState(false)
  const setActiveProject = useJourney((s) => s.setActiveProject)
  const stageRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('universe:filter', { detail: { id: filter } }))
  }, [filter])

  useEffect(() => {
    const h = (e: Event) => setHovered((e as CustomEvent<{ index: number }>).detail.index)
    window.addEventListener('universe:hover', h)
    return () => window.removeEventListener('universe:hover', h)
  }, [])

  const active = universeFilters.find((f) => f.id === filter)
  const visible = active ? projects.filter(active.match) : projects
  const hoveredProject = hovered >= 0 ? projects[hovered] : null

  return (
    <Chapter id="universe" labelledBy="universe-title">
      <div className={`${shared.stage} ${styles.stage}`} ref={stageRef}>
        <div className={styles.head}>
          <TagRow items={[chapterById['universe'].number, 'PROJECT UNIVERSE']} />
          <Reveal as="h2" mode="mask" className={styles.title} id="universe-title">
            {'Everything\nI have built'}
          </Reveal>
          <p className={styles.count} data-count-line="">
            {visible.length} of {projects.length} projects
          </p>
        </div>

        <div className={styles.filters} role="group" aria-label="Filter projects">
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
        </div>

        {/* Contextual label — one DOM node, not one per project. */}
        <div className={styles.label} data-on={Boolean(hoveredProject)} aria-hidden="true">
          {hoveredProject && (
            <>
              <span className={styles.labelName}>{hoveredProject.title}</span>
              <span className={styles.labelMeta} style={{ color: hoveredProject.accent ?? categoryAccent[hoveredProject.category] }}>
                {hoveredProject.category} · {hoveredProject.year}
              </span>
              <span className={styles.labelDesc}>{hoveredProject.shortDescription}</span>
            </>
          )}
        </div>

        <div className={styles.footer}>
          <p className={styles.hint}>
            Drag to rotate · click a node to open it
          </p>
          {/* The constellation is the index; the other journey is the
              reading. A visitor who has just been told this is
              everything he has built should not have to find the
              route to it in the chrome, so the doorway stands here,
              at the end of the archive, pointing at the seven that
              are worth a chapter each. It names its destination in
              its own text: out of context — in a screen reader's
              list of links, beside "Enter my world" and "Open as
              list" — "7 of them" identified nothing. */}
          <div className={styles.actions}>
            <Link
              href={journeys.projects.path}
              className={styles.cross}
              data-cross-link=""
              data-cursor="link"
            >
              {journeys.projects.chapters.length} projects, up close
              <span aria-hidden="true"> →</span>
            </Link>
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
        </div>

        {/* Full text alternative to the 3D archive. */}
        <div className={styles.list} data-open={listOpen}>
          <ul>
            {visible.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className={styles.listItem}
                  onClick={() => setActiveProject(p.slug)}
                  style={{ ['--row-accent' as string]: p.accent ?? categoryAccent[p.category] }}
                  data-cursor="view"
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
