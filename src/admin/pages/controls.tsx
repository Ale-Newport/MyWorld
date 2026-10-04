'use client'

import { useId, useState, type ReactNode } from 'react'
import { cssColor, cssLength } from '@/cms/schema'
import { paramsOf, type ParamDef } from '@/animations/registry'

/* Inspector fields. Each one keeps what is being typed locally and
   only writes values the schema would accept, so a half-typed
   "cla" never reaches the draft (or the page). The placeholder
   says what applies when the field is empty: inherited from a
   wider breakpoint, or what the browser computed. */

export function Row({ label, children, hint, set, onReset }: { label: string; children: ReactNode; hint?: string; set?: boolean; onReset?: () => void }) {
  return (
    <div className="pe-row" data-set={set || undefined}>
      <span className="pe-row-label" title={hint}>{label}{set && onReset && <button type="button" className="pe-reset" onClick={onReset} title="Clear this value at this size" aria-label={`Clear ${label}`}>×</button>}</span>
      <div className="pe-row-control">{children}</div>
    </div>
  )
}

function useDraft(value: string | undefined) {
  const [draft, setDraft] = useState(value ?? '')
  const [shown, setShown] = useState(value)
  if (shown !== value) { setShown(value); setDraft(value ?? '') }
  return [draft, setDraft] as const
}

const FLUID_FIELDS = new Set(['fontSize', 'width', 'maxWidth', 'padding', 'gap', 'margin', 'height', 'minHeight'])

export function LengthField({ field, label, value, placeholder, onChange, onReset }: { field: string; label: string; value?: string; placeholder?: string; onChange: (v: string | undefined) => void; onReset?: () => void }) {
  const [draft, setDraft] = useDraft(value)
  const [fluid, setFluid] = useState(false)
  const ok = (v: string) => v === '' || cssLength.safeParse(v).success
  const commit = (v: string) => { if (ok(v)) onChange(v === '' ? undefined : v) }
  const step = (dir: number, big: boolean) => {
    const m = /^(-?\d*\.?\d+)([a-z%]*)$/.exec(draft || placeholder?.replace(/^.*?(-?\d*\.?\d+[a-z%]*).*$/, '$1') || '0px')
    if (!m) return
    const unit = m[2] || 'px'
    const inc = unit === 'rem' || unit === 'em' ? (big ? 1 : 0.1) : big ? 10 : 1
    const next = `${Math.round((parseFloat(m[1]) + dir * inc) * 100) / 100}${unit}`
    setDraft(next); commit(next)
  }
  return (
    <Row label={label} set={value !== undefined} onReset={onReset}>
      <div className="pe-inline">
        <input className="input pe-input" value={draft} placeholder={placeholder} aria-label={label} aria-invalid={!ok(draft)} spellCheck={false}
          onChange={(e) => { setDraft(e.target.value); commit(e.target.value.trim()) }}
          onKeyDown={(e) => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); step(e.key === 'ArrowUp' ? 1 : -1, e.shiftKey) } }} />
        {FLUID_FIELDS.has(field) && <button type="button" className="btn btn-sm btn-icon" aria-pressed={fluid} title="Fluid: scale between two sizes" aria-label={`Fluid ${label}`} onClick={() => setFluid(!fluid)}>⤢</button>}
      </div>
      {fluid && <FluidBuilder onApply={(v) => { setDraft(v); onChange(v); setFluid(false) }} />}
    </Row>
  )
}

