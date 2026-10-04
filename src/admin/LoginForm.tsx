'use client'

import Link from 'next/link'
import { useState } from 'react'

export function LoginForm({ next, noAdmins }: { next: string; noAdmins: boolean }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <main className="a-login">
      <form
        className="card"
        onSubmit={async (e) => {
          e.preventDefault()
          const form = new FormData(e.currentTarget)
          setBusy(true)
          setError(null)
          try {
            const res = await fetch('/api/admin/auth/login', {
              method: 'POST',
              credentials: 'same-origin',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ email: form.get('email'), password: form.get('password') }),
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok) throw new Error(data.error ?? 'Sign-in failed.')
            window.location.assign(next)
          } catch (err) {
            setError((err as Error).message)
            setBusy(false)
          }
        }}
      >
        <div className="row" style={{ gap: 10 }}>
          <span className="a-mark" aria-hidden="true">AN</span>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 600 }}>Portfolio admin</h1>
            <p className="a-sub" style={{ fontSize: 12 }}>Sign in to edit the site and the world.</p>
          </div>
        </div>
        {noAdmins && (
          <p className="notice">
            No administrator exists yet. Create one on the server with <code className="a-mono">npm run admin:create</code> (see docs/ADMIN.md).
          </p>
        )}
        <label className="field">
          <span>Email</span>
          <input className="input" name="email" type="email" autoComplete="username" required />
        </label>
        <label className="field">
          <span>Password</span>
          <input className="input" name="password" type="password" autoComplete="current-password" required minLength={12} />
        </label>
        {error && <p className="notice" data-tone="danger" role="alert">{error}</p>}
        <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <Link href="/" className="a-sub" style={{ fontSize: 12 }}>← Back to the site</Link>
      </form>
    </main>
  )
}
