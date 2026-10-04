'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSiteStore } from '../store/site'
import { DraftBar } from '../DraftBar'
import { DraftPreview } from '../DraftPreview'
import { SelectInput } from '../fields'
import { toast } from '../toast'
import { ParamEditor } from '../pages/controls'
import { insertNode, makeNode } from '../pages/ops'
import { EffectSlot } from '@/animations/EffectSlot'
import { CATALOGUE, EFFECT_BY_ID, defaultParams, type EffectDef } from '@/animations/registry'
import type { ElementNode, SiteDocument } from '@/cms/schema'
import { SiteContentProvider } from '@/cms/context'

/* ============================================================
   THE ANIMATION LIBRARY

   Every effect the site has, in one catalogue: the ones built
   into its pages (documented where they live, with their inputs,
   reduced-motion behaviour and cost, and a live look at the real
   page), and the placeable ones — rendered here by the same frame
   and code the public site uses, with every control working on
   the preview. A placed effect is an Animation element in a
   section; only the effects a page actually uses are downloaded
   by its visitors.
   ============================================================ */

const CATEGORY_LABEL: Record<string, string> = { text: 'Text', data: 'Data', 'project-visual': 'Project visuals', shape: 'Shapes', particles: 'Particles', background: 'Backgrounds', interaction: 'Interaction', scroll: 'Scroll', transition: 'Transitions', scene: 'Chapter scenes', navigation: 'Navigation' }
const COST_TONE = { low: 'ok', medium: 'warn', high: 'danger' } as const

function usages(doc: SiteDocument | null, id: string) {
  const out: { section: string; node: ElementNode }[] = []
  const walk = (list: ElementNode[], section: string) => { for (const n of list) { if (n.type === 'animation' && n.props.effect === id) out.push({ section, node: n }); if (n.children) walk(n.children, section) } }
  for (const [section, list] of Object.entries(doc?.additions ?? {})) walk(list, section)
  return out
}

/** Mounts its children only once the card has been on screen. */
function WhenVisible({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect() } }, { rootMargin: '200px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return <div ref={ref} style={{ position: 'absolute', inset: 0 }}>{seen ? children : null}</div>
}

function Card({ e, selected, onSelect, used }: { e: EffectDef; selected: boolean; onSelect: () => void; used: number }) {
  return (
    <div className="lib-card" data-selected={selected || undefined}>
      {/* The thumbnail is decoration: inert, so the controls some effects draw are not reachable inside a card. */}
      <div className="lib-thumb" aria-hidden="true" inert>
        {e.placeable ? <WhenVisible><EffectSlot effect={e.id} params={{ ...defaultParams(e.id), trigger: 'always' }} /></WhenVisible> : <span className="lib-glyph">{e.category === 'scene' ? '◐' : e.category === 'transition' ? '❧' : e.category === 'navigation' ? '☰' : e.category === 'scroll' ? '↕' : e.category === 'background' ? '▨' : '✦'}</span>}
      </div>
      <div className="lib-meta">
        <b>{e.name}</b>
        <span className="a-mono">{e.id}</span>
        <span className="row" style={{ gap: 4 }}>
          <span className="badge">{CATEGORY_LABEL[e.category] ?? e.category}</span>
          <span className="badge" data-tone={COST_TONE[e.cost]}>{e.cost}</span>
          {e.added && <span className="badge" data-tone="accent">new</span>}
          {!e.placeable && <span className="badge">built in</span>}
          {used > 0 && <span className="badge" data-tone="ok">used ×{used}</span>}
        </span>
      </div>
      <button type="button" className="lib-hit" onClick={onSelect} aria-pressed={selected} aria-label={`${e.name} — ${CATEGORY_LABEL[e.category] ?? e.category}`} />
    </div>
  )
}

const SIZES = { S: { w: 360, h: 240 }, M: { w: 560, h: 320 }, L: { w: 820, h: 420 } } as const

