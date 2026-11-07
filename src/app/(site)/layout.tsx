import type { Metadata, Viewport } from 'next'
import { loadSite } from '@/server/site'
import { SiteContentProvider } from '@/cms/context'
import { GardenCover } from '@/components/home/botanical/GardenCover'
import { Analytics } from '@/components/analytics/Analytics'
import { publicSiteUrl } from '@/lib/site-url'
import { typefaceCss } from '@/styles/typefaces'
import { themeScript } from '@/components/site/theme-script'
import { FirstPaintScript } from '@/components/site/FirstPaintScript'
import { AccentStyle } from '@/components/site/AccentStyle'

/* ============================================================
   THE PUBLIC SITE

   Every public route reads the PUBLISHED site document here, once,
   and hands it to the client tree. In the deployed site that
   document is the committed file content/published/site.json, so
   the pages are prerendered at build and served as files. In the
   editor (your machine) the draft of an administrator previewing
   in Draft Mode is shown instead, and pages render on request
   (see server/site.ts).
   ============================================================ */

export async function generateMetadata(): Promise<Metadata> {
  const { doc } = await loadSite()
  const s = doc.settings
  const p = doc.profile
  const url = publicSiteUrl(s.siteUrl)
  const images = s.ogImage ? [{ url: s.ogImage }] : [{ url: '/og-image.png', width: 1200, height: 630, alt: `${p.name} — Software & AI Engineer` }]
  return {
    metadataBase: new URL(url),
    title: { default: s.title, template: `%s — ${p.name}` },
    description: s.description,
    keywords: s.keywords,
    authors: [{ name: p.name, url }],
    creator: p.name,
    icons: { icon: s.favicon ?? [{ url: '/favicon.ico' }, { url: '/favicon.svg', type: 'image/svg+xml' }], apple: '/apple-touch-icon.png' },
    openGraph: { type: 'profile', locale: 'en_GB', url, title: s.title, description: s.description, siteName: `${p.name} — Portfolio ${p.year}`, images },
    twitter: { card: 'summary_large_image', title: s.title, description: s.description, images },
    robots: { index: true, follow: true },
    alternates: { canonical: '/' },
  }
}

export async function generateViewport(): Promise<Viewport> {
  const { doc } = await loadSite()
  // The cream by day and the night ground by night (tokens.css): the toggle repaints both when the visitor chooses.
  return {
    themeColor: [
      { media: '(prefers-color-scheme: light)', color: doc.settings.themeColor },
      { media: '(prefers-color-scheme: dark)', color: '#131410' },
    ],
    width: 'device-width',
    initialScale: 1,
    viewportFit: 'cover',
  }
}

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const { doc, preview } = await loadSite()
  const url = publicSiteUrl(doc.settings.siteUrl)
  const personJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: doc.profile.name,
    jobTitle: ['Software Engineer', 'AI Engineer', 'Machine Learning Engineer', 'Product Engineer'],
    description: doc.profile.summary,
    url,
    address: { '@type': 'PostalAddress', addressLocality: 'London', addressCountry: 'GB' },
    alumniOf: doc.education.map((e) => ({ '@type': 'CollegeOrUniversity', name: e.institution, department: e.degree })),
    knowsAbout: [
      'Software Engineering', 'Artificial Intelligence', 'Machine Learning',
      'Retrieval-Augmented Generation', 'Computer Vision', 'Full-Stack Development',
      'Data Engineering', 'Concurrent Systems', 'WebGL', 'Creative Development',
    ],
    sameAs: doc.contact.filter((c) => c.href.startsWith('http')).map((c) => c.href),
  }
  return (
    <>
      {/* Light or dark, before anything paints (site/theme.ts). */}
      <FirstPaintScript code={themeScript} />
      {typefaceCss(doc.settings.options.typeface) && <style>{typefaceCss(doc.settings.options.typeface)}</style>}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(personJsonLd).replace(/</g, '\\u003c') }} />
      {/* Draft posts live in site.json (the deployed admin commits them there) but never reach a visitor's page. */}
      <SiteContentProvider doc={preview ? doc : { ...doc, posts: (doc.posts ?? []).filter((p) => p.status === 'published') }} editing={preview}>
        {/* The editor's accent colour (read tolerantly: older documents have none). */}
        <AccentStyle />
        {children}
        {/* Outlives every public route: the leaves the homepage closes
            over itself are the ones the world arrives under. */}
        <GardenCover />
        {doc.settings.options.analytics && !preview && <Analytics />}
      </SiteContentProvider>
    </>
  )
}
