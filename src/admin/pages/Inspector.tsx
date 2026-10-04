'use client'

import { useState, type ReactNode } from 'react'
import { useSiteStore } from '../store/site'
import { MediaPicker, TableEditor } from '../fields'
import { safeHref, safeSrc, type ElementNode, type SiteDocument, type StyleProps, type TableData } from '@/cms/schema'
import { CATALOGUE as EFFECTS, EFFECT_BY_ID, defaultParams } from '@/animations/registry'
import { ColorField, LengthField, NumberField, ParamEditor, Row, Segmented, SelectField, TextField } from './controls'
import { SCOPE_LABEL, frame, scopeOf, useEditor, type Computed } from './state'
import { clearScope, effectiveStyle, findNode, flag, inheritedFrom, isSection, isSlot, ownStyle, propOf, resetText, setFlag, setProp, setStyle, setText, textOf, type Scope } from './ops'
import { deleteSelection, duplicateSelection, groupSelection, ungroupSelection } from './actions'

const TEXT_KINDS = new Set(['text', 'heading', 'button', 'link', 'metric'])
const BOX_KINDS = new Set(['container', 'section', 'card'])
const COMPUTED_KEY: Partial<Record<keyof StyleProps, string>> = { background: 'backgroundColor' }

function Panel({ title, children, open: initial = true, extra }: { title: string; children: ReactNode; open?: boolean; extra?: ReactNode }) {
  const [open, setOpen] = useState(initial)
  return (
    <section className="pe-panel">
      <header className="pe-panel-head">
        <button type="button" className="pe-disclose" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? '▾' : '▸'} {title}</button>
        {extra}
      </header>
      {open && <div className="pe-panel-body">{children}</div>}
    </section>
  )
}

/** Style reading and writing for one element at the active breakpoint. */
function useStyle(id: string) {
  const doc = useSiteStore((s) => s.doc)!
  const device = useEditor((s) => s.device)
  const computed = useEditor((s) => s.computed)
  const scope = scopeOf(device)
  const own = ownStyle(doc, id, scope)
  const eff = effectiveStyle(doc, id, scope)
  const comp: Computed | null = computed?.id === id ? computed.style : null
  const write = (patch: Partial<Record<keyof StyleProps, unknown>>) => useSiteStore.getState().apply((d) => setStyle(d, id, scope, patch), { coalesce: `style:${id}:${scope}:${Object.keys(patch).join(',')}` })
  const placeholder = (key: keyof StyleProps): string | undefined => {
    if (own[key] !== undefined) return undefined
    const from = inheritedFrom(doc, id, scope, key)
    if (from && eff[key] !== undefined) return `${eff[key]} · ${from === 'base' ? 'all sizes' : from}`
    if (!comp) return undefined
    if (key === 'translateX' || key === 'translateY') { const [x = '0px', y = '0px'] = (comp.translate === 'none' ? '' : comp.translate ?? '').split(' '); return key === 'translateX' ? x || '0px' : y || '0px' }
    if (key === 'rotate') return comp.rotate === 'none' ? '0' : comp.rotate?.replace('deg', '')
    const v = comp[COMPUTED_KEY[key] ?? key]
    return v && v !== 'normal' && v !== 'none' && v !== 'auto' ? v : v
  }
  const length = (key: keyof StyleProps, label: string) => <LengthField key={key} field={key} label={label} value={own[key] as string | undefined} placeholder={placeholder(key)} onChange={(v) => write({ [key]: v })} onReset={() => write({ [key]: undefined })} />
  const color = (key: keyof StyleProps, label: string) => <ColorField key={key} label={label} value={own[key] as string | undefined} placeholder={placeholder(key)} onChange={(v) => write({ [key]: v })} onReset={() => write({ [key]: undefined })} />
  return { doc, scope, own, eff, write, placeholder, length, color }
}

