import { profile as seedProfile, contact as seedContact, siteConfig } from '@/content/profile'
import { education as seedEducation, credentials as seedCredentials } from '@/content/education'
import { experience as seedExperience } from '@/content/experience'
import { techNodes as seedTech } from '@/content/skills'
import { projects as seedProjects } from '@/content/projects'
import { clientPalettes, featuredClientProjects } from '@/content/projects/client'
import { homeChapters, projectChapters } from '@/content/chapters'
import type { Chapter } from '@/content/types'
import { SCHEMA_VERSION, siteDocument, type Section, type SiteDocument } from './schema'

/* ============================================================
   MIGRATION: src/content → the first site document

   The modules in src/content are what the site rendered before
   the CMS existed. This builds revision one from them, field for
   field, so the published site looks exactly as it did; from then
   on the database is the source of truth and those modules are
   only the seed a fresh installation starts from.

   Nothing is invented here. Fields the CMS adds (a project's
   status, order, links list, SEO and page sections) start at the
   values that reproduce the old behaviour: every project
   published and listed, in the order the modules listed them,
   with no extra page sections.
   ============================================================ */

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v))

function sectionOf(c: Chapter): Section {
  return {
    id: c.id,
    kind: 'chapter',
    hidden: false,
    title: c.title,
    label: c.label,
    ...(c.subtitle ? { subtitle: c.subtitle } : {}),
    group: c.group,
    ...(c.year ? { year: c.year } : {}),
    vh: c.vh,
    quickVh: c.quickVh,
  }
}

export function buildSeedDocument(): SiteDocument {
  const doc: SiteDocument = {
    schemaVersion: SCHEMA_VERSION,
    settings: {
      siteUrl: siteConfig.url,
      title: siteConfig.title,
      description: siteConfig.description,
      keywords: [...siteConfig.keywords],
      themeColor: '#f6f0e6',
      navigation: [
        { id: 'projects', label: 'Projects', href: '/projects', external: false },
        { id: 'world', label: 'Enter my world', href: '/world', external: false },
      ],
      options: { worldEntrance: true, analytics: true, leafCharge: 'standard' },
    },
    profile: clone(seedProfile) as unknown as SiteDocument['profile'],
    contact: clone(seedContact),
    education: clone(seedEducation),
    credentials: clone(seedCredentials),
    experience: clone(seedExperience),
    techNodes: clone(seedTech),
    projects: seedProjects.map((p, i) => ({
      ...clone(p),
      status: 'published' as const,
      hidden: false,
      order: i,
      links: [],
      seo: {},
      sections: [],
      ...(clientPalettes[p.slug] ? { palette: [...clientPalettes[p.slug]] } : {}),
    })) as SiteDocument['projects'],
    journeys: {
      home: { id: 'home', path: '/', title: 'Portfolio', label: 'PORTFOLIO', sections: homeChapters.map(sectionOf) },
      projects: { id: 'projects', path: '/projects', title: 'Projects', label: 'PROJECTS', sections: projectChapters.map(sectionOf) },
    },
    collections: { 'pansofia.gallery': featuredClientProjects.map((p) => p.id) },
    elements: {},
    additions: {},
    groups: {},
  }
  return siteDocument.parse(doc)
}
