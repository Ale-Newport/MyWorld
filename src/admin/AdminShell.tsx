'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { setCsrf, api } from './api'
import { useToasts } from './toast'
import { Icon, type IconName } from './ui/icons'

/* ============================================================
   ONE ADMIN, FOUR PLACES (TWO ON THE DEPLOYED SITE)

   The navigation is the four things there are to do: edit the
   website, edit the world, read the audience, change the few
   site-wide settings. Everything else lives inside one of them —
   projects, media and history are tabs of the website; the world's
   own history is reached from the world editor.

   Editing the website and the world happens in the editor on your
   own machine, and Publish there commits the result: the deployed
   admin keeps only the audience and the settings. The editor shows
   only what the deployed admin cannot do (the website, the world, the
   site's images), and never the website itself.
   ============================================================ */
const NAV: { href: string; label: string; icon: IconName; match: RegExp; editor?: boolean; deployed?: boolean }[] = [
  { href: '/admin/pages', label: 'Website', icon: 'website', match: /^\/admin(\/(pages|projects|media|history)(\/.*)?)?$/, editor: true },
  { href: '/admin/world', label: 'World', icon: 'world', match: /^\/admin\/world/, editor: true },
  { href: '/admin/analytics', label: 'Audience', icon: 'audience', match: /^\/admin\/analytics/, deployed: true },
  { href: '/admin/settings', label: 'Settings', icon: 'settings', match: /^\/admin\/settings/, deployed: true },
  { href: '/admin/settings', label: 'Site images', icon: 'media', match: /^\/admin\/settings/, editor: true },
]

/** Editors want the whole screen: the navigation folds to a rail there. */
const COMPACT = [/^\/admin\/pages/, /^\/admin\/world/, /^\/admin\/projects\/[^/]+/]

export function AdminShell({ user, csrf, editor, siteUrl, children }: { user: { name: string; email: string }; csrf: string; editor: boolean; siteUrl: string; children: React.ReactNode }) {
  const pathname = usePathname()
  const toasts = useToasts((s) => s.items)
  const [signingOut, setSigningOut] = useState(false)
  // Set during the first render, before any child can make a request.
  useState(() => { setCsrf(csrf); return csrf })
  useEffect(() => {
    // The public site's custom cursor and scroll locks must not follow us in.
    document.documentElement.removeAttribute('data-cursor')
    document.body.style.overflow = ''
  }, [])
  const compact = COMPACT.some((p) => p.test(pathname))
  return (
    <div className="a-shell" data-compact={compact}>
      <nav className="a-nav" aria-label="Admin">
        <Link href={editor ? '/admin/pages' : '/admin/settings'} prefetch={false} className="a-brand" title={editor ? 'Portfolio editor' : 'Portfolio admin'}>
          <span className="a-mark" aria-hidden="true">AN</span>
          <span className="a-brand-text"><b>{editor ? 'Portfolio editor' : 'Portfolio admin'}</b><small>{user.name}</small></span>
        </Link>
        <div className="a-nav-items">
          {NAV.filter((item) => (editor ? !item.deployed : !item.editor)).map((item) => (
            <Link key={item.href} href={item.href} prefetch={false} className="a-item" aria-current={item.match.test(pathname) ? 'page' : undefined} title={item.label}>
              <Icon name={item.icon} />
              <span className="a-text">{item.label}</span>
            </Link>
          ))}
        </div>
        <div className="a-nav-foot">
          {/* The editor does not show the website: this opens the deployed one. */}
          <a className="a-item" href={editor ? siteUrl : '/'} target="_blank" rel="noreferrer" title="View the live site">
            <Icon name="external" />
            <span className="a-text">View site</span>
          </a>
          <button
            type="button"
            className="a-item"
            disabled={signingOut}
            onClick={async () => {
              setSigningOut(true)
              await api('/api/admin/auth/logout', { method: 'POST' }).catch(() => {})
              // A full load, so nothing of the session survives in client caches.
              // eslint-disable-next-line @next/next/no-location-assign-relative-destination
              window.location.assign('/admin/login')
            }}
            title={`Sign out (${user.email})`}
          >
            <Icon name="signout" />
            <span className="a-text">{signingOut ? 'Signing out…' : 'Sign out'}</span>
          </button>
        </div>
      </nav>
      <div className="a-main">{children}</div>
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className="toast" data-tone={t.tone}>{t.text}</div>)}
      </div>
    </div>
  )
}
