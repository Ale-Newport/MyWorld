import type { Chapter, ChapterId, Project as LegacyProject, TechNode } from '@/content/types'
import type { Project, Section, SiteDocument, ToolboxDisplay } from './schema'
import { CHAPTER_REQUIRES } from './chapters'
import { resolveAnimation, type AnimatedSection, type SectionAnimationSettings } from '@/sections/catalog'

/* ============================================================
   WHAT THE PAGES READ

   The document is the source; this is the shape the components
   were written against (the old src/content exports), computed
   from it once per document. Projects that are not published
   never reach a page; hidden ones are reachable by slug but left
   out of every listing. Technology weights and the reverse index
   are recomputed from the evidence that is actually public.

   The Tech Toolbox is a listing too: a technology's evidence on
   the wall counts and names only listed projects, so neither a
   draft nor a hidden project is ever disclosed through it. A
   project's own page still names the technologies it used.
   ============================================================ */

/** A technology on the Tech Toolbox wall, with what it may show resolved from the section and the tool's own override. */
export interface ToolboxTech extends TechNode {
  showCount: boolean
  showNames: boolean
}

export const TECH_GROUPS = [
  { id: 'language', label: 'Languages' },
  { id: 'framework', label: 'Frameworks' },
  { id: 'ai', label: 'AI / ML' },
  { id: 'data', label: 'Data' },
  { id: 'cloud', label: 'Cloud & Infra' },
  { id: 'tooling', label: 'Tooling' },
  { id: 'design', label: 'Design & Web' },
] as const

export interface JourneyView {
  id: 'home' | 'projects'
  path: string
  title: string
  label: string
  chapters: Chapter[]
  /** Visible sections in order, chapters and custom sections alike. */
  sections: Section[]
}

export interface SiteContent {
  doc: SiteDocument
  profile: SiteDocument['profile']
  contact: SiteDocument['contact']
  settings: SiteDocument['settings']
  siteConfig: { url: string; title: string; description: string; keywords: string[] }
  education: SiteDocument['education']
  educationById: Record<string, SiteDocument['education'][number]>
  credentials: SiteDocument['credentials']
  experience: SiteDocument['experience']
  experienceById: Record<string, SiteDocument['experience'][number]>
  /** Client work, in display order, and the curated gallery of it. */
  clientProjects: (LegacyProject & Project)[]
  featuredClientProjects: (LegacyProject & Project)[]
  clientPalettes: Record<string, [string, string, string]>
  /** Published, listed projects in display order. */
  projects: (LegacyProject & Project)[]
  /** Published projects including hidden ones, for lookups by slug or id. */
  allProjects: (LegacyProject & Project)[]
  projectBySlug: Record<string, LegacyProject & Project>
  projectById: Record<string, LegacyProject & Project>
  /** Evidence restricted to listed projects (published, not hidden; drafts too in the admin's preview). */
  techNodes: ToolboxTech[]
  techById: Record<string, ToolboxTech>
  /** Every technology a live project used, hidden ones included: for that project's own page. */
  techByProject: Record<string, string[]>
  /** The Tech Toolbox section's own settings (each tool may override them). */
  toolbox: ToolboxDisplay
  /** The animation each animated section shows, already validated. */
  animations: Record<AnimatedSection, SectionAnimationSettings>
  journeys: Record<'home' | 'projects', JourneyView>
  chapterById: Record<string, Chapter>
}

function chaptersOf(journey: SiteDocument['journeys']['home'], doc: SiteDocument): Chapter[] {
  const published = new Set(doc.projects.filter((p) => p.status === 'published').map((p) => p.id))
  const roles = new Set(doc.experience.map((e) => e.id))
  const tellable = (s: Section) => {
    const need = CHAPTER_REQUIRES[s.id as keyof typeof CHAPTER_REQUIRES]
    return !need || ((!need.project || published.has(need.project)) && (!need.experience || roles.has(need.experience)))
  }
  return journey.sections
    .filter((s) => !s.hidden && tellable(s))
    .map((s, index) => ({
      id: s.id as ChapterId,
      index,
      number: String(index + 1).padStart(2, '0'),
      title: s.title,
      ...(s.subtitle ? { subtitle: s.subtitle } : {}),
      vh: s.vh,
      quickVh: s.quickVh,
      ...(s.year ? { year: s.year } : {}),
      label: s.label,
      journey: journey.id,
      group: s.group,
    }))
}

