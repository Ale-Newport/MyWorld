import { z } from 'zod'
import { isSafeHref, isSafeSrc } from './safe.ts'
import { MOTION_COMPONENTS } from './motion.ts'

export { MOTION_COMPONENTS }

/* ============================================================
   THE SITE DOCUMENT — schema v1

   Everything the public website shows that an administrator can
   change lives in one JSON document with this shape. The public
   pages render the PUBLISHED revision; the admin edits a DRAFT
   revision and previews it through the same components.

   It is deliberately close to the shape of the modules it was
   migrated from (src/content/*), so a component that used to
   import `profile` now reads `site.profile` and nothing else
   about it changes. On top of that data it carries what the
   content editor adds: section visibility, text that replaces
   what the code renders, each animated section's choice of
   animation, and the Tech Toolbox's display options.

   It deliberately carries NO layout. Positions, sizes, spacing
   and type are the site's code, which composes every screen size
   itself. Schema v1 also stored per-element styles and freely
   placed elements from a visual page builder; v2 retired that
   editor, and migrate.ts keeps the text it held while dropping
   the geometry.

   Bump SCHEMA_VERSION and add a step to migrate.ts whenever a
   change here is not backwards compatible.
   ============================================================ */

export const SCHEMA_VERSION = 2

const id = z.string().min(1).max(120).regex(/^[a-z0-9][a-z0-9._:-]*$/i, 'Use letters, numbers, dots, dashes or colons')
const shortText = z.string().max(400)
const longText = z.string().max(20_000)

/** A URL a visitor may follow: http(s), mailto, tel, or a site-relative path. Never javascript: or data:. */
export const safeHref = z.string().max(2000).refine(isSafeHref, 'Links must be http(s), mailto:, tel: or a path on this site')

/** Media the site may load: site-relative, or https. */
export const safeSrc = z.string().max(2000).refine(isSafeSrc, 'Use an uploaded file, a site path or an https URL')

const color = z.string().max(64).regex(/^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\)|var\(--[a-z0-9-]+\)|transparent|currentColor|inherit)$/i, 'Use a hex, rgb(), hsl() or var(--token) colour')
/** CSS lengths the editor writes: numbers with units, keywords and clamp()/min()/max()/calc() of those. */
const length = z.string().max(120).regex(/^(auto|none|inherit|0|-?\d*\.?\d+(px|rem|em|%|vw|vh|svh|lvh|dvh|ch|fr)|(clamp|min|max|calc)\([-+*/\s\d.a-z%,()]+\)|[-\d.\s]+(px|rem|em|%|vw|vh)( [-\d.]+(px|rem|em|%|vw|vh))*)$/i, 'Use a CSS length such as 24px, 2rem, 50% or clamp(1rem, 2vw, 2rem)')

/** The editor validates with the same rules before writing. */
export const cssLength = length
export const cssColor = color

/* ---- rich text ------------------------------------------------ */
export const textRun = z.object({
  t: z.string().max(5000),
  b: z.boolean().optional(),
  i: z.boolean().optional(),
  a: safeHref.optional(),
})
/** Plain text (line breaks allowed) or a list of styled runs. Rendered as React text, never as HTML. */
export const richText = z.union([z.string().max(20_000), z.array(textRun).max(400)])
export type RichText = z.infer<typeof richText>

/* ---- elements --------------------------------------------------- */
/** Changes to text the code already renders (identified by its `data-cms-id`). */
export const elementOverride = z.object({
  text: richText.optional(),
  /** Optional lines (corner notes, hints) can be switched off. */
  hidden: z.boolean().optional(),
  /** Where a link the code renders points. */
  href: safeHref.optional(),
})
export type ElementOverride = z.infer<typeof elementOverride>

export const ELEMENT_TYPES = ['heading', 'text', 'image', 'video', 'button', 'table', 'card', 'container', 'animation', 'divider', 'spacer'] as const
export type ElementType = (typeof ELEMENT_TYPES)[number]

export const tableData = z.object({
  caption: z.string().max(400).optional(),
  header: z.boolean().default(true),
  columns: z.array(z.object({ id, label: shortText, align: z.enum(['left', 'center', 'right']).default('left'), width: length.optional() })).max(20),
  rows: z.array(z.object({ id, cells: z.record(z.string(), z.string().max(2000)) })).max(500),
})
export type TableData = z.infer<typeof tableData>

/**
 * Content kept from schema v1's page builder: elements an administrator
 * added to a section. They are rendered in normal flow after the
 * section, styled by the site, and their text stays editable; no new
 * ones are created.
 */
