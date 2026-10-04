import type { MetadataRoute } from 'next'
import { siteConfig } from '@/content/profile'
import { projects } from '@/content/projects'

/* The site is two journeys and one archive of case studies. `/`
   answers who he is, `/projects` what he has built, and each
   project has a stable overlay URL on the home journey — the
   Project Universe lives there and is what opens them. */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date()
  return [
    { url: siteConfig.url, lastModified: now, changeFrequency: 'monthly', priority: 1 },
    { url: `${siteConfig.url}/projects`, lastModified: now, changeFrequency: 'monthly', priority: 0.9 },
    ...projects.map((p) => ({
      url: `${siteConfig.url}/#project/${p.slug}`,
      lastModified: now,
      changeFrequency: 'yearly' as const,
      priority: p.importance === 'hero' ? 0.8 : p.importance === 'featured' ? 0.6 : 0.4,
    })),
  ]
}