function Detail({ e }: { e: EffectDef }) {
  const doc = useSiteStore((s) => s.doc)
  const apply = useSiteStore((s) => s.apply)
  const [params, setParams] = useState<Record<string, unknown>>(() => defaultParams(e.id))
  const [size, setSize] = useState<keyof typeof SIZES>('M')
  const [reduced, setReduced] = useState(false)
  const [dark, setDark] = useState(false)
  const [replay, setReplay] = useState(0)
  const [live, setLive] = useState(false)
  const [target, setTarget] = useState('')
  const used = usages(doc, e.id)
  const sections = doc ? [...doc.journeys.home.sections.map((s) => ({ id: s.id, label: `Home · ${s.title}` })), ...doc.journeys.projects.sections.map((s) => ({ id: s.id, label: `Projects · ${s.title}` }))] : []
  const box = SIZES[size]

  const insert = () => {
    if (!target) { toast('Choose a section first.'); return }
    const node = makeNode('animation')
    node.name = e.name
    node.props = { effect: e.id, params: { ...params } }
    apply((d) => insertNode(d, target, node))
    toast(`Added to ${sections.find((s) => s.id === target)?.label}. Position it in the Page editor, then save.`, 'ok')
  }

  return (
    <div className="lib-detail">
      <header className="stack" style={{ gap: 6 }}>
        <p className="a-label">{CATEGORY_LABEL[e.category] ?? e.category}{e.added ? ' · added with the library' : e.placeable ? '' : ' · built into the site'}</p>
        <h2 style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em' }}>{e.name}</h2>
        <p className="a-sub">{e.description}</p>
      </header>

      {e.placeable ? (
        <>
          <div className="row" style={{ gap: 6 }}>
            <div className="btn-group" role="group" aria-label="Preview size">{(Object.keys(SIZES) as (keyof typeof SIZES)[]).map((k) => <button key={k} type="button" className="btn btn-sm" aria-pressed={size === k} onClick={() => setSize(k)}>{k} · {SIZES[k].w}px</button>)}</div>
            <button type="button" className="btn btn-sm" aria-pressed={reduced} onClick={() => setReduced(!reduced)}>Reduced motion</button>
            <button type="button" className="btn btn-sm" aria-pressed={dark} onClick={() => setDark(!dark)}>Dark backdrop</button>
            <button type="button" className="btn btn-sm" onClick={() => setReplay(replay + 1)}>↻ Replay</button>
          </div>
          <div className="lib-stage" data-dark={dark || undefined}>
            <div className="lib-stage-box" style={{ width: box.w, height: box.h }} data-lib-preview={e.id}>
              <EffectSlot key={`${e.id}-${replay}`} effect={e.id} params={params} reducedMotion={reduced} />
            </div>
          </div>
          <div className="lib-columns">
            <section className="card stack" style={{ gap: 8 }}>
              <div className="row"><h3 style={{ fontSize: 14, fontWeight: 600 }}>Controls</h3><span className="spacer" /><button type="button" className="btn btn-sm btn-ghost" onClick={() => setParams(defaultParams(e.id))}>Reset</button></div>
              <ParamEditor effect={e.id} params={params} onChange={(k, v) => setParams((p) => { const n = { ...p }; if (v === undefined) delete n[k]; else n[k] = v; return n })} />
            </section>
            <section className="stack" style={{ gap: 12 }}>
              <Facts e={e} />
              <section className="card stack" style={{ gap: 8 }}>
                <h3 style={{ fontSize: 14, fontWeight: 600 }}>Place it</h3>
                <select className="input" value={target} onChange={(ev) => setTarget(ev.target.value)} aria-label="Section to add it to">
                  <option value="">Choose a section…</option>
                  {sections.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
                <button type="button" className="btn btn-primary" onClick={insert} disabled={!doc}>Add to the draft with these settings</button>
                <small className="a-sub">It goes into the draft like any edit: save and publish to show it. Visitors only download effects a page uses.</small>
              </section>
              <section className="card stack" style={{ gap: 6 }}>
                <h3 style={{ fontSize: 14, fontWeight: 600 }}>Used in the draft</h3>
                {used.length === 0 ? <p className="a-sub" style={{ fontSize: 12.5 }}>Not placed anywhere yet.</p> : used.map((u) => <p key={u.node.id} style={{ fontSize: 12.5 }}><span className="a-mono">{u.section}</span> · {u.node.name} <Link href="/admin/pages" className="a-sub">open the Page editor →</Link></p>)}
              </section>
            </section>
          </div>
        </>
      ) : (
        <div className="lib-columns">
          <section className="stack" style={{ gap: 12 }}>
            {e.preview && (
              <section className="card stack" style={{ gap: 8 }}>
                <div className="row"><h3 style={{ fontSize: 14, fontWeight: 600 }}>The real thing</h3><span className="spacer" />{!live && <button type="button" className="btn btn-sm" onClick={() => setLive(true)}>Load live preview</button>}</div>
                {e.preview.note && <p className="a-sub" style={{ fontSize: 12.5 }}>{e.preview.note}</p>}
                {live ? (
                  <div style={{ height: 380, border: '1px solid var(--a-line)', borderRadius: 8, overflow: 'hidden' }}>
                    <DraftPreview path={`${e.preview.path}${e.preview.chapter ? `#chapter-${e.preview.chapter}` : ''}`} device="desktop" edit={false} />
                  </div>
                ) : <p className="a-sub" style={{ fontSize: 12.5 }}>Opens {e.preview.path}{e.preview.chapter ? `, at the ${e.preview.chapter} chapter,` : ''} from the draft in a frame here. Built-in effects run on their page’s scroll, so this is the effect itself rather than a copy.</p>}
              </section>
            )}
            {e.id === 'transition.leaves' && <LeafSettings />}
          </section>
          <Facts e={e} />
        </div>
      )}
    </div>
  )
}

function LeafSettings() {
  return (
    <section className="card stack" style={{ gap: 10 }}>
      <h3 style={{ fontSize: 14, fontWeight: 600 }}>Configure</h3>
      <SelectInput path="settings.options.leafCharge" label="Leaf growth" options={[{ value: 'gentle', label: 'Gentle — a longer push' }, { value: 'standard', label: 'Standard' }, { value: 'brisk', label: 'Brisk — a shorter push' }]} />
      <SelectInput path="settings.options.leafParting" label="Leaf parting" options={[{ value: 'slow', label: 'Slow' }, { value: 'standard', label: 'Standard' }, { value: 'quick', label: 'Quick' }]} />
      <p className="a-sub" style={{ fontSize: 12.5 }}>Neither can make the cover incomplete: the world only starts loading after the leaves have been measured covering the whole screen for two presented frames.</p>
      <div className="row"><DraftBar compact /><Link className="btn btn-sm" href="/admin/pages">Test it in the Page editor →</Link></div>
    </section>
  )
}

function Facts({ e }: { e: EffectDef }) {
  const rows: [string, React.ReactNode][] = [
    ['Id', <code key="id" className="a-mono">{e.id}</code>],
    ['Where it can go', e.compatibility],
    ['Small screens', e.responsive],
    ['Reduced motion', e.reducedMotion],
    ['Cost', <span key="c"><span className="badge" data-tone={COST_TONE[e.cost]}>{e.cost}</span> {e.costNote}</span>],
  ]
  if (e.source) rows.push(['Source', <code key="s" className="a-mono" style={{ wordBreak: 'break-all' }}>{e.source}</code>])
  if (e.configuredIn) rows.push(['Configured in', e.configuredIn])
  return (
    <section className="card stack" style={{ gap: 8 }}>
      <h3 style={{ fontSize: 14, fontWeight: 600 }}>Details</h3>
      <dl className="lib-facts">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      {e.inputs && <><h4 className="a-label" style={{ marginTop: 6 }}>Inputs in code today</h4><ul className="lib-inputs">{e.inputs.map((i) => <li key={i}>{i}</li>)}</ul></>}
      {e.placeable && e.params.length > 0 && <><h4 className="a-label" style={{ marginTop: 6 }}>Parameters</h4><ul className="lib-inputs">{e.params.map((p) => <li key={p.key}><code className="a-mono">{p.key}</code> · {p.type}{p.min !== undefined ? ` ${p.min}–${p.max}${p.unit ? ` ${p.unit}` : ''}` : ''}{p.options ? ` (${p.options.map((o) => o.value).join(' · ')})` : ''} · default {String(p.default) || '—'}</li>)}</ul></>}
    </section>
  )
}

function Library() {
  const doc = useSiteStore((s) => s.doc)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<string>('all')
  const [kind, setKind] = useState<'all' | 'placeable' | 'built'>('all')
  const [selected, setSelected] = useState<string>('text.typewriter')
  const categories = useMemo(() => [...new Set(CATALOGUE.map((e) => e.category))], [])
  const list = CATALOGUE.filter((e) => (category === 'all' || e.category === category) && (kind === 'all' || (kind === 'placeable' ? e.placeable : !e.placeable)) && (!query || `${e.name} ${e.id} ${e.description}`.toLowerCase().includes(query.toLowerCase())))
  const counts = { placeable: CATALOGUE.filter((e) => e.placeable).length, added: CATALOGUE.filter((e) => e.added).length, built: CATALOGUE.filter((e) => !e.placeable).length }
  const current = EFFECT_BY_ID[selected]
  return (
    <div className="lib-root">
      <aside className="lib-list">
        <header className="stack" style={{ gap: 8, padding: '16px 14px 10px' }}>
          <p className="a-label">Content</p>
          <h1 className="a-title" style={{ fontSize: 22 }}>Animation library</h1>
          <p className="a-sub" style={{ fontSize: 12.5 }}>{counts.placeable} placeable effects ({counts.added} added with the library, the rest drawn from the site) and {counts.built} built into the pages.</p>
          <input className="input" placeholder="Search effects…" value={query} onChange={(ev) => setQuery(ev.target.value)} aria-label="Search effects" />
          <div className="btn-group" role="group" aria-label="Kind">
            {(['all', 'placeable', 'built'] as const).map((k) => <button key={k} type="button" className="btn btn-sm" aria-pressed={kind === k} onClick={() => setKind(k)}>{k === 'all' ? 'All' : k === 'placeable' ? 'Placeable' : 'Built in'}</button>)}
          </div>
          <select className="input" value={category} onChange={(ev) => setCategory(ev.target.value)} aria-label="Category">
            <option value="all">Every category</option>
            {categories.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c] ?? c}</option>)}
          </select>
        </header>
        <div className="lib-grid">
          {list.map((e) => <Card key={e.id} e={e} selected={e.id === selected} onSelect={() => setSelected(e.id)} used={usages(doc, e.id).length} />)}
          {!list.length && <p className="empty">No effect matches.</p>}
        </div>
      </aside>
      <main className="lib-main">{current ? <Detail key={current.id} e={current} /> : <p className="a-sub">Choose an effect.</p>}</main>
    </div>
  )
}

/* Effects render exactly as on the site, so they get the site's content (project visuals read
   the projects) — the draft's, here. */
export function LibraryAdmin() {
  const { doc, load } = useSiteStore()
  useEffect(() => { void load() }, [load])
  if (!doc) return <main className="a-page"><p className="a-sub">Loading…</p></main>
  return <SiteContentProvider doc={doc}><Library /></SiteContentProvider>
}
