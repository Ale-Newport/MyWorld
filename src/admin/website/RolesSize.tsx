'use client'

import { useId } from 'react'
import { useSiteStore } from '../store/site'
import { Panel } from '../ui/kit'
import { Icon } from '../ui/icons'

/* ============================================================
   HOW LARGE THE ROLES UNDER THE NAME ARE SET

   The one size the editor owns on the opening screen: the rotating
   roles are the name's subtitle, and how loud that subtitle is is
   a matter of taste rather than of layout. It is a multiple of the
   size the site's code gives them at each screen width, so a phone
   and a desktop both keep their proportions; the code still caps it
   on a phone on its side.
   ============================================================ */

const MIN = 0.6
const MAX = 2
const STEP = 0.05

export function RolesSize() {
  const id = useId()
  const value = useSiteStore((s) => s.doc?.journeys.home.sections.find((x) => x.id === 'prelude')?.rolesSize ?? 1)
  const write = (v: number | undefined) => useSiteStore.getState().apply((d) => {
    const s = d.journeys.home.sections.find((x) => x.id === 'prelude')
    if (!s) return
    if (v === undefined || v === 1) delete s.rolesSize
    else s.rolesSize = Math.round(v * 100) / 100
  }, { coalesce: 'prelude:rolesSize' })

  return (
    <Panel title="Size of the rotating roles" description="The subtitle under your name. The size scales with the screen; this sets how large it is at every width.">
      <div className="field">
        <label htmlFor={id}>Size</label>
        <div className="ce-range">
          <input id={id} type="range" min={MIN} max={MAX} step={STEP} value={value} onChange={(e) => write(Number(e.target.value))} />
          <output htmlFor={id}>{Math.round(value * 100)}%</output>
        </div>
      </div>
      {value !== 1 && (
        <div><button type="button" className="btn btn-sm btn-ghost" onClick={() => write(undefined)}><Icon name="reset" size={14} />Back to the default size</button></div>
      )}
    </Panel>
  )
}
