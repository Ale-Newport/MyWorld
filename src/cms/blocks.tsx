'use client'

import { createElement } from 'react'
import { useSite } from './context'
import { renderRich } from './rich'
import { isSafeHref, isSafeSrc } from './safe'
import type { ElementNode, TableData } from './schema'
import { EffectSlot } from '@/animations/EffectSlot'
import styles from './blocks.module.css'

/* ============================================================
   CONTENT KEPT FROM THE RETIRED PAGE BUILDER

   Schema v1's visual editor let an administrator add headings,
   paragraphs, images, buttons, tables, cards and effects to a
   section and place them anywhere. v2 keeps every one of them
   but none of their geometry: they live in a section of their
   own (migrate.ts moves them there) and stack in normal flow in
   one readable column, styled entirely by the site, so they
   compose at every screen size like the rest of the page. Their
   text stays editable; new ones are not created.
   ============================================================ */

function attrs(node: ElementNode): Record<string, string> {
  return node.hidden ? { 'data-cms-id': node.id, 'data-cms-hidden': '' } : { 'data-cms-id': node.id }
}

const str = (v: unknown, max = 2000) => (typeof v === 'string' ? v.slice(0, max) : '')
const href = (v: unknown) => (typeof v === 'string' && isSafeHref(v) ? v : undefined)
const src = (v: unknown) => (typeof v === 'string' && v && isSafeSrc(v) ? v : undefined)

/** The stored table, re-checked field by field before it is drawn (the document was validated on save; this keeps the public page from trusting it blindly). */
function readTable(v: unknown): TableData | null {
  if (!v || typeof v !== 'object') return null
  const t = v as Record<string, unknown>
  if (!Array.isArray(t.columns) || !Array.isArray(t.rows)) return null
  const text = (x: unknown, max = 2000) => (typeof x === 'string' ? x.slice(0, max) : '')
  const align = (x: unknown) => (x === 'center' || x === 'right' ? x : 'left')
  const columns = t.columns.slice(0, 20).filter((c): c is Record<string, unknown> => !!c && typeof c === 'object').map((c) => ({ id: text(c.id, 120), label: text(c.label, 400), align: align(c.align) as 'left' | 'center' | 'right', width: /^\d*\.?\d+(px|rem|em|%|ch)$/.test(text(c.width, 40)) ? text(c.width, 40) : undefined }))
  const rows = t.rows.slice(0, 500).filter((r): r is Record<string, unknown> => !!r && typeof r === 'object').map((r) => ({ id: text(r.id, 120), cells: Object.fromEntries(Object.entries((r.cells as Record<string, unknown>) ?? {}).map(([k, val]) => [k, text(val)])) }))
  return { caption: text(t.caption, 400) || undefined, header: t.header !== false, columns, rows }
}

export function Block({ node }: { node: ElementNode }) {
  const a = attrs(node)
  const cls = styles.block
  const p = node.props
  switch (node.type) {
    case 'heading': {
      const level = Math.min(6, Math.max(1, Number(p.level) || 2))
      return createElement(`h${level}`, { ...a, className: `${cls} ${styles.heading}`, 'data-level': level }, renderRich(node.text ?? 'Heading'))
    }
    case 'text':
      return <p {...a} className={`${cls} ${styles.text}`}>{renderRich(node.text ?? '')}</p>
    case 'image': {
      const url = src(p.src)
      return (
        <figure {...a} className={`${cls} ${styles.figure}`}>
          {url ? <img src={url} alt={str(p.alt, 400)} loading="lazy" decoding="async" /> : <div className={styles.placeholder} role="img" aria-label={str(p.alt, 400) || 'Image placeholder'}>Image</div>}
          {str(p.caption) && <figcaption>{str(p.caption)}</figcaption>}
        </figure>
      )
    }
    case 'video': {
      const url = src(p.src)
      return (
        <figure {...a} className={`${cls} ${styles.figure}`}>
          {url ? <video src={url} poster={src(p.poster)} controls={p.controls !== false} muted={!!p.autoplay} autoPlay={!!p.autoplay} loop={!!p.loop} playsInline preload="metadata" aria-label={str(p.label, 300) || undefined} /> : <div className={styles.placeholder}>Video</div>}
          {str(p.caption) && <figcaption>{str(p.caption)}</figcaption>}
        </figure>
      )
    }
    case 'button': {
      const target = href(p.href) ?? '#'
      const external = /^https?:/.test(target)
      return (
        <a {...a} className={`${cls} ${styles.button}`} data-variant={str(p.variant, 20) || 'solid'} href={target} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
          {renderRich(node.text ?? 'Button')}
        </a>
      )
    }
    case 'table': {
      const t = readTable(p.table)
      if (!t) return <div {...a} className={cls}>Table</div>
      return (
        <div {...a} className={`${cls} ${styles.tableWrap}`}>
          <table className={styles.table}>
            {t.caption && <caption>{t.caption}</caption>}
            {t.header && (
              <thead>
                <tr>{t.columns.map((c) => <th key={c.id} scope="col" style={{ textAlign: c.align, width: c.width }}>{c.label}</th>)}</tr>
              </thead>
            )}
            <tbody>
              {t.rows.map((r) => (
                <tr key={r.id}>
                  {t.columns.map((c, i) => (i === 0 && t.header ? <th key={c.id} scope="row" style={{ textAlign: c.align }}>{r.cells[c.id] ?? ''}</th> : <td key={c.id} style={{ textAlign: c.align }}>{r.cells[c.id] ?? ''}</td>))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    }
    case 'card': {
      const link = href(p.href)
      const body = (
        <>
          {src(p.image) && <img className={styles.cardImage} src={src(p.image)} alt={str(p.alt, 400)} loading="lazy" />}
          {str(p.eyebrow) && <p className={styles.eyebrow}>{str(p.eyebrow, 120)}</p>}
          <h3 className={styles.cardTitle}>{str(p.title, 300) || node.name}</h3>
          {node.text !== undefined && <p className={styles.text}>{renderRich(node.text)}</p>}
          {node.children?.map((c) => <Block key={c.id} node={c} />)}
        </>
      )
      return link ? (
        <a {...a} className={`${cls} ${styles.card}`} href={link} data-interactive="true">{body}</a>
      ) : (
        <article {...a} className={`${cls} ${styles.card}`}>{body}</article>
      )
    }
    case 'container':
      return <div {...a} className={`${cls} ${styles.container}`}>{node.children?.map((c) => <Block key={c.id} node={c} />)}</div>
    case 'animation':
      return (
        <div {...a} className={`${cls} ${styles.effect}`} role={str(p.label, 200) ? 'img' : undefined} aria-label={str(p.label, 200) || undefined} aria-hidden={str(p.label, 200) ? undefined : true}>
          <EffectSlot effect={str(p.effect, 80)} params={(p.params as Record<string, unknown>) ?? {}} />
        </div>
      )
    case 'divider':
      return <hr {...a} className={`${cls} ${styles.divider}`} />
    case 'spacer':
      return <div {...a} className={`${cls} ${styles.spacer}`} aria-hidden="true" />
  }
}

/** A content section's blocks, in one column. */
export function AddedContent({ section }: { section: string }) {
  const { doc } = useSite()
  const nodes = doc.additions[section] ?? []
  if (!nodes.length) return null
  return (
    <div className={styles.flow} data-cms-content={section}>
      {nodes.map((n) => <Block key={n.id} node={n} />)}
    </div>
  )
}
