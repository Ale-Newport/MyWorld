'use client'

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { compileStyles } from './css'
import { deriveSite, type SiteContent } from './derive'
import type { SiteDocument } from './schema'
import { setJourneyContent } from '@/state/content'

/* ============================================================
   SITE CONTENT, CLIENT SIDE

   The server hands the document to this provider once, at the top
   of the tree; every component below reads what used to be module
   imports from here. In the admin's live preview (Draft Mode plus
   a verified session, decided on the server) the provider also
   accepts documents posted by the editor in the parent frame, so
   an edit shows up in the real page before it is saved.
   ============================================================ */

const SiteContext = createContext<SiteContent | null>(null)
const EditingContext = createContext(false)

export function SiteContentProvider({ doc, editing = false, children }: { doc: SiteDocument; editing?: boolean; children: ReactNode }) {
  const [live, setLive] = useState(doc)
  /* A new document from the server (a navigation, a refresh after saving) replaces any live one. */
  const [served, setServed] = useState(doc)
  if (served !== doc) {
    setServed(doc)
    setLive(doc)
  }

  useEffect(() => {
    if (!editing || window.parent === window) return
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== window.parent) return
      const data = event.data as { type?: string; doc?: SiteDocument }
      if (data?.type === 'cms:document' && data.doc) setLive(data.doc)
    }
    window.addEventListener('message', onMessage)
    window.parent.postMessage({ type: 'cms:preview-ready', path: window.location.pathname }, window.location.origin)
    return () => window.removeEventListener('message', onMessage)
  }, [editing])

  /* The editor's selection layer, only inside the admin's frame. */
  useEffect(() => {
    if (!editing || window.parent === window || !new URLSearchParams(window.location.search).has('cms-edit')) return
    let dispose: (() => void) | undefined
    let cancelled = false
    void import('./edit/bridge').then((m) => { if (!cancelled) dispose = m.startBridge() })
    return () => { cancelled = true; dispose?.() }
  }, [editing])

  const value = useMemo(() => deriveSite(live), [live])
  // Non-React readers (the journey store, the canvas scenes) see the same content.
  useMemo(() => setJourneyContent(value), [value])
  const css = useMemo(() => compileStyles(live, { editing }), [live, editing])
  return (
    <EditingContext.Provider value={editing}>
      <SiteContext.Provider value={value}>
        {/* Every visual edit, compiled; values were validated against the schema. */}
        {css && <style data-cms-styles="" dangerouslySetInnerHTML={{ __html: css }} />}
        {children}
      </SiteContext.Provider>
    </EditingContext.Provider>
  )
}

export function useSite(): SiteContent {
  const value = useContext(SiteContext)
  if (!value) throw new Error('useSite() outside <SiteContentProvider>')
  return value
}

/** True only inside the admin's live preview. */
export function useEditing() {
  return useContext(EditingContext)
}
