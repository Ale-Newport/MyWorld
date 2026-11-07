import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { loadSite } from '@/server/site'
import { postBySlug, postDescription, listedPosts } from '@/cms/blog'
import { PostPage } from '@/components/blog/PostPage'
import { publicSiteUrl } from '@/lib/site-url'

/* One page per published post, prerendered at build in the deployed site.
   A draft has no page there; in the editor's preview it renders on request
   (and so does a post whose address was just changed), like projects. */

export async function generateStaticParams() {
  const { doc } = await loadSite()
  return listedPosts(doc).map((p) => ({ slug: p.slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const { doc, preview } = await loadSite()
  const post = postBySlug(doc, slug, { preview })
  if (!post) return { title: 'Post not found' }
  const name = doc.profile.name
  const description = postDescription(post)
  const image = post.cover ? { url: post.cover, alt: post.coverAlt ?? '' } : { url: doc.settings.ogImage ?? '/og-image.png' }
  return {
    title: post.title,
    description,
    alternates: { canonical: `/blog/${post.slug}` },
    openGraph: {
      type: 'article',
      url: `${publicSiteUrl(doc.settings.siteUrl)}/blog/${post.slug}`,
      title: `${post.title} — ${name}`,
      description,
      images: [image],
      publishedTime: post.date,
      authors: [name],
      tags: post.tags,
    },
    twitter: { card: 'summary_large_image', title: post.title, description, images: [image.url] },
    robots: { index: post.status === 'published', follow: true },
  }
}

export default async function BlogPostRoute({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const { doc, preview } = await loadSite()
  // In the admin's preview the editor's live document decides: a post being
  // written, or one whose slug just changed, has no saved page yet.
  if (!preview && !postBySlug(doc, slug)) notFound()
  return <PostPage slug={slug} />
}