/** `preview`: the admin's draft preview also resolves draft projects by slug (never archived ones), so they can be reviewed before publishing. */
export function deriveSite(doc: SiteDocument, { preview = false }: { preview?: boolean } = {}): SiteContent {
  const live = doc.projects.filter((p) => p.status === 'published' || (preview && p.status === 'draft')).sort((a, b) => a.order - b.order) as (LegacyProject & Project)[]
  const listed = live.filter((p) => !p.hidden && p.status === 'published')
  const ids = new Set(live.map((p) => p.id))
  const onWall = new Set(live.filter((p) => !p.hidden).map((p) => p.id))
  const toolboxSection = doc.journeys.home.sections.find((s) => s.id === 'toolbox')
  const toolbox: ToolboxDisplay = { showCounts: toolboxSection?.toolbox?.showCounts ?? true, showNames: toolboxSection?.toolbox?.showNames ?? true }
  const techNodes: ToolboxTech[] = doc.techNodes.map((n) => {
    const evidence = n.evidence.filter((e) => onWall.has(e))
    return {
      ...n,
      evidence,
      weight: evidence.length >= 5 ? 3 : evidence.length >= 2 ? 2 : 1,
      showCount: n.showCounts ?? toolbox.showCounts,
      showNames: n.showNames ?? toolbox.showNames,
    }
  })
  const techByProject: Record<string, string[]> = {}
  for (const n of doc.techNodes) for (const p of n.evidence) if (ids.has(p)) (techByProject[p] ??= []).push(n.id)
  const sectionById = (id: string) => doc.journeys.home.sections.find((s) => s.id === id) ?? doc.journeys.projects.sections.find((s) => s.id === id)
  const animations = {
    about: resolveAnimation('about', sectionById('about')?.animation),
    universe: resolveAnimation('universe', sectionById('universe')?.animation),
  }
  const home = chaptersOf(doc.journeys.home, doc)
  const projects = chaptersOf(doc.journeys.projects, doc)
  return {
    doc,
    profile: doc.profile,
    contact: doc.contact,
    settings: doc.settings,
    siteConfig: { url: doc.settings.siteUrl, title: doc.settings.title, description: doc.settings.description, keywords: doc.settings.keywords },
    education: doc.education,
    educationById: Object.fromEntries(doc.education.map((e) => [e.id, e])),
    credentials: doc.credentials,
    experience: doc.experience,
    experienceById: Object.fromEntries(doc.experience.map((e) => [e.id, e])),
    clientProjects: listed.filter((p) => p.source === 'client'),
    featuredClientProjects: (doc.collections['pansofia.gallery'] ?? []).map((pid) => live.find((p) => p.id === pid)).filter((p): p is LegacyProject & Project => !!p && !p.hidden),
    clientPalettes: Object.fromEntries(live.filter((p) => p.palette?.length).map((p) => [p.slug, [p.palette![0], p.palette![1] ?? p.palette![0], p.palette![2] ?? p.palette![0]]])) as Record<string, [string, string, string]>,
    projects: listed,
    allProjects: live,
    projectBySlug: Object.fromEntries(live.map((p) => [p.slug, p])),
    projectById: Object.fromEntries(live.map((p) => [p.id, p])),
    techNodes,
    techById: Object.fromEntries(techNodes.map((t) => [t.id, t])),
    techByProject,
    toolbox,
    animations,
    journeys: {
      home: { id: 'home', path: '/', title: doc.journeys.home.title, label: doc.journeys.home.label, chapters: home, sections: doc.journeys.home.sections.filter((s) => !s.hidden) },
      projects: { id: 'projects', path: '/projects', title: doc.journeys.projects.title, label: doc.journeys.projects.label, chapters: projects, sections: doc.journeys.projects.sections.filter((s) => !s.hidden) },
    },
    chapterById: Object.fromEntries([...home, ...projects].map((c) => [c.id, c])),
  }
}
