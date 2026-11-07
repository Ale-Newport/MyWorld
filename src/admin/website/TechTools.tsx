'use client'

import { useEffect, useId, useMemo, useState } from 'react'
import { useSiteStore } from '../store/site'
import { api } from '../api'
import { Panel } from '../ui/kit'
import { Icon } from '../ui/icons'
import { TECH_GROUPS } from '@/cms/derive'
import type { TechNodeEntity } from '@/cms/schema'
import { logoOf } from '@/content/tech-ink'

/* ============================================================
   THE TECHNOLOGIES ON THE WALL

   The Tech Toolbox's list itself: add a technology, take one
   away, move it within its family, rename it, move it to another
   family, choose its mark and tick the projects that used it. The
   wall draws each family in this order; a project's page lists
   the technologies it is ticked under. (The same ticks are on each
   project, under Stack.)

   A mark is chosen from Simple Icons by name and stored with the
   technology, so the site never fetches one. A technology with no
   mark (a concept, or a brand Simple Icons does not carry) is set
   as its initial, as the shipped concepts are.
   ============================================================ */

type Group = TechNodeEntity['group']
interface Found { title: string; slug: string; hex: string; path: string }

const apply = (mutate: Parameters<ReturnType<typeof useSiteStore.getState>['apply']>[0], coalesce?: string) =>
  useSiteStore.getState().apply(mutate, coalesce ? { coalesce } : undefined)

function slugOf(name: string): string {
  return name.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/\+/g, 'plus').replace(/#/g, 'sharp')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'tech'
}

function Mark({ node, size = 22 }: { node: Pick<TechNodeEntity, 'id' | 'name' | 'logo'>; size?: number }) {
  const logo = logoOf(node)
  return (
    <span className="tt-mark" style={{ width: size, height: size, color: logo?.ink }} aria-hidden="true">
      {logo ? <svg viewBox="0 0 24 24" width={size} height={size}><path d={logo.path} fill="currentColor" /></svg> : <b>{node.name.charAt(0) || '?'}</b>}
    </span>
  )
}

