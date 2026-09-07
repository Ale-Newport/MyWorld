import { profile, contact } from '@/content/profile'
import { education, credentials } from '@/content/education'
import { experience } from '@/content/experience'
import { projects } from '@/content/projects'
import { techNodes, techGroups } from '@/content/skills'
import styles from './StaticProfile.module.css'

/* ============================================================
   ACCESSIBLE / INDEXABLE PROFILE
   Server-rendered. Visually hidden but fully in the DOM and in
   the tab order, so the answers to "who is he, what did he
   study, where has he worked, what has he built, how do I
   reach him" never depend on WebGL, JavaScript or scroll.
   ============================================================ */

export function StaticProfile() {
  return (
    <div className={styles.host} id="profile-summary">
      <h1>{profile.name} — Software &amp; AI Engineer</h1>
      <p>{profile.summary}</p>
      <p>Based in {profile.location}. Portfolio {profile.year}.</p>

      <h2>Experience</h2>
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
          </li>
        ))}
      </ul>

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

      <h2>Projects</h2>
      <ul>
        {projects.map((p) => (
          <li key={p.id}>
            <h3>{p.title}</h3>
            <p>{p.year} · {p.importance} · {p.subcategory ?? p.category}</p>
            <p>{p.description}</p>
            {p.metrics.length > 0 && (
              <p>{p.metrics.map((m) => `${m.label}: ${m.value}`).join('. ')}.</p>
            )}
            <p>Technologies: {p.technologies.join(', ')}.</p>
            {p.repository && !p.privateSource && (
              <p><a href={p.repository}>Source repository</a></p>
            )}
            {p.liveUrl && <p><a href={p.liveUrl}>Live site</a></p>}
          </li>
        ))}
      </ul>

      <h2>Technologies</h2>
      {techGroups.map((g) => (
        <p key={g.id}>
          {g.label}: {techNodes.filter((n) => n.group === g.id).map((n) => n.name).join(', ')}.
        </p>
      ))}

      <h2>Contact</h2>
      <ul>
        {contact.map((c) => (
          <li key={c.id}><a href={c.href}>{c.label}: {c.value}</a></li>
        ))}
      </ul>
    </div>
  )
}