/* ---- the panels ------------------------------------------------------ */
function LayoutPanel({ id, node, kind }: { id: string; node: ElementNode | null; kind: string }) {
  const { own, write, placeholder, length } = useStyle(id)
  const anchored = node?.layout.mode === 'anchored'
  const box = BOX_KINDS.has(kind) || isSlot(id) || node?.type === 'container' || node?.type === 'card'
  const flex = (own.display ?? placeholder('display'))?.includes('flex')
  const grid = (own.display ?? placeholder('display'))?.includes('grid')
  const pin = (h: 'left' | 'center' | 'right', v: 'top' | 'middle' | 'bottom') => write({
    left: h === 'left' ? '4%' : h === 'center' ? '50%' : undefined, right: h === 'right' ? '4%' : undefined,
    top: v === 'top' ? '8%' : v === 'middle' ? '50%' : undefined, bottom: v === 'bottom' ? '8%' : undefined,
    translateX: h === 'center' ? '-50%' : undefined, translateY: v === 'middle' ? '-50%' : undefined,
  })
  return (
    <Panel title="Layout">
      {node && (
        <Segmented label="Placement" value={node.layout.mode} options={[{ value: 'flow', label: 'In flow', title: 'Sits in its container’s layout' }, { value: 'anchored', label: 'Anchored', title: 'Pinned against the section’s edges' }]}
          onChange={(v) => useSiteStore.getState().apply((d) => { const f = findNode(d, id); if (f && v) f.node.layout.mode = v })} />
      )}
      {anchored && <>
        <Row label="Anchor">
          <div className="pe-anchor" role="group" aria-label="Pin to">
            {(['top', 'middle', 'bottom'] as const).map((v) => (['left', 'center', 'right'] as const).map((h) => <button key={`${v}-${h}`} type="button" title={`${v} ${h}`} aria-label={`Pin ${v} ${h}`} onClick={() => pin(h, v)} />))}
          </div>
        </Row>
        <div className="pe-grid2">{length('top', 'Top')}{length('right', 'Right')}{length('bottom', 'Bottom')}{length('left', 'Left')}</div>
      </>}
      <div className="pe-grid2">{length('width', 'Width')}{length('height', 'Height')}{length('maxWidth', 'Max width')}{length('minHeight', 'Min height')}</div>
      <div className="pe-grid2">{length('padding', 'Padding')}{length('margin', 'Margin')}</div>
      {box && <>
        <SelectField label="Display" value={own.display} placeholder={placeholder('display')} options={['block', 'flex', 'grid', 'inline-block', 'none'] as const} onChange={(v) => write({ display: v })} onReset={() => write({ display: undefined })} />
        {flex && <>
          <Segmented label="Direction" value={own.flexDirection} options={[{ value: 'row', label: '→' , title: 'Row' }, { value: 'column', label: '↓', title: 'Column' }, { value: 'row-reverse', label: '←', title: 'Row, reversed' }, { value: 'column-reverse', label: '↑', title: 'Column, reversed' }]} onChange={(v) => write({ flexDirection: v })} onReset={() => write({ flexDirection: undefined })} />
          <Segmented label="Wrap" value={own.flexWrap} options={[{ value: 'nowrap', label: 'No wrap' }, { value: 'wrap', label: 'Wrap' }]} onChange={(v) => write({ flexWrap: v })} onReset={() => write({ flexWrap: undefined })} />
        </>}
        {grid && <TextField label="Columns" value={own.gridTemplateColumns} placeholder={placeholder('gridTemplateColumns') ?? 'repeat(3, 1fr)'} onChange={(v) => { if (!v || /^[\w\s().,%-]+$/.test(v)) write({ gridTemplateColumns: v || undefined }) }} />}
        {(flex || grid) && <>
          <SelectField label="Justify" value={own.justifyContent} placeholder={placeholder('justifyContent')} options={['flex-start', 'center', 'flex-end', 'space-between', 'space-around', 'space-evenly', 'stretch'] as const} onChange={(v) => write({ justifyContent: v })} onReset={() => write({ justifyContent: undefined })} />
          <SelectField label="Align" value={own.alignItems} placeholder={placeholder('alignItems')} options={['flex-start', 'center', 'flex-end', 'stretch', 'baseline'] as const} onChange={(v) => write({ alignItems: v })} onReset={() => write({ alignItems: undefined })} />
          {length('gap', 'Gap')}
        </>}
      </>}
    </Panel>
  )
}

