import { Journey } from '@/components/journey/Journey'
import { StaticProfile } from '@/components/journey/StaticProfile'
import { loadSite } from '@/server/site'
import { deriveSite } from '@/cms/derive'

export default async function Home() {
  const { doc } = await loadSite()
  return (
    <>
      {/* Server-rendered, crawlable, screen-reader-first summary of
          the entire profile. The experience layers on top of it. */}
      <StaticProfile content={deriveSite(doc)} />
      <Journey journey="home" />
    </>
  )
}
