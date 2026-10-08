import type { MetadataRoute } from 'next'
import { publishedSite } from '@/server/site'
import { publicSiteUrl } from '@/lib/site-url'

// Read from the content store on request (its site URL is edited in the admin).
export const dynamic = 'force-dynamic'

export default async function robots(): Promise<MetadataRoute.Robots> {
  const { doc } = await publishedSite()
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/admin', '/api/'] }],
    sitemap: `${publicSiteUrl(doc.settings.siteUrl)}/sitemap.xml`,
  }
}