function PositionPanel({ id }: { id: string }) {
  const { own, write, placeholder, length } = useStyle(id)
  return (
    <Panel title="Position" extra={(own.translateX || own.translateY || own.rotate !== undefined) ? <button type="button" className="btn btn-sm btn-ghost" onClick={() => write({ translateX: undefined, translateY: undefined, rotate: undefined })}>Reset</button> : undefined}>
      <div className="pe-grid2">{length('translateX', 'Offset X')}{length('translateY', 'Offset Y')}</div>
      <div className="pe-grid2">
        <NumberField label="Rotate (°)" value={own.rotate} placeholder={placeholder('rotate')} min={-360} max={360} onChange={(v) => write({ rotate: v })} onReset={() => write({ rotate: undefined })} />
        <NumberField label="Layer (z)" value={own.zIndex} placeholder={placeholder('zIndex')} min={-10} max={100} onChange={(v) => write({ zIndex: v === undefined ? undefined : Math.round(v) })} onReset={() => write({ zIndex: undefined })} />
      </div>
    </Panel>
  )
}

function TypePanel({ id }: { id: string }) {
  const { own, write, placeholder, length, color } = useStyle(id)
  return (
    <Panel title="Typography">
      <SelectField label="Typeface" value={own.fontFamily} placeholder={placeholder('fontFamily')?.split(',')[0]} options={[{ value: 'display', label: 'Display (Geist)' }, { value: 'mono', label: 'Mono (Geist Mono)' }, { value: 'serif', label: 'Serif' }, { value: 'inherit', label: 'Inherit' }] as const} onChange={(v) => write({ fontFamily: v })} onReset={() => write({ fontFamily: undefined })} />
      <div className="pe-grid2">
        {length('fontSize', 'Size')}
        <SelectField label="Weight" value={own.fontWeight} placeholder={placeholder('fontWeight')} options={['300', '400', '500', '600', '700', '800'] as const} onChange={(v) => write({ fontWeight: v })} onReset={() => write({ fontWeight: undefined })} />
        <LineField id={id} k="lineHeight" label="Line height" />
        <LineField id={id} k="letterSpacing" label="Tracking" />
      </div>
      <Segmented label="Align" value={own.textAlign} options={[{ value: 'left', label: '⇤', title: 'Left' }, { value: 'center', label: '↔', title: 'Centre' }, { value: 'right', label: '⇥', title: 'Right' }, { value: 'justify', label: '≡', title: 'Justify' }]} onChange={(v) => write({ textAlign: v })} onReset={() => write({ textAlign: undefined })} />
      <div className="pe-grid2">
        <SelectField label="Case" value={own.textTransform} placeholder={placeholder('textTransform')} options={['none', 'uppercase', 'lowercase', 'capitalize'] as const} onChange={(v) => write({ textTransform: v })} onReset={() => write({ textTransform: undefined })} />
        <SelectField label="Style" value={own.fontStyle} placeholder={placeholder('fontStyle')} options={['normal', 'italic'] as const} onChange={(v) => write({ fontStyle: v })} onReset={() => write({ fontStyle: undefined })} />
      </div>
      {color('color', 'Colour')}
    </Panel>
  )
}

/** line-height and letter-spacing have their own, narrower patterns in the schema. */
function LineField({ id, k, label }: { id: string; k: 'lineHeight' | 'letterSpacing'; label: string }) {
  const { own, write, placeholder } = useStyle(id)
  const pattern = k === 'lineHeight' ? /^(normal|\d*\.?\d+(px|rem|em|%)?)$/ : /^(normal|-?\d*\.?\d+(px|rem|em))$/
  return <TextField label={label} value={own[k]} placeholder={placeholder(k)} onChange={(v) => { if (!v) write({ [k]: undefined }); else if (pattern.test(v)) write({ [k]: v }) }} />
}

function AppearancePanel({ id }: { id: string }) {
  const { own, write, placeholder, length, color } = useStyle(id)
  return (
    <Panel title="Appearance">
      {color('background', 'Fill')}
      <div className="pe-grid2">
        {length('borderRadius', 'Radius')}
        <NumberField label="Opacity" value={own.opacity} placeholder={placeholder('opacity')} min={0} max={1} step={0.05} onChange={(v) => write({ opacity: v })} onReset={() => write({ opacity: undefined })} />
      </div>
    </Panel>
  )
}

