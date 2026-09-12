'use client'

import { useId, type ReactNode } from 'react'
import { useSiteStore } from '../store/site'
import { getPath, setPath } from '../paths'
import { TableEditor } from '../fields'
import { Panel, Switch, Notice } from '../ui/kit'
import { Icon } from '../ui/icons'
import { richToPlain } from '@/cms/rich'
import { safeHref, tableData, type ElementNode, type Section, type SiteDocument } from '@/cms/schema'
import type { DataField, ElementField, FieldDef, ItemField, ListField, SectionDef } from './registry'

/* ============================================================
   ONE SECTION'S TEXT, AS A FORM

   Fields come from registry.ts. Every change goes through the
   draft store's apply(), so it is undoable, appears at once in
   the preview beside the form, and is validated by the server's
   schema when the draft is saved. Nothing here can move, resize or
   restyle anything: the site lays the text out itself.
   ============================================================ */

type Apply = (mutate: (d: SiteDocument) => void, opts?: { coalesce?: string }) => void
const apply: Apply = (m, o) => useSiteStore.getState().apply(m, o)

function Counter({ length, recommended }: { length: number; recommended?: number }) {
  if (!recommended) return null
  const over = length > recommended
  return (
    <small className="ce-count" data-over={over || undefined}>
      {length}/{recommended}{over ? ' — longer than the design expects; it will still fit, set smaller or wrapped' : ''}
    </small>
  )
}

function TextBox({ id, value, onChange, multiline, invalid, describedBy, placeholder }: { id: string; value: string; onChange: (v: string) => void; multiline?: boolean; invalid?: boolean; describedBy?: string; placeholder?: string }) {
  const rows = Math.min(8, Math.max(2, value.split('\n').length + (value.length > 90 ? 1 : 0)))
  return multiline
    ? <textarea id={id} className="input" rows={rows} value={value} placeholder={placeholder} aria-invalid={invalid || undefined} aria-describedby={describedBy} onChange={(e) => onChange(e.target.value)} />
    : <input id={id} className="input" value={value} placeholder={placeholder} aria-invalid={invalid || undefined} aria-describedby={describedBy} onChange={(e) => onChange(e.target.value)} />
}

/* ---- text that belongs to the page ------------------------------- */
function ElementText({ f }: { f: ElementField }) {
  const override = useSiteStore((s) => s.doc?.elements[f.id])
  const id = useId()
  const edited = override?.text !== undefined
  const formatted = Array.isArray(override?.text)
  const value = edited ? richToPlain(override!.text) : f.fallback
  const hidden = !!override?.hidden
  const write = (patch: { text?: string | undefined; hidden?: boolean | undefined }) => apply((d) => {
    const next = { ...(d.elements[f.id] ?? {}), ...patch }
    if (next.text === undefined) delete next.text
    if (!next.hidden) delete next.hidden
    if (Object.keys(next).length) d.elements[f.id] = next
    else delete d.elements[f.id]
  }, patch.text !== undefined ? { coalesce: `el:${f.id}` } : undefined)
  return (
    <div className="field ce-field" data-hidden={hidden || undefined}>
      <div className="ce-field-head">
        <label htmlFor={id}>{f.label}</label>
        {edited && <button type="button" className="btn btn-sm btn-ghost" onClick={() => write({ text: undefined })} title="Go back to the site's own text"><Icon name="reset" size={14} />Default</button>}
      </div>
      <TextBox id={id} value={value} multiline={f.multiline} describedBy={`${id}-hint`} onChange={(v) => write({ text: v })} />
      <div id={`${id}-hint`} className="ce-field-foot">
        {f.help && <small className="a-hint">{f.help}</small>}
        {formatted && <small className="a-hint">This text had formatting from the old editor; editing it here keeps the words only.</small>}
        <Counter length={value.length} recommended={f.recommended} />
      </div>
      {f.optional && <Switch checked={!hidden} onChange={(on) => write({ hidden: !on })} label="Show on the site" />}
    </div>
  )
}

