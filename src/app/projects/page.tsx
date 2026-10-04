import type { Metadata } from 'next'
import { Journey } from '@/components/journey/Journey'
import { StaticProjects } from '@/components/journey/StaticProjects'
import { profile, siteConfig } from '@/content/profile'

/* The seven chapters of this journey, said once, in prose: client
   work, teaching, the two products, the two intelligence pieces
   and the systems one. Written out rather than generated from the
   chapter titles because "Intelligence" and "Focus" mean nothing
   to a search result on their own. */
const description =
  `The work behind ${profile.name}'s portfolio: fourteen production websites for clients at ` +
  'Pansofia and Grupo Newport, teaching at King’s College London, an AI engine that generates ' +
  'personalised learning videos, a rigged pose-data gym app, retrieval and computer vision at ' +
  'Metaview, a chess assistant that reads a physical board, and a multithreaded matching engine.'

export const metadata: Metadata = {
  title: 'Projects',
  description,
  alternates: { canonical: '/projects' },
  openGraph: {
    type: 'website',
    locale: 'en_GB',
    url: `${siteConfig.url}/projects`,
    title: `Projects — ${profile.name}`,
    description,
    siteName: `${profile.name} — Portfolio ${profile.year}`,
  },
  twitter: {
    card: 'summary_large_image',
    title: `Projects — ${profile.name}`,
    description,
  },
  robots: { index: true, follow: true },
}

export default function ProjectsPage() {
  return (
    <>
      {/* Server-rendered and crawlable: what was built and what was
          contributed to it, readable without WebGL or a scroll. */}
      <StaticProjects />
      <Journey journey="projects" />
    </>
  )
}