function OverridesPanel({ id }: { id: string }) {
  const doc = useSiteStore((s) => s.doc)!
  const device = useEditor((s) => s.device)
  const scope = scopeOf(device)
  const keys = Object.keys(ownStyle(doc, id, scope))
  const other = (['base', 'tablet', 'mobile'] as Scope[]).filter((s) => s !== scope && Object.keys(ownStyle(doc, id, s)).length)
  return (
    <Panel title={`Set at this size · ${keys.length}`} open={false}>
      <p className="a-sub" style={{ fontSize: 11.5 }}>{SCOPE_LABEL[scope]}. {scope === 'base' ? 'Tablet and mobile inherit these unless they set their own.' : 'These replace the wider sizes’ values below this width.'}</p>
      {keys.length ? <p className="a-mono" style={{ fontSize: 11 }}>{keys.join(' · ')}</p> : <p className="a-sub" style={{ fontSize: 12 }}>Nothing set at this size.</p>}
      {other.length > 0 && <p className="a-sub" style={{ fontSize: 11.5 }}>Also set for: {other.map((s) => (s === 'base' ? 'all sizes' : s)).join(', ')}.</p>}
      {keys.length > 0 && <button type="button" className="btn btn-sm btn-danger" onClick={() => useSiteStore.getState().apply((d) => clearScope(d, id, scope))}>Clear everything at this size</button>}
    </Panel>
  )
}

