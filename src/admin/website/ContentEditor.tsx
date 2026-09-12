'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSiteStore } from '../store/site'
import { DraftBar } from '../DraftBar'
import type { Device, PreviewHandle } from '../DraftPreview'
import { EditorFrame, PreviewPane } from '../ui/EditorFrame'
import { Loading, Notice, PageHeader, Panel, Segmented, Tabs, WEBSITE_TABS } from '../ui/kit'
import { Icon } from '../ui/icons'
import { AnimationPicker } from './AnimationPicker'
import { ToolboxSettings } from './ToolboxSettings'
import { AddedContent, SectionDetails, SectionFields } from './SectionForm'
import { PAGES, SECTION_BY_ID } from './registry'

/* ============================================================
   WEBSITE › PAGES

   Pages → a section → its text and its animation → the preview →
   save a draft or publish. That is the whole workflow.

   The preview beside the form is the public page itself, at a real
   phone, tablet, laptop, desktop or ultrawide viewport; selecting a
   section here brings it into view there, and clicking a section
   there selects it here. Nothing on either side can drag, move or
   resize anything: how a section is laid out at each size is the
   site's code, which keeps every screen composed.
   ============================================================ */

type PageId = (typeof PAGES)[number]['id']

export function ContentEditor() {
  const status = useSiteStore((s) => s.status)
  const error = useSiteStore((s) => s.error)
  const doc = useSiteStore((s) => s.doc)
  const [page, setPage] = useState<PageId>('home')
  const [selected, setSelected] = useState<string>('about')
  const [device, setDevice] = useState<Device>('laptop')
  const [testing, setTesting] = useState(false)
  const preview = useRef<PreviewHandle>(null)
  const pending = useRef<string | null>(null)

  useEffect(() => { void useSiteStore.getState().load() }, [])

  const sections = useMemo(() => doc?.journeys[page].sections ?? [], [doc, page])
  const section = sections.find((s) => s.id === selected) ?? sections[0]
  const def = section ? SECTION_BY_ID[section.id] : undefined

  const scrollTo = useCallback((id: string, at = 0.5) => {
    preview.current?.post({ type: 'cms:scroll-to-section', section: id, at })
  }, [])

  const select = (id: string) => {
    setSelected(id)
    scrollTo(id)
  }

  const switchPage = (p: PageId) => {
    setPage(p)
    setTesting(false)
    const first = useSiteStore.getState().doc?.journeys[p].sections[0]?.id
    if (first) {
      setSelected(first)
      pending.current = first
    }
  }

  const selectedRef = useRef(selected)
  useEffect(() => { selectedRef.current = selected }, [selected])
  const onMessage = useCallback((m: Record<string, unknown>) => {
    if (m.type === 'cms:link-ready') {
      // A fresh frame: bring the section being edited into view.
      const target = pending.current ?? selectedRef.current
      pending.current = null
      if (target) scrollTo(target)
    }
    if (m.type === 'cms:section' && typeof m.section === 'string') setSelected(m.section)
  }, [scrollTo])

  if (status !== 'ready' || !doc) {
    return <main className="a-page">{status === 'error' ? <Notice tone="danger">{error ?? 'The draft could not be loaded.'}</Notice> : <Loading label="Loading the draft…" />}</main>
  }

  const pagePath = PAGES.find((p) => p.id === page)!.path
  const path = testing ? '/?cms-test=transition' : pagePath

  const header = (
    <PageHeader
      compact
      eyebrow="Website"
      title="Pages"
      description="Choose a section, edit its words and its animation, check it at every size, then publish."
      actions={<DraftBar />}
      tabs={<Tabs label="Website" tabs={WEBSITE_TABS} />}
    />
  )

  const nav = (
    <div className="ce-nav">
      <Segmented<PageId> label="Page" value={page} onChange={switchPage} options={PAGES.map((p) => ({ value: p.id, label: p.label }))} />
      <ol className="ce-sections" aria-label="Sections">
        {sections.map((s, i) => (
          <li key={s.id}>
            <button type="button" className="ce-section" aria-current={s.id === section?.id ? 'true' : undefined} onClick={() => select(s.id)}>
              <span className="ce-section-no a-mono">{String(i + 1).padStart(2, '0')}</span>
              <span className="ce-section-text">
                <b>{s.title}</b>
                <small>{SECTION_BY_ID[s.id]?.summary ?? 'Content section'}</small>
              </span>
              {s.hidden && <span className="badge" data-tone="warn">Hidden</span>}
              {SECTION_BY_ID[s.id]?.animation && <span className="ce-section-flag" title="Has a choice of animation"><Icon name="play" size={12} /></span>}
            </button>
          </li>
        ))}
      </ol>
      <p className="a-hint ce-nav-note">The order of sections and how each one is laid out are part of the site’s design.</p>
    </div>
  )

  const form = section ? (
    <div className="ce-form">
      {/* Where the list does not fit beside the form, it is a choice at its head. */}
      <div className="ce-picker">
        <Segmented<PageId> label="Page" size="sm" value={page} onChange={switchPage} options={PAGES.map((p) => ({ value: p.id, label: p.label }))} />
        <label className="field">
          <span className="a-label">Section</span>
          <select className="input" value={section?.id ?? ''} onChange={(e) => select(e.target.value)}>
            {sections.map((s, i) => <option key={s.id} value={s.id}>{String(i + 1).padStart(2, '0')} · {s.title}{s.hidden ? ' (hidden)' : ''}</option>)}
          </select>
        </label>
      </div>
      <header className="ce-form-head">
        <p className="a-label">{PAGES.find((p) => p.id === page)!.label} · section</p>
        <h2>{section.title}</h2>
        {def && <p className="a-sub">{def.summary}</p>}
      </header>
      {def ? <SectionFields def={def} /> : (
        <Panel title="Content" description="This section holds content kept from the old page builder. It reads in one column at every size; its text can be edited and blocks removed.">
          <AddedContent section={section.id} />
        </Panel>
      )}
      {def?.animation && <AnimationPicker section={def.animation} journey={page} onPreview={() => scrollTo(section.id, 0.5)} />}
      {def?.toolbox && <ToolboxSettings />}
      {def?.id === 'contact' && (
        <Panel title="The way into the world" description="At the foot of the page the garden grows over everything and opens onto /world. It is the same whichever animation this section shows.">
          <div className="row">
            <button type="button" className="btn btn-sm" aria-pressed={testing} onClick={() => setTesting((v) => !v)}><Icon name="leaf" size={15} />{testing ? 'End the test' : 'Test it in the preview'}</button>
            <Link className="btn btn-sm btn-ghost" href="/admin/settings">Leaf growth and parting speeds</Link>
          </div>
          {testing && <small className="a-hint">Scroll to the very end of the preview and keep scrolling: the leaves cover the page, the world loads underneath, then they part.</small>}
        </Panel>
      )}
      {def?.elsewhere?.map((e) => (
        <Notice key={e.href}>{e.note} <Link href={e.href}>{e.label} →</Link></Notice>
      ))}
      <SectionDetails journey={page} section={section} />
    </div>
  ) : <Notice>This page has no sections.</Notice>

  return (
    <EditorFrame
      header={header}
      nav={nav}
      form={form}
      preview={<PreviewPane ref={preview} path={path} device={device} onDevice={setDevice} onMessage={onMessage} />}
    />
  )
}
