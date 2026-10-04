import type { ElementNode, SiteDocument } from './schema'
import { CHAPTER_IDS } from './chapters'

/* Cross-reference checks the schema cannot express: unique ids
   and slugs, evidence pointing at real projects, sections that
   exist, groups whose members exist. Run before every save and
   again before publishing. */

export interface ReferenceProblem {
  path: string
  message: string
}

function walk(nodes: ElementNode[], visit: (n: ElementNode) => void) {
  for (const n of nodes) {
    visit(n)
    if (n.children) walk(n.children, visit)
  }
}

export function validateSiteReferences(doc: SiteDocument): ReferenceProblem[] {
  const problems: ReferenceProblem[] = []
  const projectIds = new Set<string>()
  const slugs = new Set<string>()
  doc.projects.forEach((p, i) => {
    if (projectIds.has(p.id)) problems.push({ path: `projects.${i}.id`, message: `Two projects share the id “${p.id}”` })
    if (slugs.has(p.slug)) problems.push({ path: `projects.${i}.slug`, message: `Two projects share the slug “${p.slug}”` })
    projectIds.add(p.id)
    slugs.add(p.slug)
  })
  doc.techNodes.forEach((t, i) => t.evidence.forEach((e) => {
    if (!projectIds.has(e)) problems.push({ path: `techNodes.${i}.evidence`, message: `“${t.name}” cites a project that does not exist (${e})` })
  }))
  for (const [name, list] of Object.entries(doc.collections)) list.forEach((pid) => {
    if (!projectIds.has(pid)) problems.push({ path: `collections.${name}`, message: `The list “${name}” includes a project that does not exist (${pid})` })
  })
  const sectionIds = new Set<string>()
  for (const key of ['home', 'projects'] as const) {
    doc.journeys[key].sections.forEach((s, i) => {
      if (sectionIds.has(s.id)) problems.push({ path: `journeys.${key}.sections.${i}`, message: `Section “${s.id}” appears twice` })
      sectionIds.add(s.id)
      if (s.kind === 'chapter' && !CHAPTER_IDS.includes(s.id as never)) problems.push({ path: `journeys.${key}.sections.${i}`, message: `“${s.id}” is not a chapter this site can render` })
    })
    if (!doc.journeys[key].sections.some((s) => !s.hidden)) problems.push({ path: `journeys.${key}`, message: `The ${key} page would have no visible sections` })
  }
  const elementIds = new Set<string>()
  for (const [sectionId, nodes] of Object.entries(doc.additions)) {
    if (!sectionIds.has(sectionId)) problems.push({ path: `additions.${sectionId}`, message: `Elements were added to a section that no longer exists (${sectionId})` })
    walk(nodes, (n) => {
      if (elementIds.has(n.id)) problems.push({ path: `additions.${sectionId}`, message: `Two added elements share the id “${n.id}”` })
      elementIds.add(n.id)
    })
  }
  for (const sectionId of Object.keys(doc.groups)) {
    if (!sectionIds.has(sectionId)) problems.push({ path: `groups.${sectionId}`, message: `A group belongs to a section that no longer exists (${sectionId})` })
  }
  return problems
}
