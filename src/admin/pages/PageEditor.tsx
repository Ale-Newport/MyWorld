'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useSiteStore } from '../store/site'
import { DraftBar } from '../DraftBar'
import { DraftPreview, DEVICES, type Device, type PreviewHandle } from '../DraftPreview'
import { typingTarget } from '../keys'
import { toast } from '../toast'
import { LeftPanel } from './LeftPanel'
import { Inspector } from './Inspector'
import { HOME, SCOPE_LABEL, frame, scopeOf, useEditor, type PageDef, type TreeNode } from './state'
import { commitChanges, commitText, onDoubleClick, onDrop, onKey, pick, syncSelection, type Change } from './actions'

/* ============================================================
   THE PAGE EDITOR

   Left: the page's sections, its layers, elements to insert and
   the media library. Centre: the real page in Draft Mode, at the
   chosen device's width, with the selection layer. Right: the
   inspector for whatever is selected. The device picks the
   breakpoint styles are written to: Desktop writes the values
   every size shares; Tablet and Mobile write overrides below
   1024 and 640 pixels.

   Preview turns the selection layer off so the page behaves as
   a visitor's would (links, scroll scenes, overlays). Test
   transition runs the full leaf transition into the world inside
   the frame; nowhere else in the editor can it start, so a scroll
   to the foot of the page never carries the editor off to /world.
   ============================================================ */

export function PageEditor() {
  const { status, doc, load, error } = useSiteStore()
  const { page, device, mode } = useEditor()
  const set = useEditor((s) => s.set)
  const selection = useEditor((s) => s.selection)
  const preview = useRef<PreviewHandle>(null)

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    frame.post = (m) => preview.current?.post(m)
    return () => { frame.post = () => {} }
  }, [])

  const groupsKey = doc ? JSON.stringify(doc.groups) : ''
  useEffect(() => { syncSelection() }, [selection, groupsKey])
  useEffect(() => { frame.post({ type: 'cms:mode', mode: mode === 'edit' ? 'edit' : 'preview' }) }, [mode])

  /* keys pressed while the editor (not the frame) has focus */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (typingTarget(e.target) || (e.target as HTMLElement)?.closest?.('dialog')) return
      const meta = e.metaKey || e.ctrlKey
      if (meta && /^[zys]$/i.test(e.key)) return // DraftBar's
      if (useEditor.getState().mode !== 'edit') return
      if (onKey({ key: e.key, meta, shift: e.shiftKey, alt: e.altKey }, false)) e.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const onMessage = useCallback((m: Record<string, unknown>) => {
    switch (m.type) {
      case 'cms:tree': set({ tree: m.nodes as TreeNode[], treePath: m.path as string }); break
      case 'cms:bridge-ready': syncSelection(); frame.post({ type: 'cms:mode', mode: useEditor.getState().mode === 'edit' ? 'edit' : 'preview' }); break
      case 'cms:pick': pick(m.id as string | null, !!m.additive, !!m.deep); break
      case 'cms:hovered': set({ hovered: (m.id as string | null) ?? null }); break
      case 'cms:dblclick': onDoubleClick(m.id as string, m.kind as string); break
      case 'cms:text': commitText(m.id as string, m.text as string); break
      case 'cms:move': commitChanges(m.changes as Change[]); break
      case 'cms:resize': commitChanges([m.change as Change]); break
      case 'cms:drop': onDrop(m as never); break
      case 'cms:key': onKey(m as never, true); break
      case 'cms:viewport': set({ viewportSection: (m.section as string | null) ?? null }); break
      case 'cms:computed': set({ computed: { id: m.id as string, style: m.style as Record<string, string> } }); break
      case 'cms:transition-blocked': toast('The leaf transition runs only in Test transition, so the editor never leaves this page.'); break
    }
  }, [set])

  if (status === 'error') return <main className="a-page"><p className="notice" data-tone="danger">{error}</p></main>
  if (status !== 'ready' || !doc) return <main className="a-page"><p className="a-sub">Loading the draft…</p></main>

  const projects = doc.projects.filter((p) => p.status !== 'archived').sort((a, b) => a.order - b.order)
  const pages: PageDef[] = [HOME, { key: 'projects', path: '/projects', journey: 'projects', label: 'Projects' }, ...projects.map((p) => ({ key: `project:${p.slug}`, path: `/projects/${p.slug}`, journey: null, label: `Project page · ${p.title}` }))]
  const path = mode === 'test' ? '/?cms-test=transition' : page.path

  return (
    <div className="pe-root">
      <header className="pe-toolbar">
        <select className="input pe-input" style={{ width: 220 }} value={page.key} aria-label="Page" onChange={(e) => { const p = pages.find((x) => x.key === e.target.value); if (p) set({ page: p, selection: [], tree: [], enteredGroup: null, mode: mode === 'test' ? 'edit' : mode }) }}>
          <optgroup label="Pages">{pages.slice(0, 2).map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</optgroup>
          <optgroup label="Project page template">{pages.slice(2).map((p) => <option key={p.key} value={p.key}>{p.label.replace('Project page · ', '')}</option>)}</optgroup>
        </select>
        <div className="btn-group" role="group" aria-label="Device and breakpoint">
          {(Object.keys(DEVICES) as Device[]).map((d) => <button key={d} type="button" className="btn btn-sm" aria-pressed={device === d} onClick={() => set({ device: d })} title={SCOPE_LABEL[scopeOf(d)]}>{DEVICES[d].label}</button>)}
        </div>
        <span className="pe-scope" title="Where style edits are written">Styles → {SCOPE_LABEL[scopeOf(device)]}</span>
        <span className="spacer" />
        <div className="btn-group" role="group" aria-label="Mode">
          <button type="button" className="btn btn-sm" aria-pressed={mode === 'edit'} onClick={() => set({ mode: 'edit' })}>Edit</button>
          <button type="button" className="btn btn-sm" aria-pressed={mode === 'preview'} onClick={() => set({ mode: 'preview', selection: [] })}>Preview</button>
          <button type="button" className="btn btn-sm" aria-pressed={mode === 'test'} onClick={() => set({ mode: 'test', selection: [] })} title="Runs the leaf transition into the world inside the frame">Test transition</button>
        </div>
        <DraftBar compact />
      </header>
      <div className="pe-body">
        <LeftPanel />
        <main className="pe-canvas" aria-label="Page">
          {mode === 'test' && (
            <div className="pe-banner" role="status">
              <span><b>Transition test.</b> Scroll to the very end of the page and keep scrolling until the leaves close. The world loads inside this frame — the editor stays here.</span>
              <button type="button" className="btn btn-sm" onClick={() => set({ mode: 'edit' })}>End test</button>
            </div>
          )}
          <DraftPreview ref={preview} path={path} device={device} edit={mode === 'edit'} onMessage={onMessage} />
        </main>
        <aside className="pe-right" aria-label="Inspector">
          {mode === 'edit' ? <Inspector /> : <p className="pe-empty">{mode === 'preview' ? 'Preview: the page behaves as a visitor sees it. Switch back to Edit to select things.' : 'Testing the transition.'}</p>}
        </aside>
      </div>
    </div>
  )
}
