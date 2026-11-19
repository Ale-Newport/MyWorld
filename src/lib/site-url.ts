/** The first CMS revisions carry the prelaunch placeholder domain, which was never registered. */
const placeholder = 'https://alejandronewport.com'
const deployed = 'https://www.alenewport.com'

export function publicSiteUrl(configured: string): string {
  const url = configured.replace(/\/+$/, '')
  return url === placeholder ? deployed : url
}
