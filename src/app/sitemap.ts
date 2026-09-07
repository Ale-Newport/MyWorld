import type { MetadataRoute } from 'next'
import { siteConfig } from '@/content/profile'
import { projects } from '@/content/projects'

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date()
  return [
    { url: siteConfig.url, lastModified: now, changeFrequency: 'monthly', priority: 1 },
    ...projects.map((p) => ({
      url: `${siteConfig.url}/#project/${p.slug}`,
      lastModified: now,
      changeFrequency: 'yearly' as const,
      priority: p.importance === 'hero' ? 0.8 : p.importance === 'featured' ? 0.6 : 0.4,
    })),
  ]
}
