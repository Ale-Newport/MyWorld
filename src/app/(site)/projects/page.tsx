import type { Metadata } from 'next'
import { Journey } from '@/components/journey/Journey'
import { StaticProjects } from '@/components/journey/StaticProjects'
import { loadSite } from '@/server/site'
import { deriveSite } from '@/cms/derive'
import { publicSiteUrl } from '@/lib/site-url'

/* The seven chapters of this journey, said once, in prose: client
   work, teaching, the two products, the two intelligence pieces
   and the systems one. Written out rather than generated from the
   chapter titles because "Intelligence" and "Focus" mean nothing
   to a search result on their own. */
const describe = (name: string) =>
  `The work behind ${name}'s portfolio: fourteen production websites for clients at ` +
  'Pansofia and Grupo Newport, teaching at King’s College London, an AI engine that generates ' +
  'personalised learning videos, a rigged pose-data gym app, retrieval and computer vision at ' +
  'Metaview, a chess assistant that reads a physical board, and a multithreaded matching engine.'

export async function generateMetadata(): Promise<Metadata> {
  const { doc } = await loadSite()
  const { name, year } = doc.profile
  const description = describe(name)
  return {
    title: 'Projects',
    description,
    alternates: { canonical: '/projects' },
    openGraph: {
      type: 'website',
      locale: 'en_GB',
      url: `${publicSiteUrl(doc.settings.siteUrl)}/projects`,
      title: `Projects — ${name}`,
      description,
      siteName: `${name} — Portfolio ${year}`,
      images: [doc.settings.ogImage ?? '/og-image.png'],
    },
    twitter: { card: 'summary_large_image', title: `Projects — ${name}`, description, images: [doc.settings.ogImage ?? '/og-image.png'] },
    robots: { index: true, follow: true },
  }
}

export default async function ProjectsPage() {
  const { doc } = await loadSite()
  return (
    <>
      {/* Server-rendered and crawlable: what was built and what was
          contributed to it, readable without WebGL or a scroll. */}
      <StaticProjects content={deriveSite(doc)} />
      <Journey journey="projects" />
    </>
  )
}
