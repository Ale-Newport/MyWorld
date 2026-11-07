import { Notice, PageHeader, Tabs, WEBSITE_TABS } from '../ui/kit'
import { Icon } from '../ui/icons'

/* The editor on your machine does not write posts: the live admin does, and
   keeps them in the site's database (server/blog.ts), where /blog reads them.
   An old link or bookmark to the editor's blog lands here and is sent on. */
export function BlogMoved({ siteUrl }: { siteUrl: string }) {
  return (
    <main className="a-page">
      <PageHeader eyebrow="Website" title="Blog" tabs={<Tabs label="Website" tabs={WEBSITE_TABS} />} />
      <div className="stack" style={{ maxWidth: 640 }}>
        <Notice tone="info">
          <b>Posts are written in the live admin.</b> There, each post is saved in the site&apos;s database and is on /blog as soon as it is
          published: nothing is committed and nothing is rebuilt. Publishing the website from here leaves the blog as it is.
        </Notice>
        <div className="row">
          <a className="btn btn-primary" href={`${siteUrl}/admin/blog`} target="_blank" rel="noreferrer">Open the blog in the live admin <Icon name="external" size={16} /></a>
        </div>
      </div>
    </main>
  )
}
