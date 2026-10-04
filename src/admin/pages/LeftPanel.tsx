'use client'

import { useMemo, useState, type DragEvent } from 'react'
import { useSiteStore } from '../store/site'
import { uploadMedia, useMedia } from '../fields'
import { toast } from '../toast'
import type { ElementType } from '@/cms/schema'
import { deleteCustomSection, findNode, flag, moveInList, moveNodeTo, newSectionId, setFlag } from './ops'
import { frame, useEditor, type TreeNode } from './state'
import { insertElement, pick } from './actions'

const KIND_ICON: Record<string, string> = { heading: 'H', text: '¶', button: '▭', link: '↗', image: '▨', video: '▶', table: '▦', container: '▢', card: '▤', animation: '✦', section: '§', metric: '#', list: '☰', divider: '—', spacer: '↕' }

/* ---- sections ------------------------------------------------------------- */
function SectionsPanel() {
  const doc = useSiteStore((s) => s.doc)!
  const apply = useSiteStore((s) => s.apply)
  const { page, selection, viewportSection } = useEditor()
  if (!page.journey) return <p className="pe-empty">A project page is laid out from the project’s own sections; edit them under Projects. Here you can restyle the template every project page shares.</p>
  const j = page.journey
  const sections = doc.journeys[j].sections
  const move = (i: number, d: number) => apply((x) => { const l = x.journeys[j].sections; const [s] = l.splice(i, 1); l.splice(i + d, 0, s) })
  const add = () => {
    const title = prompt('Name of the new section', 'New section')?.trim()
    if (!title) return
    const id = newSectionId(doc)
    const at = Math.max(0, sections.findIndex((s) => s.id === viewportSection)) + 1
    apply((x) => { x.journeys[j].sections.splice(at, 0, { id, kind: 'custom', hidden: false, title, label: title, group: 'Custom', vh: 2, quickVh: 1 }) })
    useEditor.getState().select([`section.${id}`])
    setTimeout(() => frame.post({ type: 'cms:scroll-to-section', section: id }), 600)
  }
  return (
    <div className="pe-list" role="list">
      {sections.map((s, i) => {
        const id = `section.${s.id}`
        return (
          <div key={s.id} role="listitem" className="pe-item" data-selected={selection.includes(id) || undefined} data-current={viewportSection === s.id || undefined} data-dim={s.hidden || undefined}>
            <button type="button" className="pe-item-main" onClick={() => { useEditor.getState().select([id]); frame.post({ type: 'cms:scroll-to-section', section: s.id }) }}>
              <span className="pe-icon" aria-hidden="true">§</span>
              <span className="pe-item-text">{s.title}<small>{s.kind === 'custom' ? 'Added section' : s.label}</small></span>
            </button>
            <span className="pe-item-tools">
              <button type="button" className="pe-tool" title="Move up" aria-label={`Move ${s.title} up`} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
              <button type="button" className="pe-tool" title="Move down" aria-label={`Move ${s.title} down`} disabled={i === sections.length - 1} onClick={() => move(i, 1)}>↓</button>
              <button type="button" className="pe-tool" title={s.hidden ? 'Show' : 'Hide'} aria-label={`${s.hidden ? 'Show' : 'Hide'} ${s.title}`} aria-pressed={s.hidden} onClick={() => apply((x) => { x.journeys[j].sections[i].hidden = !s.hidden })}>{s.hidden ? '◌' : '◉'}</button>
              {s.kind === 'custom' && <button type="button" className="pe-tool" title="Delete section" aria-label={`Delete ${s.title}`} onClick={() => { if (confirm(`Delete the section “${s.title}” and everything added to it?`)) { apply((x) => { deleteCustomSection(x, j, s.id) }); useEditor.getState().select([]) } }}>✕</button>}
            </span>
          </div>
        )
      })}
      <button type="button" className="btn btn-sm" style={{ margin: 8 }} onClick={add}>+ Add a section</button>
      <p className="pe-empty">Hidden sections leave the page and the index. The site’s own chapters can be hidden and reordered; added sections can also be deleted.</p>
    </div>
  )
}

