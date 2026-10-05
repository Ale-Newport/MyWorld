import type { ComponentType } from 'react'
import type { ContactAnimationProps, SectionAnimationProps, UniverseAnimationProps } from './types'

/* ============================================================
   ONE CHUNK PER ANIMATION

   The public page imports this map, not the animations: each
   entry is its own chunk, and a page downloads only the option
   each of its sections has selected (SectionAnimation.tsx), well
   before the visitor reaches it. The ids are catalog.ts's.
   ============================================================ */

type Loader<P> = () => Promise<{ default: ComponentType<P> }>

export const ABOUT_LOADERS: Record<string, Loader<SectionAnimationProps>> = {
  'about.journey-ribbon': () => import('./about/JourneyRibbon'),
  'about.identity-assembly': () => import('./about/IdentityAssembly'),
  'about.profile-frame': () => import('./about/ProfileFrame'),
  'about.interest-constellation': () => import('./about/InterestConstellation'),
  'about.type-motion': () => import('./about/TypeMotion'),
}

export const UNIVERSE_LOADERS: Record<string, Loader<UniverseAnimationProps>> = {
  'universe.constellation': () => import('./universe/Constellation'),
  'universe.orbits': () => import('./universe/Orbits'),
  'universe.gallery': () => import('./universe/Gallery'),
  'universe.mosaic': () => import('./universe/Mosaic'),
  'universe.layered-field': () => import('./universe/LayeredField'),
}

export const CONTACT_LOADERS: Record<string, Loader<ContactAnimationProps>> = {
  'contact.botanical-gateway': () => import('./contact/BotanicalGateway'),
  'contact.converging-paths': () => import('./contact/ConvergingPaths'),
  'contact.stepping-path': () => import('./contact/SteppingPath'),
  'contact.contour-horizon': () => import('./contact/ContourHorizon'),
  'contact.ribbon-aperture': () => import('./contact/RibbonAperture'),
}

// Each section passes its own props; the slot only needs to know it can render the module.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyLoader = () => Promise<{ default: ComponentType<any> }>

export const LOADERS: Record<string, AnyLoader> = { ...ABOUT_LOADERS, ...UNIVERSE_LOADERS, ...CONTACT_LOADERS }
