import type { Metadata } from 'next'
import { WorldRoute } from '@/components/world/WorldRoute'
import { WorldFallback } from '@/components/world/WorldFallback'
import { profile, siteConfig } from '@/content/profile'

export const metadata: Metadata = {
  title: 'World',
  description:
    `Explore Archipiélago, ${profile.name}'s island: drive, fly, race, bowl and discover projects, education and achievements.`,
  alternates: { canonical: '/world' },
  openGraph: {
    type: 'website',
    url: `${siteConfig.url}/world`,
    title: `Enter my world — ${profile.name}`,
    description:
      'A drivable portfolio. WASD to drive, Space to brake, double Space to fly, E to interact.',
  },
  // The world is a companion to the portfolio, not a second copy of
  // it. Everything here is indexable at `/`, so this route is
  // deliberately excluded rather than competing with it.
  robots: { index: false, follow: true },
}

export default function WorldPage() {
  return (
    <>
      {/* Server-rendered and crawlable: the whole point of the world
          is reachable without WebGL, a keyboard or a mouse. */}
      <WorldFallback />
      <WorldRoute />
    </>
  )
}
