import type { Project, ProjectCategory, Importance } from '../types'
import { personalProjects } from './personal'
import { clientProjects } from './client'

export const projects: Project[] = [...personalProjects, ...clientProjects]

export const projectBySlug = Object.fromEntries(projects.map((p) => [p.slug, p]))
export const projectById = Object.fromEntries(projects.map((p) => [p.id, p]))

export const heroProjects = projects.filter((p) => p.importance === 'hero')
export const featuredProjects = projects.filter((p) => p.importance === 'featured')
export const archiveProjects = projects.filter((p) => p.importance === 'archive')

export function byImportance(i: Importance) {
  return projects.filter((p) => p.importance === i)
}

export function byChapter(id: string) {
  return projects.filter((p) => p.chapter === id)
}

/** Filters offered in the Project Universe. */
export const universeFilters: { id: string; label: string; match: (p: Project) => boolean }[] = [
  { id: 'all',        label: 'All',         match: () => true },
  { id: 'ai-ml',      label: 'AI / ML',     match: (p) => p.category === 'ai-ml' },
  { id: 'software',   label: 'Software',    match: (p) => p.category === 'software' },
  { id: 'web',        label: 'Web',         match: (p) => p.category === 'web' },
  { id: 'mobile',     label: 'Mobile',      match: (p) => p.category === 'mobile' },
  { id: '3d',         label: '3D',          match: (p) => p.category === '3d' },
  { id: 'university', label: 'University',  match: (p) => p.source === 'university' || p.category === 'university' },
  { id: 'experiment', label: 'Experiments', match: (p) => p.category === 'experiment' },
  { id: 'client',     label: 'Client Work', match: (p) => p.source === 'client' },
]

/** Category → display colour used by the Universe nodes. */
/**
 * Category colour. Deliberately narrow: everything sits between
 * the site's vermilion and its muted teal, with graphite for the
 * quieter tiers. A rainbow would make the archive look like a
 * chart rather than a body of work.
 */
export const categoryAccent: Record<ProjectCategory, string> = {
  'ai-ml': '#d4491f',
  software: '#3f7a68',
  web: '#8a8a92',
  mobile: '#9a8578',
  '3d': '#7d7488',
  data: '#5f8490',
  university: '#8d8467',
  experiment: '#6f6f76',
  'client-work': '#a8683f',
}

/** Content-health summary — powers CONTENT_STATUS.md and the dev overlay. */
export function contentHealth() {
  const total = projects.length
  const needsReview = projects.filter((p) => p.dataStatus !== 'verified')
  const placeholderAssets = projects.filter((p) => p.assetStatus === 'placeholder')
  return {
    total,
    verified: total - needsReview.length,
    needsReview: needsReview.map((p) => p.slug),
    placeholderAssets: placeholderAssets.map((p) => p.slug),
  }
}
