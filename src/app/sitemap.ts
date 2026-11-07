import type { MetadataRoute } from 'next'
import { publishedSite } from '@/server/site'
import { deriveSite } from '@/cms/derive'
import { publicSiteUrl } from '@/lib/site-url'
import { publishedPosts } from '@/server/blog'
import type { BlogPost } from '@/cms/schema'

/* The two journeys, contact, the blog and one page per published project,
   from the published site document (as current as the last deploy), and one
   page per published post, from the database at the moment it is asked for —
   so it is generated on request. Without the database the posts are left out
   for that request; the rest of the map is unchanged. */

export const dynamic = 'force-dynamic'

async function posts(): Promise<BlogPost[]> {
  try {
    return await publishedPosts()
  } catch (error) {
    console.error('[sitemap] the blog posts could not be read', error)
    return []
  }
}

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
    ...(await posts()).map((p) => ({
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
