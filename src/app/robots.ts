import type { MetadataRoute } from 'next'
import { publishedSite } from '@/server/site'

// Read from the content store on request (its site URL is edited in the admin).
export const dynamic = 'force-dynamic'

export default async function robots(): Promise<MetadataRoute.Robots> {
  const { doc } = await publishedSite()
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/admin', '/api/'] }],
    sitemap: `${doc.settings.siteUrl}/sitemap.xml`,
  }
}
