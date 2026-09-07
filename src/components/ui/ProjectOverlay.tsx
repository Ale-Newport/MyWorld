'use client'

import { useEffect, useRef } from 'react'
import { useJourney } from '@/state/journey'
import { projectBySlug } from '@/content/projects'
import { techByProject, techById } from '@/content/skills'
import { ProjectVisual } from '@/components/project-visuals/ProjectVisual'
import styles from './ProjectOverlay.module.css'

/**
 * Deep-linkable case study. Opens over the journey without a
 * route change; writes the slug to the URL hash so a project
 * can be shared directly.
 */
export function ProjectOverlay() {
  const slug = useJourney((s) => s.activeProject)
  const setActiveProject = useJourney((s) => s.setActiveProject)
  const reducedMotion = useJourney((s) => s.reducedMotion)
  const panel = useRef<HTMLDivElement>(null)
  const closeBtn = useRef<HTMLButtonElement>(null)
  const project = slug ? projectBySlug[slug] : undefined

  /* URL hash sync — deep links in and out. */
  useEffect(() => {
    if (slug) {
      const url = `${window.location.pathname}#project/${slug}`
      window.history.replaceState(null, '', url)
    } else if (window.location.hash.startsWith('#project/')) {
      window.history.replaceState(null, '', window.location.pathname)
    }
  }, [slug])

  useEffect(() => {
    const h = window.location.hash
    if (h.startsWith('#project/')) {
      const s = h.slice('#project/'.length)
      if (projectBySlug[s]) setActiveProject(s)
    }
  }, [setActiveProject])

  useEffect(() => {
    if (!slug) return
    const prev = document.activeElement as HTMLElement | null
    closeBtn.current?.focus()
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActiveProject(null)
      if (e.key !== 'Tab') return
      const nodes = panel.current?.querySelectorAll<HTMLElement>('button, a[href], [tabindex]:not([tabindex="-1"])')
      if (!nodes?.length) return
      const list = Array.from(nodes)
      const first = list[0], last = list[list.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
      prev?.focus()
    }
  }, [slug, setActiveProject])

  const techs = project ? (techByProject[project.id] ?? []) : []

  return (
    <div
      className={styles.overlay}
      data-open={Boolean(project)}
      role="dialog"
      aria-modal="true"
      aria-label={project ? `${project.title} case study` : 'Project'}
      aria-hidden={!project}
      inert={!project}
    >
      <div className={styles.scrim} onClick={() => setActiveProject(null)} />
      {project && (
        <article className={styles.panel} ref={panel} style={project.accent ? { ['--project-accent' as string]: project.accent } : undefined}>
          <button
            ref={closeBtn}
            type="button"
            className={styles.close}
            onClick={() => setActiveProject(null)}
            data-cursor="link"
            data-cursor-text="CLOSE"
          >
            <span aria-hidden="true">✕</span>
            <span className="sr-only">Close project</span>
          </button>

          <div className={styles.visual}>
            {project.assets.screenshots.length > 0 ? (
              <ClientShot project={project.slug} title={project.title} />
            ) : (
              <ProjectVisual project={project} reducedMotion={reducedMotion} />
            )}
          </div>

          <div className={styles.body}>
            <header className={styles.header}>
              <p className={styles.eyebrow}>
                <span>{project.importance}</span>
                <span aria-hidden="true">·</span>
                <span>{project.subcategory ?? project.category}</span>
                <span aria-hidden="true">·</span>
                <span>{project.dates ?? project.year}</span>
              </p>
              <h2 className={styles.title}>{project.title}</h2>
              {project.organisation && <p className={styles.org}>{project.organisation}</p>}
              <p className={styles.description}>{project.description}</p>
              {project.contribution && (
                <p className={styles.contribution}>
                  <span className="label">Role</span> {project.contribution}
                </p>
              )}
            </header>

            {project.metrics.length > 0 && (
              <section className={styles.metrics} aria-label="Key numbers">
                {project.metrics.map((m) => (
                  <div key={m.label} className={styles.metric}>
                    <span className={styles.metricValue}>{m.value}</span>
                    <span className={styles.metricLabel}>{m.label}</span>
                    {m.note && <span className={styles.metricNote}>{m.note}</span>}
                  </div>
                ))}
              </section>
            )}

            {project.verifiedFacts.length > 0 && (
              <section className={styles.facts}>
                <h3 className="label">How it works</h3>
                <ul>
                  {project.verifiedFacts.map((f, i) => (
                    <li key={i}>{f}</li>
                  ))}
                </ul>
              </section>
            )}

            {techs.length > 0 && (
              <section className={styles.stack}>
                <h3 className="label">Stack</h3>
                <ul className={styles.chips}>
                  {techs.map((id) => (
                    <li key={id} className={styles.chip}>{techById[id]?.name ?? id}</li>
                  ))}
                  {project.technologies
                    .filter((t) => !techs.some((id) => techById[id]?.name === t))
                    .map((t) => (
                      <li key={t} className={styles.chip}>{t}</li>
                    ))}
                </ul>
              </section>
            )}

            <footer className={styles.links}>
              {project.repository && !project.privateSource && (
                <a href={project.repository} target="_blank" rel="noreferrer noopener" className={styles.cta} data-cursor="link">
                  Source ↗
                </a>
              )}
              {project.liveUrl && (
                <a href={project.liveUrl} target="_blank" rel="noreferrer noopener" className={styles.cta} data-cursor="link">
                  Live site ↗
                </a>
              )}
              {project.privateSource && (
                <span className={styles.privateNote}>Source is private — client work</span>
              )}
            </footer>
          </div>
        </article>
      )}
    </div>
  )
}

/** Real capture for client sites, with an AVIF/WebP source set. */
function ClientShot({ project, title }: { project: string; title: string }) {
  return (
    <picture>
      <source srcSet={`/assets/client-work/${project}-desktop.avif`} type="image/avif" />
      <img
        src={`/assets/client-work/${project}-desktop.webp`}
        alt={`Homepage of ${title}`}
        className={styles.shot}
        loading="lazy"
        decoding="async"
      />
    </picture>
  )
}
