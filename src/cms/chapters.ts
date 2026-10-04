/** Chapters the site has components for (src/components/journey/Journey.tsx). Sections of kind 'chapter' must be one of these. */
export const CHAPTER_IDS = ['prelude', 'about', 'toolbox', 'universe', 'education', 'contact', 'pansofia', 'teaching', 'focus', 'gym', 'metaview', 'chess', 'stock'] as const
export type ChapterComponentId = (typeof CHAPTER_IDS)[number]

/**
 * What a chapter cannot be told without. If the project or role it is
 * about is unpublished, the chapter drops out of its journey instead of
 * rendering a hole (src/cms/derive.ts).
 */
export const CHAPTER_REQUIRES: Partial<Record<ChapterComponentId, { project?: string; experience?: string }>> = {
  focus: { project: 'focus', experience: 'focus' },
  gym: { project: 'gym-app' },
  chess: { project: 'chess-assistant' },
  stock: { project: 'stock-market-simulator' },
  metaview: { experience: 'metaview' },
  teaching: { experience: 'kcl-gta' },
  pansofia: { experience: 'pansofia' },
}