/* ---- layers -------------------------------------------------------------- */
function LayersPanel() {
  const doc = useSiteStore((s) => s.doc)!
  const apply = useSiteStore((s) => s.apply)
  const { tree, selection, hovered, page, viewportSection } = useEditor()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [dragging, setDragging] = useState<string | null>(null)
  const bySection = useMemo(() => {
    const map = new Map<string, TreeNode[]>()
    for (const n of tree) { const k = n.section ?? 'page'; if (!map.has(k)) map.set(k, []); map.get(k)!.push(n) }
    return map
  }, [tree])
  const titles = Object.fromEntries((page.journey ? doc.journeys[page.journey].sections : []).map((s) => [s.id, s.title]))
  const q = query.toLowerCase()
  const children = (list: TreeNode[], parent: string | null) => list.filter((n) => n.parent === parent || (parent === null && !list.some((p) => p.id === n.parent)))

  const row = (n: TreeNode, list: TreeNode[], depth: number): React.ReactNode => {
    if (n.kind === 'section') return children(list, n.id).map((c) => row(c, list, depth))
    const kids = children(list, n.id)
    const hidden = flag(doc, n.id, 'hidden')
    const locked = flag(doc, n.id, 'locked')
    const match = !q || `${n.label} ${n.text} ${n.id}`.toLowerCase().includes(q)
    const added = !!findNode(doc, n.id)
    const sub = kids.map((c) => row(c, list, depth + 1))
    if (!match && !sub.some(Boolean)) return null
    const dropProps = added ? {
      draggable: true,
      onDragStart: (e: DragEvent) => { setDragging(n.id); e.dataTransfer.setData('text/plain', n.id); e.dataTransfer.effectAllowed = 'move' },
      onDragEnd: () => setDragging(null),
      onDragOver: (e: DragEvent) => { if (dragging && dragging !== n.id) e.preventDefault() },
      onDrop: (e: DragEvent) => {
        e.preventDefault()
        if (!dragging) return
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
        const inside = n.kind === 'container' && e.clientX > r.left + r.width * 0.55
        apply((d) => moveNodeTo(d, dragging, n.id, inside ? 'inside' : 'before'))
        setDragging(null)
      },
    } : {}
    return (
      <div key={n.id} role="treeitem" aria-selected={selection.includes(n.id)} aria-level={depth + 1}>
        <div className="pe-item" data-selected={selection.includes(n.id) || undefined} data-hover={hovered === n.id || undefined} data-dim={hidden || undefined} style={{ paddingLeft: 6 + depth * 12 }}
          onMouseEnter={() => frame.post({ type: 'cms:hover', id: n.id })} onMouseLeave={() => frame.post({ type: 'cms:hover', id: null })} {...dropProps}>
          {added && <span className="pe-grip" aria-hidden="true" title="Drag to reorder">⠿</span>}
          <button type="button" className="pe-item-main" onClick={(e) => { pick(n.id, e.shiftKey, true); frame.post({ type: 'cms:reveal', id: n.id }) }}>
            <span className="pe-icon" aria-hidden="true">{KIND_ICON[n.kind] ?? '•'}</span>
            <span className="pe-item-text">{n.label}{n.count > 1 && <small> ×{n.count}</small>}{n.text && n.text !== n.label && <small>{n.text}</small>}</span>
          </button>
          <span className="pe-item-tools">
            {added && <>
              <button type="button" className="pe-tool" title="Move up" aria-label={`Move ${n.label} up`} onClick={() => apply((d) => moveInList(d, n.id, -1))}>↑</button>
              <button type="button" className="pe-tool" title="Move down" aria-label={`Move ${n.label} down`} onClick={() => apply((d) => moveInList(d, n.id, 1))}>↓</button>
            </>}
            <button type="button" className="pe-tool" title={locked ? 'Unlock' : 'Lock'} aria-label={`${locked ? 'Unlock' : 'Lock'} ${n.label}`} aria-pressed={locked} onClick={() => apply((d) => setFlag(d, n.id, 'locked', !locked))}>{locked ? '🔒' : '🔓'}</button>
            <button type="button" className="pe-tool" title={hidden ? 'Show' : 'Hide'} aria-label={`${hidden ? 'Show' : 'Hide'} ${n.label}`} aria-pressed={hidden} onClick={() => apply((d) => setFlag(d, n.id, 'hidden', !hidden))}>{hidden ? '◌' : '◉'}</button>
          </span>
        </div>
        {sub}
      </div>
    )
  }

  const order = page.journey ? doc.journeys[page.journey].sections.map((s) => s.id).filter((id) => bySection.has(id)) : []
  const keys = [...order, ...[...bySection.keys()].filter((k) => !order.includes(k))]
  return (
    <div className="pe-layers">
      <input className="input pe-input" style={{ margin: 8, width: 'calc(100% - 16px)' }} placeholder="Find a layer…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Find a layer" />
      <div role="tree" aria-label="Layers">
        {keys.map((k) => {
          const list = bySection.get(k)!
          const expanded = open[k] ?? (k === viewportSection || !!q || list.some((n) => selection.includes(n.id)) || keys.length === 1)
          const groups = doc.groups[k] ?? []
          return (
            <div key={k} className="pe-tree-section">
              <button type="button" className="pe-tree-head" aria-expanded={expanded} onClick={() => setOpen({ ...open, [k]: !expanded })}>{expanded ? '▾' : '▸'} {titles[k] ?? (k === 'page' ? 'Page' : k)} <small>{list.length}</small></button>
              {expanded && <>
                {groups.map((g) => (
                  <div key={g.id} className="pe-item" data-selected={g.members.every((m) => selection.includes(m)) || undefined}>
                    <button type="button" className="pe-item-main" onClick={() => useEditor.getState().select(g.members)}><span className="pe-icon">⧉</span><span className="pe-item-text">{g.name}<small>{g.members.length} elements</small></span></button>
                    <span className="pe-item-tools"><button type="button" className="pe-tool" title="Ungroup" aria-label={`Ungroup ${g.name}`} onClick={() => apply((d) => { d.groups[k] = d.groups[k].filter((x) => x.id !== g.id); if (!d.groups[k].length) delete d.groups[k] })}>✕</button></span>
                  </div>
                ))}
                {children(list, null).map((n) => row(n, list, 0))}
              </>}
            </div>
          )
        })}
        {!tree.length && <p className="pe-empty">Waiting for the page…</p>}
      </div>
    </div>
  )
}

