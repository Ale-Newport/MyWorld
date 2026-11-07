import { Notice, PageHeader, Tabs, WEBSITE_TABS } from '../ui/kit'
import { Icon } from '../ui/icons'

/* The editor on your machine no longer writes posts: the live admin does,
   committing each one to the repository (admin/blog/store.ts). An old link
   or bookmark to the editor's blog lands here and is sent on. */
export function BlogMoved({ siteUrl }: { siteUrl: string }) {
  return (
    <main className="a-page">
      <PageHeader eyebrow="Website" title="Blog" tabs={<Tabs label="Website" tabs={WEBSITE_TABS} />} />
      <div className="stack" style={{ maxWidth: 640 }}>
        <Notice tone="info">
          <b>Posts are written in the live admin.</b> There, each post is saved and published as a commit to the site&apos;s repository, and the
          website rebuilds with it a minute or two later. After a <span className="a-mono">git pull</span>, <b>History › Reload from git</b> brings the posts
          into this editor too, so publishing from here keeps them.
        </Notice>
        <div className="row">
          <a className="btn btn-primary" href={`${siteUrl}/admin/blog`} target="_blank" rel="noreferrer">Open the blog in the live admin <Icon name="external" size={16} /></a>
        </div>
      </div>
    </main>
  )
}
