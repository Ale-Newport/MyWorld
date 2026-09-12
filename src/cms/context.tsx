'use client'

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
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
   an edit shows up in the real page before it is saved — the
   preview IS the public renderer, never an approximation of it.
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

  /* The editor can point at a section: the frame brings it into view.
     Read-only — the preview never takes edits of its own. */
  useEffect(() => {
    if (!editing || window.parent === window) return
    let dispose: (() => void) | undefined
    let cancelled = false
    void import('./edit/preview').then((m) => { if (!cancelled) dispose = m.startPreviewLink() })
    return () => { cancelled = true; dispose?.() }
  }, [editing])

  const value = useMemo(() => deriveSite(live, { preview: editing }), [live, editing])
  // Non-React readers (the journey store, the canvas scenes) see the same content.
  useMemo(() => setJourneyContent(value), [value])
  /* Layers that measure the copy (the homepage's vegetation) re-measure
     when it changes after the first render — in practice, in the
     admin's live preview. After the DOM has the new words. */
  const first = useRef(true)
  useEffect(() => {
    if (first.current) { first.current = false; return }
    const raf = requestAnimationFrame(() => window.dispatchEvent(new Event('cms:content')))
    return () => cancelAnimationFrame(raf)
  }, [value])
  return (
    <EditingContext.Provider value={editing}>
      <SiteContext.Provider value={value}>
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