/* ---- content ------------------------------------------------------------ */
function ContentPanel({ id, node, kind, bind }: { id: string; node: ElementNode | null; kind: string; bind?: string }) {
  const doc = useSiteStore((s) => s.doc)!
  const apply = useSiteStore((s) => s.apply)
  const treeText = useEditor((s) => s.tree.find((n) => n.id === id)?.text ?? '')
  const [picker, setPicker] = useState<null | 'src' | 'poster' | 'image'>(null)
  const prop = (k: string) => (node ? node.props[k] : propOf(doc, id, k)) as string | undefined
  const writeProp = (k: string, v: unknown, coalesce = true) => apply((d) => setProp(d, id, k, v), coalesce ? { coalesce: `prop:${id}:${k}` } : undefined)
  const type = node?.type
  const { text, rich } = textOf(doc, id, bind)
  const showText = TEXT_KINDS.has(kind) || type === 'card' || type === 'heading' || type === 'text' || type === 'button'
  const overridden = !node && !bind && doc.elements[id]?.text !== undefined

  return (
    <Panel title="Content">
      {showText && (
        <div className="stack" style={{ gap: 6 }}>
          <textarea className="input" rows={3} value={text ?? treeText} aria-label="Text" onChange={(e) => apply((d) => setText(d, id, e.target.value, bind), { coalesce: `text:${id}` })} />
          {bind && <small className="a-sub" style={{ fontSize: 11.5 }}>Bound to <code className="a-mono">{bind}</code>: changing it here changes it everywhere it appears.</small>}
          {rich && <small className="a-sub" style={{ fontSize: 11.5 }}>This text has bold, italic or links; editing it here keeps the words and drops that formatting.</small>}
          {overridden && <button type="button" className="btn btn-sm" onClick={() => apply((d) => resetText(d, id))}>Restore the original text</button>}
          <small className="a-sub" style={{ fontSize: 11.5 }}>Tip: double-click the text on the page to edit it in place.</small>
        </div>
      )}
      {type === 'heading' && <SelectField label="Level" value={String(node!.props.level ?? 2) as '1'} options={['1', '2', '3', '4', '5', '6'] as const} onChange={(v) => writeProp('level', Number(v ?? 2), false)} />}
      {(kind === 'link' || kind === 'button' || type === 'button' || type === 'card') && (
        <Row label="Link">
          <input className="input pe-input" value={prop('href') ?? ''} placeholder="/projects or https://…" aria-label="Link address" aria-invalid={!!prop('href') && !safeHref.safeParse(prop('href')).success} onChange={(e) => writeProp('href', e.target.value || undefined)} />
        </Row>
      )}
      {type === 'button' && <Segmented label="Style" value={(node!.props.variant as 'solid') ?? 'solid'} options={[{ value: 'solid', label: 'Solid' }, { value: 'outline', label: 'Outline' }, { value: 'text', label: 'Text' }]} onChange={(v) => writeProp('variant', v ?? 'solid', false)} />}
      {(type === 'image' || type === 'video' || type === 'card') && (
        <Row label={type === 'card' ? 'Image' : 'File'}>
          <div className="pe-inline">
            <input className="input pe-input" value={prop(type === 'card' ? 'image' : 'src') ?? ''} placeholder="/media/…" aria-label="File address" aria-invalid={!!prop(type === 'card' ? 'image' : 'src') && !safeSrc.safeParse(prop(type === 'card' ? 'image' : 'src')).success} onChange={(e) => writeProp(type === 'card' ? 'image' : 'src', e.target.value || undefined)} />
            <button type="button" className="btn btn-sm" onClick={() => setPicker(type === 'card' ? 'image' : 'src')}>Library</button>
          </div>
        </Row>
      )}
      {(type === 'image' || type === 'card') && <TextField label="Alt text" value={prop('alt')} placeholder="Describe the image (empty if decorative)" onChange={(v) => writeProp('alt', v || undefined)} />}
      {(type === 'image' || type === 'video') && <TextField label="Caption" value={prop('caption')} onChange={(v) => writeProp('caption', v || undefined)} />}
      {type === 'video' && <>
        <Row label="Poster"><div className="pe-inline"><input className="input pe-input" value={prop('poster') ?? ''} aria-label="Poster image" onChange={(e) => writeProp('poster', e.target.value || undefined)} /><button type="button" className="btn btn-sm" onClick={() => setPicker('poster')}>Library</button></div></Row>
        <TextField label="Description" value={prop('label')} placeholder="What the video shows" onChange={(v) => writeProp('label', v || undefined)} />
        <Row label="Playback">
          <div className="pe-inline" style={{ flexWrap: 'wrap', gap: 10 }}>
            {(['controls', 'autoplay', 'loop'] as const).map((k) => <label key={k} className="check" style={{ fontSize: 12 }}><input type="checkbox" checked={k === 'controls' ? node!.props.controls !== false : !!node!.props[k]} onChange={(e) => writeProp(k, e.target.checked, false)} />{k}</label>)}
          </div>
        </Row>
        <small className="a-sub" style={{ fontSize: 11.5 }}>Autoplaying video is muted, and pauses under reduced motion only if you leave autoplay off.</small>
      </>}
      {type === 'card' && <>
        <TextField label="Title" value={prop('title')} onChange={(v) => writeProp('title', v)} />
        <TextField label="Eyebrow" value={prop('eyebrow')} onChange={(v) => writeProp('eyebrow', v || undefined)} />
      </>}
      {type === 'table' && <TableEditor value={(node!.props.table as TableData)} onChange={(next, coalesce) => apply((d) => { const f = findNode(d, id); if (f) f.node.props.table = next }, coalesce ? { coalesce: `table:${id}:${coalesce}` } : undefined)} />}
      {type === 'animation' && <AnimationContent id={id} node={node!} />}
      {!showText && !type && kind !== 'section' && <p className="a-sub" style={{ fontSize: 12 }}>This element’s content comes from the code; you can restyle, move, resize or hide it.</p>}
      <MediaPicker open={picker !== null} accept={type === 'video' && picker === 'src' ? 'video' : 'image'} onClose={() => setPicker(null)} onPick={(m) => { writeProp(picker!, m.url, false); if ((type === 'image' || type === 'card') && !prop('alt') && m.alt) writeProp('alt', m.alt, false); setPicker(null) }} />
    </Panel>
  )
}