/* ---- insert ---------------------------------------------------------------- */
const PALETTE: { type: ElementType; preset?: string; label: string; icon: string }[] = [
  { type: 'heading', label: 'Heading', icon: 'H' }, { type: 'text', label: 'Paragraph', icon: '¶' }, { type: 'button', label: 'Button', icon: '▭' },
  { type: 'image', label: 'Image', icon: '▨' }, { type: 'video', label: 'Video', icon: '▶' }, { type: 'table', label: 'Table', icon: '▦' },
  { type: 'card', label: 'Card', icon: '▤' }, { type: 'container', preset: 'row', label: 'Row', icon: '⇥' }, { type: 'container', preset: 'column', label: 'Column', icon: '⇩' },
  { type: 'container', preset: 'grid', label: 'Grid', icon: '▦' }, { type: 'animation', label: 'Animation', icon: '✦' }, { type: 'divider', label: 'Divider', icon: '—' },
  { type: 'spacer', label: 'Spacer', icon: '↕' },
]
function InsertPanel() {
  return (
    <div className="pe-insert">
      <p className="pe-empty">Drag onto the page to place it there, or click to add it to the section in view (or into the selected row, column or grid).</p>
      <div className="pe-palette">
        {PALETTE.map((p) => (
          <button key={`${p.type}-${p.preset ?? ''}`} type="button" className="pe-tile" draggable
            onDragStart={(e) => { e.dataTransfer.setData('application/x-cms', JSON.stringify({ kind: 'element', type: p.type, preset: p.preset })); e.dataTransfer.effectAllowed = 'copy' }}
            onClick={() => insertElement(p.type, { preset: p.preset })}>
            <span aria-hidden="true">{p.icon}</span>{p.label}
          </button>
        ))}
      </div>
    </div>
  )
}

/* ---- assets ------------------------------------------------------------------ */
function AssetsPanel() {
  const { items, reload } = useMedia()
  const [busy, setBusy] = useState(false)
  return (
    <div className="pe-insert">
      <label className="btn btn-sm" style={{ margin: 8 }}>{busy ? 'Uploading…' : 'Upload'}<input type="file" hidden accept="image/*,video/mp4,video/webm" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; setBusy(true); try { await uploadMedia(f); await reload() } catch (err) { toast((err as Error).message, 'danger') } finally { setBusy(false) } }} /></label>
      {!items ? <p className="pe-empty">Loading…</p> : !items.length ? <p className="pe-empty">No media yet. Upload images or video here or in Media.</p> : (
        <div className="pe-assets">
          {items.filter((m) => m.mime.startsWith('image/') || m.mime.startsWith('video/')).map((m) => (
            <button key={m.id} type="button" className="pe-asset" draggable title={m.title || m.filename}
              onDragStart={(e) => { e.dataTransfer.setData('application/x-cms', JSON.stringify({ kind: 'media', url: m.url, mime: m.mime, alt: m.alt })); e.dataTransfer.effectAllowed = 'copy' }}
              onClick={() => {
                const sel = useEditor.getState().selection[0]
                const node = sel ? findNode(useSiteStore.getState().doc!, sel)?.node : null
                if (node && (node.type === 'image' || node.type === 'video') && m.mime.startsWith(`${node.type}/`)) useSiteStore.getState().apply((d) => { const f = findNode(d, sel!); if (f) { f.node.props.src = m.url; if (m.alt && !f.node.props.alt) f.node.props.alt = m.alt } })
                else insertElement(m.mime.startsWith('video/') ? 'video' : 'image', { src: m.url, alt: m.alt })
              }}>
              {m.mime.startsWith('image/') ? <img src={m.url} alt="" /> : <span className="a-mono">{m.filename.split('.').pop()?.toUpperCase()}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function LeftPanel() {
  const panel = useEditor((s) => s.panel)
  const set = useEditor((s) => s.set)
  return (
    <aside className="pe-left" aria-label="Page structure">
      <nav className="pe-tabs" role="tablist">
        {(['layers', 'sections', 'insert', 'assets'] as const).map((p) => <button key={p} type="button" role="tab" aria-selected={panel === p} className="pe-tab" onClick={() => set({ panel: p })}>{p[0].toUpperCase() + p.slice(1)}</button>)}
      </nav>
      <div className="pe-left-body">
        {panel === 'sections' && <SectionsPanel />}
        {panel === 'layers' && <LayersPanel />}
        {panel === 'insert' && <InsertPanel />}
        {panel === 'assets' && <AssetsPanel />}
      </div>
    </aside>
  )
}
