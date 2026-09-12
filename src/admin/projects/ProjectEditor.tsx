'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useSiteStore } from '../store/site'
import { DraftBar } from '../DraftBar'
import type { Device } from '../DraftPreview'
import { EditorFrame, PreviewPane } from '../ui/EditorFrame'
import { Loading, PageHeader, Segmented, Tabs, WEBSITE_TABS } from '../ui/kit'
import { ColorInput, Field, MediaInput, MediaPicker, NumberInput, SelectInput, StringList, TableEditor, TextInput, Toggle, emptyTable, newId } from '../fields'
import { MOTION_COMPONENTS, safeHref, type Project, type ProjectSection } from '@/cms/schema'

/* ============================================================
   ONE PROJECT, EVERY FIELD

   The form edits the project entity in the draft; the preview on
   the right is the real public route for it, re-rendered from the
   draft on every keystroke. Because the homepage cards, the
   universe, the index and the case-study overlay all read this
   same entity, the "Listing" and "Homepage" previews show the same
   edit landing there too.
   ============================================================ */

const TABS = ['Content', 'Details', 'Media', 'Links & SEO', 'Page sections', 'Stack'] as const
type Tab = (typeof TABS)[number]

const CATEGORY = ['ai-ml', 'software', 'web', 'mobile', '3d', 'data', 'university', 'experiment', 'client-work'] as const
const SOURCE = ['personal', 'university', 'client', 'professional'] as const
const SECTION_TYPES: { value: ProjectSection['type']; label: string }[] = [
  { value: 'text', label: 'Text' }, { value: 'facts', label: 'Facts list' }, { value: 'metrics', label: 'Numbers' }, { value: 'gallery', label: 'Image gallery' },
  { value: 'video', label: 'Video' }, { value: 'links', label: 'Links' }, { value: 'table', label: 'Table' },
]

const hrefError = (v: string) => (v && !safeHref.safeParse(v).success ? 'Use http(s)://, mailto:, tel: or a path such as /projects' : null)

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t) }, [value, ms])
  return v
}

function Group({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="a-panel">
      <header className="a-panel-head"><div><h2>{title}</h2></div>{actions}</header>
      <div className="a-panel-body">{children}</div>
    </section>
  )
}