/** min/max sizes at two viewport widths → clamp(min, a + b·vw, max). */
function FluidBuilder({ onApply }: { onApply: (v: string) => void }) {
  const [min, setMin] = useState(24), [max, setMax] = useState(56), [from, setFrom] = useState(390), [to, setTo] = useState(1440)
  const slope = (max - min) / Math.max(1, to - from)
  const intercept = min - slope * from
  const r = (n: number) => Math.round(n * 1000) / 1000
  const value = `clamp(${r(min / 16)}rem, ${r(intercept / 16)}rem + ${r(slope * 100)}vw, ${r(max / 16)}rem)`
  return (
    <div className="pe-fluid">
      <label>From <input className="input pe-input" type="number" value={min} onChange={(e) => setMin(+e.target.value)} aria-label="Smallest size in pixels" /> px at <input className="input pe-input" type="number" value={from} onChange={(e) => setFrom(+e.target.value)} aria-label="Narrow viewport width" /> px</label>
      <label>to <input className="input pe-input" type="number" value={max} onChange={(e) => setMax(+e.target.value)} aria-label="Largest size in pixels" /> px at <input className="input pe-input" type="number" value={to} onChange={(e) => setTo(+e.target.value)} aria-label="Wide viewport width" /> px</label>
      <code className="a-mono">{value}</code>
      <button type="button" className="btn btn-sm btn-primary" onClick={() => onApply(value)}>Apply</button>
    </div>
  )
}

export function ColorField({ label, value, placeholder, onChange, onReset }: { label: string; value?: string; placeholder?: string; onChange: (v: string | undefined) => void; onReset?: () => void }) {
  const [draft, setDraft] = useDraft(value)
  const ok = (v: string) => v === '' || cssColor.safeParse(v).success
  const hex = /^#[0-9a-f]{6}$/i.test(draft) ? draft : rgbToHex(placeholder) ?? '#000000'
  return (
    <Row label={label} set={value !== undefined} onReset={onReset}>
      <div className="pe-inline">
        <input type="color" className="pe-swatch" value={hex} aria-label={`${label} picker`} onChange={(e) => { setDraft(e.target.value); onChange(e.target.value) }} />
        <input className="input pe-input" value={draft} placeholder={placeholder} aria-label={label} aria-invalid={!ok(draft)} spellCheck={false} onChange={(e) => { setDraft(e.target.value); if (ok(e.target.value.trim())) onChange(e.target.value.trim() || undefined) }} />
      </div>
    </Row>
  )
}
function rgbToHex(v?: string): string | null {
  const m = v && /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(v)
  return m ? `#${[m[1], m[2], m[3]].map((n) => (+n).toString(16).padStart(2, '0')).join('')}` : null
}

