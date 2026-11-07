import type { MetadataRoute } from 'next'
import { publishedSite } from '@/server/site'
import { deriveSite } from '@/cms/derive'
import { publicSiteUrl } from '@/lib/site-url'

/* The two journeys, contact, the blog and its published posts, and one page
   per published project, all read from the published site document, so it is
   as current as the last deploy. */

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { doc } = await publishedSite()
  const { allProjects } = deriveSite(doc)
  const url = publicSiteUrl(doc.settings.siteUrl)
  const now = new Date()
  return [
    { url, lastModified: now, changeFrequency: 'monthly', priority: 1 },
    { url: `${url}/projects`, lastModified: now, changeFrequency: 'monthly', priority: 0.9 },
    { url: `${url}/contact`, lastModified: now, changeFrequency: 'yearly', priority: 0.7 },
    { url: `${url}/blog`, lastModified: now, changeFrequency: 'weekly', priority: 0.7 },
    ...(doc.posts ?? []).filter((p) => p.status === 'published').map((p) => ({
      url: `${url}/blog/${p.slug}`,
      lastModified: new Date(`${p.date}T12:00:00Z`),
      changeFrequency: 'yearly' as const,
      priority: 0.6,
    })),
    ...allProjects.map((p) => ({
      url: `${url}/projects/${p.slug}`,
      lastModified: now,
      changeFrequency: 'yearly' as const,
      priority: p.importance === 'hero' ? 0.8 : p.importance === 'featured' ? 0.6 : 0.4,
    })),
  ]
}