export function TechTools() {
  const nodes = useSiteStore((s) => s.doc?.techNodes)
  const all = useMemo(() => nodes ?? [], [nodes])
  const [open, setOpen] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [group, setGroup] = useState<Group>('language')
  const id = useId()

  const add = () => {
    const label = name.trim()
    if (!label) return
    const taken = new Set(all.map((n) => n.id))
    const base = slugOf(label)
    let nodeId = base
    for (let i = 2; taken.has(nodeId); i++) nodeId = `${base}-${i}`
    apply((d) => { d.techNodes.push({ id: nodeId, name: label, group, evidence: [], weight: 1 }) })
    setName('')
    setOpen(nodeId)
  }

  /** Swaps a technology with the previous or next one of its own family: the wall draws each family in list order. */
  const move = (nodeId: string, dir: -1 | 1) => apply((d) => {
    const i = d.techNodes.findIndex((n) => n.id === nodeId)
    if (i < 0) return
    let j = i + dir
    while (j >= 0 && j < d.techNodes.length && d.techNodes[j].group !== d.techNodes[i].group) j += dir
    if (j < 0 || j >= d.techNodes.length) return
    const t = d.techNodes[i]
    d.techNodes[i] = d.techNodes[j]
    d.techNodes[j] = t
  })

  const remove = (n: TechNodeEntity) => {
    if (!confirm(`Remove “${n.name}” from the Tech Toolbox? Its tile and its links to ${n.evidence.length} project${n.evidence.length === 1 ? '' : 's'} go with it when you publish. Undo brings it back.`)) return
    apply((d) => { d.techNodes = d.techNodes.filter((x) => x.id !== n.id) })
    if (open === n.id) setOpen(null)
  }

  return (
    <Panel title="Technologies" description="The tools on the wall: add, remove and order them, and tick the projects that used each one. The order here is the order on the wall, family by family.">
      {TECH_GROUPS.map((g) => {
        const list = all.filter((n) => n.group === g.id)
        return (
          <section key={g.id} className="tt-group" aria-labelledby={`${id}-${g.id}`}>
            <h4 id={`${id}-${g.id}`} className="tt-group-head">{g.label} <span className="badge">{list.length}</span></h4>
            {list.length === 0 ? <p className="a-hint">None yet.</p> : (
              <ol className="tt-list">
                {list.map((n, i) => (
                  <li key={n.id} className="tt-row" data-open={open === n.id || undefined}>
                    <div className="tt-line">
                      <Mark node={n} />
                      <input className="input tt-name" value={n.name} aria-label={`Name of ${n.name || 'this technology'}`} onChange={(e) => apply((d) => { const x = d.techNodes.find((y) => y.id === n.id); if (x) x.name = e.target.value }, `tech:${n.id}:name`)} />
                      <span className="a-sub tt-count">{n.evidence.length} project{n.evidence.length === 1 ? '' : 's'}</span>
                      <span className="btn-group">
                        <button type="button" className="btn btn-sm btn-icon" disabled={i === 0} onClick={() => move(n.id, -1)} title="Move up" aria-label={`Move ${n.name} up`}><Icon name="up" size={14} /></button>
                        <button type="button" className="btn btn-sm btn-icon" disabled={i === list.length - 1} onClick={() => move(n.id, 1)} title="Move down" aria-label={`Move ${n.name} down`}><Icon name="down" size={14} /></button>
                      </span>
                      <button type="button" className="btn btn-sm" aria-expanded={open === n.id} onClick={() => setOpen(open === n.id ? null : n.id)}>{open === n.id ? 'Done' : 'Edit'}</button>
                      <button type="button" className="btn btn-sm btn-icon btn-ghost btn-danger" onClick={() => remove(n)} title="Remove" aria-label={`Remove ${n.name}`}><Icon name="trash" size={14} /></button>
                    </div>
                    {open === n.id && <TechDetails node={n} />}
                  </li>
                ))}
              </ol>
            )}
          </section>
        )
      })}

      <form className="tt-add" onSubmit={(e) => { e.preventDefault(); add() }}>
        <div className="field">
          <label htmlFor={`${id}-name`}>New technology</label>
          <input id={`${id}-name`} className="input" value={name} placeholder="Rust, Kubernetes, Supabase…" onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={`${id}-group`}>Family</label>
          <select id={`${id}-group`} className="input" value={group} onChange={(e) => setGroup(e.target.value as Group)}>
            {TECH_GROUPS.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
          </select>
        </div>
        <button type="submit" className="btn" disabled={!name.trim()}><Icon name="plus" size={15} />Add</button>
      </form>
      <small className="a-hint">A new technology goes to the end of its family. Choose its mark and its projects in Edit.</small>
    </Panel>
  )
}

function TechDetails({ node }: { node: TechNodeEntity }) {
  const id = useId()
  const projects = useSiteStore((s) => s.doc?.projects)
  const [q, setQ] = useState('')
  const sorted = useMemo(() => (projects ?? []).filter((p) => p.status !== 'archived').slice()
    .sort((a, b) => Number(node.evidence.includes(b.id)) - Number(node.evidence.includes(a.id)) || a.title.localeCompare(b.title)), [projects, node.evidence])
  const set = (mutate: (n: TechNodeEntity) => void) => apply((d) => { const n = d.techNodes.find((x) => x.id === node.id); if (n) mutate(n) })

  return (
    <div className="tt-details stack">
      <div className="field">
        <label htmlFor={`${id}-group`}>Family</label>
        <select id={`${id}-group`} className="input" value={node.group} onChange={(e) => set((n) => { n.group = e.target.value as Group })}>
          {TECH_GROUPS.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
        </select>
      </div>

      <LogoPicker node={node} onPick={(f) => set((n) => { if (f) n.logo = { title: f.title, hex: f.hex, path: f.path }; else delete n.logo })} />

      <div className="field">
        <label htmlFor={`${id}-q`}>Projects that used it</label>
        <input id={`${id}-q`} className="input" type="search" placeholder="Filter projects…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="tt-projects">
          {sorted.filter((p) => !q || p.title.toLowerCase().includes(q.toLowerCase())).map((p) => (
            <label key={p.id} className="check">
              <input type="checkbox" checked={node.evidence.includes(p.id)} onChange={(e) => set((n) => { n.evidence = e.target.checked ? [...n.evidence, p.id] : n.evidence.filter((x) => x !== p.id) })} />
              {p.title}{p.status === 'draft' && <span className="badge" data-tone="warn">Draft</span>}
            </label>
          ))}
        </div>
        <small className="a-hint">Only published, listed projects are counted and named on the wall.</small>
      </div>
    </div>
  )
}

function LogoPicker({ node, onPick }: { node: TechNodeEntity; onPick: (f: Found | null) => void }) {
  const id = useId()
  const [q, setQ] = useState(node.name)
  const [found, setFound] = useState<Found[]>([])
  const [state, setState] = useState<'idle' | 'busy' | 'error'>('idle')
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    const query = q.trim()
    if (!query) return
    let live = true
    const t = window.setTimeout(async () => {
      setState('busy')
      try {
        const r = await api<{ icons: Found[]; error?: string }>(`/api/admin/tech/icons?q=${encodeURIComponent(query)}`)
        if (!live) return
        setFound(r.icons)
        setNote(r.error ?? null)
        setState('idle')
      } catch {
        if (live) setState('error')
      }
    }, 250)
    return () => { live = false; window.clearTimeout(t) }
  }, [q])

  const current = logoOf(node)
  return (
    <div className="field">
      <label htmlFor={`${id}-q`}>Mark</label>
      <div className="row">
        <Mark node={node} size={28} />
        <span className="a-sub">{node.logo ? `${node.logo.title} (chosen here)` : current ? `${current.title}` : 'No mark: the wall shows its initial'}</span>
        {node.logo && <button type="button" className="btn btn-sm btn-ghost" onClick={() => onPick(null)}><Icon name="reset" size={14} />Remove</button>}
      </div>
      <input id={`${id}-q`} className="input" type="search" placeholder="Search Simple Icons…" value={q} onChange={(e) => setQ(e.target.value)} />
      {state === 'error' && <small className="a-hint">The marks could not be searched.</small>}
      {note && <small className="a-hint">{note}</small>}
      {q.trim() && found.length > 0 && (
        <div className="tt-found" role="group" aria-label="Marks found" aria-busy={state === 'busy'}>
          {found.map((f) => (
            <button key={f.slug} type="button" className="tt-found-item" aria-pressed={node.logo?.path === f.path} onClick={() => onPick(f)} title={f.title}>
              <svg viewBox="0 0 24 24" width={24} height={24} aria-hidden="true"><path d={f.path} fill={f.hex} /></svg>
              <span>{f.title}</span>
            </button>
          ))}
        </div>
      )}
      {q.trim() && state === 'idle' && found.length === 0 && !note && <small className="a-hint">No mark by that name. A concept is better shown as its initial than as someone else&apos;s logo.</small>}
    </div>
  )
}
