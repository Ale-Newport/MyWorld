import type { MutableRefObject } from 'react'
import type { SiteContent } from '@/cms/derive'

/* ============================================================
   WHAT A SECTION ANIMATION RECEIVES

   Every option is a client component that fills the box its
   chapter gives it (`position: absolute; inset: 0` of a region the
   chapter's layout reserves) and never draws outside it. The
   chapter decides WHERE the animation sits at each screen size;
   the animation decides only what happens inside its box.

   The rules every option keeps (see src/sections/README.md):
     · read `progress.current` in a frame loop — it changes every
       frame without a React render;
     · do no per-frame work while `active` is false (subscribe to
       the shared ticker only while active);
     · draw a composed, still state under `reducedMotion`;
     · size from a ResizeObserver on its own box, never by
       measuring the DOM every frame;
     · release everything it created on unmount.
   ============================================================ */

export interface SectionAnimationProps {
  /** Chapter-local scroll progress: 0 as the section's stage arrives, 1 as it leaves (a little beyond either end while it crosses). */
  progress: MutableRefObject<number>
  /** The animation's box is on screen or about to be. While false, do nothing per frame. */
  active: boolean
  reducedMotion: boolean
  /** The administrator's intensity knob, 0..1 (what it means is the option's own: see catalog.ts). */
  intensity: number
  /** Multiplies the animation's clock, 0.5..1.5. Scroll-driven motion follows the scroll regardless. */
  speed: number
  /** The site's content, as every component reads it. */
  site: SiteContent
}

export type SiteProject = SiteContent['projects'][number]

/** "Project universe": the archive the section lists, and what the visitor does with it. */
export interface UniverseAnimationProps extends SectionAnimationProps {
  /** Every listed project, in display order. */
  projects: SiteProject[]
  /** Ids of the projects the current filter keeps. The others stay in place, subdued — never removed, so the composition does not jump. */
  visible: ReadonlySet<string>
  /** The active filter's id ('all' when none). */
  filter: string
  /** Opens a project's case study. */
  onOpen: (slug: string) => void
  /** Reports the project under the pointer or focus (null when none), for the chapter's label. */
  onHover: (slug: string | null) => void
}

/** A rectangle in the animation box's own CSS pixels. */
export interface Rect { x: number; y: number; w: number; h: number }

/** "End of journey": the closing words sit in the middle of the same box the animation fills. */
export interface ContactAnimationProps extends SectionAnimationProps {
  /**
   * The text-safe rectangles (the closing question and answer, the
   * links, the corner labels), in the box's CSS pixels, with margin
   * already added. Updated when the layout changes, never per frame.
   * Nothing the animation draws may enter them, at any point of its
   * motion.
   */
  safe: MutableRefObject<Rect[]>
  /** Bumped whenever `safe` changes, so an option can recompose. */
  safeVersion: number
}
