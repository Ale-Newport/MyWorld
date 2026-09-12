'use client'

import { useId, useMemo, useState } from 'react'
import { useSiteStore } from '../store/site'
import { Panel, Segmented, Switch } from '../ui/kit'
import { Icon } from '../ui/icons'

/* ============================================================
   WHAT THE TECH TOOLBOX DISCLOSES

   Two independent switches for the whole wall — project counts,
   project names — and, folded away, a per-tool override of either
   (inherit the section's setting, always show, always hide). A
   detail that is off is not rendered at all on the public page.
   ============================================================ */

type Choice = 'inherit' | 'show' | 'hide'
const toChoice = (v: boolean | undefined): Choice => (v === undefined ? 'inherit' : v ? 'show' : 'hide')
const fromChoice = (c: Choice): boolean | undefined => (c === 'inherit' ? undefined : c === 'show')

export function ToolboxSettings() {
  const section = useSiteStore((s) => s.doc?.journeys.home.sections.find((x) => x.id === 'toolbox'))
  const allNodes = useSiteStore((s) => s.doc?.techNodes)
  const [query, setQuery] = useState('')
  const id = useId()
  const counts = section?.toolbox?.showCounts ?? true
  const names = section?.toolbox?.showNames ?? true
  const nodes = useMemo(() => allNodes ?? [], [allNodes])
  const overridden = nodes.filter((n) => n.showCounts !== undefined || n.showNames !== undefined).length

  const setSection = (patch: { showCounts?: boolean; showNames?: boolean }) => useSiteStore.getState().apply((d) => {
    const s = d.journeys.home.sections.find((x) => x.id === 'toolbox')
    if (s) s.toolbox = { showCounts: counts, showNames: names, ...patch }
  })
  const setNode = (nodeId: string, key: 'showCounts' | 'showNames', c: Choice) => useSiteStore.getState().apply((d) => {
    const n = d.techNodes.find((x) => x.id === nodeId)
    if (!n) return
    const v = fromChoice(c)
    if (v === undefined) delete n[key]
    else n[key] = v
  })

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? nodes.filter((n) => n.name.toLowerCase().includes(q)) : nodes
  }, [nodes, query])

  const inherit = (on: boolean) => `Inherit (${on ? 'shown' : 'hidden'})`

  return (
    <Panel title="Technology details" description="What the wall says about each technology when it is pointed at, focused or tapped.">
      <Switch checked={counts} onChange={(v) => setSection({ showCounts: v })} label="Show project counts" hint="The small number on each tile and the “3 projects” line in the readout." />
      <Switch checked={names} onChange={(v) => setSection({ showNames: v })} label="Show project names" hint="The list of projects in the readout, each opening its case study." />
      <small className="a-hint">Only projects that are published and listed are ever counted or named.</small>

      <details className="a-more">
        <summary><Icon name="chevron" size={14} />Per-technology overrides {overridden > 0 && <span className="badge">{overridden} set</span>}</summary>
        <div className="stack" style={{ marginTop: 12 }}>
          <div className="field">
            <label htmlFor={`${id}-q`}>Find a technology</label>
            <input id={`${id}-q`} className="input" type="search" value={query} placeholder="Python, React…" onChange={(e) => setQuery(e.target.value)} />
          </div>
          <ul className="ce-overrides">
            {shown.map((n) => (
              <li key={n.id} className="ce-override">
                <b>{n.name}</b>
                <div className="ce-override-controls">
                  <span className="a-sub">Count</span>
                  <Segmented<Choice> size="sm" label={`${n.name}: project count`} value={toChoice(n.showCounts)} onChange={(c) => setNode(n.id, 'showCounts', c)} options={[{ value: 'inherit', label: 'Inherit', title: inherit(counts) }, { value: 'show', label: 'Show' }, { value: 'hide', label: 'Hide' }]} />
                  <span className="a-sub">Names</span>
                  <Segmented<Choice> size="sm" label={`${n.name}: project names`} value={toChoice(n.showNames)} onChange={(c) => setNode(n.id, 'showNames', c)} options={[{ value: 'inherit', label: 'Inherit', title: inherit(names) }, { value: 'show', label: 'Show' }, { value: 'hide', label: 'Hide' }]} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      </details>
    </Panel>
  )
}
