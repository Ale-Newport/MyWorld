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
import styles from './Focus.module.css'

/* ============================================================
   PROJECTS · 23 – 42%  BUILDING A PRODUCT
   The longest chapter on the site. A finished video plays,
   freezes, and deconstructs into the ten layers that made it;
   the camera travels the stack and reassembles it — in the
   columns between the heading and the list of those layers.
   ============================================================ */

const LAYERS = [
  { id: 'script',   label: 'Script',        note: 'Topic → outline → narration.' },
  { id: 'model',    label: 'Model',         note: 'Generation, constrained to the learning objective.' },
  { id: 'content',  label: 'Content',       note: 'Facts, examples, ordering.' },
  { id: 'voice',    label: 'Voice',         note: 'Synthesised narration.' },
  { id: 'audio',    label: 'Audio',         note: 'Bed, ducking, levels.' },
  { id: 'characters', label: 'Characters',  note: 'Presenters and visual voice.' },
  { id: 'motion',   label: 'Motion',        note: 'Timed graphics driven by the script.' },
  { id: 'captions', label: 'Captions',      note: 'Word-level timing from the voice track.' },
  { id: 'renderer', label: 'Renderer',      note: 'Composition and export.' },
  { id: 'app',      label: 'App',           note: 'Delivery, playback, progress.' },
]

export function Focus() {
  const { projectById, experienceById, chapterById } = useSite()
  const titleCms = useCms('focus.title', { kind: 'heading', label: 'Title' })
  const title = useCmsText('focus.title', 'Focus')
  const tag = useCmsText('focus.tag', 'BUILDING A PRODUCT')
  const project = projectById.focus
  const role = experienceById.focus
  const reducedMotion = useJourney((s) => s.reducedMotion)
  const [progress, setProgress] = useState(0)
  const [active, setActive] = useState<string | null>(null)
  const layersRef = useRef<HTMLOListElement>(null)
  const headRef = useRef<HTMLDivElement>(null)

  useChapterFrame('focus', (t) => {
    setProgress((p) => (Math.abs(p - t) > 0.004 ? t : p))
    if (reducedMotion) return

    const head = headRef.current
    if (head) {
      const a = clamp(range(t, 0, 0.08)) * (1 - clamp(range(t, 0.84, 0.95)))
      head.style.opacity = String(a)
    }

    const list = layersRef.current
    if (!list) return
    const n = list.children.length
    for (let i = 0; i < n; i++) {
      const el = list.children[i] as HTMLElement
      const from = 0.24 + (i / n) * 0.42
      const a = clamp(range(t, from, from + 0.1)) * (1 - clamp(range(t, 0.8, 0.92)))
      el.style.opacity = String(0.25 + a * 0.75)
      el.style.transform = `translate3d(${(1 - a) * -1.2}rem, 0, 0)`
      el.dataset.on = a > 0.7 ? 'true' : 'false'
    }
  })

  return (
    <Chapter id="focus" labelledBy="focus-title">
      <div className={`${shared.stage} ${styles.stage}`}>
        <div className={styles.visual}>
          <ProjectVisual
            project={project}
            progress={progress}
            active
            reducedMotion={reducedMotion}
            interactive
          />
        </div>

        <div className={`${styles.head} ${shared.driven}`} ref={headRef}>
          <E cms="focus.tag" kind="container" label="Chapter tag"><TagRow items={[chapterById['focus'].number, tag, role.dates]} /></E>
          <Reveal as="h2" mode="mask" className={styles.title} id="focus-title" attrs={titleCms}>
            {title}
          </Reveal>
          <p className={styles.subtitle}>{project.shortDescription}</p>
          <p className={styles.role}>{role.role}</p>
        </div>

        <ol className={styles.layers} ref={layersRef} aria-label="Generation pipeline">
          {LAYERS.map((l, i) => (
            <li
              key={l.id}
              className={styles.layer}
              data-on="false"
              data-active={active === l.id}
              onMouseEnter={() => setActive(l.id)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(l.id)}
              onBlur={() => setActive(null)}
              tabIndex={0}
            >
              <span className={styles.layerNo}>{String(i + 1).padStart(2, '0')}</span>
              <span className={styles.layerLabel}>{l.label}</span>
              <span className={styles.layerNote}>{l.note}</span>
            </li>
          ))}
        </ol>

        <div className={`${shared.corner} ${styles.chain}`}>
          PROMPT → SCRIPT → VOICE → CAPTIONS → RENDER
        </div>
        <div className={`${shared.corner} ${styles.credit}`}>
          CO-FOUNDER
          <br />
          {role.dates.toUpperCase()}
        </div>
      </div>
    </Chapter>
  )
}