export interface ElementNode {
  id: string
  type: ElementType
  name: string
  text?: RichText
  props: Record<string, unknown>
  hidden?: boolean
  children?: ElementNode[]
}
export const elementNode: z.ZodType<ElementNode> = z.lazy(() => z.object({
  id,
  type: z.enum(ELEMENT_TYPES),
  name: shortText,
  text: richText.optional(),
  props: z.record(z.string(), z.unknown()),
  hidden: z.boolean().optional(),
  children: z.array(elementNode).max(200).optional(),
}))

/* ---- section animations ------------------------------------------ */
/** An animated section's choice (src/sections/catalog.ts). Ids are checked against the catalogue in references.ts. */
export const sectionAnimation = z.object({
  id: z.string().min(1).max(80).regex(/^[a-z0-9][a-z0-9.-]*$/),
  intensity: z.number().min(0).max(1).optional(),
  speed: z.number().min(0.5).max(1.5).optional(),
})
export type SectionAnimation = z.infer<typeof sectionAnimation>

/** The Tech Toolbox's details, each switched on or off for the whole section (a tool may override either). */
export const toolboxDisplay = z.object({
  showCounts: z.boolean(),
  showNames: z.boolean(),
})
export type ToolboxDisplay = z.infer<typeof toolboxDisplay>

/* ---- sections & journeys ---------------------------------------- */
export const section = z.object({
  id,
  kind: z.enum(['chapter', 'custom']),
  hidden: z.boolean().default(false),
  title: shortText,
  label: shortText,
  subtitle: shortText.optional(),
  group: shortText,
  year: z.string().max(12).optional(),
  /** Scroll length in viewport heights, and in Quick View. */
  vh: z.number().min(0.5).max(20),
  quickVh: z.number().min(0.5).max(20),
  /** Animated sections only (about, universe, contact). Absent: the section's default. */
  animation: sectionAnimation.optional(),
  /** The Tech Toolbox section only. Absent: counts and names both shown. */
  toolbox: toolboxDisplay.optional(),
})
export type Section = z.infer<typeof section>

export const journey = z.object({
  id: z.enum(['home', 'projects']),
  path: z.enum(['/', '/projects']),
  title: shortText,
  label: shortText,
  sections: z.array(section).min(1).max(40),
})
export type Journey = z.infer<typeof journey>

/* ---- portfolio data (migrated from src/content) ---------------- */
const dataStatus = z.enum(['verified', 'partially-verified', 'placeholder', 'needs-review'])
export const metric = z.object({ label: shortText, value: shortText, numeric: z.number().optional(), suffix: z.string().max(20).optional(), prefix: z.string().max(20).optional(), note: shortText.optional() })

export const profile = z.object({
  name: shortText,
  initials: z.string().max(6),
  location: shortText,
  origin: shortText,
  year: z.string().max(12),
  roles: z.array(shortText).max(20),
  thesis: shortText,
  thesisShort: shortText,
  summary: longText,
  markers: z.array(z.object({ from: shortText, to: shortText })).max(12),
  closing: z.object({ question: shortText, answer: shortText, ucl: z.array(shortText).max(6) }),
})

export const contactLink = z.object({ id, label: shortText, value: shortText, href: safeHref, dataStatus, needsVerification: z.boolean().optional() })

export const educationEntry = z.object({
  id, institution: shortText, shortName: shortText, degree: shortText, degreeLine: z.array(shortText).max(6),
  result: shortText.optional(), dates: shortText, start: z.string().max(10), end: z.string().max(10), location: shortText,
  modules: z.array(z.object({ name: shortText, visual: z.enum(['graph', 'tree', 'schedule', 'cipher', 'modules', 'matrix', 'network', 'mining', 'verify', 'stats']), blurb: shortText })).max(20),
  dataStatus,
})

export const credential = z.object({ id, title: shortText, issuer: shortText, note: shortText, dataStatus })

export const experienceEntry = z.object({
  id, role: shortText, organisation: shortText, dates: shortText, start: z.string().max(10), end: z.string().max(10), location: shortText.optional(),
  summary: longText, facts: z.array(longText).max(40), metrics: z.array(metric).max(40), technologies: z.array(shortText).max(60), dataStatus, chapter: z.string().max(60),
})

export const techNode = z.object({
  id, name: shortText, group: z.enum(['language', 'framework', 'ai', 'data', 'cloud', 'tooling', 'design']),
  evidence: z.array(z.string().max(120)).max(80), weight: z.number().min(1).max(3), note: shortText.optional(),
  /** Per-tool overrides of the Tech Toolbox section's settings; absent inherits the section's. */
  showCounts: z.boolean().optional(),
  showNames: z.boolean().optional(),
})


