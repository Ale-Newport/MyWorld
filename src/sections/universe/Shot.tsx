'use client'

import { useState } from 'react'
import type { SiteProject } from '../types'
import { isBlankCapture, shotOf } from './shared'

/**
 * A project's real capture, faded in over whatever the frame
 * already shows once it has loaded and proved to be a picture
 * (see isBlankCapture). Lazy, decoded off the main thread, and
 * sized, so a wall of them never shifts or blocks.
 */
export function Shot({ p, narrow, className, width, height }: { p: SiteProject; narrow: boolean; className?: string; width: number; height: number }) {
  const shot = shotOf(p, narrow)
  const [state, setState] = useState<'wait' | 'ok' | 'blank'>('wait')
  if (!shot || state === 'blank') return null
  return (
    <picture>
      {shot.avif && <source srcSet={shot.avif} type="image/avif" />}
      <img
        src={shot.src}
        alt=""
        className={className}
        data-ready={state === 'ok' || undefined}
        loading="lazy"
        decoding="async"
        draggable={false}
        width={Math.round(width)}
        height={Math.round(height)}
        onLoad={(e) => setState(isBlankCapture(e.currentTarget) ? 'blank' : 'ok')}
        onError={() => setState('blank')}
      />
    </picture>
  )
}

/** Whether a project has a capture to show at all (before loading it). */
export const hasShot = (p: SiteProject) => (p.assets?.screenshots?.length ?? 0) > 0
