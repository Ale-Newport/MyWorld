import type { ComponentType } from 'react'
import type { EffectProps } from './types'
import { MOTION_COMPONENTS } from '@/cms/motion'

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
  'text.typewriter': () => import('./effects/TypewriterEffect'),
  'text.split-flap': () => import('./effects/SplitFlapEffect'),
  'text.marquee': () => import('./effects/MarqueeEffect'),
  'text.highlight': () => import('./effects/HighlightEffect'),
  'data.bars': () => import('./effects/BarsEffect'),
  'data.gauge': () => import('./effects/GaugeEffect'),
  'data.sparkline': () => import('./effects/SparklineEffect'),
  'shape.orbits': () => import('./effects/OrbitsEffect'),
  'shape.blob': () => import('./effects/BlobEffect'),
  'shape.line-draw': () => import('./effects/LineDrawEffect'),
  'particles.flow-field': () => import('./effects/FlowFieldEffect'),
  'particles.constellation': () => import('./effects/ConstellationEffect'),
  'background.gradient-mesh': () => import('./effects/GradientMeshEffect'),
  'background.dot-ripple': () => import('./effects/DotRippleEffect'),
  'interaction.tilt-card': () => import('./effects/TiltCardEffect'),
  'scroll.parallax-layers': () => import('./effects/ParallaxLayersEffect'),
  'transition.wipe': () => import('./effects/WipeEffect'),
  ...projectVisual,
}
