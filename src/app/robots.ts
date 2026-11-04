import type { MetadataRoute } from 'next'
import { publishedSite } from '@/server/site'
import { publicSiteUrl } from '@/lib/site-url'

// Built with the site: its URL is a setting of the published document.
export default async function robots(): Promise<MetadataRoute.Robots> {
  const { doc } = await publishedSite()
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/admin', '/api/'] }],
    sitemap: `${publicSiteUrl(doc.settings.siteUrl)}/sitemap.xml`,
  }
}
