import Link from 'next/link'
import type { SiteContent } from '@/cms/derive'
import styles from './StaticProfile.module.css'

/* ============================================================
   ACCESSIBLE / INDEXABLE WORK RECORD
   Server-rendered, for `/projects` only. Not the home page's
   summary repeated at a second URL: no identity block, no
   education, no technology index, no contact list — those are
   answered at `/`, and two self-canonical pages printing the
   same paragraphs do not rank twice, they compete, and the
   engine keeps whichever one it prefers.

   So this URL owns the work outright. The employment record
   lives here rather than on the home page because all four
   entries are chapters of this journey, and the archive that
   follows is the whole of it: description, contribution,
   verified facts, metrics, technologies and links. The home page
   keeps a bare index of titles and one-line summaries, which is
   how a reader gets here, and the line below is how a reader
   who arrived here first gets back.

   NAMING THE TARGET
   Every outbound anchor carries its project's title in the link
   text. Forty-odd links reading "Source repository" would be a
   list of identical entries in a screen reader's link menu, and
   forty identical anchor texts pointing at forty different hosts
   for a crawler.
   ============================================================ */

export function StaticProjects({ content }: { content: SiteContent }) {
  const { experience, projects, profile } = content
  return (
    <div className={styles.host} id="projects-summary">
      <h1>Projects and professional work — {profile.name}</h1>
      <p>
        Client work, teaching, products and applied AI: the things built, what
        was contributed to each, and what can be verified about them.
      </p>
      <p>
        Who he is, what he studied and how to reach him are on the{' '}
        <Link href="/">profile page</Link>.
      </p>

      <h2>Professional experience</h2>
      <ul>
        {experience.map((e) => (
          <li key={e.id}>
            <h3>{e.role} — {e.organisation}</h3>
            <p>{e.dates}</p>
            <p>{e.summary}</p>
            <ul>
              {e.facts.map((f, i) => <li key={i}>{f}</li>)}
            </ul>
            {e.metrics.length > 0 && (
              <ul>
                {e.metrics.map((m) => <li key={m.label}>{m.label}: {m.value}</li>)}
              </ul>
            )}
            <p>Technologies: {e.technologies.join(', ')}.</p>
          </li>
        ))}
      </ul>

      <h2>Project archive</h2>
      <ul>
        {projects.map((p) => (
          <li key={p.id}>
            <h3><a href={`/projects/${p.slug}`}>{p.title}</a></h3>
            <p>{p.year} · {p.source} · {p.subcategory ?? p.category}</p>
            <p>{p.description}</p>
            {p.contribution && <p>Contribution: {p.contribution}</p>}
            {p.verifiedFacts.length > 0 && (
              <ul>
                {p.verifiedFacts.map((f, i) => <li key={i}>{f}</li>)}
              </ul>
            )}
            {p.metrics.length > 0 && (
              <p>{p.metrics.map((m) => `${m.label}: ${m.value}`).join('. ')}.</p>
            )}
            <p>Technologies: {p.technologies.join(', ')}.</p>
            {p.repository && !p.privateSource && (
              <p><a href={p.repository}>{p.title} — source repository</a></p>
            )}
            {p.liveUrl && <p><a href={p.liveUrl}>{p.title} — live site</a></p>}
          </li>
        ))}
      </ul>
    </div>
  )
}
