import { notFound } from 'next/navigation'
import { requireAdmin } from '@/server/auth/guard'
import { EDITOR } from '@/server/mode'
import { publishedSite } from '@/server/site'
import { typefaceCss } from '@/styles/typefaces'
import { accentCss } from '@/styles/accent'
import { BlogPreviewPage } from '@/admin/blog/PreviewPage'

/* The deployed admin's blog preview (admin/blog/PreviewPage): the public
   blog components in a frame, fed the post being written. Signed in only;
   the editor on your machine has its own Draft Mode preview and no blog. */
export const dynamic = 'force-dynamic'
export const metadata = { title: 'Blog preview' }

export default async function BlogPreviewRoute({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (EDITOR) notFound()
  await requireAdmin('/admin/blog')
  const { doc } = await publishedSite()
  const { slug } = await searchParams
  const type = typefaceCss(doc.settings.options.typeface)
  const accent = accentCss((doc.settings as { accent?: string }).accent)
  return (
    <>
      {type && <style>{type}</style>}
      {accent && <style>{accent}</style>}
      <BlogPreviewPage doc={doc} slug={typeof slug === 'string' && slug ? slug : null} />
    </>
  )
}
