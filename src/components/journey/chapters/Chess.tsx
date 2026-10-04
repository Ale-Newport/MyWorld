'use client'

import { useRef, useState } from 'react'
import { Chapter } from '@/components/journey/Chapter'
import { Reveal } from '@/components/typography/Reveal'
import { TagRow } from '@/components/journey/parts'
import { Counter } from '@/components/typography/Counter'
import { ProjectVisual } from '@/components/project-visuals/ProjectVisual'
import { projectById } from '@/content/projects'
import { chapterById } from '@/content/chapters'
import { useChapterFrame } from '@/hooks/useChapterProgress'
import { useJourney } from '@/state/journey'
import { clamp, range } from '@/lib/math'
import shared from './chapters.module.css'
import styles from './Chess.module.css'

/* ============================================================
   PROJECTS · 75 – 90%  SEEING THE BOARD
   The CV pipeline runs in the DOM canvas; the reconstructed
   board resolves in WebGL behind it. Two layers, one idea.
   ============================================================ */

const PIPELINE = ['CAMERA', 'BOARD DETECTION', 'GRID', 'PIECE DETECTION', 'CLASSIFICATION', 'BOARD STATE', 'FEN', 'STOCKFISH', 'BEST MOVE']

export function Chess() {
  const project = projectById['chess-assistant']
  const reducedMotion = useJourney((s) => s.reducedMotion)
  const [progress, setProgress] = useState(0)
  const pipeRef = useRef<HTMLOListElement>(null)
  const metricRef = useRef<HTMLDivElement>(null)
  const visualRef = useRef<HTMLDivElement>(null)
  const setActiveProject = useJourney((s) => s.setActiveProject)

  useChapterFrame('chess', (t) => {
    setProgress((p) => (Math.abs(p - t) > 0.004 ? t : p))
    if (reducedMotion) return

    const v = visualRef.current
    if (v) {
      // The pipeline canvas hands off to the 3D board.
      const a = 1 - clamp(range(t, 0.48, 0.56))
      v.style.opacity = String(a)
      v.style.transform = `scale(${1 - (1 - a) * 0.08})`
    }

    const list = pipeRef.current
    if (list) {
      const n = list.children.length
      const local = clamp(range(t, 0.04, 0.56))
      for (let i = 0; i < n; i++) {
        const el = list.children[i] as HTMLElement
        el.dataset.on = local > (i + 0.4) / n ? 'true' : 'false'
      }
    }

    const m = metricRef.current
    if (m) {
      const a = clamp(range(t, 0.78, 0.9)) * (1 - clamp(range(t, 0.96, 1)))
      m.style.opacity = String(a)
      m.style.transform = `translate3d(0, ${(1 - a) * 2}rem, 0)`
    }
  })

  return (
    <Chapter id="chess" labelledBy="chess-title">
      <div className={`${shared.stage} ${styles.stage}`}>
        <div className={`${styles.visual} ${shared.driven}`} ref={visualRef}>
          <ProjectVisual project={project} progress={progress} active reducedMotion={reducedMotion} interactive />
        </div>

        <div className={styles.head}>
          <TagRow items={[chapterById['chess'].number, 'SEEING THE BOARD', '2025']} />
          <Reveal as="h2" mode="mask" className={styles.title} id="chess-title">
            {'Chess\nAssistant'}
          </Reveal>
          <p className={shared.note}>{project.shortDescription}</p>
        </div>

        <ol className={styles.pipeline} ref={pipeRef} aria-label="Vision pipeline">
          {PIPELINE.map((s, i) => (
            <li key={s} className={styles.step} data-on="false">
              <span className={styles.stepNo}>{String(i + 1).padStart(2, '0')}</span>
              <span>{s}</span>
            </li>
          ))}
        </ol>

        <div className={`${styles.metric} ${shared.driven}`} ref={metricRef}>
          <span className={styles.metricValue}>
            <Counter to={99.6} duration={1.6} format={(v) => v.toFixed(1)} suffix="%" />
          </span>
          <span className={styles.metricLabel}>Piece recognition accuracy</span>
          <button
            type="button"
            className={styles.play}
            onClick={() => setActiveProject('chess-assistant')}
            data-cursor="explore"
            data-cursor-text="PLAY"
          >
            Play me →
          </button>
        </div>

        <div className={`${shared.corner} ${shared.cornerBR}`}>
          MOBILENETV2 · CNN
          <br />
          1,200 SYNTHETIC BOARDS
          <br />
          AWS EC2 · S3
        </div>
      </div>
    </Chapter>
  )
}
