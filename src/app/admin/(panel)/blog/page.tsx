import { EDITOR } from '@/server/mode'
import { publishedSite } from '@/server/site'
import { publicSiteUrl } from '@/lib/site-url'
import { BlogAdmin } from '@/admin/blog/BlogAdmin'
import { BlogMoved } from '@/admin/blog/BlogMoved'

export const metadata = { title: 'Blog' }

/* Posts are written in the deployed admin, which commits them to the repository.
   The editor on your machine points there instead (admin/blog/BlogMoved). */
export default async function BlogPage() {
  if (EDITOR) return <BlogMoved siteUrl={publicSiteUrl((await publishedSite()).doc.settings.siteUrl)} />
  return <BlogAdmin />
}
