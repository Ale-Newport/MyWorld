'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useEditing, useSite } from '@/cms/context'
import { E } from '@/cms/editable'
import { renderRich } from '@/cms/rich'
import type { ProjectSection } from '@/cms/schema'
import { ProjectVisual } from '@/components/project-visuals/ProjectVisual'
import { categoryAccent } from '@/content/project-meta'
import { track } from '@/components/analytics/track'
import styles from './ProjectPage.module.css'

/* ============================================================
   A PROJECT'S OWN PAGE

   The same entity everything else reads, given a page: what it
   is, what was contributed, the numbers, how it works, the stack,
   where it lives, and the sections the admin adds below (text,
   facts, metrics, galleries, video, links, tables). Every field is
   bound to the entity, so an inline edit in the admin's preview
   edits the project itself — and with it the card, the universe
   node and the case-study overlay.
   ============================================================ */

function Section({ section, at }: { section: ProjectSection; at: string }) {
  if (section.hidden) return null
  const items = section.items ?? []
  return (
    <section className={styles.section} aria-labelledby={`section-${section.id}`}>
      <E cms={`project.section.${section.id}.title`} as="h2" kind="heading" label="Section title" bind={`${at}.title`} id={`section-${section.id}`} className={styles.sectionTitle}>{section.title}</E>
      {section.type === 'text' && section.body !== undefined && <div className={styles.prose}>{renderRich(section.body)}</div>}
      {section.type === 'facts' && <ul className={styles.facts}>{items.map((it, i) => <li key={i}>{it.value}</li>)}</ul>}
      {section.type === 'metrics' && (
        <div className={styles.metrics}>{items.map((it, i) => <div key={i} className={styles.metric}><span className={styles.metricValue}>{it.value}</span><span className={styles.metricLabel}>{it.label}</span></div>)}</div>
      )}
      {section.type === 'gallery' && (
        <div className={styles.gallery}>{items.filter((it) => it.src).map((it, i) => <figure key={i}><img src={it.src} alt={it.alt ?? ''} loading="lazy" decoding="async" />{it.label && <figcaption>{it.label}</figcaption>}</figure>)}</div>
      )}
      {section.type === 'video' && items.filter((it) => it.src).map((it, i) => (
        <figure key={i} className={styles.video}><video src={it.src} controls playsInline preload="metadata" aria-label={it.alt || it.label || section.title} />{it.label && <figcaption>{it.label}</figcaption>}</figure>
      ))}
      {section.type === 'links' && (
        <ul className={styles.linkList}>{items.filter((it) => it.href).map((it, i) => <li key={i}><a href={it.href} target={it.href!.startsWith('http') ? '_blank' : undefined} rel={it.href!.startsWith('http') ? 'noopener noreferrer' : undefined}>{it.label || it.href} ↗</a></li>)}</ul>
      )}
      {section.type === 'table' && section.table && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            {section.table.caption && <caption>{section.table.caption}</caption>}
            {section.table.header && <thead><tr>{section.table.columns.map((c) => <th key={c.id} scope="col" style={{ textAlign: c.align, width: c.width }}>{c.label}</th>)}</tr></thead>}
            <tbody>{section.table.rows.map((r) => <tr key={r.id}>{section.table!.columns.map((c, i) => (i === 0 && section.table!.header ? <th key={c.id} scope="row" style={{ textAlign: c.align }}>{r.cells[c.id]}</th> : <td key={c.id} style={{ textAlign: c.align }}>{r.cells[c.id]}</td>))}</tr>)}</tbody>
          </table>
        </div>
      )}
    </section>
  )
}

/* This page is outside the journeys (which track it in their store), so it asks the browser itself. */
function useReducedMotionPreference() {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const apply = () => setReduced(mq.matches)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])
  return reduced
}

