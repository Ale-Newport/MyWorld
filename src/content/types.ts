/* ============================================================
   CONTENT DATA MODEL
   Every piece of narrative content on the site is described
   here. Components read from `src/content/*` — nothing is
   hardcoded in JSX.
   ============================================================ */

export type ChapterId =
  | 'prelude'
  | 'about'
  | 'kcl'
  | 'pansofia'
  | 'teaching'
  | 'focus'
  | 'gym'
  | 'metaview'
  | 'chess'
  | 'stock'
  | 'universe'
  | 'toolbox'
  | 'ucl'
  | 'contact'

/**
 * The journey has no themes — it is white end to end. This union
 * survives for `src/content/world.ts`, where a district still
 * declares one.
 */
export type Theme = 'light' | 'dark'

/** Narrative weight. Drives layout, duration and visual budget. */
export type Importance = 'hero' | 'featured' | 'archive'

/** How much of this entry is verified from a primary source. */
export type DataStatus = 'verified' | 'partially-verified' | 'placeholder' | 'needs-review'

/** Whether the visual assets are real or a coded stand-in. */
export type AssetStatus = 'real' | 'generated' | 'placeholder' | 'none-required'

export type ProjectCategory =
  | 'ai-ml'
  | 'software'
  | 'web'
  | 'mobile'
  | '3d'
  | 'data'
  | 'university'
  | 'experiment'
  | 'client-work'

/** Which procedural motion component renders this project. */
export type MotionComponent =
  | 'ChessMotion'
  | 'StockMotion'
  | 'ThreeBodyMotion'
  | 'VpnMotion'
  | 'GymMotion'
  | 'FocusMotion'
  | 'KeyframesMotion'
  | 'LabyrinthMotion'
  | 'PrimesMotion'
  | 'VoxelMotion'
  | 'CardsMotion'
  | 'DotsBoxesMotion'
  | 'TrainingMotion'
  | 'CatanMotion'
  | 'VideoPlayerMotion'
  | 'WebsiteMotion'
  | 'LibraryMotion'
  | 'JobBoardMotion'
  | 'GenericProjectMotion'

export interface Metric {
  label: string
  value: string
  /** Numeric target used by count-up animations. */
  numeric?: number
  suffix?: string
  prefix?: string
  note?: string
}

export interface ProjectPresentation {
  type: 'procedural' | 'screenshot-motion' | 'hybrid' | 'static'
  motionComponent: MotionComponent
  /** Human-readable description of the motion concept — used in docs + dev overlay. */
  concept: string
  interaction: string
  /** Approximate seconds of designed motion. */
  duration: number
}

export interface ProjectAssets {
  screenshots: string[]
  videos: string[]
  models: string[]
  textures: string[]
  audio: string[]
}

export interface Project {
  id: string
  slug: string
  title: string
  /** Short display name for tight spaces (universe labels, chips). */
  shortTitle?: string
  year: string
  dates?: string
  source: 'personal' | 'university' | 'client' | 'professional'
  organisation?: string
  category: ProjectCategory
  subcategory?: string
  importance: Importance
  /** One line, <= 110 chars. Shown on hover in Project Universe. */
  shortDescription: string
  description: string
  contribution?: string
  verifiedFacts: string[]
  metrics: Metric[]
  technologies: string[]
  repository?: string
  liveUrl?: string
  chapter?: ChapterId
  /** 0..1 — where on the career timeline this sits. */
  timelinePosition: number
  presentation: ProjectPresentation
  assets: ProjectAssets
  assetStatus: AssetStatus
  dataStatus: DataStatus
  privateSource: boolean
  needsReplacement?: boolean
  featured: boolean
  /** Palette hint for the Universe node + overlay accent. */
  accent?: string
}

export interface Chapter {
  id: ChapterId
  index: number
  /** Two-digit index used in the INDEX overlay. */
  number: string
  title: string
  subtitle?: string
  /** Scroll length in viewport heights. Drives the whole pacing. */
  vh: number
  /** Shorter length when Quick View is active. */
  quickVh: number
  /** Timeline year marker, if this chapter advances the timeline. */
  year?: string
  label: string
}

export interface TechNode {
  id: string
  name: string
  group: 'language' | 'framework' | 'ai' | 'data' | 'cloud' | 'tooling'
  /** Project ids that provide real evidence of use. */
  evidence: string[]
  /** 1–3, drives node size. */
  weight: number
  note?: string
}
