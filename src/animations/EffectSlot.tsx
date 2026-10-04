'use client'

import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ComponentType, type CSSProperties, type LazyExoticComponent } from 'react'
import { EFFECT_LOADERS } from './runtime'
import { MotionTuningContext } from './tuning'
import { bool, color, num, pick, type EffectProps } from './types'

/* ============================================================
   THE EFFECT FRAME

   Every placed animation runs inside one of these. It owns the
   controls every effect shares, so each effect only has to draw:

     trigger     viewport (default) · hover · click · time · always
     delay       seconds before the trigger counts
     speed       multiplies the effect's clock (see tuning.ts)
     scrollStart / scrollEnd / scrollFollow
                 where in the element's pass through the viewport
                 its progress runs from 0 to 1, and how strongly it
                 follows the scroll (0 = ignores it)
     accent / ink / surface
                 colours, as CSS custom properties the effect reads

   Reduced motion is decided here once and passed down: every
   effect renders a composed still frame instead of animating.
   ============================================================ */

/* lazy() fetches nothing until a component renders, so wrapping every loader up front costs nothing. */
const LAZY: Record<string, LazyExoticComponent<ComponentType<EffectProps>>> = Object.fromEntries(
  Object.entries(EFFECT_LOADERS).map(([id, loader]) => [id, lazy(loader)]),
)

function useReducedMotion() {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const apply = () => setReduced(mq.matches)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])
  return reduced
}

export function EffectSlot({ effect, params, style, className }: { effect: string; params: Record<string, unknown>; style?: CSSProperties; className?: string }) {
  const host = useRef<HTMLDivElement>(null)
  const progress = useRef(0)
  const reducedMotion = useReducedMotion()
  const trigger = pick(params.trigger, ['viewport', 'hover', 'click', 'time', 'always'] as const, 'viewport')
  const delay = num(params.delay, 0, 0, 30)
  /* What the trigger observed, and which "on" period it belongs to, so a delay is counted afresh each time. */
  const [observed, setObserved] = useState({ on: false, session: 0 })
  const [delayedSession, setDelayedSession] = useState(-1)
  const Comp = LAZY[effect]
  const constant = trigger === 'always' || trigger === 'time'
  const raw = constant || observed.on
  const session = constant ? 0 : observed.session
  const active = raw && (delay === 0 || delayedSession === session)

  /* trigger → observed state (event callbacks only) */
  useEffect(() => {
    const el = host.current
    if (!el || constant) return
    const set = (on: boolean) => setObserved((v) => (v.on === on ? v : { on, session: on ? v.session + 1 : v.session }))
    if (trigger === 'viewport') {
      const io = new IntersectionObserver(([e]) => set(e.isIntersecting), { threshold: 0.2 })
      io.observe(el)
      return () => io.disconnect()
    }
    if (trigger === 'hover') {
      const on = () => set(true), off = () => set(false)
      el.addEventListener('pointerenter', on); el.addEventListener('pointerleave', off); el.addEventListener('focusin', on); el.addEventListener('focusout', off)
      return () => { el.removeEventListener('pointerenter', on); el.removeEventListener('pointerleave', off); el.removeEventListener('focusin', on); el.removeEventListener('focusout', off) }
    }
    const toggle = () => setObserved((v) => ({ on: !v.on, session: v.on ? v.session : v.session + 1 }))
    el.addEventListener('click', toggle)
    return () => el.removeEventListener('click', toggle)
  }, [trigger, constant])

  /* delay, per "on" period */
  useEffect(() => {
    if (!raw || !delay) return
    const t = window.setTimeout(() => setDelayedSession(session), delay * 1000)
    return () => window.clearTimeout(t)
  }, [raw, delay, session])

  /* scroll progress, written to a ref every frame while on screen */
  const start = num(params.scrollStart, 0, 0, 1)
  const end = num(params.scrollEnd, 1, 0, 1)
  const follow = num(params.scrollFollow, 1, 0, 1)
  useEffect(() => {
    const el = host.current
    if (!el) return
    let raf = 0
    let visible = false
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting })
    io.observe(el)
    const tick = () => {
      raf = requestAnimationFrame(tick)
      if (!visible) return
      const r = el.getBoundingClientRect()
      const vh = window.innerHeight || 1
      const pass = (vh - r.top) / (vh + r.height)
      const ranged = end > start ? (pass - start) / (end - start) : pass
      const p = Math.min(1, Math.max(0, ranged))
      progress.current = follow * p + (1 - follow) * 1
    }
    raf = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(raf); io.disconnect() }
  }, [start, end, follow])

  const vars = {
    '--fx-accent': color(params.accent, 'var(--accent)'),
    '--fx-ink': color(params.ink, 'var(--text-primary)'),
    '--fx-surface': color(params.surface, 'transparent'),
    // Visuals written before the library read the site's own tokens.
    '--accent': color(params.accent, 'var(--accent)'),
    position: 'relative',
    width: '100%',
    height: '100%',
    background: 'var(--fx-surface)',
    cursor: trigger === 'click' ? 'pointer' : undefined,
    ...style,
  } as CSSProperties
  const tuning = useMemo(() => ({ timeScale: num(params.speed, 1, 0.1, 4) }), [params.speed])

  if (!Comp) return <div ref={host} className={className} style={vars} data-effect-missing={effect} aria-hidden="true" />
  return (
    <div ref={host} className={className} style={vars} data-effect={effect} data-active={active || undefined} tabIndex={trigger === 'click' || trigger === 'hover' ? 0 : undefined}>
      <MotionTuningContext.Provider value={tuning}>
        <Suspense fallback={null}>
          <Comp params={params} progress={progress} active={active || bool(params.preview, false)} reducedMotion={reducedMotion} />
        </Suspense>
      </MotionTuningContext.Provider>
    </div>
  )
}
