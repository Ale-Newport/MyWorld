'use client'

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { api } from './api'
import { useSiteStore } from './store/site'
import type { IconName } from './ui/icons'

/** The screen sizes the preview offers: real CSS viewports, so breakpoints and the 100svh stages behave exactly as on that device. */
export const DEVICES = {
  mobile: { w: 390, h: 844, label: 'Phone', icon: 'phone' as IconName },
  tablet: { w: 820, h: 1180, label: 'Tablet', icon: 'tablet' as IconName },
  laptop: { w: 1280, h: 800, label: 'Laptop', icon: 'laptop' as IconName },
  desktop: { w: 1440, h: 900, label: 'Desktop', icon: 'desktop' as IconName },
  wide: { w: 2560, h: 1080, label: 'Ultrawide', icon: 'wide' as IconName },
} as const
export type Device = keyof typeof DEVICES

export interface PreviewHandle { post: (message: object) => void; frame: () => HTMLIFrameElement | null }

/* ============================================================
   THE REAL PAGE, WITH THE DRAFT

   An iframe of the public route itself — the same components,
   styles and animations, the same responsive renderer a visitor
   gets — rendered in Next's Draft Mode for this admin only (the
   server re-checks the session before serving a draft). The
   document being edited is posted to it on every change, so edits
   appear before they are saved.

   The frame is laid out at the device's real viewport, width AND
   height, and scaled down to fit the pane: a phone preview is a
   390 × 844 page, never a desktop page squeezed narrow, and never
   a desktop page made unusually tall to fill the space.
   ============================================================ */
export const DraftPreview = forwardRef<PreviewHandle, { path: string; device: Device; onMessage?: (data: Record<string, unknown>) => void }>(function DraftPreview({ path, device, onMessage }, ref) {
  const frame = useRef<HTMLIFrameElement>(null)
  const host = useRef<HTMLDivElement>(null)
  const [enabled, setEnabled] = useState(false)
  const [scale, setScale] = useState(0)
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

  /* fit the device into the pane, both ways */
  useEffect(() => {
    const el = host.current
    if (!el) return
    const fit = () => {
      const { w, h } = DEVICES[device]
      const r = el.getBoundingClientRect()
      setScale(Math.max(0.1, Math.min(1, (r.width - 24) / w, (r.height - 24) / h)))
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

  const { w, h, label } = DEVICES[device]
  const src = `${path}${path.includes('?') ? '&' : '?'}cms-preview=1`
  return (
    <div ref={host} className="a-preview">
      {enabled && scale > 0 ? (
        <div className="a-preview-device" data-device={device} style={{ width: w * scale, height: h * scale }}>
          <iframe
            ref={frame}
            key={src}
            src={src}
            title={`Draft preview — ${label}`}
            style={{ width: w, height: h, transform: `scale(${scale})` }}
          />
        </div>
      ) : <p className="a-sub" style={{ padding: 24 }}>Opening the draft preview…</p>}
      {enabled && scale > 0 && <p className="a-preview-size a-mono" aria-hidden="true">{w} × {h} · {Math.round(scale * 100)}%</p>}
    </div>
  )
})