export function ProjectEditor({ id }: { id: string }) {
  const router = useRouter()
  const { status, doc, load, apply } = useSiteStore()
  const [tab, setTab] = useState<Tab>('Content')
  const [device, setDevice] = useState<Device>('laptop')
  const [view, setView] = useState<'page' | 'index' | 'home'>('page')
  useEffect(() => { void load() }, [load])

  const index = doc?.projects.findIndex((p) => p.id === id) ?? -1
  const project = index >= 0 ? doc!.projects[index] : null
  const at = `projects[id=${id}]`
  const slug = useDebounced(project?.slug ?? '', 700)

  if (status !== 'ready' || !doc) return <main className="a-page"><Loading label="Loading the draft…" /></main>
  if (!project) {
    return (
      <main className="a-page">
        <div className="empty"><b>No project with the id “{id}” in this draft.</b><span>It may have been deleted, or the draft was reloaded.</span><Link className="btn" href="/admin/projects">Back to projects</Link></div>
      </main>
    )
  }

  const slugTaken = doc.projects.some((p) => p.id !== id && p.slug === project.slug)
  const remove = () => {
    if (!confirm(`Delete “${project.title}”? Its page, cards and evidence links go with it when you publish. Earlier revisions keep a copy you can restore from History.`)) return
    apply((d) => {
      d.projects = d.projects.filter((p) => p.id !== id)
      for (const t of d.techNodes) t.evidence = t.evidence.filter((e) => e !== id)
      for (const k of Object.keys(d.collections)) d.collections[k] = d.collections[k].filter((e) => e !== id)
    })
    router.push('/admin/projects')
  }

  const previewPath = view === 'page' ? `/projects/${slug || project.slug}` : view === 'index' ? '/projects' : '/'
  const header = (
    <PageHeader
      compact
      eyebrow="Website · Project"
      title={<span className="ed-title"><Link href="/admin/projects" className="ed-back" aria-label="All projects">←</Link>{project.title || 'Untitled'}<span className="badge" data-tone={project.status === 'published' ? (project.hidden ? 'warn' : 'ok') : project.status === 'draft' ? 'warn' : undefined}>{project.status}{project.status === 'published' && project.hidden ? ' · hidden' : ''}</span></span>}
      actions={<DraftBar compact />}
      tabs={<Tabs label="Website" tabs={WEBSITE_TABS} />}
    />
  )
  const form = (
    <div className="ce-form">
      <nav className="ed-formtabs" role="tablist" aria-label="Project fields">
        {TABS.map((t) => <button key={t} type="button" role="tab" aria-selected={tab === t} className="a-tab" onClick={() => setTab(t)}>{t}</button>)}
      </nav>
            {tab === 'Content' && <>
              <Group title="Summary">
                <TextInput path={`${at}.title`} label="Title" maxLength={400} />
                <TextInput path={`${at}.shortTitle`} label="Short title" hint="Used where space is tight (breadcrumbs, the universe)." optional />
                <TextInput path={`${at}.shortDescription`} label="One-line summary" maxLength={200} multiline rows={2} />
                <TextInput path={`${at}.description`} label="Description" multiline rows={6} />
                <TextInput path={`${at}.contribution`} label="Contribution" hint="What you did on it, when it was a team effort." multiline rows={3} optional />
              </Group>
              <Group title="How it works"><StringList path={`${at}.verifiedFacts`} label="Facts" addLabel="Add fact" multiline hint="Only claims you can stand behind: they are shown as facts." /></Group>
              <MetricsEditor at={at} metrics={project.metrics} />
            </>}

            {tab === 'Details' && <>
              <Group title="Publishing">
                <SelectInput path={`${at}.status`} label="Status" options={[{ value: 'published', label: 'Published — on the public site' }, { value: 'draft', label: 'Draft — only in the admin preview' }, { value: 'archived', label: 'Archived — retired, kept here' }]} />
                <Toggle path={`${at}.hidden`} label="Hide from listings" hint="Its page still answers at its address; cards, the universe and the index leave it out." />
                <Toggle path={`${at}.featured`} label="Featured" />
                <NumberInput path={`${at}.order`} label="Order" hint="Lower comes first. Dragging rows in the list rewrites this." />
              </Group>
              <Group title="Address">
                <TextInput path={`${at}.slug`} label="Slug" hint={`/projects/${project.slug}`} validate={(v) => (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(v) ? 'Lowercase words joined by dashes' : slugTaken ? 'Another project already uses this slug' : null)} />
                <Field label="Id" hint="Fixed: evidence, collections and the world refer to it."><input className="input a-mono" value={project.id} readOnly /></Field>
              </Group>
              <Group title="Classification">
                <div className="grid-2">
                  <SelectInput path={`${at}.category`} label="Category" options={CATEGORY} />
                  <TextInput path={`${at}.subcategory`} label="Subcategory" optional />
                  <SelectInput path={`${at}.source`} label="Source" options={SOURCE} />
                  <TextInput path={`${at}.organisation`} label="Organisation" optional />
                  <TextInput path={`${at}.year`} label="Year" />
                  <TextInput path={`${at}.dates`} label="Dates" placeholder="2023 – 2024" optional />
                  <SelectInput path={`${at}.importance`} label="Importance" options={['hero', 'featured', 'archive']} />
                  <TextInput path={`${at}.chapter`} label="Chapter" optional />
                </div>
                <NumberInput path={`${at}.timelinePosition`} label="Timeline position (0–1)" min={0} max={1} step={0.01} />
                <div className="grid-2">
                  <SelectInput path={`${at}.dataStatus`} label="Data status" options={['verified', 'partially-verified', 'placeholder', 'needs-review']} />
                  <SelectInput path={`${at}.assetStatus`} label="Asset status" options={['real', 'generated', 'placeholder', 'none-required']} />
                </div>
                <Toggle path={`${at}.privateSource`} label="Source code is private" hint="Hides the repository link and says so on the page." />
              </Group>
              <Group title="Colour">
                <ColorInput path={`${at}.accent`} label="Accent" />
                <PaletteEditor at={at} palette={project.palette ?? []} />
              </Group>
              <Group title="Danger zone"><div className="row"><button type="button" className="btn btn-danger" onClick={remove}>Delete project</button><span className="a-sub" style={{ fontSize: 12 }}>Prefer Archived to keep it out of the site without losing it.</span></div></Group>
            </>}

            {tab === 'Media' && <>
              <AssetList at={at} kind="screenshots" label="Screenshots" accept="image" list={project.assets.screenshots} hint="The first one is the page's hero image and the card's picture." />
              <AssetList at={at} kind="videos" label="Videos" accept="video" list={project.assets.videos} />
              <Group title="Motion presentation">
                <SelectInput path={`${at}.presentation.type`} label="Type" options={['procedural', 'screenshot-motion', 'hybrid', 'static']} />
                <SelectInput path={`${at}.presentation.motionComponent`} label="Motion piece" options={MOTION_COMPONENTS} hint="The animated visual drawn for the project when it has no screenshot." />
                <TextInput path={`${at}.presentation.concept`} label="Concept" multiline rows={2} />
                <TextInput path={`${at}.presentation.interaction`} label="Interaction" multiline rows={2} />
                <NumberInput path={`${at}.presentation.duration`} label="Loop duration (s)" min={0} max={3600} />
              </Group>
            </>}

            {tab === 'Links & SEO' && <>
              <Group title="Where it lives">
                <TextInput path={`${at}.repository`} label="Repository" optional validate={hrefError} placeholder="https://github.com/…" />
                <TextInput path={`${at}.liveUrl`} label="Live site" optional validate={hrefError} placeholder="https://…" />
                <LinksEditor at={at} links={project.links} />
              </Group>
              <Group title="Search and sharing">
                <TextInput path={`${at}.seo.title`} label="Page title" optional hint={`Defaults to “${project.title}”.`} />
                <TextInput path={`${at}.seo.description`} label="Description" optional multiline rows={3} maxLength={320} hint="Defaults to the one-line summary." />
                <MediaInput path={`${at}.seo.image`} label="Share image" hint="Defaults to the first screenshot." />
              </Group>
            </>}

            {tab === 'Page sections' && <SectionsEditor at={at} sections={project.sections} />}

            {tab === 'Stack' && <>
              <StackEditor id={id} />
              <Group title="Other technologies"><StringList path={`${at}.technologies`} label="Technologies" addLabel="Add technology" hint="Names shown on the page that are not in the toolbox." /></Group>
            </>}
    </div>
  )
  return (
    <EditorFrame
      header={header}
      form={form}
      preview={<PreviewPane path={previewPath} device={device} onDevice={setDevice} tools={<Segmented<'page' | 'index' | 'home'> label="Show" size="sm" value={view} onChange={setView} options={[{ value: 'page', label: 'Project page' }, { value: 'index', label: 'Listing' }, { value: 'home', label: 'Homepage' }]} />} />}
    />
  )
}

