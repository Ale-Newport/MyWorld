/** The first CMS revision still contains the prelaunch placeholder domain. */
const placeholder = 'https://alejandronewport.com'
const deployed = 'https://alejandro-newport-portfolio.anewportd.workers.dev'

export function publicSiteUrl(configured: string): string {
  const url = configured.replace(/\/+$/, '')
  return url === placeholder ? deployed : url
}
