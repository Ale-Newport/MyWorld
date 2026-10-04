'use client'

import { createElement, type ReactNode } from 'react'
import { useEditing, useSite } from './context'
import { renderRich } from './rich'
import { safeHref, safeSrc, tableData, type ElementNode } from './schema'
import { EffectSlot } from '@/animations/EffectSlot'
import styles from './blocks.module.css'

/* ============================================================
   ELEMENTS ADDED IN THE EDITOR

   Each section of the site ends with a slot: a layer over its
   stage that holds what an administrator added — headings,
   paragraphs, images, buttons, tables, cards, containers and
   animations from the library. They are ordinary semantic HTML
   (a table is a <table> with a caption and header cells, a
   button is a link), styled by the same compiled stylesheet as
   every other element.

   `flow` elements stack in the slot's own layout (a column by
   default; any container can be made a row or a grid); `anchored`
   elements are positioned against the section's edges, with
   distances the editor writes per breakpoint.
   ============================================================ */

function attrs(node: ElementNode, editing: boolean): Record<string, string> {
  const a: Record<string, string> = { 'data-cms-id': node.id, 'data-cms-added': 'true' }
  if (editing) {
    a['data-cms-kind'] = node.type === 'animation' ? 'animation' : node.type === 'container' || node.type === 'card' ? 'container' : node.type === 'table' ? 'table' : node.type === 'image' || node.type === 'video' ? 'image' : node.type === 'button' ? 'button' : node.type === 'heading' ? 'heading' : 'text'
    a['data-cms-label'] = node.name
    if (node.locked) a['data-cms-locked'] = 'true'
  }
  return a
}

const str = (v: unknown, max = 2000) => (typeof v === 'string' ? v.slice(0, max) : '')
const href = (v: unknown) => (typeof v === 'string' && safeHref.safeParse(v).success ? v : undefined)
const src = (v: unknown) => (typeof v === 'string' && v && safeSrc.safeParse(v).success ? v : undefined)

export function Block({ node }: { node: ElementNode }) {
  const editing = useEditing()
  const a = attrs(node, editing)
  const cls = `${styles.block} ${node.layout.mode === 'anchored' ? styles.anchored : ''}`
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
      const parsed = tableData.safeParse(p.table)
      if (!parsed.success) return <div {...a} className={cls}>Table</div>
      const t = parsed.data
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

export function CmsSlot({ section, children }: { section: string; children?: ReactNode }) {
  const { doc } = useSite()
  const editing = useEditing()
  const nodes = doc.additions[section] ?? []
  if (!nodes.length && !editing && !children) return null
  return (
    <div className={styles.slot} data-cms-slot={section} data-cms-id={`slot.${section}`} {...(editing ? { 'data-cms-kind': 'container', 'data-cms-label': 'Added elements' } : {})}>
      {children}
      {nodes.map((n) => <Block key={n.id} node={n} />)}
    </div>
  )
}
