'use client'

import { useEffect } from 'react'
import { useSiteStore } from './store/site'
import { DraftBar } from './DraftBar'
import { Loading, PageHeader } from './ui/kit'
import { ColorInput, Field, MediaInput, SelectInput, StringList, TextInput, Toggle, newId } from './fields'
import { safeHref } from '@/cms/schema'

/* ============================================================
   SETTINGS — each one is read by the public site:
   title, description, keywords and the share image become the
   pages' metadata; the theme colour paints the browser chrome;
   the favicon is the tab icon; the site URL makes canonical and
   social links absolute (and the sitemap). The world entrance
   switch and label drive the portal at the foot of the homepage
   and the index's link; leaf growth sets how much push the leaves
   need; analytics switches first-party collection on or off at
   the server, not just in the page.
   ============================================================ */
export function SettingsAdmin() {
  const { status, doc, load, apply } = useSiteStore()
  useEffect(() => { void load() }, [load])
  if (status !== 'ready' || !doc) return <main className="a-page"><Loading label="Loading the draft…" /></main>
  const s = doc.settings
  const world = s.navigation.findIndex((n) => n.id === 'world')
  const extra = s.navigation.map((n, i) => ({ n, i })).filter(({ n }) => n.id !== 'world')
  const host = (() => { try { return new URL(s.siteUrl).host } catch { return s.siteUrl } })()

  return (
    <main className="a-page">
      <PageHeader
        eyebrow="Site"
        title="Settings"
        description="Site-wide essentials. Part of the same draft as every other edit: save, then publish to apply them."
        actions={<DraftBar />}
      />
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(280px, 380px)', gap: 18, alignItems: 'start' }}>
        <div className="stack">
          <section className="card stack">
            <h2>Identity</h2>
            <TextInput path="settings.title" label="Site title" maxLength={400} hint="The homepage's title; other pages use “Page — Name”." />
            <TextInput path="settings.description" label="Description" multiline rows={3} maxLength={320} />
            <StringList path="settings.keywords" label="Keywords" addLabel="Add keyword" />
            <TextInput path="settings.siteUrl" label="Site URL" hint="Canonical and social links are made absolute with it; the sitemap lists pages under it." validate={(v) => { try { const u = new URL(v); return u.protocol === 'https:' || u.hostname === 'localhost' ? null : 'Use https://' } catch { return 'A full URL, e.g. https://example.com' } }} />
          </section>
          <section className="card stack">
            <h2>Appearance</h2>
            <ColorInput path="settings.themeColor" label="Browser theme colour" optional={false} />
            <MediaInput path="settings.favicon" label="Favicon" hint="Square PNG or SVG. Empty keeps the built-in icon." />
            <MediaInput path="settings.ogImage" label="Share image" hint="Shown when the site is shared; 1200×630 works everywhere." />
          </section>
          <section className="card stack">
            <h2>Navigation</h2>
            {world >= 0 && <TextInput path={`settings.navigation.${world}.label`} label="World entrance label" hint="The index's link to /world. The address is fixed: the leaf transition leads there." />}
            <div className="stack" style={{ gap: 8 }}>
              <div className="row"><span className="a-sub" style={{ fontSize: 12 }}>Extra links in the index overlay</span><span className="spacer" />
                <button type="button" className="btn btn-sm" disabled={s.navigation.length >= 12} onClick={() => apply((d) => { d.settings.navigation.push({ id: newId('nav-'), label: 'Link', href: 'https://', external: true }) })}>+ Link</button>
              </div>
              {extra.length === 0 && <p className="a-sub" style={{ fontSize: 12.5 }}>None. Contact links are edited with the profile.</p>}
              {extra.map(({ n, i }) => {
                const bad = !safeHref.safeParse(n.href).success
                return (
                  <div key={n.id} className="row" style={{ alignItems: 'center' }}>
                    <input className="input" style={{ width: 150 }} value={n.label} aria-label={`Link ${i} label`} onChange={(e) => apply((d) => { d.settings.navigation[i].label = e.target.value }, { coalesce: `nav-${n.id}-label` })} />
                    <input className="input" style={{ flex: 1 }} value={n.href} aria-label={`Link ${i} address`} aria-invalid={bad} onChange={(e) => apply((d) => { d.settings.navigation[i].href = e.target.value; d.settings.navigation[i].external = /^https?:/.test(e.target.value) }, { coalesce: `nav-${n.id}-href` })} />
                    <button type="button" className="btn btn-sm btn-icon" aria-label="Remove link" onClick={() => apply((d) => { d.settings.navigation.splice(i, 1) })}>✕</button>
                  </div>
                )
              })}
            </div>
          </section>
          <section className="card stack">
            <h2>Behaviour</h2>
            <Toggle path="settings.options.worldEntrance" label="World entrance at the foot of the homepage" hint="Off: no portal to charge and no world link in the index. /world still answers for anyone with the address." />
            <SelectInput path="settings.options.leafCharge" label="Leaf growth" options={[{ value: 'gentle', label: 'Gentle — a longer push' }, { value: 'standard', label: 'Standard' }, { value: 'brisk', label: 'Brisk — a shorter push' }]} hint="How much scrolling the leaves need to close. The cover always completes before the world loads." />
            <SelectInput path="settings.options.leafParting" label="Leaf parting" options={[{ value: 'slow', label: 'Slow — a longer reveal' }, { value: 'standard', label: 'Standard' }, { value: 'quick', label: 'Quick — a shorter reveal' }]} hint="How long the leaves take to open over the world once it is ready." />
            <Toggle path="settings.options.analytics" label="First-party audience statistics" hint="Cookieless, no third parties, honours Do Not Track and Global Privacy Control. Off: the collector refuses every event." />
          </section>
        </div>
        <aside className="stack" style={{ position: 'sticky', top: 16 }}>
          <section className="card stack">
            <p className="a-label">Search result</p>
            <div>
              <p className="a-mono" style={{ color: 'var(--a-muted)' }}>{host}</p>
              <p style={{ color: '#1a0dab', fontSize: 18, lineHeight: 1.3 }}>{s.title || 'Untitled'}</p>
              <p style={{ fontSize: 13, color: 'var(--a-ink-2)' }}>{s.description.length > 160 ? `${s.description.slice(0, 157)}…` : s.description}</p>
            </div>
          </section>
          <section className="card stack">
            <p className="a-label">Shared link</p>
            <div style={{ border: '1px solid var(--a-line)', borderRadius: 10, overflow: 'hidden', background: '#fff' }}>
              {s.ogImage ? <img src={s.ogImage} alt="" style={{ width: '100%', aspectRatio: '1200 / 630', objectFit: 'cover', display: 'block' }} /> : <div style={{ aspectRatio: '1200 / 630', display: 'grid', placeItems: 'center', background: s.themeColor, color: 'var(--a-muted)', fontSize: 12 }}>No share image</div>}
              <div style={{ padding: '10px 12px' }}>
                <p className="a-mono" style={{ color: 'var(--a-muted)', fontSize: 11 }}>{host.toUpperCase()}</p>
                <p style={{ fontWeight: 600 }}>{s.title}</p>
              </div>
            </div>
          </section>
          <Field label="Theme colour"><div style={{ height: 36, borderRadius: 8, background: s.themeColor, border: '1px solid var(--a-line)' }} /></Field>
        </aside>
      </div>
    </main>
  )
}