export function SelectField<T extends string>({ label, value, options, placeholder, onChange, onReset }: { label: string; value?: T; options: readonly (T | { value: T; label: string })[]; placeholder?: string; onChange: (v: T | undefined) => void; onReset?: () => void }) {
  const id = useId()
  return (
    <Row label={label} set={value !== undefined} onReset={onReset}>
      <select id={id} className="input pe-input" value={value ?? ''} aria-label={label} onChange={(e) => onChange((e.target.value || undefined) as T | undefined)}>
        <option value="">{placeholder ? `— ${placeholder}` : '—'}</option>
        {options.map((o) => typeof o === 'string' ? <option key={o} value={o}>{o}</option> : <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </Row>
  )
}

export function Segmented<T extends string>({ label, value, options, onChange, onReset }: { label: string; value?: T; options: { value: T; label: string; title?: string }[]; onChange: (v: T | undefined) => void; onReset?: () => void }) {
  return (
    <Row label={label} set={value !== undefined} onReset={onReset}>
      <div className="btn-group pe-seg" role="group" aria-label={label}>
        {options.map((o) => <button key={o.value} type="button" className="btn btn-sm" title={o.title ?? o.label} aria-pressed={value === o.value} onClick={() => onChange(value === o.value ? undefined : o.value)}>{o.label}</button>)}
      </div>
    </Row>
  )
}

export function NumberField({ label, value, placeholder, min, max, step = 1, onChange, onReset }: { label: string; value?: number; placeholder?: string; min?: number; max?: number; step?: number; onChange: (v: number | undefined) => void; onReset?: () => void }) {
  const [draft, setDraft] = useDraft(value === undefined ? undefined : String(value))
  return (
    <Row label={label} set={value !== undefined} onReset={onReset}>
      <input className="input pe-input" type="number" value={draft} placeholder={placeholder} min={min} max={max} step={step} aria-label={label}
        onChange={(e) => { setDraft(e.target.value); if (e.target.value === '') onChange(undefined); else { const n = e.target.valueAsNumber; if (Number.isFinite(n) && (min === undefined || n >= min) && (max === undefined || n <= max)) onChange(n) } }} />
    </Row>
  )
}

export function TextField({ label, value, placeholder, onChange, multiline = false }: { label: string; value?: string; placeholder?: string; onChange: (v: string) => void; multiline?: boolean }) {
  const [draft, setDraft] = useDraft(value)
  return (
    <Row label={label}>
      {multiline
        ? <textarea className="input pe-input" rows={3} value={draft} placeholder={placeholder} aria-label={label} onChange={(e) => { setDraft(e.target.value); onChange(e.target.value) }} />
        : <input className="input pe-input" value={draft} placeholder={placeholder} aria-label={label} onChange={(e) => { setDraft(e.target.value); onChange(e.target.value) }} />}
    </Row>
  )
}

/** The typed controls of a library effect. Values are data; the effect validates them again. */
export function ParamEditor({ effect, params, onChange, only }: { effect: string; params: Record<string, unknown>; onChange: (key: string, value: unknown) => void; only?: ParamDef['group'][] }) {
  const defs = paramsOf(effect).filter((p) => !only || only.includes(p.group))
  const groups = [...new Set(defs.map((d) => d.group))]
  return (
    <div className="stack" style={{ gap: 10 }}>
      {groups.map((g) => (
        <div key={g} className="stack" style={{ gap: 4 }}>
          <p className="a-label" style={{ fontSize: 9.5 }}>{g}</p>
          {defs.filter((d) => d.group === g).map((d) => {
            const v = params[d.key]
            const reset = v !== undefined ? () => onChange(d.key, undefined) : undefined
            if (d.type === 'select') return <SelectField key={d.key} label={d.label} value={v as string | undefined} options={d.options ?? []} placeholder={String(d.default)} onChange={(x) => onChange(d.key, x)} onReset={reset} />
            if (d.type === 'boolean') return <Row key={d.key} label={d.label}><input type="checkbox" checked={typeof v === 'boolean' ? v : !!d.default} aria-label={d.label} onChange={(e) => onChange(d.key, e.target.checked)} /></Row>
            if (d.type === 'color') return <ColorField key={d.key} label={d.label} value={v as string | undefined} placeholder={String(d.default || 'site colour')} onChange={(x) => onChange(d.key, x)} onReset={reset} />
            if (d.type === 'number') return (
              <Row key={d.key} label={`${d.label}${d.unit ? ` (${d.unit})` : ''}`} hint={d.help} set={v !== undefined} onReset={reset}>
                <div className="pe-inline">
                  <input type="range" min={d.min} max={d.max} step={d.step} value={typeof v === 'number' ? v : Number(d.default)} aria-label={d.label} onChange={(e) => onChange(d.key, e.target.valueAsNumber)} style={{ flex: 1, minWidth: 0 }} />
                  <input className="input pe-input" style={{ width: 64 }} type="number" min={d.min} max={d.max} step={d.step} value={typeof v === 'number' ? v : ''} placeholder={String(d.default)} aria-label={`${d.label} value`} onChange={(e) => { const n = e.target.valueAsNumber; if (Number.isFinite(n)) onChange(d.key, n); else if (e.target.value === '') onChange(d.key, undefined) }} />
                </div>
              </Row>
            )
            return <TextField key={d.key} label={d.label} value={v as string | undefined} placeholder={String(d.default)} onChange={(x) => onChange(d.key, x || undefined)} />
          })}
        </div>
      ))}
    </div>
  )
}