/* ---- pieces ------------------------------------------------------- */
/** Changes to the project at `at` (`projects[id=…]`), as one undoable step (or one per field while typing). */
const editorFor = (at: string) => {
  const id = at.slice('projects[id='.length, -1)
  return (mutate: (p: Project) => void, coalesce?: string) => useSiteStore.getState().apply((d) => { const p = d.projects.find((x) => x.id === id); if (p) mutate(p) }, coalesce ? { coalesce } : undefined)
}

function MetricsEditor({ at, metrics }: { at: string; metrics: Project['metrics'] }) {
  const edit = editorFor(at)
  return (
    <Group title="Numbers" actions={<button type="button" className="btn btn-sm" onClick={() => edit((p) => { p.metrics.push({ label: 'Label', value: '0' }) })}>+ Number</button>}>
      {metrics.length === 0 && <p className="a-sub">No numbers. Add only figures you can verify.</p>}
      {metrics.map((m, i) => (
        <div key={i} className="stack" style={{ gap: 8, paddingBottom: 10, borderBottom: '1px solid var(--a-line)' }}>
          <div className="grid-2">
            <TextInput path={`${at}.metrics.${i}.value`} label="Value" />
            <TextInput path={`${at}.metrics.${i}.label`} label="Label" />
          </div>
          <div className="grid-3">
            <TextInput path={`${at}.metrics.${i}.prefix`} label="Prefix" optional />
            <TextInput path={`${at}.metrics.${i}.suffix`} label="Suffix" optional />
            <Field label="Count to"><input className="input" type="number" value={m.numeric ?? ''} onChange={(e) => edit((p) => { p.metrics[i].numeric = Number.isFinite(e.target.valueAsNumber) ? e.target.valueAsNumber : undefined }, `${at}.metrics.${i}.numeric`)} /></Field>
          </div>
          <TextInput path={`${at}.metrics.${i}.note`} label="Note" optional hint="How the number was measured." />
          <div className="row">
            <button type="button" className="btn btn-sm" disabled={i === 0} onClick={() => edit((p) => { [p.metrics[i - 1], p.metrics[i]] = [p.metrics[i], p.metrics[i - 1]] })}>Move up</button>
            <button type="button" className="btn btn-sm btn-danger" onClick={() => edit((p) => { p.metrics.splice(i, 1) })}>Remove</button>
          </div>
        </div>
      ))}
    </Group>
  )
}

