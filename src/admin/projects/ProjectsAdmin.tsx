'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { useSiteStore } from '../store/site'
import { DraftBar } from '../DraftBar'
import type { Project } from '@/cms/schema'

const STATUS_TONE: Record<string, string> = { published: 'ok', draft: 'warn', archived: '' }
const slugify = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'project'

export function blankProject(doc: { projects: Project[] }, title = 'Untitled project'): Project {
  let slug = slugify(title)
  for (let i = 2; doc.projects.some((p) => p.slug === slug || p.id === slug); i++) slug = `${slugify(title)}-${i}`
  return {
    id: slug, slug, title, year: String(new Date().getFullYear()), source: 'personal', category: 'software', importance: 'archive',
    shortDescription: '', description: '', verifiedFacts: [], metrics: [], technologies: [], timelinePosition: 0.5,
    presentation: { type: 'procedural', motionComponent: 'GenericProjectMotion', concept: '', interaction: '', duration: 8 },
    assets: { screenshots: [], videos: [], models: [], textures: [], audio: [] }, assetStatus: 'none-required', dataStatus: 'needs-review',
    privateSource: false, featured: false, status: 'draft', hidden: false, order: Math.max(0, ...doc.projects.map((p) => p.order)) + 1, links: [], seo: {}, sections: [],
  }
}

/* Every project the site knows, in display order. The homepage cards, the
   universe, /projects, each project's page and the overlay all read these
   same entities; nothing here is a copy of anything else. */
export function ProjectsAdmin() {
  const router = useRouter()
  const { status, doc, load, apply } = useSiteStore()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'published' | 'draft' | 'archived' | 'hidden'>('all')
  const [drag, setDrag] = useState<string | null>(null)
  useEffect(() => { void load() }, [load])

  const projects = useMemo(() => (doc?.projects ?? []).slice().sort((a, b) => a.order - b.order), [doc])
  const shown = projects.filter((p) => (filter === 'all' || (filter === 'hidden' ? p.hidden : p.status === filter)) && (!query || `${p.title} ${p.slug} ${p.category} ${p.technologies.join(' ')}`.toLowerCase().includes(query.toLowerCase())))

  const reorder = (from: string, to: string) => apply((d) => {
    const list = d.projects.slice().sort((a, b) => a.order - b.order)
    const i = list.findIndex((p) => p.id === from), j = list.findIndex((p) => p.id === to)
    if (i < 0 || j < 0) return
    const [moved] = list.splice(i, 1)
    list.splice(j, 0, moved)
    list.forEach((p, k) => { d.projects.find((x) => x.id === p.id)!.order = k })
  })
  const patch = (id: string, change: Partial<Project>) => apply((d) => { Object.assign(d.projects.find((p) => p.id === id)!, change) })

  return (
    <main className="a-page">
      <header className="a-head">
        <div>
          <p className="a-label">Content</p>
          <h1 className="a-title">Projects</h1>
          <p className="a-sub">Drag rows to reorder the listings. Drafts and archived projects never reach the public site; hidden ones keep their page but leave every listing.</p>
        </div>
        <DraftBar>
          <button type="button" className="btn btn-primary" disabled={!doc} onClick={() => {
            const p = blankProject(doc!)
            apply((d) => { d.projects.push(p) })
            router.push(`/admin/projects/${encodeURIComponent(p.id)}`)
          }}>+ New project</button>
        </DraftBar>
      </header>
      {status !== 'ready' || !doc ? <p className="a-sub">Loading…</p> : (
        <section className="card">
          <div className="row" style={{ marginBottom: 12 }}>
            <input className="input" style={{ maxWidth: 320 }} placeholder="Search title, slug, technology…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search projects" />
            <div className="btn-group" role="group" aria-label="Filter">
              {(['all', 'published', 'hidden', 'draft', 'archived'] as const).map((f) => <button key={f} type="button" className="btn btn-sm" aria-pressed={filter === f} onClick={() => setFilter(f)}>{f[0].toUpperCase() + f.slice(1)}</button>)}
            </div>
            <span className="spacer" /><span className="a-sub">{shown.length} of {projects.length}</span>
          </div>
          <table className="table">
            <thead><tr><th aria-label="Order" /><th>Project</th><th>Category</th><th>Year</th><th>Status</th><th>Listed</th><th>Featured</th><th /></tr></thead>
            <tbody>
              {shown.map((p, i) => (
                <tr key={p.id} draggable={!query && filter === 'all'} onDragStart={() => setDrag(p.id)} onDragOver={(e) => { e.preventDefault() }} onDrop={() => { if (drag && drag !== p.id) reorder(drag, p.id); setDrag(null) }} style={{ opacity: drag === p.id ? 0.4 : 1 }}>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <span aria-hidden="true" style={{ cursor: 'grab', color: 'var(--a-faint)', marginRight: 6 }}>⠿</span>
                    <button type="button" className="btn btn-sm btn-icon" aria-label={`Move ${p.title} up`} disabled={i === 0} onClick={() => reorder(p.id, shown[i - 1].id)}>↑</button>
                    <button type="button" className="btn btn-sm btn-icon" aria-label={`Move ${p.title} down`} disabled={i === shown.length - 1} onClick={() => reorder(p.id, shown[i + 1].id)}>↓</button>
                  </td>
                  <td><Link href={`/admin/projects/${encodeURIComponent(p.id)}`} style={{ fontWeight: 500 }}>{p.title}</Link><br /><span className="a-mono a-sub">/projects/{p.slug}</span></td>
                  <td>{p.category}</td>
                  <td className="a-mono">{p.year}</td>
                  <td>
                    <select className="input" style={{ minHeight: 28, width: 'auto' }} value={p.status} aria-label={`Status of ${p.title}`} onChange={(e) => patch(p.id, { status: e.target.value as Project['status'] })}>
                      <option value="published">Published</option><option value="draft">Draft</option><option value="archived">Archived</option>
                    </select>{' '}
                    <span className="badge" data-tone={STATUS_TONE[p.status]}>{p.status}</span>
                  </td>
                  <td><label className="check"><input type="checkbox" checked={!p.hidden} onChange={(e) => patch(p.id, { hidden: !e.target.checked })} /> {p.hidden ? 'Hidden' : 'Listed'}</label></td>
                  <td><input type="checkbox" checked={p.featured} aria-label={`${p.title} featured`} onChange={(e) => patch(p.id, { featured: e.target.checked })} /></td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <Link className="btn btn-sm" href={`/admin/projects/${encodeURIComponent(p.id)}`}>Edit</Link>{' '}
                    <button type="button" className="btn btn-sm" onClick={() => {
                      const copy = { ...structuredClone(p), ...blankProject(doc, `${p.title} copy`), ...{ description: p.description, shortDescription: p.shortDescription, technologies: [...p.technologies], category: p.category, source: p.source } }
                      apply((d) => { d.projects.push(copy) })
                      router.push(`/admin/projects/${encodeURIComponent(copy.id)}`)
                    }}>Duplicate</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {shown.length === 0 && <p className="empty">No project matches.</p>}
        </section>
      )}
    </main>
  )
}
