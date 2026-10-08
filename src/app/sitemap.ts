import type { MetadataRoute } from 'next'
import { publishedSite } from '@/server/site'
import { deriveSite } from '@/cms/derive'
import { publicSiteUrl } from '@/lib/site-url'

/* The two journeys and one page per published project, all read from
   the published site document — a project unpublished in the admin
   leaves the sitemap with its next regeneration. */
export const dynamic = 'force-dynamic'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { doc } = await publishedSite()
  const { allProjects } = deriveSite(doc)
  const url = publicSiteUrl(doc.settings.siteUrl)
  const now = new Date()
  return [
    { url, lastModified: now, changeFrequency: 'monthly', priority: 1 },
    { url: `${url}/projects`, lastModified: now, changeFrequency: 'monthly', priority: 0.9 },
    ...allProjects.map((p) => ({
      url: `${url}/projects/${p.slug}`,
      lastModified: now,
      changeFrequency: 'yearly' as const,
      priority: p.importance === 'hero' ? 0.8 : p.importance === 'featured' ? 0.6 : 0.4,
    })),
  ]
}
