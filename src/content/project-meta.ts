import type { Project, ProjectCategory } from './types'

/* Presentation constants for projects. No project data lives here, so
   client components can import these without bundling the inventory. */

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

