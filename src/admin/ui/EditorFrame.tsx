'use client'

import { forwardRef, useState, type ReactNode } from 'react'
import { DraftPreview, DEVICES, type Device, type PreviewHandle } from '../DraftPreview'
import { Segmented } from './kit'
import { Icon } from './icons'

/* ============================================================
   THE EDITORS' LAYOUT

   Website pages and projects share one frame: a header (where you
   are, the draft's state, save and publish), an optional list on
   the left, the form, and the live preview of the real page.

   On narrow screens nothing is squeezed into a strip: below the
   width where three columns fit, the list folds into the form's
   head and the preview becomes a panel the editor opens on demand
   (a button in the header), full width, closed again with one tap.
   ============================================================ */

export function EditorFrame({ header, nav, form, preview, previewLabel = 'Preview' }: { header: ReactNode; nav?: ReactNode; form: ReactNode; preview: ReactNode; previewLabel?: string }) {
  const [showPreview, setShowPreview] = useState(false)
  return (
    <div className="ed" data-preview-open={showPreview || undefined} data-has-nav={nav ? true : undefined}>
      <div className="ed-head">
        {header}
        <button type="button" className="btn ed-preview-toggle" aria-expanded={showPreview} onClick={() => setShowPreview((v) => !v)}>
          <Icon name={showPreview ? 'close' : 'eye'} size={16} />{showPreview ? 'Close preview' : previewLabel}
        </button>
      </div>
      {nav && <aside className="ed-nav">{nav}</aside>}
      <div className="ed-form">{form}</div>
      <section className="ed-preview" aria-label="Preview">{preview}</section>
    </div>
  )
}

export const PreviewPane = forwardRef<PreviewHandle, { path: string; device: Device; onDevice: (d: Device) => void; onMessage?: (data: Record<string, unknown>) => void; tools?: ReactNode }>(function PreviewPane({ path, device, onDevice, onMessage, tools }, ref) {
  return (
    <div className="ed-preview-inner">
      <div className="ed-preview-bar">
        <Segmented<Device>
          label="Preview size"
          size="sm"
          value={device}
          onChange={onDevice}
          options={(Object.keys(DEVICES) as Device[]).map((d) => ({ value: d, label: <span className="ed-dev-label">{DEVICES[d].label}</span>, title: `${DEVICES[d].label} · ${DEVICES[d].w} × ${DEVICES[d].h}`, icon: DEVICES[d].icon }))}
        />
        {tools}
      </div>
      <DraftPreview ref={ref} path={path} device={device} onMessage={onMessage} />
    </div>
  )
})
