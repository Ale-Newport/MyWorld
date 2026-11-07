import type { SiteContent } from '@/cms/derive'

/* ============================================================
   THE SITE'S PAGES — AND NOTHING ELSE

   The navigation names pages, never the sections inside them: a
   chapter is reached by scrolling the page it belongs to. On a
   desktop the pages are printed in the top bar; on a phone the
   index lists them. Both read this list, so they cannot disagree.

   The world is listed while its entrance is on (Settings); the
   settings' longer label ("Enter my world") stays the portal's.
   ============================================================ */

export type SitePageId = 'home' | 'projects' | 'world' | 'blog' | 'contact'

export interface SitePage {
  id: SitePageId
  label: string
  href: string
  /** One line under the page's name in the index. */
  note: string
}

export function sitePages(site: Pick<SiteContent, 'settings' | 'journeys'>): SitePage[] {
  const world = site.settings.navigation.find((n) => n.id === 'world')
  const pages: SitePage[] = [
    { id: 'home', label: 'Home', href: '/', note: 'The journey, from the start' },
    { id: 'projects', label: 'Projects', href: site.journeys.projects.path, note: 'The work, up close' },
  ]
  if (site.settings.options.worldEntrance && world) pages.push({ id: 'world', label: 'World', href: world.href, note: 'An interactive island · WASD' })
  pages.push(
    { id: 'blog', label: 'Blog', href: '/blog', note: 'Notes and writing' },
    { id: 'contact', label: 'Contact', href: '/contact', note: 'Get in touch' },
  )
  return pages
}
