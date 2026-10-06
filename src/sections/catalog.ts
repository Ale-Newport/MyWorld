/* ============================================================
   SECTION ANIMATIONS — THE CATALOGUE

   Three homepage sections have a choice of animation: "A little
   about me", "Project universe" and "End of journey". Each has
   exactly five, all written for that section and its real content.
   The administrator picks one per section and may turn two
   knobs on it, intensity and speed. Nothing else about an
   animation is editable: its layout, colours and timing are code,
   so no choice made in the admin can break the page at any size.

   This file is plain data so the server can validate a document,
   the admin can describe the options and the public page can load
   the one component it needs (see ./loaders.ts) without any of
   them pulling in the others.

   Ids are stable. A stored id that is no longer listed here (an
   option that was retired) is dropped when the document is read,
   and the section falls back to its default (cms/migrate.ts).
   ============================================================ */

export const ANIMATED_SECTIONS = ['about', 'universe'] as const
export type AnimatedSection = (typeof ANIMATED_SECTIONS)[number]

export interface SectionAnimationOption {
  id: string
  section: AnimatedSection
  name: string
  /** One sentence for the admin: what the visitor sees. */
  description: string
  /** What the intensity knob changes for this option, in words. */
  intensityLabel: string
  defaults: { intensity: number; speed: number }
}

export interface SectionAnimationSettings {
  id: string
  intensity: number
  speed: number
}

export const INTENSITY = { min: 0, max: 1, step: 0.05 } as const
export const SPEED = { min: 0.5, max: 1.5, step: 0.05 } as const

const option = (section: AnimatedSection, slug: string, name: string, description: string, intensityLabel: string, defaults = { intensity: 0.65, speed: 1 }): SectionAnimationOption => ({
  id: `${section}.${slug}`,
  section,
  name,
  description,
  intensityLabel,
  defaults,
})

export const SECTION_ANIMATIONS: Record<AnimatedSection, SectionAnimationOption[]> = {
  about: [
    option('about', 'journey-ribbon', 'Journey ribbon', 'A ribbon threads through the real milestones — places, universities, roles — and each one settles onto it as the section is read.', 'How far the ribbon folds'),
    option('about', 'identity-assembly', 'Assembling identity', 'Roles, disciplines and the strongest technologies arrive from the margins and lock into one balanced composition.', 'How many pieces take part'),
    option('about', 'profile-frame', 'Layered profile frame', 'The initials and the facts of the profile are revealed through nested, offset frames that open in depth.', 'Depth of the frames'),
    option('about', 'interest-constellation', 'Interest constellation', 'Real skills and the areas they belong to form a quiet, connected constellation that draws itself in.', 'How many links are drawn'),
    option('about', 'type-motion', 'Typographic identity', 'The name and the through-lines are set as large moving type that slides, crosses and resolves into place.', 'Scale of the type'),
  ],
  universe: [
    option('universe', 'constellation', 'Project constellation', 'Every project is a star; related work is joined by fine lines, and the filters light up their part of the sky.', 'Number of connections'),
    option('universe', 'orbits', 'Orbital system', 'Projects travel concentric orbits by importance — the headline work innermost — around one quiet centre.', 'Depth of the orbits'),
    option('universe', 'gallery', 'Dimensional gallery', 'Projects hang as frames in a small spatial gallery that turns to bring each one into focus.', 'Depth of the room'),
    option('universe', 'mosaic', 'Magnetic mosaic', 'A tidy mosaic of project tiles that leans gently towards the pointer or the focused tile.', 'Strength of the pull'),
    option('universe', 'layered-field', 'Layered field', 'Project panels drift in on separate depth planes and settle into one composed field as you scroll.', 'Parallax depth'),
  ],
}

export const DEFAULT_ANIMATION: Record<AnimatedSection, string> = {
  about: 'about.journey-ribbon',
  universe: 'universe.orbits',
}

export const ANIMATION_BY_ID: Record<string, SectionAnimationOption> = Object.fromEntries(
  ANIMATED_SECTIONS.flatMap((s) => SECTION_ANIMATIONS[s].map((o) => [o.id, o])),
)

export const isAnimatedSection = (id: string): id is AnimatedSection => (ANIMATED_SECTIONS as readonly string[]).includes(id)

const clampTo = (v: unknown, min: number, max: number, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback)

/** The animation a section shows: its stored choice when that still exists, otherwise the default, with both knobs in range. */
export function resolveAnimation(section: AnimatedSection, stored: { id?: string; intensity?: number; speed?: number } | undefined): SectionAnimationSettings {
  const chosen = stored?.id && ANIMATION_BY_ID[stored.id]?.section === section ? ANIMATION_BY_ID[stored.id] : ANIMATION_BY_ID[DEFAULT_ANIMATION[section]]
  return {
    id: chosen.id,
    intensity: clampTo(stored?.id === chosen.id ? stored.intensity : undefined, INTENSITY.min, INTENSITY.max, chosen.defaults.intensity),
    speed: clampTo(stored?.id === chosen.id ? stored.speed : undefined, SPEED.min, SPEED.max, chosen.defaults.speed),
  }
}