function AnimationContent({ id, node }: { id: string; node: ElementNode }) {
  const apply = useSiteStore((s) => s.apply)
  const effect = String(node.props.effect ?? '')
  const params = (node.props.params as Record<string, unknown>) ?? {}
  const def = EFFECT_BY_ID[effect]
  return (
    <div className="stack" style={{ gap: 8 }}>
      <Row label="Effect">
        <select className="input pe-input" value={effect} aria-label="Effect" onChange={(e) => apply((d) => { const f = findNode(d, id); if (f) { f.node.props.effect = e.target.value; f.node.props.params = defaultParams(e.target.value); f.node.name = EFFECT_BY_ID[e.target.value]?.name ?? f.node.name } })}>
          {[...new Set(EFFECTS.filter((x) => x.placeable).map((x) => x.category))].map((c) => (
            <optgroup key={c} label={c}>{EFFECTS.filter((x) => x.placeable && x.category === c).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</optgroup>
          ))}
        </select>
      </Row>
      {def && <small className="a-sub" style={{ fontSize: 11.5 }}>{def.description} Cost: {def.cost}. Reduced motion: {def.reducedMotion}</small>}
      <TextField label="Description" value={node.props.label as string | undefined} placeholder="Leave empty if decorative" onChange={(v) => apply((d) => { const f = findNode(d, id); if (f) { if (v) f.node.props.label = v; else delete f.node.props.label } }, { coalesce: `label:${id}` })} />
      <ParamEditor effect={effect} params={params} onChange={(k, v) => apply((d) => {
        const f = findNode(d, id)
        if (!f) return
        const p = { ...((f.node.props.params as Record<string, unknown>) ?? {}) }
        if (v === undefined) delete p[k]; else p[k] = v
        f.node.props.params = p
      }, { coalesce: `param:${id}:${k}` })} />
    </div>
  )
}

/* ---- sections ------------------------------------------------------------- */
function SectionInspector({ id }: { id: string }) {
  const doc = useSiteStore((s) => s.doc)!
  const apply = useSiteStore((s) => s.apply)
  const page = useEditor((s) => s.page)
  const chapter = id.slice('section.'.length)
  const journey = page.journey
  const index = journey ? doc.journeys[journey].sections.findIndex((s) => s.id === chapter) : -1
  const s = index >= 0 ? doc.journeys[journey!].sections[index] : null
  const at = (d: SiteDocument) => d.journeys[journey!].sections[index]
  return (
    <>
      {s && (
        <Panel title="Section">
          <TextField label="Title" value={s.title} onChange={(v) => apply((d) => { at(d).title = v }, { coalesce: `sec:${chapter}:title` })} />
          <TextField label="Index label" value={s.label} onChange={(v) => apply((d) => { at(d).label = v }, { coalesce: `sec:${chapter}:label` })} />
          <TextField label="Subtitle" value={s.subtitle} onChange={(v) => apply((d) => { if (v) at(d).subtitle = v; else delete at(d).subtitle }, { coalesce: `sec:${chapter}:subtitle` })} />
          <div className="pe-grid2">
            <TextField label="Group" value={s.group} onChange={(v) => apply((d) => { at(d).group = v }, { coalesce: `sec:${chapter}:group` })} />
            <TextField label="Year" value={s.year} onChange={(v) => apply((d) => { if (v) at(d).year = v; else delete at(d).year }, { coalesce: `sec:${chapter}:year` })} />
            <NumberField label="Length (screens)" value={s.vh} min={0.5} max={20} step={0.1} onChange={(v) => v !== undefined && apply((d) => { at(d).vh = v }, { coalesce: `sec:${chapter}:vh` })} />
            <NumberField label="Quick View length" value={s.quickVh} min={0.5} max={20} step={0.1} onChange={(v) => v !== undefined && apply((d) => { at(d).quickVh = v }, { coalesce: `sec:${chapter}:qvh` })} />
          </div>
          <label className="check"><input type="checkbox" checked={!s.hidden} onChange={(e) => apply((d) => { at(d).hidden = !e.target.checked })} /> Shown on the page</label>
          <button type="button" className="btn btn-sm" onClick={() => { useEditor.getState().select([`slot.${chapter}`]); frame.post({ type: 'cms:reveal', id: `slot.${chapter}` }) }}>Arrange its added elements…</button>
        </Panel>
      )}
      <AppearancePanel id={id} />
      <OverridesPanel id={id} />
    </>
  )
}

/* ---- one element ------------------------------------------------------------ */
function ElementInspector({ id }: { id: string }) {
  const doc = useSiteStore((s) => s.doc)!
  const apply = useSiteStore((s) => s.apply)
  const t = useEditor((s) => s.tree.find((n) => n.id === id))
  const found = findNode(doc, id)
  const node = found?.node ?? null
  const kind = node ? (node.type === 'container' || node.type === 'card' ? 'container' : node.type) : t?.kind ?? 'text'
  const hidden = flag(doc, id, 'hidden')
  const locked = flag(doc, id, 'locked')
  const slot = isSlot(id)
  return (
    <>
      <header className="pe-inspector-head">
        {node ? <input className="input pe-name" value={node.name} aria-label="Layer name" onChange={(e) => apply((d) => { const f = findNode(d, id); if (f) f.node.name = e.target.value }, { coalesce: `name:${id}` })} /> : <h2 className="pe-title">{slot ? 'Added elements' : t?.label ?? id}</h2>}
        <p className="a-mono pe-id" title={id}>{node ? node.type : kind} · {id}{t && t.count > 1 ? ` · ${t.count} instances` : ''}</p>
        <div className="row" style={{ gap: 4 }}>
          <button type="button" className="btn btn-sm" aria-pressed={hidden} onClick={() => apply((d) => setFlag(d, id, 'hidden', !hidden))}>{hidden ? 'Hidden' : 'Hide'}</button>
          <button type="button" className="btn btn-sm" aria-pressed={locked} onClick={() => apply((d) => setFlag(d, id, 'locked', !locked))}>{locked ? 'Locked' : 'Lock'}</button>
          {!slot && <button type="button" className="btn btn-sm" onClick={() => duplicateSelection()} title="⌘D">Duplicate</button>}
          {node && <button type="button" className="btn btn-sm btn-danger" onClick={() => deleteSelection()} title="Delete">Delete</button>}
          {!node && !slot && doc.elements[id] && <button type="button" className="btn btn-sm" onClick={() => { if (confirm('Clear every change made to this element (text, styles, visibility)?')) apply((d) => { delete d.elements[id] }) }}>Reset</button>}
        </div>
        {t && t.count > 1 && <p className="a-sub" style={{ fontSize: 11.5 }}>Changes apply to all {t.count} places this element appears.</p>}
      </header>
      {!slot && <ContentPanel id={id} node={node} kind={kind} bind={t?.bind} />}
      <LayoutPanel id={id} node={node} kind={kind} />
      {!slot && <PositionPanel id={id} />}
      {(TEXT_KINDS.has(kind) || node?.type === 'card' || node?.type === 'container' || slot || kind === 'container') && <TypePanel id={id} />}
      <AppearancePanel id={id} />
      <OverridesPanel id={id} />
    </>
  )
}

function MultiInspector({ ids }: { ids: string[] }) {
  const doc = useSiteStore((s) => s.doc)!
  const apply = useSiteStore((s) => s.apply)
  const device = useEditor((s) => s.device)
  const scope = scopeOf(device)
  const allHidden = ids.every((id) => flag(doc, id, 'hidden'))
  const allLocked = ids.every((id) => flag(doc, id, 'locked'))
  const align = (how: string) => frame.post({ type: 'cms:align', ids, how })
  const writeAll = (patch: Partial<Record<keyof StyleProps, unknown>>) => apply((d) => { for (const id of ids) setStyle(d, id, scope, patch) }, { coalesce: `multi:${ids.join()}:${Object.keys(patch).join()}` })
  const common = <K extends keyof StyleProps>(k: K) => { const vals = ids.map((id) => ownStyle(doc, id, scope)[k]); return vals.every((v) => v === vals[0]) ? vals[0] : undefined }
  return (
    <>
      <header className="pe-inspector-head">
        <h2 className="pe-title">{ids.length} elements</h2>
        <div className="row" style={{ gap: 4 }}>
          <button type="button" className="btn btn-sm" onClick={() => groupSelection()} title="⌘G">Group</button>
          <button type="button" className="btn btn-sm" onClick={() => ungroupSelection()} title="⇧⌘G">Ungroup</button>
          <button type="button" className="btn btn-sm" aria-pressed={allHidden} onClick={() => apply((d) => { for (const id of ids) setFlag(d, id, 'hidden', !allHidden) })}>{allHidden ? 'Show' : 'Hide'}</button>
          <button type="button" className="btn btn-sm" aria-pressed={allLocked} onClick={() => apply((d) => { for (const id of ids) setFlag(d, id, 'locked', !allLocked) })}>{allLocked ? 'Unlock' : 'Lock'}</button>
        </div>
      </header>
      <Panel title="Align">
        <div className="pe-align" role="group" aria-label="Align">
          {[['left', '⇤', 'Align left edges'], ['hcenter', '↔', 'Align horizontal centres'], ['right', '⇥', 'Align right edges'], ['top', '⤒', 'Align top edges'], ['vcenter', '↕', 'Align vertical centres'], ['bottom', '⤓', 'Align bottom edges']].map(([how, icon, label]) => <button key={how} type="button" className="btn btn-sm btn-icon" title={label} aria-label={label} onClick={() => align(how)}>{icon}</button>)}
        </div>
        <div className="pe-align" role="group" aria-label="Distribute">
          <button type="button" className="btn btn-sm" disabled={ids.length < 3} onClick={() => align('hdistribute')}>Distribute horizontally</button>
          <button type="button" className="btn btn-sm" disabled={ids.length < 3} onClick={() => align('vdistribute')}>Distribute vertically</button>
        </div>
      </Panel>
      <Panel title="Shared style">
        <ColorField label="Colour" value={common('color')} placeholder="mixed" onChange={(v) => writeAll({ color: v })} />
        <ColorField label="Fill" value={common('background')} placeholder="mixed" onChange={(v) => writeAll({ background: v })} />
        <LengthField field="fontSize" label="Text size" value={common('fontSize')} placeholder="mixed" onChange={(v) => writeAll({ fontSize: v })} />
        <NumberField label="Opacity" value={common('opacity')} placeholder="mixed" min={0} max={1} step={0.05} onChange={(v) => writeAll({ opacity: v })} />
      </Panel>
      {ids.some((id) => findNode(doc, id)) && <div style={{ padding: '0 12px' }}><button type="button" className="btn btn-sm btn-danger" onClick={() => deleteSelection()}>Delete added elements</button></div>}
    </>
  )
}

function PageInspector() {
  const page = useEditor((s) => s.page)
  const device = useEditor((s) => s.device)
  return (
    <div className="pe-panel-body stack" style={{ gap: 10 }}>
      <h2 className="pe-title">{page.label}</h2>
      <p className="a-sub" style={{ fontSize: 12.5 }}>Styles you change now apply to: <b>{SCOPE_LABEL[scopeOf(device)]}</b>. Switch the device above to override them for smaller screens.</p>
      <ul className="pe-tips">
        <li><kbd>Click</kbd> select · <kbd>⇧ Click</kbd> add to selection · <kbd>⌘ Click</kbd> inside a group · <kbd>⌥ Click</kbd> what is underneath</li>
        <li><kbd>Double-click</kbd> text to edit it in place</li>
        <li><kbd>Drag</kbd> to move, handles to resize · <kbd>⌥</kbd> no snapping · <kbd>⇧</kbd> one axis / keep proportions</li>
        <li><kbd>←↑→↓</kbd> nudge 1 px · <kbd>⇧</kbd> 10 px</li>
        <li><kbd>⌘D</kbd> duplicate · <kbd>⌘C</kbd>/<kbd>⌘V</kbd> copy, paste · <kbd>⌘G</kbd> group · <kbd>⇧⌘G</kbd> ungroup</li>
        <li><kbd>⌫</kbd> delete an added element, hide a built-in one · <kbd>⌘L</kbd> lock · <kbd>Esc</kbd> deselect</li>
        <li><kbd>⌘Z</kbd> undo · <kbd>⇧⌘Z</kbd> redo · <kbd>⌘S</kbd> save the draft</li>
      </ul>
      <p className="a-sub" style={{ fontSize: 12 }}>Elements the site’s code renders can be restyled, moved, resized, hidden and grouped, and their text edited; deleting them is not possible because the code would render them again. Elements you add (Insert panel) can be anything.</p>
    </div>
  )
}

export function Inspector() {
  const selection = useEditor((s) => s.selection)
  const doc = useSiteStore((s) => s.doc)
  if (!doc) return null
  if (!selection.length) return <PageInspector />
  if (selection.length > 1) return <MultiInspector ids={selection} />
  const id = selection[0]
  if (isSection(id)) return <SectionInspector id={id} />
  if (!findNode(doc, id) && !useEditor.getState().tree.some((n) => n.id === id)) {
    return <div className="pe-panel-body"><p className="a-sub">That element is not on this page any more.</p></div>
  }
  return <ElementInspector key={id} id={id} />
}
