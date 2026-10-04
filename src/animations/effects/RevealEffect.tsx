'use client'

import { Reveal } from '@/components/typography/Reveal'
import { num, pick, str, type EffectProps } from '../types'
import styles from './effects.module.css'

/** The site's text reveal (six behaviours), as a placeable block. Re-runs each time its trigger fires. */
export default function RevealEffect({ params, active, reducedMotion }: EffectProps) {
  const mode = pick(params.mode, ['mask', 'chars', 'words', 'scramble', 'perspective', 'clip'] as const, 'mask')
  const text = str(params.text, 'Building intelligent systems.', 400)
  const size = num(params.size, 3.2, 1, 9)
  return (
    <div className={styles.center} style={{ fontSize: `clamp(1.4rem, ${size}vw, ${size * 1.6}rem)` }}>
      {reducedMotion ? (
        <p className={styles.display}>{text}</p>
      ) : active ? (
        <Reveal key={`${mode}-${text}`} as="p" mode={mode} immediate stagger={num(params.stagger, 0.028, 0, 0.3)} className={styles.display}>{text}</Reveal>
      ) : (
        <p className={styles.display} style={{ opacity: 0 }}>{text}</p>
      )}
    </div>
  )
}
