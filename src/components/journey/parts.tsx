'use client'

import { Reveal } from '@/components/typography/Reveal'
import styles from './parts.module.css'

/** Tiny technical label — the site's recurring counterpoint to huge type. */
export function Tag({ children, accent }: { children: React.ReactNode; accent?: boolean }) {
  return <span className={styles.tag} data-accent={accent ? 'true' : undefined}>{children}</span>
}

/** A row of tiny technical labels, e.g. [ AI / DATA ] LONDON 2026 */
export function TagRow({ items, className }: { items: React.ReactNode[]; className?: string }) {
  return (
    <p className={`${styles.tagRow} ${className ?? ''}`}>
      {items.map((t, i) => (
        <span key={i} className={styles.tagRowItem}>{t}</span>
      ))}
    </p>
  )
}

/** Chapter opening: number, label, then the headline. */
export function ChapterHead({
  number, label, title, mode = 'mask', id, sub,
}: {
  number: string; label: string; title: string; mode?: 'mask' | 'chars' | 'words' | 'clip' | 'perspective' | 'scramble'
  id?: string; sub?: string
}) {
  return (
    <div className={styles.head}>
      <TagRow items={[number, label]} />
      <Reveal as="h2" mode={mode} className={styles.headTitle} id={id}>{title}</Reveal>
      {sub && <p className={styles.headSub}>{sub}</p>}
    </div>
  )
}

/** A single big number with a small caption. */
export function MetricBlock({
  value, label, note, size = 'md',
}: { value: React.ReactNode; label: string; note?: string; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <div className={styles.metric} data-size={size}>
      <span className={styles.metricValue}>{value}</span>
      <span className={styles.metricLabel}>{label}</span>
      {note && <span className={styles.metricNote}>{note}</span>}
    </div>
  )
}

/** Fine hairline with an optional caption, used to separate beats. */
export function Rule({ caption }: { caption?: string }) {
  return (
    <div className={styles.rule}>
      <span className={styles.ruleLine} />
      {caption && <span className={styles.ruleCaption}>{caption}</span>}
      <span className={styles.ruleLine} />
    </div>
  )
}

export function ScrollHint({ label = 'SCROLL TO BEGIN' }: { label?: string }) {
  return (
    <div className={styles.hint} aria-hidden="true">
      <span>{label}</span>
      <span className={styles.hintLine} />
    </div>
  )
}
