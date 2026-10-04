import type { Metadata, Viewport } from 'next'
import { loadSite } from '@/server/site'
import { SiteContentProvider } from '@/cms/context'
import { GardenCover } from '@/components/home/botanical/GardenCover'
import { Analytics } from '@/components/analytics/Analytics'

/* ============================================================
   THE PUBLIC SITE

   Every public route reads the PUBLISHED site document here, once,
   and hands it to the client tree. An administrator previewing in
   Draft Mode gets the draft instead (see server/site.ts). The
   pages stay static: they are regenerated when something is
   published, and at most every five minutes otherwise.
   ============================================================ */

export const revalidate = 300

export async function generateMetadata(): Promise<Metadata> {
  const { doc } = await loadSite()
  const s = doc.settings
  const p = doc.profile
  return {
    metadataBase: new URL(s.siteUrl),
    title: { default: s.title, template: `%s — ${p.name}` },
    description: s.description,
    keywords: s.keywords,
    authors: [{ name: p.name, url: s.siteUrl }],
    creator: p.name,
    icons: s.favicon ? { icon: s.favicon } : undefined,
    openGraph: { type: 'profile', locale: 'en_GB', url: s.siteUrl, title: s.title, description: s.description, siteName: `${p.name} — Portfolio ${p.year}`, ...(s.ogImage ? { images: [s.ogImage] } : {}) },
    twitter: { card: 'summary_large_image', title: s.title, description: s.description, ...(s.ogImage ? { images: [s.ogImage] } : {}) },
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
  const personJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: doc.profile.name,
    jobTitle: ['Software Engineer', 'AI Engineer', 'Machine Learning Engineer', 'Product Engineer'],
    description: doc.profile.summary,
    url: doc.settings.siteUrl,
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
