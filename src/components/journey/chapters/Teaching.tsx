'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Chapter } from '@/components/journey/Chapter'
import { Reveal } from '@/components/typography/Reveal'
import { TagRow } from '@/components/journey/parts'
import { experienceById } from '@/content/experience'
import { useChapterFrame } from '@/hooks/useChapterProgress'
import { useJourney } from '@/state/journey'
import { clamp, range } from '@/lib/math'
import shared from './chapters.module.css'
import styles from './Teaching.module.css'

/* ============================================================
   40 – 46%  LEARNING BY TEACHING
   A test suite fails, cursors arrive, the code is corrected,
   and the suite turns green — the whole chapter is one
   continuous edit rather than a list of responsibilities.
   ============================================================ */

const TESTS = [
  'testBinarySearchEmptyArray',
  'testInsertRebalancesTree',
  'testHashCollisionChaining',
  'testQuickSortWorstCase',
  'testGraphCycleDetection',
  'testStackUnderflowThrows',
  'testMergeSortStability',
  'testLruEvictsOldest',
]

const BROKEN = [
  'while (lo <= hi) {',
  '  int mid = (lo + hi) / 2;',
  '  if (a[mid] == key) return mid;',
  '  if (a[mid] < key) hi = mid - 1;',
  '  else lo = mid + 1;',
  '}',
  'return -1;',
]

const FIXED = [
  'while (lo <= hi) {',
  '  int mid = lo + (hi - lo) / 2;',
  '  if (a[mid] == key) return mid;',
  '  if (a[mid] < key) lo = mid + 1;',
  '  else hi = mid - 1;',
  '}',
  'return -1;',
]

export function Teaching() {
  const role = experienceById['kcl-gta']
  const reducedMotion = useJourney((s) => s.reducedMotion)
  const [passing, setPassing] = useState(0)
  const [fixed, setFixed] = useState(false)
  const listRef = useRef<HTMLUListElement>(null)
  const codeRef = useRef<HTMLPreElement>(null)
  const cursorsRef = useRef<HTMLDivElement>(null)

  useChapterFrame('teaching', (t) => {
    // The suite goes green in step with the scroll.
    const p = clamp(range(t, 0.3, 0.86))
    const n = Math.round(p * TESTS.length)
    setPassing((prev) => (prev === n ? prev : n))
    setFixed(t > 0.42)

    if (reducedMotion) return
    const c = cursorsRef.current
    if (c) {
      const a = clamp(range(t, 0.2, 0.34)) * (1 - clamp(range(t, 0.72, 0.86)))
      c.style.opacity = String(a)
      const kids = c.children
      for (let i = 0; i < kids.length; i++) {
        const el = kids[i] as HTMLElement
        const phase = t * 6 + i * 2.1
        el.style.transform = `translate3d(${Math.sin(phase) * 42 + i * 30}px, ${Math.cos(phase * 0.8) * 26 + i * 22}px, 0)`
      }
    }
  })

  const lines = useMemo(() => (fixed ? FIXED : BROKEN), [fixed])

  useEffect(() => {
    const el = codeRef.current
    if (el) el.dataset.fixed = String(fixed)
  }, [fixed])

  return (
    <Chapter id="teaching" labelledBy="teaching-title">
      <div className={`${shared.stage} ${styles.stage}`}>
        <div className={styles.head}>
          <TagRow items={['06', 'LEARNING BY TEACHING', role.dates]} />
          <Reveal as="h2" mode="words" className={styles.title} id="teaching-title">
            {'First I learned how systems work.\nThen I learned how to explain them.'}
          </Reveal>
          <p className={styles.role}>
            {role.role} · {role.organisation}
          </p>
          <p className={shared.note}>{role.summary}</p>
        </div>

        <div className={styles.editor}>
          <div className={styles.editorBar} aria-hidden="true">
            <span>BinarySearch.java</span>
            <span className={styles.editorStat} data-ok={passing === TESTS.length}>
              {passing}/{TESTS.length} PASSING
            </span>
          </div>

          <pre className={styles.code} ref={codeRef} data-fixed="false" aria-label="Student code being corrected">
            {lines.map((l, i) => (
              <code key={i} className={styles.line} data-changed={BROKEN[i] !== FIXED[i]}>
                <span className={styles.lineNo}>{String(i + 1).padStart(2, '0')}</span>
                <span>{l}</span>
              </code>
            ))}
          </pre>

          <div className={styles.cursors} ref={cursorsRef} aria-hidden="true">
            {['AN', 'S1', 'S2'].map((n) => (
              <span key={n} className={styles.cursor}>
                <i />
                <em>{n}</em>
              </span>
            ))}
          </div>
        </div>

        <ul className={styles.tests} ref={listRef} aria-label="Test suite">
          {TESTS.map((name, i) => (
            <li key={name} className={styles.test} data-pass={i < passing}>
              <span className={styles.testState}>{i < passing ? 'PASS' : 'FAIL'}</span>
              <span className={styles.testName}>{name}</span>
            </li>
          ))}
        </ul>

        <div className={`${shared.corner} ${shared.cornerBR}`}>
          LABS · TUTORIALS
          <br />
          DEBUGGING · TESTING
          <br />
          COMPLEXITY · CLEAN CODE
        </div>
      </div>
    </Chapter>
  )
}
