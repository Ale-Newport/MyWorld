import { Journey } from '@/components/journey/Journey'
import { StaticProfile } from '@/components/journey/StaticProfile'

export default function Home() {
  return (
    <>
      {/* Server-rendered, crawlable, screen-reader-first summary of
          the entire profile. The experience layers on top of it. */}
      <StaticProfile />
      <Journey journey="home" />
    </>
  )
}
