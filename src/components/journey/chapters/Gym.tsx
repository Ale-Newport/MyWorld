'use client'

import { useRef, useState } from 'react'
import { Chapter } from '@/components/journey/Chapter'
import { useSite } from '@/cms/context'
import { E, useCms, useCmsText } from '@/cms/editable'
import { Reveal } from '@/components/typography/Reveal'
import { TagRow } from '@/components/journey/parts'
import { ProjectVisual } from '@/components/project-visuals/ProjectVisual'
import { useChapterFrame } from '@/hooks/useChapterProgress'
import { useJourney } from '@/state/journey'
import { clamp, range } from '@/lib/math'
import shared from './chapters.module.css'
import styles from './Gym.module.css'

/* ============================================================
   PROJECTS · 42 – 55%  ONE MODEL, MANY MOVEMENTS
   Skin → rig → joints → pose data → equipment → exercise.
   The argument of the chapter is an equation, so the chapter
   is laid out as one.
   ============================================================ */

const STAGES = ['FIGURE', 'RIG', 'JOINTS', 'POSE DATA', 'EQUIPMENT', 'EXERCISE']

export function Gym() {
  const { projectById, chapterById } = useSite()
  const titleCms = useCms('gym.title', { kind: 'heading', label: 'Title' })
  const title = useCmsText('gym.title', 'Gym App')
  const tag = useCmsText('gym.tag', 'ONE MODEL, MANY MOVEMENTS')
  const project = projectById['gym-app']
  const reducedMotion = useJourney((s) => s.reducedMotion)
  const [progress, setProgress] = useState(0)
  const stagesRef = useRef<HTMLOListElement>(null)
  const eqRef = useRef<HTMLDivElement>(null)

  useChapterFrame('gym', (t) => {
    setProgress((p) => (Math.abs(p - t) > 0.004 ? t : p))
    if (reducedMotion) return

    const list = stagesRef.current
    if (list) {
      const n = list.children.length
      for (let i = 0; i < n; i++) {
        const el = list.children[i] as HTMLElement
        const from = 0.1 + (i / n) * 0.62
        el.dataset.on = t > from ? 'true' : 'false'
      }
    }

    const eq = eqRef.current
    if (eq) {
      const a = clamp(range(t, 0.62, 0.8))
      eq.style.opacity = String(a)
      eq.style.transform = `translate3d(0, ${(1 - a) * 2}rem, 0)`
    }
  })

  return (
    <Chapter id="gym" labelledBy="gym-title">
      <div className={`${shared.stage} ${styles.stage}`}>
        <div className={styles.visual}>
          <ProjectVisual project={project} progress={progress} active reducedMotion={reducedMotion} interactive />
        </div>

        <div className={styles.head}>
          <E cms="gym.tag" kind="container" label="Chapter tag"><TagRow items={[chapterById['gym'].number, tag]} /></E>
          <Reveal as="h2" mode="clip" className={styles.title} id="gym-title" attrs={titleCms}>
            {title}
          </Reveal>
          <p className={shared.note}>{project.description}</p>
        </div>

        <ol className={styles.stages} ref={stagesRef} aria-label="Pipeline stages">
          {STAGES.map((s, i) => (
            <li key={s} className={styles.stage_} data-on="false">
              <span className={styles.stageNo}>{String(i + 1).padStart(2, '0')}</span>
              <span>{s}</span>
            </li>
          ))}
        </ol>

        <div className={`${styles.equation} ${shared.driven}`} ref={eqRef}>
          <span className={styles.eqTerm}>ONE MODEL</span>
          <span className={styles.eqOp} aria-hidden="true">+</span>
          <span className={styles.eqTerm}>POSE DATA</span>
          <span className={styles.eqOp} aria-hidden="true">+</span>
          <span className={styles.eqTerm}>EQUIPMENT</span>
          <span className={styles.eqOp} aria-hidden="true">=</span>
          <span className={`${styles.eqTerm} ${styles.eqResult}`}>A LARGE EXERCISE LIBRARY</span>
        </div>

        <div className={`${shared.corner} ${shared.cornerBR}`}>
          3D · RIGGING
          <br />
          DATA ARCHITECTURE
          <br />
          ANIMATION SYSTEMS
        </div>
      </div>
    </Chapter>
  )
}
