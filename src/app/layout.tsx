import type { Metadata, Viewport } from 'next'
import { GeistSans } from 'geist/font/sans'
import { GeistMono } from 'geist/font/mono'
import { siteConfig, profile, contact } from '@/content/profile'
import { education } from '@/content/education'
import { GardenCover } from '@/components/home/botanical/GardenCover'
import '@/styles/globals.css'

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  title: {
    default: siteConfig.title,
    template: '%s — Alejandro Newport',
  },
  description: siteConfig.description,
  keywords: [...siteConfig.keywords],
  authors: [{ name: profile.name, url: siteConfig.url }],
  creator: profile.name,
  openGraph: {
    type: 'profile',
    locale: 'en_GB',
    url: siteConfig.url,
    title: siteConfig.title,
    description: siteConfig.description,
    siteName: `${profile.name} — Portfolio ${profile.year}`,
  },
  twitter: {
    card: 'summary_large_image',
    title: siteConfig.title,
    description: siteConfig.description,
  },
  robots: { index: true, follow: true },
  alternates: { canonical: '/' },
}

export const viewport: Viewport = {
  // One colour, unconditionally: the page is white whatever the
  // visitor's OS is set to, and advertising a dark variant would
  // only paint the phone's browser chrome against it. Must track
  // --bg-primary in tokens.css.
  themeColor: '#f6f0e6',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

const personJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Person',
  name: profile.name,
  jobTitle: ['Software Engineer', 'AI Engineer', 'Machine Learning Engineer', 'Product Engineer'],
  description: profile.summary,
  url: siteConfig.url,
  address: { '@type': 'PostalAddress', addressLocality: 'London', addressCountry: 'GB' },
  alumniOf: education.map((e) => ({
    '@type': 'CollegeOrUniversity',
    name: e.institution,
    department: e.degree,
  })),
  knowsAbout: [
    'Software Engineering', 'Artificial Intelligence', 'Machine Learning',
    'Retrieval-Augmented Generation', 'Computer Vision', 'Full-Stack Development',
    'Data Engineering', 'Concurrent Systems', 'WebGL', 'Creative Development',
  ],
  sameAs: contact.filter((c) => c.href.startsWith('http')).map((c) => c.href),
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(personJsonLd) }}
        />
        {children}
        {/* Outlives every route: the leaves the homepage closes over
            itself are the ones the world arrives under. */}
        <GardenCover />
      </body>
    </html>
  )
}
