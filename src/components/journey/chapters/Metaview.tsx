'use client'

import { useRef } from 'react'
import { Chapter } from '@/components/journey/Chapter'
import { Reveal } from '@/components/typography/Reveal'
import { TagRow } from '@/components/journey/parts'
import { Counter } from '@/components/typography/Counter'
import { experienceById } from '@/content/experience'
import { chapterById } from '@/content/chapters'
import { useChapterFrame } from '@/hooks/useChapterProgress'
import { useJourney } from '@/state/journey'
import { clamp, range, formatCount } from '@/lib/math'
import shared from './chapters.module.css'
import styles from './Metaview.module.css'

/* ============================================================
   65 – 74%  CHAPTER IV — INTELLIGENCE
   The site turns dark here, and it turns dark because the
   subject changes: half a million documents become a space you
   can fly through. The DOM layer stays quiet — six beats, each
   one number and one line — over the galaxy in the canvas.
   ============================================================ */

interface Beat {
  at: [number, number]
  kicker: string
  value: string
  numeric?: number
  suffix?: string
  prefix?: string
  line: string
}

const BEATS: Beat[] = [
  { at: [0.02, 0.20], kicker: 'CORPUS',      value: '500K+', numeric: 500000, suffix: '+', line: 'Half a million documents, processed and structured for retrieval.' },
  { at: [0.20, 0.38], kicker: 'EMBEDDING',   value: '9 CLUSTERS', line: 'The corpus folds into a space where distance means meaning.' },
  { at: [0.38, 0.56], kicker: 'RETRIEVAL',   value: '90%+', numeric: 90, suffix: '%+', line: 'A query travels the space. The right neighbourhood lights up.' },
  { at: [0.56, 0.70], kicker: 'GENERATION',  value: '+35%', numeric: 35, prefix: '+', suffix: '%', line: 'Grounded context lifted text-generation relevance — scored on BLEU, ROUGE and perplexity.' },
  { at: [0.70, 0.84], kicker: 'VISION',      value: '92%', numeric: 92, suffix: '%', line: 'A classifier over 50,000+ images cut manual labelling by 70%.' },
  { at: [0.84, 1.00], kicker: 'ANALYTICS',   value: '1M+', numeric: 1000000, suffix: '+', line: 'A million records, automated pipelines, 40% less reporting time.' },
]

export function Metaview() {
  const role = experienceById.metaview
  const reducedMotion = useJourney((s) => s.reducedMotion)
  const beatsRef = useRef<HTMLOListElement>(null)
  const headRef = useRef<HTMLDivElement>(null)
  const pipeRef = useRef<HTMLDivElement>(null)

  useChapterFrame('metaview', (t) => {
    if (reducedMotion) return

    const head = headRef.current
    if (head) {
      const a = clamp(range(t, 0, 0.06)) * (1 - clamp(range(t, 0.14, 0.24)))
      head.style.opacity = String(a)
      head.style.transform = `translate3d(0, ${(1 - a) * 1.5}rem, 0)`
    }

    const list = beatsRef.current
    if (list) {
      for (let i = 0; i < list.children.length; i++) {
        const el = list.children[i] as HTMLElement
        const [a0, a1] = BEATS[i].at
        const inA = clamp(range(t, a0, a0 + 0.05))
        const outA = clamp(range(t, a1 - 0.05, a1))
        const a = inA * (1 - outA)
        el.style.opacity = String(a)
        el.style.transform = `translate3d(0, ${(1 - a) * 2.4}rem, 0)`
        el.style.pointerEvents = a > 0.4 ? 'auto' : 'none'
      }
    }

    const pipe = pipeRef.current
    if (pipe) {
      const a = clamp(range(t, 0.36, 0.46)) * (1 - clamp(range(t, 0.64, 0.72)))
      pipe.style.opacity = String(a)
      const steps = pipe.children
      const local = clamp(range(t, 0.4, 0.68))
      for (let i = 0; i < steps.length; i++) {
        const el = steps[i] as HTMLElement
        el.dataset.on = local > i / steps.length ? 'true' : 'false'
      }
    }
  })

  return (
    <Chapter id="metaview" labelledBy="metaview-title">
      <div className={`${shared.stage} ${styles.stage}`}>
        <div className={`${styles.head} ${shared.driven}`} ref={headRef}>
          <TagRow items={[chapterById['metaview'].number, '[ AI / DATA ]', role.dates]} />
          <Reveal as="h2" mode="chars" className={styles.title} id="metaview-title">
            {'Metaview'}
          </Reveal>
          <p className={styles.role}>{role.role}</p>
        </div>

        <ol className={styles.beats} ref={beatsRef}>
          {BEATS.map((b) => (
            <li key={b.kicker} className={styles.beat}>
              <span className={styles.beatKicker}>{b.kicker}</span>
              <span className={styles.beatValue}>
                {b.numeric !== undefined ? (
                  <Counter
                    to={b.numeric}
                    prefix={b.prefix}
                    suffix={b.suffix}
                    duration={1.4}
                    format={b.numeric >= 1000 ? (v) => formatCount(v) : undefined}
                  />
                ) : (
                  b.value
                )}
              </span>
              <span className={styles.beatLine}>{b.line}</span>
            </li>
          ))}
        </ol>

        <div className={styles.pipeline} ref={pipeRef} aria-hidden="true">
          {['QUERY', 'EMBEDDING', 'RETRIEVAL', 'CONTEXT', 'MODEL', 'OUTPUT'].map((s) => (
            <span key={s} className={styles.pipeStep} data-on="false">{s}</span>
          ))}
        </div>

        {/* The full metric set, always reachable. */}
        <details className={styles.all}>
          <summary>All measured outcomes</summary>
          <ul>
            {role.metrics.map((m) => (
              <li key={m.label}>
                <span>{m.value}</span> {m.label}
              </li>
            ))}
          </ul>
        </details>
      </div>
    </Chapter>
  )
}
