import type { Project, Importance } from '../types'
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

export { universeFilters, categoryAccent } from '../project-meta'

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
