import type { ComponentType } from 'react'
import type { EffectProps } from './types'
import { MOTION_COMPONENTS } from '@/cms/schema'

/* ============================================================
   EFFECT LOADERS — the only part of the library a public page
   ever ships. Each entry is a dynamic import, so the bundler
   splits every effect into its own chunk and a page downloads
   exactly the effects placed on it, when they mount. The names,
   descriptions, parameter definitions and previews live in
   registry.ts, which only the admin imports.
   ============================================================ */

type Loader = () => Promise<{ default: ComponentType<EffectProps> }>

const projectVisual: Record<string, Loader> = Object.fromEntries(
  MOTION_COMPONENTS.map((m) => [`project.${m}`, () => import('./effects/ProjectVisualEffect').then((mod) => ({ default: mod.forMotion(m) }))]),
)

export const EFFECT_LOADERS: Record<string, Loader> = {
  'type.reveal': () => import('./effects/RevealEffect'),
  'data.counter': () => import('./effects/CounterEffect'),
  ...projectVisual,
}
