import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { loadSite } from '@/server/site'
import { adjacentPosts, linkTo, listedPosts, postDescription } from '@/cms/blog'
import { BlogIndex } from '@/components/blog/BlogIndex'
import { PostPage } from '@/components/blog/PostPage'
import { publicSiteUrl } from '@/lib/site-url'
import { readPublished } from '../published'

/* One published post, read from the database on every request (no
   static params: a post is here the moment it is published). A draft
   or an unknown address is a 404; without the database, the blog's
   calm "unavailable" page rather than an error. */

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const [{ doc }, { ok, posts }] = await Promise.all([loadSite(), readPublished()])
  if (!ok) return { title: 'Blog' }
  const post = listedPosts(posts).find((p) => p.slug === slug)
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
    robots: { index: true, follow: true },
  }
}

export default async function BlogPostRoute({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const { ok, posts } = await readPublished()
  if (!ok) return <BlogIndex posts={[]} unavailable />
  const list = listedPosts(posts)
  const post = list.find((p) => p.slug === slug)
  if (!post) notFound()
  const { newer, older } = adjacentPosts(list, post.slug)
  return <PostPage post={post} newer={linkTo(newer)} older={linkTo(older)} />
}
