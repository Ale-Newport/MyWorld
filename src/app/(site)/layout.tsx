import type { Metadata, Viewport } from 'next'
import { loadSite } from '@/server/site'
import { SiteContentProvider } from '@/cms/context'
import { GardenCover } from '@/components/home/botanical/GardenCover'
import { Analytics } from '@/components/analytics/Analytics'
import { publicSiteUrl } from '@/lib/site-url'

/* ============================================================
   THE PUBLIC SITE

   Every public route reads the PUBLISHED site document here, once,
   and hands it to the client tree. An administrator previewing in
   Draft Mode gets the draft instead (see server/site.ts). The
   pages render on request from the content store, so a publish
   shows at once (the parsed document is cached per revision).
   ============================================================ */

export const dynamic = 'force-dynamic'

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
  // One colour, unconditionally: the page is cream whatever the OS
  // theme is, and a dark variant would only paint the browser chrome.
  return { themeColor: doc.settings.themeColor, width: 'device-width', initialScale: 1, viewportFit: 'cover' }
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
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(personJsonLd).replace(/</g, '\\u003c') }} />
      <SiteContentProvider doc={doc} editing={preview}>
        {children}
        {/* Outlives every public route: the leaves the homepage closes
            over itself are the ones the world arrives under. */}
        <GardenCover />
        {doc.settings.options.analytics && !preview && <Analytics />}
      </SiteContentProvider>
    </>
  )
}
