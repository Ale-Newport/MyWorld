'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { setCsrf, api } from './api'
import { useToasts } from './toast'

const NAV: { group?: string; href: string; label: string; icon: string }[] = [
  { href: '/admin', label: 'Dashboard', icon: '◧' },
  { group: 'Content', href: '/admin/pages', label: 'Page editor', icon: '▤' },
  { href: '/admin/projects', label: 'Projects', icon: '▣' },
  { href: '/admin/library', label: 'Animation library', icon: '✦' },
  { href: '/admin/world', label: 'World editor', icon: '◭' },
  { group: 'Site', href: '/admin/media', label: 'Media', icon: '▨' },
  { href: '/admin/analytics', label: 'Audience', icon: '◔' },
  { href: '/admin/settings', label: 'Settings', icon: '⚙' },
  { href: '/admin/history', label: 'History', icon: '↺' },
]

/** Editors want the whole screen: the navigation folds to a rail there. */
const COMPACT = [/^\/admin\/pages/, /^\/admin\/world/, /^\/admin\/projects\/[^/]+/, /^\/admin\/library/]

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
        <Link href="/admin" className="a-brand">
          <span className="a-mark" aria-hidden="true">AN</span>
          <span><b>Portfolio admin</b><small>Draft · publish · world</small></span>
        </Link>
        {NAV.map((item) => (
          <div key={item.href} style={{ display: 'contents' }}>
            {item.group && <p className="a-group a-label">{item.group}</p>}
            <Link href={item.href} className="a-item" aria-current={(item.href === '/admin' ? pathname === '/admin' : pathname.startsWith(item.href)) ? 'page' : undefined} title={item.label}>
              <span className="a-icon" aria-hidden="true">{item.icon}</span>
              <span className="a-text">{item.label}</span>
            </Link>
          </div>
        ))}
        <div className="a-nav-foot">
          <a className="a-item" href="/" target="_blank" rel="noreferrer" title="Open the public site">
            <span className="a-icon" aria-hidden="true">↗</span><span className="a-text">View site</span>
          </a>
          <span className="a-user a-text" title={user.email}>{user.name}</span>
          <button
            type="button"
            className="btn btn-sm"
            disabled={signingOut}
            onClick={async () => {
              setSigningOut(true)
              await api('/api/admin/auth/logout', { method: 'POST' }).catch(() => {})
              // A full load, so nothing of the session survives in client caches.
              // eslint-disable-next-line @next/next/no-location-assign-relative-destination
              window.location.assign('/admin/login')
            }}
            title="Sign out"
          >
            <span aria-hidden="true">⏻</span><span className="a-text">Sign out</span>
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
