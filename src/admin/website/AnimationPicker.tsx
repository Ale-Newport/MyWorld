'use client'

import { useId } from 'react'
import { useSiteStore } from '../store/site'
import { Panel, radioKeys } from '../ui/kit'
import { Icon } from '../ui/icons'
import { ABOUT_THUMBS } from '@/sections/about/thumbs'
import { UNIVERSE_THUMBS } from '@/sections/universe/thumbs'
import { CONTACT_THUMBS } from '@/sections/contact/thumbs'
import { DEFAULT_ANIMATION, INTENSITY, SECTION_ANIMATIONS, SPEED, resolveAnimation, type AnimatedSection } from '@/sections/catalog'

/* ============================================================
   CHOOSING A SECTION'S ANIMATION

   Five options, each with a still picture and one sentence; the
   chosen one plays in the preview beside the form — the real
   page, so what is seen here is what is published. Only that one
   runs: the pictures are static, so this panel never plays five
   (let alone fifteen) animations at once.

   Two knobs, and only two: intensity (what it changes is the
   option's own, named under the slider) and speed. Everything
   else about an animation — its layout, colours and timing — is
   the site's code.
   ============================================================ */

const THUMBS = { ...ABOUT_THUMBS, ...UNIVERSE_THUMBS, ...CONTACT_THUMBS }

export function AnimationPicker({ section, journey, onPreview }: { section: AnimatedSection; journey: 'home' | 'projects'; onPreview: () => void }) {
  const stored = useSiteStore((s) => s.doc?.journeys[journey].sections.find((x) => x.id === section)?.animation)
  const current = resolveAnimation(section, stored)
  const options = SECTION_ANIMATIONS[section]
  const chosen = options.find((o) => o.id === current.id)!
  const id = useId()

  const write = (next: { id: string; intensity?: number; speed?: number }, coalesce?: string) => useSiteStore.getState().apply((d) => {
    const s = d.journeys[journey].sections.find((x) => x.id === section)
    if (s) s.animation = next
  }, coalesce ? { coalesce } : undefined)

  const choose = (optionId: string) => {
    const o = options.find((x) => x.id === optionId)!
    write({ id: o.id, intensity: o.defaults.intensity, speed: o.defaults.speed })
  }

  return (
    <Panel
      title="Animation"
      description="Plays beside the text, never over it. Pick one; the preview shows it on the real page."
      actions={<button type="button" className="btn btn-sm" onClick={onPreview}><Icon name="eye" size={15} />Show in preview</button>}
    >
      <div className="ce-options" role="radiogroup" aria-label="Animation" onKeyDown={radioKeys(options.map((o) => o.id), current.id, choose)}>
        {options.map((o) => {
          const on = o.id === current.id
          return (
            <button key={o.id} type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1} className="ce-option" onClick={() => choose(o.id)}>
              <span className="ce-option-thumb" aria-hidden="true">{THUMBS[o.id] ?? <span className="ce-option-blank" />}</span>
              <span className="ce-option-text">
                <b>{o.name}{o.id === DEFAULT_ANIMATION[section] && <span className="badge">Default</span>}</b>
                <span>{o.description}</span>
              </span>
              {on && <span className="ce-option-check"><Icon name="check" size={16} /></span>}
            </button>
          )
        })}
      </div>

      <div className="grid-2 ce-knobs">
        <div className="field">
          <label htmlFor={`${id}-i`}>Intensity <span className="a-sub">— {chosen.intensityLabel.toLowerCase()}</span></label>
          <div className="ce-range">
            <input id={`${id}-i`} type="range" min={INTENSITY.min} max={INTENSITY.max} step={INTENSITY.step} value={current.intensity} onChange={(e) => write({ ...current, intensity: Number(e.target.value) }, `anim:${section}:i`)} />
            <output htmlFor={`${id}-i`}>{Math.round(current.intensity * 100)}%</output>
          </div>
        </div>
        <div className="field">
          <label htmlFor={`${id}-s`}>Speed</label>
          <div className="ce-range">
            <input id={`${id}-s`} type="range" min={SPEED.min} max={SPEED.max} step={SPEED.step} value={current.speed} onChange={(e) => write({ ...current, speed: Number(e.target.value) }, `anim:${section}:s`)} />
            <output htmlFor={`${id}-s`}>{current.speed.toFixed(2)}×</output>
          </div>
        </div>
      </div>
      {(current.intensity !== chosen.defaults.intensity || current.speed !== chosen.defaults.speed) && (
        <div><button type="button" className="btn btn-sm btn-ghost" onClick={() => choose(chosen.id)}><Icon name="reset" size={14} />Reset intensity and speed</button></div>
      )}
      <small className="a-hint">Visitors who ask their device for reduced motion see a still, composed version of whichever animation is chosen.</small>
    </Panel>
  )
}
