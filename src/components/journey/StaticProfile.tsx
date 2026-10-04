import Link from 'next/link'
import { TECH_GROUPS as techGroups, type SiteContent } from '@/cms/derive'
import styles from './StaticProfile.module.css'

/* ============================================================
   ACCESSIBLE / INDEXABLE PROFILE
   Server-rendered. Visually hidden but fully in the DOM and in
   the tab order, so the answers to "who is he, what did he
   study, what does he work with, how do I reach him" never
   depend on WebGL, JavaScript or scroll.

   ONE FACT, ONE URL
   This page and `/projects` are both self-canonical and both sit
   in the sitemap. Anything printed in full on both therefore
   makes the two compete for the same query, and the engine — not
   us — decides which one to keep. So the record is divided
   rather than shared. Identity, education, the technology index
   and the contact list are answered here and nowhere else. The
   project archive — what each project does, what was contributed
   to it, what can be verified about it, what it was built with
   and where it lives — is answered at `/projects` and nowhere
   else. What stands here in its place is an index: one line per
   project, taken from `shortDescription`, which is a different
   sentence from the archive's `description` rather than the same
   one set twice.

   The employment record went with the archive. All four entries
   are chapters of the `/projects` journey, and each is told in
   the same facts and metrics that the archive prints around it,
   so keeping the two together keeps one argument in one place.
   The pointer below carries a reader — or a crawler that has
   only ever seen this page — straight to it.
   ============================================================ */

export function StaticProfile({ content }: { content: SiteContent }) {
  const { profile, contact, education, credentials, projects, techNodes } = content
  return (
    <div className={styles.host} id="profile-summary">
      <h1>{profile.name} — Software &amp; AI Engineer</h1>
      <p>{profile.summary}</p>
      <p>Based in {profile.location}. Portfolio {profile.year}.</p>
      <p>
        Where he has worked and the full record of what he has built are at{' '}
        <Link href="/projects">Projects and professional work</Link>.
      </p>

      <h2>Education</h2>
      <ul>
        {education.map((e) => (
          <li key={e.id}>
            <h3>{e.degree} — {e.institution}</h3>
            <p>{e.dates}{e.result ? ` · ${e.result}` : ''}</p>
            <p>Modules: {e.modules.map((m) => m.name).join(', ')}.</p>
          </li>
        ))}
        {credentials.map((c) => (
          <li key={c.id}>
            <h3>{c.title} — {c.issuer}</h3>
            <p>{c.note}</p>
          </li>
        ))}
      </ul>

      <h2>Technologies</h2>
      {techGroups.map((g) => (
        <p key={g.id}>
          {g.label}: {techNodes.filter((n) => n.group === g.id).map((n) => n.name).join(', ')}.
        </p>
      ))}

      {/* An index, not an archive: a name, a year and the one line
          each project is introduced with. Every title links to the
          project's own page, /projects/<slug>, which the sitemap
          advertises and which renders the same project entity the
          cards, the universe and the case-study overlay read. */}
      <h2>Project index</h2>
      <p>
        {projects.length} projects. Descriptions, contributions, verified facts,
        metrics and links are in <Link href="/projects">the full project archive</Link>.
      </p>
      <ul>
        {projects.map((p) => (
          <li key={p.id}>
            <a href={`/projects/${p.slug}`}>{p.title}</a> ({p.year}) — {p.shortDescription}
          </li>
        ))}
      </ul>

      <h2>Contact</h2>
      <ul>
        {contact.map((c) =>
          c.id === 'cv' && c.dataStatus === 'placeholder' ? (
            <li key={c.id}>{c.label}: available on request</li>
          ) : (
            <li key={c.id}><a href={c.href}>{c.label}: {c.value}</a></li>
          ),
        )}
      </ul>
    </div>
  )
}
