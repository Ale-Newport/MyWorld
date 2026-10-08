import type { Metadata } from 'next'
import { WorldRoute } from '@/components/world/WorldRoute'
import { WorldFallback } from '@/components/world/WorldFallback'
import { publishedSite } from '@/server/site'
import { publicSiteUrl } from '@/lib/site-url'

export async function generateMetadata(): Promise<Metadata> {
  const { doc } = await publishedSite()
  const name = doc.profile.name
  return {
    title: 'World',
    description: `Explore Archipiélago, ${name}'s island: drive, fly, race, bowl and discover projects, education and achievements.`,
    alternates: { canonical: '/world' },
    openGraph: {
      type: 'website',
      url: `${publicSiteUrl(doc.settings.siteUrl)}/world`,
      title: `Enter my world — ${name}`,
      description: 'A drivable portfolio. WASD to drive, Space to jump (hold to raise the wheels), Space twice to fly, E to interact, M for the map: select a place to travel there.',
      images: [doc.settings.ogImage ?? '/og-image.png'],
    },
    // The world is a companion to the portfolio, not a second copy of
    // it. Everything here is indexable at `/`, so this route is
    // deliberately excluded rather than competing with it.
    robots: { index: false, follow: true },
  }
}

export default async function WorldPage() {
  const { doc } = await publishedSite()
  return (
    <>
      {/* Server-rendered and crawlable: the whole point of the world
          is reachable without WebGL, a keyboard or a mouse. */}
      <WorldFallback name={doc.profile.name} />
      <WorldRoute />
    </>
  )
}