function PaletteEditor({ at, palette }: { at: string; palette: string[] }) {
  const edit = editorFor(at)
  return (
    <Field label="Brand palette" hint="Client work: the gallery tints the site with these.">
      <div className="row">
        {palette.map((c, i) => (
          <span key={i} className="row" style={{ gap: 2 }}>
            <input type="color" value={/^#[0-9a-f]{6}$/i.test(c) ? c : '#000000'} aria-label={`Palette colour ${i + 1}`} onChange={(e) => edit((p) => { p.palette![i] = e.target.value }, `${at}.palette.${i}`)} style={{ width: 30, height: 28, padding: 0, border: '1px solid var(--a-line-strong)', borderRadius: 5 }} />
            <button type="button" className="btn btn-sm btn-icon" aria-label="Remove colour" onClick={() => edit((p) => { p.palette!.splice(i, 1); if (!p.palette!.length) delete p.palette })}>✕</button>
          </span>
        ))}
        {palette.length < 6 && <button type="button" className="btn btn-sm" onClick={() => edit((p) => { (p.palette ??= []).push('#bf4f27') })}>+ Colour</button>}
      </div>
    </Field>
  )
}

function AssetList({ at, kind, label, list, accept, hint }: { at: string; kind: 'screenshots' | 'videos'; label: string; list: string[]; accept: 'image' | 'video'; hint?: string }) {
  const edit = editorFor(at)
  const [open, setOpen] = useState(false)
  return (
    <Group title={label} actions={<button type="button" className="btn btn-sm" onClick={() => setOpen(true)}>+ From library</button>}>
      {hint && <small className="a-sub">{hint}</small>}
      {list.length === 0 && <p className="a-sub">None yet.</p>}
      {list.map((src, i) => (
        <div key={`${src}-${i}`} className="row" style={{ alignItems: 'center' }}>
          {accept === 'image' ? <img src={src} alt="" style={{ width: 72, height: 50, objectFit: 'cover', borderRadius: 5, border: '1px solid var(--a-line)', background: 'var(--a-sunk)' }} /> : <span className="badge">video</span>}
          <input className="input a-mono" style={{ flex: 1 }} value={src} aria-label={`${label} ${i + 1}`} onChange={(e) => edit((p) => { p.assets[kind][i] = e.target.value }, `${at}.assets.${kind}.${i}`)} />
          <button type="button" className="btn btn-sm btn-icon" aria-label="Move up" disabled={i === 0} onClick={() => edit((p) => { const l = p.assets[kind]; [l[i - 1], l[i]] = [l[i], l[i - 1]] })}>↑</button>
          <button type="button" className="btn btn-sm btn-icon" aria-label="Remove" onClick={() => edit((p) => { p.assets[kind].splice(i, 1) })}>✕</button>
        </div>
      ))}
      <MediaPicker open={open} accept={accept} onClose={() => setOpen(false)} onPick={(m) => { edit((p) => { p.assets[kind].push(m.url); if (p.assetStatus === 'none-required' || p.assetStatus === 'placeholder') p.assetStatus = 'real' }); setOpen(false) }} />
    </Group>
  )
}

function LinksEditor({ at, links }: { at: string; links: Project['links'] }) {
  const edit = editorFor(at)
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row"><span className="a-sub" style={{ fontSize: 12 }}>Other links</span><span className="spacer" /><button type="button" className="btn btn-sm" onClick={() => edit((p) => { p.links.push({ label: 'Link', href: 'https://' }) })}>+ Link</button></div>
      {links.map((l, i) => (
        <div key={i} className="row" style={{ alignItems: 'start' }}>
          <input className="input" style={{ width: 130 }} value={l.label} aria-label={`Link ${i + 1} label`} onChange={(e) => edit((p) => { p.links[i].label = e.target.value }, `${at}.links.${i}.label`)} />
          <input className="input" style={{ flex: 1 }} value={l.href} aria-label={`Link ${i + 1} address`} aria-invalid={!!hrefError(l.href)} onChange={(e) => edit((p) => { p.links[i].href = e.target.value }, `${at}.links.${i}.href`)} />
          <button type="button" className="btn btn-sm btn-icon" aria-label="Remove link" onClick={() => edit((p) => { p.links.splice(i, 1) })}>✕</button>
        </div>
      ))}
    </div>
  )
}

