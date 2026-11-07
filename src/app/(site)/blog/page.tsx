import type { Metadata } from 'next'
import { loadSite } from '@/server/site'
import { publicSiteUrl } from '@/lib/site-url'
import { BlogIndex } from '@/components/blog/BlogIndex'

/* ============================================================
   /blog
   The posts written in the admin, newest first. Prerendered at
   build from the published site document in the deployed site,
   so a post goes live the way any other edit does: switched to
   Published in the admin, then the site published. The page's
   words are the posts'; this file only says what it is called.
   ============================================================ */

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

export default function BlogRoute() {
  return <BlogIndex />
}
