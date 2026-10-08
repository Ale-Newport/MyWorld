'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { setCsrf, api } from './api'
import { useToasts } from './toast'
import { Icon, type IconName } from './ui/icons'

/* ============================================================
   ONE ADMIN, FOUR PLACES

   The navigation is the four things there are to do: edit the
   website, edit the world, read the audience, change the few
   site-wide settings. Everything else lives inside one of them —
   projects, media and history are tabs of the website; the world's
   own history is reached from the world editor.
   ============================================================ */
const NAV: { href: string; label: string; icon: IconName; match: RegExp }[] = [
  { href: '/admin/pages', label: 'Website', icon: 'website', match: /^\/admin(\/(pages|projects|media|history)(\/.*)?)?$/ },
  { href: '/admin/world', label: 'World', icon: 'world', match: /^\/admin\/world/ },
  { href: '/admin/analytics', label: 'Audience', icon: 'audience', match: /^\/admin\/analytics/ },
  { href: '/admin/settings', label: 'Settings', icon: 'settings', match: /^\/admin\/settings/ },
]

/** Editors want the whole screen: the navigation folds to a rail there. */
const COMPACT = [/^\/admin\/pages/, /^\/admin\/world/, /^\/admin\/projects\/[^/]+/]

export function AdminShell({ user, csrf, children }: { user: { name: string; email: string }; csrf: string; children: React.ReactNode }) {
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
        <Link href="/admin/pages" prefetch={false} className="a-brand" title="Portfolio admin">
          <span className="a-mark" aria-hidden="true">AN</span>
          <span className="a-brand-text"><b>Portfolio admin</b><small>{user.name}</small></span>
        </Link>
        <div className="a-nav-items">
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} prefetch={false} className="a-item" aria-current={item.match.test(pathname) ? 'page' : undefined} title={item.label}>
              <Icon name={item.icon} />
              <span className="a-text">{item.label}</span>
            </Link>
          ))}
        </div>
        <div className="a-nav-foot">
          {/* Leaves Draft Mode first, so the site shows what visitors see. */}
          <a className="a-item" href="/admin/view-site" target="_blank" rel="noreferrer" title="View the live site">
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