function StackEditor({ id }: { id: string }) {
  const nodes = useSiteStore((s) => s.doc!.techNodes)
  const [q, setQ] = useState('')
  const sorted = useMemo(() => nodes.slice().sort((a, b) => Number(b.evidence.includes(id)) - Number(a.evidence.includes(id)) || a.name.localeCompare(b.name)), [nodes, id])
  return (
    <Group title="Toolbox evidence">
      <small className="a-sub">Ticking a technology lists this project as evidence for it in the toolbox, and shows the technology on the project&apos;s page.</small>
      <input className="input" placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter technologies" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 4, maxHeight: 360, overflow: 'auto' }}>
        {sorted.filter((t) => !q || t.name.toLowerCase().includes(q.toLowerCase())).map((t) => (
          <label key={t.id} className="check" style={{ fontSize: 12.5 }}>
            <input type="checkbox" checked={t.evidence.includes(id)} onChange={(e) => useSiteStore.getState().apply((d) => {
              const n = d.techNodes.find((x) => x.id === t.id)!
              n.evidence = e.target.checked ? [...n.evidence, id] : n.evidence.filter((x) => x !== id)
            })} />
            {t.name}
          </label>
        ))}
      </div>
    </Group>
  )
}

function SectionsEditor({ at, sections }: { at: string; sections: ProjectSection[] }) {
  const edit = editorFor(at)
  const [type, setType] = useState<ProjectSection['type']>('text')
  const [picker, setPicker] = useState<number | null>(null)
  const add = () => edit((p) => {
    const s: ProjectSection = { id: newId('s'), type, title: SECTION_TYPES.find((t) => t.value === type)!.label, hidden: false }
    if (type === 'text') s.body = ''
    else if (type === 'table') s.table = emptyTable()
    else s.items = []
    p.sections.push(s)
  })
  return (
    <>
      <section className="card row">
        <span className="a-sub" style={{ fontSize: 12.5 }}>Sections appear on the project&apos;s page below its summary, in this order.</span>
        <span className="spacer" />
        <select className="input" style={{ width: 'auto' }} value={type} onChange={(e) => setType(e.target.value as ProjectSection['type'])} aria-label="New section type">
          {SECTION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <button type="button" className="btn btn-sm btn-primary" onClick={add}>+ Add section</button>
      </section>
      {sections.length === 0 && <p className="empty">No extra sections.</p>}
      {sections.map((s, i) => (
        <Group key={s.id} title={`${SECTION_TYPES.find((t) => t.value === s.type)?.label} · ${s.title || 'Untitled'}`} actions={
          <div className="row" style={{ gap: 4 }}>
            <button type="button" className="btn btn-sm btn-icon" aria-label="Move section up" disabled={i === 0} onClick={() => edit((p) => { [p.sections[i - 1], p.sections[i]] = [p.sections[i], p.sections[i - 1]] })}>↑</button>
            <button type="button" className="btn btn-sm btn-icon" aria-label="Move section down" disabled={i === sections.length - 1} onClick={() => edit((p) => { [p.sections[i + 1], p.sections[i]] = [p.sections[i], p.sections[i + 1]] })}>↓</button>
            <button type="button" className="btn btn-sm" aria-pressed={s.hidden} onClick={() => edit((p) => { p.sections[i].hidden = !p.sections[i].hidden })}>{s.hidden ? 'Hidden' : 'Hide'}</button>
            <button type="button" className="btn btn-sm" onClick={() => edit((p) => { p.sections.splice(i + 1, 0, { ...structuredClone(p.sections[i]), id: newId('s') }) })}>Duplicate</button>
            <button type="button" className="btn btn-sm btn-danger" onClick={() => { if (confirm('Remove this section?')) edit((p) => { p.sections.splice(i, 1) }) }}>Remove</button>
          </div>
        }>
          <TextInput path={`${at}.sections.${i}.title`} label="Heading" />
          {s.type === 'text' && <TextInput path={`${at}.sections.${i}.body`} label="Text" multiline rows={6} hint="Line breaks are kept." />}
          {s.type === 'table' && s.table && <TableEditor value={s.table} onChange={(next, coalesce) => edit((p) => { p.sections[i].table = next }, coalesce ? `${at}.sections.${i}.table.${coalesce}` : undefined)} />}
          {s.type !== 'text' && s.type !== 'table' && (
            <div className="stack" style={{ gap: 8 }}>
              {(s.items ?? []).map((it, j) => (
                <div key={j} className="row" style={{ alignItems: 'start' }}>
                  {(s.type === 'gallery' || s.type === 'video') && <>
                    {s.type === 'gallery' && it.src && <img src={it.src} alt="" style={{ width: 52, height: 38, objectFit: 'cover', borderRadius: 4 }} />}
                    <input className="input a-mono" style={{ flex: 1, minWidth: 140 }} placeholder="/media/…" value={it.src ?? ''} aria-label="File" onChange={(e) => edit((p) => { p.sections[i].items![j].src = e.target.value }, `${at}.s${i}.${j}.src`)} />
                    <button type="button" className="btn btn-sm" onClick={() => setPicker(i * 1000 + j)}>Library</button>
                    <input className="input" style={{ flex: 1, minWidth: 120 }} placeholder="Alt text" value={it.alt ?? ''} aria-label="Alternative text" onChange={(e) => edit((p) => { p.sections[i].items![j].alt = e.target.value }, `${at}.s${i}.${j}.alt`)} />
                  </>}
                  {s.type === 'links' && <input className="input" style={{ flex: 1 }} placeholder="https://…" value={it.href ?? ''} aria-label="Address" aria-invalid={!!hrefError(it.href ?? '')} onChange={(e) => edit((p) => { p.sections[i].items![j].href = e.target.value }, `${at}.s${i}.${j}.href`)} />}
                  {s.type === 'facts' && <textarea className="input" style={{ flex: 1 }} rows={2} value={it.value ?? ''} aria-label={`Fact ${j + 1}`} onChange={(e) => edit((p) => { p.sections[i].items![j].value = e.target.value }, `${at}.s${i}.${j}.value`)} />}
                  {s.type === 'metrics' && <input className="input" style={{ width: 110 }} placeholder="Value" value={it.value ?? ''} aria-label="Value" onChange={(e) => edit((p) => { p.sections[i].items![j].value = e.target.value }, `${at}.s${i}.${j}.value`)} />}
                  {s.type !== 'facts' && <input className="input" style={{ flex: 1, minWidth: 100 }} placeholder={s.type === 'links' ? 'Label' : 'Caption'} value={it.label ?? ''} aria-label="Label" onChange={(e) => edit((p) => { p.sections[i].items![j].label = e.target.value }, `${at}.s${i}.${j}.label`)} />}
                  <button type="button" className="btn btn-sm btn-icon" aria-label="Remove item" onClick={() => edit((p) => { p.sections[i].items!.splice(j, 1) })}>✕</button>
                </div>
              ))}
              <div><button type="button" className="btn btn-sm" onClick={() => edit((p) => { (p.sections[i].items ??= []).push({}) })}>+ Item</button></div>
            </div>
          )}
        </Group>
      ))}
      <MediaPicker open={picker !== null} accept={picker !== null && sections[Math.floor(picker / 1000)]?.type === 'video' ? 'video' : 'image'} onClose={() => setPicker(null)} onPick={(m) => {
        const i = Math.floor(picker! / 1000), j = picker! % 1000
        edit((p) => { const it = p.sections[i].items![j]; it.src = m.url; if (!it.alt && m.alt) it.alt = m.alt })
        setPicker(null)
      }} />
    </>
  )
}