export const projectSection = z.object({
  id,
  type: z.enum(['text', 'facts', 'metrics', 'gallery', 'video', 'links', 'table']),
  title: shortText,
  hidden: z.boolean().default(false),
  body: richText.optional(),
  items: z.array(z.object({ label: shortText.optional(), value: z.string().max(2000).optional(), src: safeSrc.optional(), href: safeHref.optional(), alt: shortText.optional() })).max(60).optional(),
  table: tableData.optional(),
})
export type ProjectSection = z.infer<typeof projectSection>

export const project = z.object({
  id, slug: z.string().min(1).max(80).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Slugs are lowercase words joined by dashes'),
  title: shortText, shortTitle: shortText.optional(), year: z.string().max(12), dates: shortText.optional(),
  source: z.enum(['personal', 'university', 'client', 'professional']), organisation: shortText.optional(),
  category: z.enum(['ai-ml', 'software', 'web', 'mobile', '3d', 'data', 'university', 'experiment', 'client-work']), subcategory: shortText.optional(),
  importance: z.enum(['hero', 'featured', 'archive']),
  shortDescription: z.string().max(200), description: longText, contribution: longText.optional(),
  verifiedFacts: z.array(longText).max(40), metrics: z.array(metric).max(40), technologies: z.array(shortText).max(60),
  repository: safeHref.optional(), liveUrl: safeHref.optional(), chapter: z.string().max(60).optional(), timelinePosition: z.number().min(0).max(1),
  presentation: z.object({ type: z.enum(['procedural', 'screenshot-motion', 'hybrid', 'static']), motionComponent: z.enum(MOTION_COMPONENTS), concept: longText, interaction: longText, duration: z.number().min(0).max(3600) }),
  assets: z.object({ screenshots: z.array(safeSrc).max(60), videos: z.array(safeSrc).max(20), models: z.array(safeSrc).max(20), textures: z.array(safeSrc).max(20), audio: z.array(safeSrc).max(20) }),
  assetStatus: z.enum(['real', 'generated', 'placeholder', 'none-required']), dataStatus, privateSource: z.boolean(), needsReplacement: z.boolean().optional(),
  featured: z.boolean(), accent: color.optional(),
  /** Brand colours (client work): the gallery tints each site with them. */
  palette: z.array(color).max(6).optional(),
  /* ---- added by the CMS ---- */
  /** published: shown; draft: kept out of the public site; archived: retired but kept. */
  status: z.enum(['published', 'draft', 'archived']),
  /** Published but left out of listings (cards, universe, index); its page still answers. */
  hidden: z.boolean(),
  /** Order within listings, ascending. */
  order: z.number(),
  links: z.array(z.object({ label: shortText, href: safeHref })).max(20),
  seo: z.object({ title: shortText.optional(), description: z.string().max(320).optional(), image: safeSrc.optional() }),
  /** The project's own page, below its summary. */
  sections: z.array(projectSection).max(40),
})
export type Project = z.infer<typeof project>

/* ---- settings --------------------------------------------------- */
export const settings = z.object({
  siteUrl: z.string().url().max(200),
  title: shortText,
  description: z.string().max(320),
  keywords: z.array(shortText).max(40),
  themeColor: color,
  favicon: safeSrc.optional(),
  ogImage: safeSrc.optional(),
  navigation: z.array(z.object({ id, label: shortText, href: safeHref, external: z.boolean().default(false) })).max(12),
  options: z.object({
    /** The scroll-through entrance to /world at the foot of the homepage. */
    worldEntrance: z.boolean(),
    /** Collect first-party, cookieless audience statistics. */
    analytics: z.boolean(),
    /** The leaf transition's growth speed; never affects full coverage. */
    leafCharge: z.enum(['gentle', 'standard', 'brisk']),
    /** How long the leaves take to part over the world; coverage is verified before it either way. */
    leafParting: z.enum(['slow', 'standard', 'quick']).default('standard'),
  }),
})
export type Settings = z.infer<typeof settings>

/* ---- the document -------------------------------------------------- */
export const siteDocument = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  settings,
  profile,
  contact: z.array(contactLink).max(20),
  education: z.array(educationEntry).max(20),
  credentials: z.array(credential).max(20),
  experience: z.array(experienceEntry).max(40),
  techNodes: z.array(techNode).max(200),
  projects: z.array(project).max(300),
  journeys: z.object({ home: journey, projects: journey }),
  /** Ordered lists of project ids a chapter shows, e.g. `pansofia.gallery`. */
  collections: z.record(z.string().max(80), z.array(z.string().max(120)).max(100)),
  elements: z.record(z.string().max(160), elementOverride),
  additions: z.record(z.string().max(120), z.array(elementNode).max(200)),
})
export type SiteDocument = z.infer<typeof siteDocument>
export type ProjectEntity = Project
