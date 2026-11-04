'use client'

import { useEffect } from 'react'
import { create } from 'zustand'
import type { TokenStatus } from '@/server/github'
import { api } from './api'
import { Notice } from './ui/kit'

/* ============================================================
   THE GITHUB TOKEN'S EXPIRY

   Publishing settings from the deployed admin needs a GitHub token,
   and a token expires. This says how long is left, warns from 30
   days before (on every admin page), and gives the steps to renew
   it. GitHub reports the date itself; see server/github.ts.
   ============================================================ */

const WARN_DAYS = 30

interface Store { status: TokenStatus | null; loading: boolean; load: (fresh?: boolean) => Promise<void> }

const useToken = create<Store>((set, get) => ({
  status: null,
  loading: false,
  async load(fresh = false) {
    if (get().loading || (!fresh && get().status)) return
    set({ loading: true })
    try {
      set({ status: await api<TokenStatus>(`/api/admin/github${fresh ? '?fresh=1' : ''}`) })
    } catch {
      /* the reminder is a courtesy: never in the way */
    } finally {
      set({ loading: false })
    }
  },
}))

const day = (at: number) => new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`

/** One sentence: how long is left, or what is wrong. */
export function describeToken(s: TokenStatus): { tone: 'ok' | 'warn' | 'danger' | 'info'; text: string } {
  if (!s.valid) return { tone: 'danger', text: s.error ?? 'GitHub does not accept this token.' }
  if (s.daysLeft == null || s.expiresAt == null) return { tone: 'info', text: 'This token has no expiry date.' }
  if (s.daysLeft < 0) return { tone: 'danger', text: `The token expired on ${day(s.expiresAt)}.` }
  if (s.daysLeft === 0) return { tone: 'danger', text: `The token expires today (${day(s.expiresAt)}).` }
  return { tone: s.daysLeft <= WARN_DAYS ? 'warn' : 'ok', text: `The token expires in ${plural(s.daysLeft, 'day')} (${day(s.expiresAt)}).` }
}

/** The steps, as shown wherever the token is mentioned. */
function Steps() {
  return (
    <ol className="a-sub" style={{ paddingLeft: 20, display: 'grid', gap: 6, margin: '6px 0 0', listStyle: 'decimal' }}>
      <li>On GitHub: your photo → <b>Settings</b> → <b>Developer settings</b> → <b>Personal access tokens</b> → <b>Fine-grained tokens</b>.</li>
      <li>Open <b>portfolio-admin-settings</b> and choose <b>Regenerate token</b> (it keeps the repository and the permission) with a new expiration, then copy the new value (it starts with <code>github_pat_</code>).</li>
      <li>In Terminal, from the project folder:
        <pre className="a-mono" style={{ margin: '4px 0', padding: '8px 10px', background: 'var(--a-sunk)', borderRadius: 6, overflowX: 'auto' }}>{'cd ~/Projects/Portfolio\nnpx wrangler secret put GITHUB_TOKEN'}</pre>
        Paste the token when it asks and press Enter.
      </li>
      <li>Come back here and press <b>Check again</b>.</li>
    </ol>
  )
}

/** On every deployed admin page: only when something needs doing. */
export function TokenBanner() {
  const { status, load } = useToken()
  useEffect(() => { void load() }, [load])
  if (!status?.configured) return null
  const { tone, text } = describeToken(status)
  if (tone !== 'warn' && tone !== 'danger') return null
  return (
    <div style={{ padding: '10px 16px 0' }}>
      <Notice tone={tone}>
        <b>GitHub token.</b> {text} {status.valid ? 'Settings cannot be published once it expires.' : 'Settings cannot be published until it is renewed.'}{' '}
        <a href="/admin/settings#github-token" style={{ textDecoration: 'underline' }}>How to renew it</a>
      </Notice>
    </div>
  )
}

/** On the Settings page, always. */
export function TokenCard() {
  const { status, loading, load } = useToken()
  useEffect(() => { void load() }, [load])
  if (!status?.configured) return null
  const { tone, text } = describeToken(status)
  return (
    <section className="card stack" id="github-token">
      <h2>GitHub token</h2>
      <Notice tone={tone}>{text}</Notice>
      <p className="a-sub" style={{ fontSize: 12.5 }}>
        Publishing a setting here is a commit to <code>{status.repo}</code>, made with this token. When it expires publishing stops until it is renewed; you are warned here from {WARN_DAYS} days before.
      </p>
      <details open={tone === 'warn' || tone === 'danger'}>
        <summary style={{ cursor: 'pointer' }}>How to renew it</summary>
        <Steps />
      </details>
      <div className="row"><button type="button" className="btn btn-sm" disabled={loading} onClick={() => void load(true)}>{loading ? 'Checking…' : 'Check again'}</button></div>
    </section>
  )
}
