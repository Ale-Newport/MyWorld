'use client'

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { api } from './api'
import { useSiteStore } from './store/site'

export const DEVICES = { desktop: { w: 1440, h: 900, label: 'Desktop' }, tablet: { w: 820, h: 1180, label: 'Tablet' }, mobile: { w: 390, h: 844, label: 'Mobile' } } as const
export type Device = keyof typeof DEVICES

export interface PreviewHandle { post: (message: object) => void; frame: () => HTMLIFrameElement | null }

/* ============================================================
   THE REAL PAGE, WITH THE DRAFT

   An iframe of the public route itself — the same components,
   styles and animations — rendered in Next's Draft Mode for this
   admin only (the server re-checks the session before serving a
   draft). The document being edited is posted to it on every
   change, so edits appear before they are saved. `edit` loads the
   selection bridge for direct manipulation.

   The frame is laid out at the device's real CSS width and scaled
   to fit, so breakpoints, wrapping and media queries are exactly
   what a visitor on that device gets.
   ============================================================ */
export const DraftPreview = forwardRef<PreviewHandle, { path: string; device: Device; edit?: boolean; onMessage?: (data: Record<string, unknown>) => void }>(function DraftPreview({ path, device, edit = true, onMessage }, ref) {
  const frame = useRef<HTMLIFrameElement>(null)
  const host = useRef<HTMLDivElement>(null)
  const [enabled, setEnabled] = useState(false)
  const [scale, setScale] = useState(1)
  const ready = useRef(false)
  const doc = useSiteStore((s) => s.doc)
  const onMessageRef = useRef(onMessage)
  useEffect(() => { onMessageRef.current = onMessage })

  useImperativeHandle(ref, () => ({
    post: (message) => frame.current?.contentWindow?.postMessage(message, location.origin),
    frame: () => frame.current,
  }), [])

  useEffect(() => {
    let cancelled = false
    void api('/api/admin/preview', { method: 'POST' }).then(() => { if (!cancelled) setEnabled(true) })
    return () => { cancelled = true }
  }, [])

  /* fit the device frame into the workspace */
  useEffect(() => {
    const el = host.current
    if (!el) return
    const fit = () => {
      const { w, h } = DEVICES[device]
      const r = el.getBoundingClientRect()
      setScale(Math.min(1, (r.width - 24) / w, device === 'desktop' ? 1 : (r.height - 24) / h))
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [device])

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== location.origin || e.source !== frame.current?.contentWindow) return
      const data = e.data as Record<string, unknown>
      if (data?.type === 'cms:preview-ready') {
        ready.current = true
        const d = useSiteStore.getState().doc
        if (d) frame.current?.contentWindow?.postMessage({ type: 'cms:document', doc: d }, location.origin)
      }
      onMessageRef.current?.(data)
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [])

  /* push every edit, once per frame at most */
  useEffect(() => {
    if (!doc || !ready.current) return
    const raf = requestAnimationFrame(() => frame.current?.contentWindow?.postMessage({ type: 'cms:document', doc }, location.origin))
    return () => cancelAnimationFrame(raf)
  }, [doc])

  const { w, h } = DEVICES[device]
  const src = `${path}${path.includes('?') ? '&' : '?'}${edit ? 'cms-edit=1' : 'cms-preview=1'}`
  return (
    <div ref={host} style={{ position: 'relative', width: '100%', height: '100%', overflow: 'auto', background: 'var(--a-sunk)', display: 'grid', placeItems: device === 'desktop' ? 'start center' : 'center' }}>
      {enabled ? (
        <div style={{ width: w * scale, height: (device === 'desktop' ? Math.max(h, (host.current?.clientHeight ?? h) / scale - 24) : h) * scale, margin: 12, boxShadow: '0 20px 60px -30px rgb(0 0 0 / .45)', borderRadius: device === 'desktop' ? 6 : 22, overflow: 'hidden', flex: 'none' }}>
          <iframe
            ref={frame}
            key={src}
            src={src}
            title={`Draft preview — ${DEVICES[device].label}`}
            style={{ width: w, height: device === 'desktop' ? Math.max(h, (host.current?.clientHeight ?? h) / scale - 24) : h, border: 0, transform: `scale(${scale})`, transformOrigin: '0 0', display: 'block', background: '#f6f0e6' }}
          />
        </div>
      ) : <p className="a-sub" style={{ padding: 24 }}>Opening the draft preview…</p>}
    </div>
  )
})
