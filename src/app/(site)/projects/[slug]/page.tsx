import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { loadSite } from '@/server/site'
import { deriveSite } from '@/cms/derive'
import { ProjectPage } from '@/components/projects/ProjectPage'

/* One page per published project, rendered from the same entity the
   homepage cards, the universe, the toolbox evidence and the case-study
   overlay read. Rendered on request, like the rest of the site. */

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const { doc, preview } = await loadSite()
  const p = deriveSite(doc, { preview }).projectBySlug[slug]
  if (!p) return { title: 'Project not found' }
  const title = p.seo.title || p.title
  const description = p.seo.description || p.shortDescription
  const image = p.seo.image || p.assets.screenshots[0]
  return {
    title,
    description,
    alternates: { canonical: `/projects/${p.slug}` },
    openGraph: { type: 'article', url: `${doc.settings.siteUrl}/projects/${p.slug}`, title: `${title} — ${doc.profile.name}`, description, ...(image ? { images: [image] } : {}) },
    twitter: { card: 'summary_large_image', title, description },
    robots: { index: !p.hidden, follow: true },
  }
}

export default async function ProjectRoute({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const { doc, preview } = await loadSite()
  // In the admin's preview the editor's live document decides: a project
  // created or renamed there has no saved page yet but must still show.
  if (!preview && !deriveSite(doc).projectBySlug[slug]) notFound()
  return <ProjectPage slug={slug} />
}
