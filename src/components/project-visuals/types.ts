import type { Project } from '@/content/types'

/**
 * SHARED CONTRACT for every project motion graphic.
 * Each visual is a self-contained Canvas2D/SVG component that
 * explains one project. It must:
 *   - fill its container (100% width & height, no fixed size)
 *   - read colours from CSS custom properties, never hardcode
 *     theme colours
 *   - honour `reducedMotion` by rendering a meaningful static
 *     end-state instead of animating
 *   - pause when off-screen (use the useCanvas2D hook)
 */
export interface ProjectVisualProps {
  /** The project this visual explains — read metrics/labels from it. */
  project?: Project
  /** 0..1 when the visual is scroll-linked; undefined when self-running. */
  progress?: number
  /** True while the owning chapter/overlay is on screen. */
  active?: boolean
  reducedMotion?: boolean
  className?: string
  /** Optional interaction toggle — set false inside dense grids. */
  interactive?: boolean
}

/** Reads a themed colour from CSS custom properties at draw time. */
export function themeColor(el: Element | null, name: string, fallback: string): string {
  if (!el) return fallback
  const v = getComputedStyle(el).getPropertyValue(name).trim()
  return v || fallback
}

/** The visual palette every project graphic draws from. */
export interface VisualPalette {
  ink: string
  inkSoft: string
  inkFaint: string
  bg: string
  accent: string
  signal: string
}

export function readPalette(el: Element | null): VisualPalette {
  return {
    ink: themeColor(el, '--text-primary', '#0c0c0d'),
    inkSoft: themeColor(el, '--text-secondary', '#3a3a3e'),
    inkFaint: themeColor(el, '--text-faint', '#a6a6ad'),
    bg: themeColor(el, '--bg-primary', '#f4f2ee'),
    accent: themeColor(el, '--accent', '#d4491f'),
    signal: themeColor(el, '--signal', '#2f6f5e'),
  }
}
