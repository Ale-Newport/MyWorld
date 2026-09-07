'use client'

import { useEffect, useState } from 'react'
import { Chapter } from '@/components/journey/Chapter'
import { Reveal } from '@/components/typography/Reveal'
import { TagRow } from '@/components/journey/parts'
import { techNodes, techGroups } from '@/content/skills'
import { projectById } from '@/content/projects'
import { useJourney } from '@/state/journey'
import shared from './chapters.module.css'
import styles from './Toolbox.module.css'

/* ============================================================
   90 – 94%  MY TECH TOOLBOX
   Not a logo wall. Every technology is wired to the projects
   that prove it: hovering one lights only its real evidence,
   and technologies with no public evidence say so out loud.
   ============================================================ */

export function Toolbox() {
  const [active, setActive] = useState<string | null>(null)
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
          <TagRow items={['13', 'EVIDENCE, NOT KEYWORDS']} />
          <Reveal as="h2" mode="mask" className={styles.title} id="toolbox-title">
            {'Tech\ntoolbox'}
          </Reveal>
          <p className={shared.note}>
            Hover a technology to light up every project that actually used it.
          </p>
        </div>

        <div className={styles.grid} onMouseLeave={() => setActive(null)}>
          {techGroups.map((g) => (
            <section key={g.id} className={styles.group}>
              <h3 className={styles.groupLabel}>{g.label}</h3>
              <ul className={styles.chips}>
                {techNodes.filter((n) => n.group === g.id).map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      className={styles.chip}
                      data-on={active === n.id}
                      data-dim={active !== null && active !== n.id}
                      data-weight={n.weight}
                      data-evidence={n.evidence.length > 0}
                      onMouseEnter={() => setActive(n.id)}
                      onFocus={() => setActive(n.id)}
                      onClick={() => setActive(active === n.id ? null : n.id)}
                      aria-pressed={active === n.id}
                      data-cursor="link"
                    >
                      {n.name}
                      {n.evidence.length > 0 && <span className={styles.chipCount}>{n.evidence.length}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <div className={styles.evidence} data-on={Boolean(activeNode)} aria-live="polite">
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
