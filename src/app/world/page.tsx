import type { Metadata } from 'next'
import { WorldRoute } from '@/components/world/WorldRoute'
import { WorldFallback } from '@/components/world/WorldFallback'
import { profile, siteConfig } from '@/content/profile'

export const metadata: Metadata = {
  title: 'World',
  description:
    `An interactive 3D world you drive through, built from the same project data as the main portfolio. A racing circuit, a bowling alley, a labyrinth, a black hole and ${profile.name}'s name written large enough to drive on — with every project reachable from one terminal.`,
  alternates: { canonical: '/world' },
  openGraph: {
    type: 'website',
    url: `${siteConfig.url}/world`,
    title: `Enter my world — ${profile.name}`,
    description:
      'A drivable portfolio. WASD to move, Shift to boost, Space to jump, Enter to read.',
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
