'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { DEVICES, type Device } from '../DraftPreview'
import { Segmented } from '../ui/kit'
import type { SiteDocument } from '@/cms/schema'

/* ============================================================
   THE PREVIEW PANE, FOR THE DEPLOYED ADMIN'S BLOG

   The editor's preview (DraftPreview) frames the public route in
   Draft Mode, which the deployed site's prerendered pages cannot
   offer. This frames /admin/blog-preview instead — the same blog
   components — at the device's real viewport, scaled to fit the
   pane, so the phone layout is the phone layout. The document is
   posted to it once it is ready and again on every edit.
   ============================================================ */

export function BlogPreviewPane({ doc, slug, tools }: { doc: SiteDocument | null; slug: string | null; tools?: ReactNode }) {
  const [device, setDevice] = useState<Device>('laptop')
  return (
    <div className="ed-preview-inner">
      <div className="ed-preview-bar">
        <Segmented<Device>
          label="Preview size"
          size="sm"
          value={device}
          onChange={setDevice}
          options={(Object.keys(DEVICES) as Device[]).map((d) => ({ value: d, label: <span className="ed-dev-label">{DEVICES[d].label}</span>, title: `${DEVICES[d].label} · ${DEVICES[d].w} × ${DEVICES[d].h}`, icon: DEVICES[d].icon }))}
        />
        {tools}
      </div>
      <BlogPreviewFrame doc={doc} slug={slug} device={device} />
    </div>
  )
}

function BlogPreviewFrame({ doc, slug, device }: { doc: SiteDocument | null; slug: string | null; device: Device }) {
  const frame = useRef<HTMLIFrameElement>(null)
  const host = useRef<HTMLDivElement>(null)
  const ready = useRef(false)
  const latest = useRef(doc)
  const [scale, setScale] = useState(0)
  useEffect(() => { latest.current = doc })

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
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== location.origin || e.source !== frame.current?.contentWindow) return
      if ((e.data as { type?: string })?.type !== 'cms:preview-ready') return
      ready.current = true
      if (latest.current) frame.current?.contentWindow?.postMessage({ type: 'cms:document', doc: latest.current }, location.origin)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  /* every edit, once per frame at most */
  useEffect(() => {
    if (!doc || !ready.current) return
    const raf = requestAnimationFrame(() => frame.current?.contentWindow?.postMessage({ type: 'cms:document', doc }, location.origin))
    return () => cancelAnimationFrame(raf)
  }, [doc])

  const { w, h, label } = DEVICES[device]
  const src = `/admin/blog-preview${slug ? `?slug=${encodeURIComponent(slug)}` : ''}`
  // A new address is a new frame: it says when it is ready again.
  useEffect(() => { ready.current = false }, [src])
  return (
    <div ref={host} className="a-preview">
      {scale > 0 ? (
        <div className="a-preview-device" data-device={device} style={{ width: w * scale, height: h * scale }}>
          <iframe ref={frame} key={src} src={src} title={`Preview — ${label}`} style={{ width: w, height: h, transform: `scale(${scale})` }} />
        </div>
      ) : <p className="a-sub" style={{ padding: 24 }}>Opening the preview…</p>}
      {scale > 0 && <p className="a-preview-size a-mono" aria-hidden="true">{w} × {h} · {Math.round(scale * 100)}%</p>}
    </div>
  )
}
