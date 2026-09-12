'use client'

import { Component, Suspense, lazy, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ComponentType, type ReactNode } from 'react'
import { useSite } from '@/cms/context'
import { useChapterFrame } from '@/hooks/useChapterProgress'
import { useJourney } from '@/state/journey'
import { ANIMATION_BY_ID, type AnimatedSection } from './catalog'
import { LOADERS } from './loaders'
import type { SectionAnimationProps } from './types'

/* ============================================================
   THE SLOT A SECTION'S ANIMATION PLAYS IN

   A chapter renders <SectionAnimation section="about" … /> in the
   region its layout reserves for it, and this:

     · picks the option the site document chose (validated in
       derive.ts; an unknown id falls back to the default);
     · downloads that option's chunk once the page is idle, so it
       is ready long before the visitor scrolls to it, and mounts
       it a screen or so ahead of arrival;
     · feeds it the chapter's scroll progress (a ref written every
       frame, no React renders) and whether its box is on screen;
     · keeps a failing animation from taking the section's text
       down with it.

   Nothing else on the page waits for it: the section's words are
   server-rendered and readable without it.

   `?section-animation=<id>[,<id>…]` swaps in another option for
   one visit — a review and QA aid that only ever picks among the
   options in the catalogue.
   ============================================================ */

const LAZY: Record<string, ComponentType<SectionAnimationProps & Record<string, unknown>>> = Object.fromEntries(
  Object.entries(LOADERS).map(([id, load]) => [id, lazy(load)]),
)

class Contain extends Component<{ id: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: unknown) {
    console.error(`[section animation] ${this.props.id} failed; the section carries on without it`, error)
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

const noSubscription = () => () => {}

function useOverride(section: AnimatedSection): string | null {
  // The server renders without it; the browser reads its own address after hydrating.
  const search = useSyncExternalStore(noSubscription, () => window.location.search, () => '')
  return useMemo(() => {
    const wanted = new URLSearchParams(search).get('section-animation')
    return wanted?.split(',').find((x) => ANIMATION_BY_ID[x]?.section === section) ?? null
  }, [search, section])
}

/** Warm one option's chunk while the browser is idle. */
function prefetch(id: string) {
  const load = LOADERS[id]
  if (!load) return () => {}
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (h: number) => void }
  if (w.requestIdleCallback) {
    const h = w.requestIdleCallback(() => void load().catch(() => {}), { timeout: 2500 })
    return () => w.cancelIdleCallback?.(h)
  }
  const t = window.setTimeout(() => void load().catch(() => {}), 1200)
  return () => window.clearTimeout(t)
}

type Extra = Record<string, unknown>

export function SectionAnimation({ section, extra, className, reserve = false }: {
  section: AnimatedSection
  extra?: Extra
  className?: string
  /** Keep the homepage's vegetation out of this box (a region of its own, not a backdrop). */
  reserve?: boolean
}) {
  const site = useSite()
  const override = useOverride(section)
  const chosen = site.animations[section]
  const settings = override && override !== chosen.id ? { ...chosen, id: override, ...ANIMATION_BY_ID[override].defaults } : chosen
  const reducedMotion = useJourney((s) => s.reducedMotion)
  const progress = useRef(0)
  const boxRef = useRef<HTMLDivElement>(null)
  const [near, setNear] = useState(false)
  const [active, setActive] = useState(false)

  useChapterFrame(section, (t) => {
    progress.current = t
  })

  useEffect(() => prefetch(settings.id), [settings.id])

  /* Two horizons: mount a good way ahead (so the first frame the
     visitor sees is already composed), run only when close. */
  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    const far = new IntersectionObserver(([e]) => { if (e.isIntersecting) setNear(true) }, { rootMargin: '150% 0px 150% 0px' })
    const close = new IntersectionObserver(([e]) => setActive(e.isIntersecting), { rootMargin: '15% 0px 15% 0px' })
    far.observe(box)
    close.observe(box)
    return () => {
      far.disconnect()
      close.disconnect()
    }
  }, [])

  const Comp = LAZY[settings.id]
  const props = useMemo(
    () => ({ progress, active, reducedMotion, intensity: settings.intensity, speed: settings.speed, site, ...extra }),
    [active, reducedMotion, settings.intensity, settings.speed, site, extra],
  )

  return (
    <div ref={boxRef} className={className} data-section-animation={settings.id} data-room-reserve={reserve ? '0' : undefined} aria-hidden={section === 'universe' ? undefined : true}>
      {near && Comp && (
        <Contain key={settings.id} id={settings.id}>
          <Suspense fallback={null}>
            <Comp {...props} />
          </Suspense>
        </Contain>
      )}
    </div>
  )
}
