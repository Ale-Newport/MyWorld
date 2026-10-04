import type { MetadataRoute } from 'next'
import { publishedSite } from '@/server/site'

export default function robots(): MetadataRoute.Robots {
  const { doc } = publishedSite()
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/admin', '/api/'] }],
    sitemap: `${doc.settings.siteUrl}/sitemap.xml`,
  }
}
