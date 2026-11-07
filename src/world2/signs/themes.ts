import { TOKENS, contrastRatio } from './palette'
import { ACCENT, mixHex } from './accent'
import type { CharmKind } from './geometry'

/* ============================================================
   ONE SYSTEM, MANY PERSONALITIES

   A sign's character is data, not code: which little picture it
   carries, what colour its ribbon is, which ornament hangs from
   it, whether it is hung on oak, rope, chain or ivy. Every
   project board, plaza plaque or career label picks a record
   from here (or hands in its own), and the kit does the rest —
   so two signs can look nothing alike and still belong to the
   same island.
   ============================================================ */

export type EmblemKind =
  | 'chess' | 'stock' | 'orbit' | 'gym' | 'pipeline' | 'tunnel' | 'timeline' | 'maze'
  | 'rings' | 'browser' | 'cards' | 'jobs' | 'voxel' | 'books' | 'dots'

export type HardwareKind = 'oak' | 'rope' | 'chain' | 'vine'

export interface SignTheme {
  id: string
  /** The animated picture on the sign's face; null for a sign with none. */
  emblem: EmblemKind | null
  /** Ribbon fill, its fold shade and the lettering on it (every pair is >= 4.5:1, see the palette test). */
  ribbon: string
  ribbonDeep: string
  ribbonInk: string
  /** Colour of rules, seals and highlights drawn on the face. */
  accent: string
  /** The ornament that hangs from or stands on the sign. */
  charm: CharmKind
  hardware: HardwareKind
}

/* The site's accent (./accent) as a ribbon: a shade down from the colour itself, as the terracotta ribbon was from the
   terracotta, and lettered in cream unless the colour chosen in the editor is too light to carry it. */
const accentRibbon = mixHex(ACCENT, '#000000', 0.12)
const accent = { ribbon: accentRibbon, ribbonDeep: mixHex(ACCENT, '#000000', 0.34), ribbonInk: contrastRatio(TOKENS.cream, accentRibbon) >= 4.5 ? TOKENS.cream : TOKENS.ink, accent: ACCENT }
const teal = { ribbon: '#2f6f5e', ribbonDeep: '#1f4d41', ribbonInk: TOKENS.cream, accent: TOKENS.teal }
const leaf = { ribbon: '#4b6a1d', ribbonDeep: '#344a13', ribbonInk: TOKENS.cream, accent: TOKENS.leaf }
const ochre = { ribbon: TOKENS.gold, ribbonDeep: '#a9790a', ribbonInk: TOKENS.ink, accent: '#a9790a' }
const timber = { ribbon: TOKENS.woodDark, ribbonDeep: '#3b3524', ribbonInk: TOKENS.cream, accent: TOKENS.copper }

export const SIGN_THEMES: Record<string, SignTheme> = {
  chess: { id: 'chess', emblem: 'chess', ...accent, charm: 'pawn', hardware: 'oak' },
  stock: { id: 'stock', emblem: 'stock', ...teal, charm: 'coin', hardware: 'rope' },
  orbit: { id: 'orbit', emblem: 'orbit', ...timber, charm: 'planet', hardware: 'oak' },
  gym: { id: 'gym', emblem: 'gym', ...accent, charm: 'dumbbell', hardware: 'rope' },
  pipeline: { id: 'pipeline', emblem: 'pipeline', ...leaf, charm: 'leaf', hardware: 'vine' },
  tunnel: { id: 'tunnel', emblem: 'tunnel', ...teal, charm: 'padlock', hardware: 'chain' },
  timeline: { id: 'timeline', emblem: 'timeline', ...ochre, charm: 'diamond', hardware: 'oak' },
  maze: { id: 'maze', emblem: 'maze', ...leaf, charm: 'compass', hardware: 'vine' },
  rings: { id: 'rings', emblem: 'rings', ...accent, charm: 'acorn', hardware: 'oak' },
  browser: { id: 'browser', emblem: 'browser', ...teal, charm: 'pennant', hardware: 'rope' },
  cards: { id: 'cards', emblem: 'cards', ...accent, charm: 'cards', hardware: 'oak' },
  jobs: { id: 'jobs', emblem: 'jobs', ...teal, charm: 'pennant', hardware: 'rope' },
  voxel: { id: 'voxel', emblem: 'voxel', ...leaf, charm: 'gear', hardware: 'oak' },
  books: { id: 'books', emblem: 'books', ...accent, charm: 'books', hardware: 'oak' },
  dots: { id: 'dots', emblem: 'dots', ...ochre, charm: 'diamond', hardware: 'rope' },
  /** Plain timber: no picture, no charm. For plaques that only carry words. */
  plain: { id: 'plain', emblem: null, ...timber, charm: 'none', hardware: 'oak' },
}

export const DEFAULT_THEME = SIGN_THEMES.rings

/** Which theme each project motion component gets. The CMS offers these by name. */
export const MOTION_THEME: Record<string, string> = {
  ChessMotion: 'chess', StockMotion: 'stock', ThreeBodyMotion: 'orbit', GymMotion: 'gym',
  FocusMotion: 'pipeline', VideoPlayerMotion: 'pipeline', VpnMotion: 'tunnel',
  KeyframesMotion: 'timeline', TrainingMotion: 'timeline', LabyrinthMotion: 'maze', CatanMotion: 'maze',
  PrimesMotion: 'rings', GenericProjectMotion: 'rings', WebsiteMotion: 'browser',
  CardsMotion: 'cards', JobBoardMotion: 'jobs', VoxelMotion: 'voxel', LibraryMotion: 'books', DotsBoxesMotion: 'dots',
}

const CATEGORY_THEME: Record<string, string> = {
  'ai / ml': 'rings', software: 'stock', web: 'browser', mobile: 'jobs', '3d': 'orbit',
  data: 'timeline', university: 'timeline', experiment: 'maze', 'client work': 'browser',
}

export const themeById = (id: string | undefined | null): SignTheme => (id ? SIGN_THEMES[id] : undefined) ?? DEFAULT_THEME

/** The theme for a board entry: its motion component first, then its category, then the default. */
export function themeForProject(project: { motion?: string | null; category?: string | null }): SignTheme {
  const byMotion = project.motion ? MOTION_THEME[project.motion] : undefined
  if (byMotion) return SIGN_THEMES[byMotion]
  const byCategory = project.category ? CATEGORY_THEME[project.category.toLowerCase()] : undefined
  return byCategory ? SIGN_THEMES[byCategory] : DEFAULT_THEME
}