export function ProjectPage({ slug }: { slug: string }) {
  const { projectBySlug, projects, techByProject, techById, profile } = useSite()
  const editing = useEditing()
  const reducedMotion = useReducedMotionPreference()
  const p = projectBySlug[slug]
  useEffect(() => { if (p && !editing) track('project_open', { slug: p.slug, from: 'page' }) }, [p, editing])
  if (!p) return editing ? <main className={styles.page}><p className={styles.lead}>No project in this draft answers to “{slug}”. Archived projects have no page.</p></main> : null
  const at = `projects[id=${p.id}]`
  const accent = p.accent ?? categoryAccent[p.category]
  const techs = techByProject[p.id] ?? []
  const index = projects.findIndex((x) => x.id === p.id)
  const prev = index > 0 ? projects[index - 1] : null
  const next = index >= 0 && index < projects.length - 1 ? projects[index + 1] : null
  return (
    <main className={styles.page} style={{ ['--project-accent' as string]: accent }}>
      <nav className={styles.crumbs} aria-label="Breadcrumb">
        <Link href="/">{profile.name}</Link>
        <span aria-hidden="true">/</span>
        <Link href="/projects">Projects</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{p.shortTitle ?? p.title}</span>
      </nav>

      <header className={styles.hero}>
        <div className={styles.heroText}>
          <p className={styles.eyebrow}>
            <span>{p.subcategory ?? p.category}</span><span aria-hidden="true">·</span><span>{p.dates ?? p.year}</span>
            {p.organisation && <><span aria-hidden="true">·</span><span>{p.organisation}</span></>}
          </p>
          <E cms="project.title" as="h1" kind="heading" label="Title" bind={`${at}.title`} className={styles.title}>{p.title}</E>
          <E cms="project.summary" as="p" label="Summary" bind={`${at}.shortDescription`} className={styles.summary}>{p.shortDescription}</E>
        </div>
        <div className={styles.visual}>
          {p.assets.screenshots[0] ? <img src={p.assets.screenshots[0]} alt={`${p.title} — screenshot`} className={styles.shot} /> : <ProjectVisual project={p} active interactive reducedMotion={reducedMotion} />}
        </div>
      </header>

      <div className={styles.body}>
        <div className={styles.main}>
          <E cms="project.description" as="p" label="Description" bind={`${at}.description`} className={styles.lead}>{p.description}</E>
          {p.contribution && (
            <p className={styles.contribution}><span className={styles.label}>Contribution</span><E cms="project.contribution" label="Contribution" bind={`${at}.contribution`}>{p.contribution}</E></p>
          )}
          {p.metrics.length > 0 && (
            <section className={styles.section} aria-label="Key numbers">
              <div className={styles.metrics}>
                {p.metrics.map((m, i) => (
                  <div key={i} className={styles.metric}>
                    <E cms={`project.metric.${i}.value`} label={`Metric ${i + 1}`} bind={`${at}.metrics.${i}.value`} className={styles.metricValue}>{m.value}</E>
                    <E cms={`project.metric.${i}.label`} label={`Metric ${i + 1} label`} bind={`${at}.metrics.${i}.label`} className={styles.metricLabel}>{m.label}</E>
                    {m.note && <span className={styles.metricNote}>{m.note}</span>}
                  </div>
                ))}
              </div>
            </section>
          )}
          {p.verifiedFacts.length > 0 && (
            <section className={styles.section} aria-labelledby="facts-title">
              <h2 id="facts-title" className={styles.sectionTitle}>How it works</h2>
              <ul className={styles.facts}>{p.verifiedFacts.map((f, i) => <E key={i} cms={`project.fact.${i}`} as="li" label={`Fact ${i + 1}`} bind={`${at}.verifiedFacts.${i}`}>{f}</E>)}</ul>
            </section>
          )}
          {p.sections.map((s, i) => <Section key={s.id} section={s} at={`${at}.sections.${i}`} />)}
        </div>

        <aside className={styles.side}>
          {(techs.length > 0 || p.technologies.length > 0) && (
            <section>
              <h2 className={styles.label}>Stack</h2>
              <ul className={styles.chips}>
                {techs.map((id) => <li key={id}>{techById[id]?.name ?? id}</li>)}
                {p.technologies.filter((t) => !techs.some((id) => techById[id]?.name === t)).map((t) => <li key={t}>{t}</li>)}
              </ul>
            </section>
          )}
          <section className={styles.links}>
            {p.repository && !p.privateSource && <a href={p.repository} target="_blank" rel="noopener noreferrer">Source ↗</a>}
            {p.liveUrl && <a href={p.liveUrl} target="_blank" rel="noopener noreferrer">Live site ↗</a>}
            {p.links.map((l) => <a key={l.href} href={l.href} target={l.href.startsWith('http') ? '_blank' : undefined} rel={l.href.startsWith('http') ? 'noopener noreferrer' : undefined}>{l.label} ↗</a>)}
            {p.privateSource && <span className={styles.private}>Source is private</span>}
          </section>
        </aside>
      </div>

      <nav className={styles.pager} aria-label="More projects">
        {prev ? <Link href={`/projects/${prev.slug}`}>← {prev.title}</Link> : <span />}
        <Link href="/projects">All projects</Link>
        {next ? <Link href={`/projects/${next.slug}`}>{next.title} →</Link> : <span />}
      </nav>
    </main>
  )
}
