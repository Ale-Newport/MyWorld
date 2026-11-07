import type { Metadata } from 'next'
import { loadSite } from '@/server/site'
import { publicSiteUrl } from '@/lib/site-url'
import { listedPosts, summarisePost } from '@/cms/blog'
import { BlogIndex } from '@/components/blog/BlogIndex'
import { readPublished } from './published'

/* ============================================================
   /blog
   The posts written in the deployed admin, newest first, read
   from the database on every request (server/blog.ts): a post is
   here as soon as it is published, with no build. The rest of the
   site stays prerendered from the repository. Without the
   database the page says the blog is unavailable, calmly.
   ============================================================ */

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  const { doc } = await loadSite()
  const { name, year } = doc.profile
  const description = `Notes and writing by ${name}.`
  const image = doc.settings.ogImage ?? '/og-image.png'
  return {
    title: 'Blog',
    description,
    alternates: { canonical: '/blog' },
    openGraph: {
      type: 'website',
      locale: 'en_GB',
      url: `${publicSiteUrl(doc.settings.siteUrl)}/blog`,
      title: `Blog — ${name}`,
      description,
      siteName: `${name} — Portfolio ${year}`,
      images: [image],
    },
    twitter: { card: 'summary_large_image', title: `Blog — ${name}`, description, images: [image] },
    robots: { index: true, follow: true },
  }
}

export default async function BlogRoute() {
  const { ok, posts } = await readPublished()
  return <BlogIndex posts={listedPosts(posts).map(summarisePost)} unavailable={!ok} />
}