/* ---- text that belongs to the portfolio's data --------------------- */
function DataText({ f }: { f: DataField }) {
  const value = useSiteStore((s) => getPath(s.doc, f.path) as string | undefined) ?? ''
  const id = useId()
  const invalid = f.link && value !== '' && !safeHref.safeParse(value).success
  return (
    <div className="field ce-field">
      <div className="ce-field-head"><label htmlFor={id}>{f.label}</label></div>
      <TextBox id={id} value={value} multiline={f.multiline} invalid={invalid} describedBy={`${id}-hint`} onChange={(v) => apply((d) => { setPath(d, f.path, v) }, { coalesce: f.path })} />
      <div id={`${id}-hint`} className="ce-field-foot">
        {invalid ? <small className="a-hint" data-tone="danger" role="alert">Links must start with https://, mailto:, tel: or / (a page of this site).</small> : f.help && <small className="a-hint">{f.help}</small>}
        <Counter length={value.length} recommended={f.recommended} />
      </div>
    </div>
  )
}

/* ---- lists ------------------------------------------------------------ */
function ItemText({ path, field, value, index }: { path: string; field: ItemField; value: string; index: number }) {
  const id = useId()
  const invalid = field.link && value !== '' && !safeHref.safeParse(value).success
  return (
    <div className="field">
      <label htmlFor={id} className="ce-item-label">{field.label}</label>
      <TextBox id={id} value={value} multiline={field.multiline} invalid={invalid} onChange={(v) => apply((d) => { setPath(d, `${path}.${index}.${field.key}`, v) }, { coalesce: `${path}.${index}.${field.key}` })} />
      {invalid && <small className="a-hint" data-tone="danger" role="alert">Links must start with https://, mailto:, tel: or /.</small>}
    </div>
  )
}

function ListEditor({ f }: { f: ListField }) {
  const list = useSiteStore((s) => getPath(s.doc, f.path) as unknown[] | undefined) ?? []
  const editable = f.addLabel !== ''
  const setList = (next: unknown[]) => apply((d) => { setPath(d, f.path, next) })
  const move = (i: number, by: number) => { const n = [...list]; const [x] = n.splice(i, 1); n.splice(i + by, 0, x); setList(n) }
  const fields = f.item ?? []
  const blank = () => Object.fromEntries(fields.filter((x) => !x.list).map((x) => [x.key, '']))
  return (
    <fieldset className="ce-list">
      <legend>{f.label}</legend>
      {f.help && <small className="a-hint">{f.help}</small>}
      <ol className="ce-list-items">
        {list.map((item, i) => (
          <li key={i} className="ce-list-item">
            <div className="ce-list-fields" data-records={fields.filter((x) => !x.list).length}>
              {fields.map((field) => field.list
                ? <NestedList key={field.key} path={`${f.path}.${i}.${field.key}`} label={field.label} fields={field.list} />
                : <ItemText key={field.key} path={f.path} field={field} index={i} value={String((item as Record<string, unknown>)?.[field.key] ?? '')} />)}
            </div>
            {editable && (
              <div className="ce-list-actions">
                <button type="button" className="btn btn-sm btn-icon" aria-label="Move up" title="Move up" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                <button type="button" className="btn btn-sm btn-icon" aria-label="Move down" title="Move down" disabled={i === list.length - 1} onClick={() => move(i, 1)}>↓</button>
                <button type="button" className="btn btn-sm btn-icon" aria-label="Remove" title="Remove" onClick={() => setList(list.filter((_, j) => j !== i))}><Icon name="close" size={14} /></button>
              </div>
            )}
          </li>
        ))}
      </ol>
      {editable && list.length < f.max && <div><button type="button" className="btn btn-sm" onClick={() => setList([...list, blank()])}>+ {f.addLabel}</button></div>}
    </fieldset>
  )
}

/* Plain string lists are stored as arrays of strings: edit them in place. */
function StringItem({ path, index, label, value }: { path: string; index: number; label: string; value: string }) {
  const id = useId()
  return (
    <div className="field">
      <label htmlFor={id} className="ce-item-label">{label}</label>
      <input id={id} className="input" value={value} onChange={(e) => apply((d) => { setPath(d, `${path}.${index}`, e.target.value) }, { coalesce: `${path}.${index}` })} />
    </div>
  )
}

function StringList({ f }: { f: ListField }) {
  const list = useSiteStore((s) => getPath(s.doc, f.path) as string[] | undefined) ?? []
  const setList = (next: string[]) => apply((d) => { setPath(d, f.path, next) })
  const move = (i: number, by: number) => { const n = [...list]; const [x] = n.splice(i, 1); n.splice(i + by, 0, x); setList(n) }
  return (
    <fieldset className="ce-list">
      <legend>{f.label}</legend>
      {f.help && <small className="a-hint">{f.help}</small>}
      <ol className="ce-list-items">
        {list.map((item, i) => (
          <li key={i} className="ce-list-item">
            <div className="ce-list-fields" data-records="1"><StringItem path={f.path} index={i} label={`${f.label.replace(/s$/, '')} ${i + 1}`} value={item} /></div>
            <div className="ce-list-actions">
              <button type="button" className="btn btn-sm btn-icon" aria-label="Move up" title="Move up" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
              <button type="button" className="btn btn-sm btn-icon" aria-label="Move down" title="Move down" disabled={i === list.length - 1} onClick={() => move(i, 1)}>↓</button>
              <button type="button" className="btn btn-sm btn-icon" aria-label="Remove" title="Remove" onClick={() => setList(list.filter((_, j) => j !== i))}><Icon name="close" size={14} /></button>
            </div>
          </li>
        ))}
      </ol>
      {list.length < f.max && <div><button type="button" className="btn btn-sm" onClick={() => setList([...list, ''])}>+ {f.addLabel}</button></div>}
    </fieldset>
  )
}

function NestedList({ path, label, fields }: { path: string; label: string; fields: { key: string; label: string }[] }) {
  const list = useSiteStore((s) => getPath(s.doc, path) as Record<string, unknown>[] | undefined) ?? []
  return (
    <details className="a-more ce-nested">
      <summary><Icon name="chevron" size={14} />{label} <span className="a-sub">({list.length})</span></summary>
      <div className="stack" style={{ marginTop: 10 }}>
        {list.map((item, i) => (
          <div key={i} className="ce-nested-row">
            {fields.map((field) => <ItemText key={field.key} path={path} field={field} index={i} value={String(item?.[field.key] ?? '')} />)}
          </div>
        ))}
      </div>
    </details>
  )
}

export function FieldEditor({ f }: { f: FieldDef }) {
  if (f.kind === 'element') return <ElementText f={f} />
  if (f.kind === 'data') return <DataText f={f} />
  return f.item ? <ListEditor f={f} /> : <StringList f={f} />
}

/* ---- the section itself ---------------------------------------------- */
export function SectionDetails({ journey, section }: { journey: 'home' | 'projects'; section: Section }) {
  const index = useSiteStore((s) => s.doc?.journeys[journey].sections.findIndex((x) => x.id === section.id) ?? -1)
  const at = `journeys.${journey}.sections.${index}`
  const set = (key: keyof Section, value: unknown) => apply((d) => { setPath(d, `${at}.${key}`, value) }, { coalesce: `${at}.${key}` })
  const id = useId()
  return (
    <Panel title="Section" description="How the section is named in the index and the progress bar, and whether it is shown at all.">
      <Switch checked={!section.hidden} onChange={(on) => set('hidden', !on)} label="Show this section" hint="Hidden sections stay in the draft with all their text; they are simply left out of the page." />
      <div className="grid-2">
        <div className="field"><label htmlFor={`${id}-t`}>Name in the index</label><input id={`${id}-t`} className="input" value={section.title} onChange={(e) => set('title', e.target.value)} /></div>
        <div className="field"><label htmlFor={`${id}-l`}>Index label</label><input id={`${id}-l`} className="input" value={section.label} onChange={(e) => set('label', e.target.value)} /></div>
      </div>
      <div className="field"><label htmlFor={`${id}-s`}>Index subtitle</label><input id={`${id}-s`} className="input" value={section.subtitle ?? ''} onChange={(e) => set('subtitle', e.target.value || undefined)} /></div>
    </Panel>
  )
}

/* ---- content kept from the old page builder ----------------------- */
const TEXT_TYPES = new Set(['heading', 'text', 'button', 'card'])

function walk(nodes: ElementNode[], out: { node: ElementNode; path: string }[], base: string) {
  nodes.forEach((n, i) => {
    out.push({ node: n, path: `${base}.${i}` })
    if (n.children) walk(n.children, out, `${base}.${i}.children`)
  })
}

export function AddedContent({ section }: { section: string }) {
  const nodes = useSiteStore((s) => s.doc?.additions[section]) ?? []
  const items: { node: ElementNode; path: string }[] = []
  walk(nodes, items, `additions.${section}`)
  if (!items.length) return <Notice>This content section has nothing in it yet.</Notice>
  return (
    <div className="stack">
      {items.map(({ node, path }) => <AddedItem key={node.id} node={node} path={path} />)}
    </div>
  )
}

function AddedItem({ node, path }: { node: ElementNode; path: string }) {
  const id = useId()
  const set = (key: string, value: unknown) => apply((d) => { setPath(d, `${path}.${key}`, value) }, { coalesce: `${path}.${key}` })
  const setProp = (key: string, value: unknown) => apply((d) => { setPath(d, `${path}.props.${key}`, value) }, { coalesce: `${path}.props.${key}` })
  const remove = () => apply((d) => {
    const parts = path.split('.')
    const i = Number(parts.pop())
    const parent = getPath(d, parts.join('.')) as unknown[] | undefined
    parent?.splice(i, 1)
  })
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  let body: ReactNode = null
  if (TEXT_TYPES.has(node.type)) {
    body = (
      <>
        <div className="field"><label htmlFor={`${id}-x`}>Text</label><TextBox id={`${id}-x`} value={richToPlain(node.text)} multiline onChange={(v) => set('text', v)} /></div>
        {(node.type === 'button' || node.type === 'card') && <div className="field"><label htmlFor={`${id}-h`}>Link</label><input id={`${id}-h`} className="input" value={str(node.props.href)} aria-invalid={!!node.props.href && !safeHref.safeParse(node.props.href).success} onChange={(e) => setProp('href', e.target.value)} /></div>}
        {node.type === 'card' && <div className="field"><label htmlFor={`${id}-c`}>Card title</label><input id={`${id}-c`} className="input" value={str(node.props.title)} onChange={(e) => setProp('title', e.target.value)} /></div>}
      </>
    )
  } else if (node.type === 'image' || node.type === 'video') {
    body = (
      <div className="grid-2">
        <div className="field"><label htmlFor={`${id}-a`}>Description (alt text)</label><input id={`${id}-a`} className="input" value={str(node.props.alt ?? node.props.label)} onChange={(e) => setProp(node.type === 'image' ? 'alt' : 'label', e.target.value)} /></div>
        <div className="field"><label htmlFor={`${id}-p`}>Caption</label><input id={`${id}-p`} className="input" value={str(node.props.caption)} onChange={(e) => setProp('caption', e.target.value)} /></div>
      </div>
    )
  } else if (node.type === 'table') {
    const parsed = tableData.safeParse(node.props.table)
    body = parsed.success ? <TableEditor value={parsed.data} onChange={(next) => setProp('table', next)} /> : <small className="a-hint">This table could not be read.</small>
  } else if (node.type === 'animation') {
    body = <small className="a-hint">An effect from the retired animation library ({str(node.props.effect) || 'unknown'}). It keeps playing in place; it can be removed but no longer edited.</small>
  } else {
    body = <small className="a-hint">{node.type === 'divider' ? 'A dividing rule.' : node.type === 'spacer' ? 'Space between blocks.' : 'A group of the blocks below.'}</small>
  }
  return (
    <div className="ce-added">
      <div className="ce-field-head">
        <b className="ce-added-type">{node.name || node.type}</b>
        <button type="button" className="btn btn-sm btn-ghost btn-danger" onClick={remove}><Icon name="close" size={14} />Remove</button>
      </div>
      {body}
    </div>
  )
}

export function SectionFields({ def }: { def: SectionDef }) {
  const text = def.fields.filter((f) => f.kind !== 'list')
  const lists = def.fields.filter((f) => f.kind === 'list')
  return (
    <>
      <Panel title="Text" description="The words in this section. The layout adapts to them at every screen size.">
        {text.map((f) => <FieldEditor key={f.kind === 'element' ? f.id : f.path} f={f} />)}
      </Panel>
      {lists.length > 0 && (
        <Panel title="Lists">
          {lists.map((f) => <FieldEditor key={(f as ListField).path} f={f} />)}
        </Panel>
      )}
    </>
  )
}
