'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useStore } from 'zustand'
import type { WorldStore } from '@/world/state/store'
import type { Game } from '@/world/Game'
import { PROJECT_GROUPS, landmarkById, resolvePanel } from '@/content/world'
import { projectBySlug } from '@/content/projects'
import { WorldMap } from './WorldMap'
import { WorldControls } from './WorldControls'
import { achievementGroups } from '@/content/achievements'
import styles from './world.module.css'

/* ============================================================
   OVERLAYS

   Pause, project panels, achievements and options. All of them
   are modal, all of them release the driving controls while open
   (`inputs.setFilters(['ui'])`), and all of them close on ESCAPE.

   The project panel is the reason the world exists: it renders
   the SAME data the scroll journey's case studies render, pulled
   through `resolvePanel()` in `src/content/world.ts`. Nothing is
   retyped here.
   ============================================================ */

interface Props {
  store: WorldStore
  getGame: () => Game | null
}

export function WorldOverlays({ store, getGame }: Props) {
  const overlay = useStore(store, (s) => s.overlay)
  const panelId = useStore(store, (s) => s.panelId)

  /* While any overlay is open the car must not be driveable. */
  useEffect(() => {
    const game = getGame()
    if (!game) return
    if (overlay) {
      game.inputs.setFilters(['ui'])
      game.inputs.releaseAll()
    } else {
      game.inputs.setFilters([])
    }
  }, [overlay, getGame])

  /* Escape is owned by the engine's input layer (`pause` action), so
     it keeps working with a gamepad and cannot fight this component
     for the same key. Nothing to bind here. */

  if (!overlay) return null

  const close = () => store.getState().setOverlay(null)

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true">
      <button type="button" className={styles.overlayScrim} onClick={close} aria-label="Close" />
      <div className={styles.overlayPanel}>
        <button type="button" className={styles.overlayClose} onClick={close}>
          <span aria-hidden="true">✕</span>
          <span className="sr-only">Close</span>
        </button>

        {overlay === 'pause' && <PauseMenu store={store} getGame={getGame} />}
        {overlay === 'panel' && panelId && <ProjectPanel id={panelId} />}
        {overlay === 'projects' && <ProjectArchive store={store} />}
        {overlay === 'achievements' && <AchievementList getGame={getGame} />}
        {overlay === 'options' && <Options store={store} getGame={getGame} />}
        {overlay === 'map' && <WorldMap store={store} getGame={getGame} />}
        {overlay === 'controls' && <WorldControls store={store} getGame={getGame} />}
      </div>
    </div>
  )
}

/* ---------------------------------------------------------- */

function PauseMenu({ store, getGame }: Props) {
  const items: { label: string; action: () => void }[] = [
    { label: 'Resume', action: () => store.getState().setOverlay(null) },
    { label: 'Map', action: () => store.getState().setOverlay('map') },
    { label: 'Achievements', action: () => store.getState().setOverlay('achievements') },
    { label: 'Options', action: () => store.getState().setOverlay('options') },
    { label: 'Controls', action: () => store.getState().setOverlay('controls') },
    {
      label: 'Respawn',
      action: () => {
        getGame()?.player.respawn()
        store.getState().setOverlay(null)
      },
    },
  ]

  return (
    <div className={styles.pause}>
      <p className="label">Paused</p>
      <h2 className={styles.overlayTitle}>The World</h2>
      <nav className={styles.pauseList}>
        {items.map((item) => (
          <button key={item.label} type="button" onClick={item.action} className={styles.pauseItem}>
            {item.label}
          </button>
        ))}
        <Link href="/" className={styles.pauseItem} data-exit="true">
          Back to portfolio →
        </Link>
      </nav>
    </div>
  )
}

/* ---------------------------------------------------------- */

function ProjectPanel({ id }: { id: string }) {
  const landmark = landmarkById[id]
  const panel = landmark ? resolvePanel(landmark) : null
  if (!panel) return null

  return (
    <article className={styles.panel}>
      {panel.eyebrow && <p className={styles.panelEyebrow}>{panel.eyebrow}</p>}
      <h2 className={styles.overlayTitle}>{panel.title}</h2>

      {panel.lines.length > 0 && (
        <div className={styles.panelBody}>
          {panel.lines.filter(Boolean).map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
      )}

      {panel.metrics.length > 0 && (
        <ul className={styles.panelMetrics}>
          {panel.metrics.map((metric) => (
            <li key={metric.label}>
              <span className={styles.panelMetricValue}>{metric.value}</span>
              <span className={styles.panelMetricLabel}>{metric.label}</span>
            </li>
          ))}
        </ul>
      )}

      {panel.technologies.length > 0 && (
        <ul className={styles.panelChips}>
          {panel.technologies.map((tech) => (
            <li key={tech}>{tech}</li>
          ))}
        </ul>
      )}

      <footer className={styles.panelLinks}>
        {panel.links.map((link) => (
          <a
            key={link.href}
            href={link.href}
            className={styles.panelLink}
            target={link.href.startsWith('http') ? '_blank' : undefined}
            rel={link.href.startsWith('http') ? 'noreferrer noopener' : undefined}
          >
            {link.label} ↗
          </a>
        ))}
        {panel.projectSlug && (
          <Link href={`/#project/${panel.projectSlug}`} className={styles.panelLink}>
            Full case study →
          </Link>
        )}
      </footer>
    </article>
  )
}

/* ============================================================
   THE PROJECTS ARCHIVE

   The island used to give nine projects a district each and put
   the rest on islands in an archive ring. The drawing has one
   PROJECTS, so this is where the other forty-two live: a group
   list on the left, a project on the right, and the same
   `resolvePanel()` copy the scroll journey renders.

   NO CONTENT WAS LOST when the districts went. This is where to
   check that: every slug in `projects/*` appears in one of
   `PROJECT_GROUPS`, and the counts are printed.
   ============================================================ */

function ProjectArchive({ store }: { store: WorldStore }) {
  const [group, setGroup] = useState(PROJECT_GROUPS[0]?.id ?? 'featured')
  const active = PROJECT_GROUPS.find((g) => g.id === group) ?? PROJECT_GROUPS[0]
  const total = new Set(PROJECT_GROUPS.flatMap((g) => g.slugs)).size

  return (
    <section className={styles.archive}>
      <header className={styles.archiveHead}>
        <p className={styles.panelEyebrow}>PROJECTS</p>
        <h2 className={styles.overlayTitle}>The archive</h2>
        <p className={styles.archiveCount}>{total} projects · {PROJECT_GROUPS.length} collections</p>
      </header>

      <nav className={styles.archiveTabs} aria-label="Project collections">
        {PROJECT_GROUPS.map((g) => (
          <button
            key={g.id}
            type="button"
            data-active={g.id === active?.id}
            onClick={() => setGroup(g.id)}
          >
            {g.label} <span>{g.slugs.length}</span>
          </button>
        ))}
      </nav>

      <ul className={styles.archiveList}>
        {(active?.slugs ?? []).map((slug) => {
          const project = projectBySlug[slug]
          if (!project) return null
          return (
            <li key={slug}>
              <Link
                href={`/#project/${slug}`}
                className={styles.archiveItem}
                onClick={() => store.getState().setOverlay(null)}
              >
                <span className={styles.archiveYear}>{project.year}</span>
                <span className={styles.archiveTitle}>{project.shortTitle ?? project.title}</span>
                <span className={styles.archiveBlurb}>{project.shortDescription}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/* ---------------------------------------------------------- */

function AchievementList({ getGame }: { getGame: () => Game | null }) {
  const game = getGame()
  const list = game?.achievements.list() ?? []

  return (
    <div className={styles.achievements}>
      <p className="label">
        {game?.achievements.unlockedCount ?? 0} / {game?.achievements.totalCount ?? 0}
      </p>
      <h2 className={styles.overlayTitle}>Achievements</h2>

      {achievementGroups.map((group) => {
        const items = list.filter((a) => a.definition.group === group.id)
        if (items.length === 0) return null
        return (
          <section key={group.id} className={styles.achievementGroup}>
            <h3 className="label">{group.label}</h3>
            <ul>
              {items.map((item) => (
                <li key={item.id} data-unlocked={item.unlocked}>
                  <span className={styles.achievementLabel}>{item.definition.label}</span>
                  <span className={styles.achievementHint}>{item.definition.hint}</span>
                  {item.definition.target > 1 && (
                    <span className={styles.achievementProgress}>
                      {Math.min(item.progress, item.definition.target)} / {item.definition.target}
                      {item.definition.unit ?? ''}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

/* ---------------------------------------------------------- */

function Options({ store, getGame }: Props) {
  const quality = useStore(store, (s) => s.qualityPreference)
  const reducedMotion = useStore(store, (s) => s.reducedMotion)
  const resolved = useStore(store, (s) => s.quality)
  const muted = useStore(store, (s) => s.muted)
  const volume = useStore(store, (s) => s.volume)

  return (
    <div className={styles.options}>
      <p className="label">Options</p>
      <h2 className={styles.overlayTitle}>Settings</h2>

      <fieldset className={styles.optionRow}>
        <legend className="label">Quality</legend>
        <div className={styles.optionButtons}>
          {(['auto', 'low', 'medium', 'high'] as const).map((level) => (
            <button
              key={level}
              type="button"
              data-on={quality === level}
              onClick={() => getGame()?.setQualityPreference(level)}
            >
              {level.toUpperCase()}
            </button>
          ))}
        </div>
        <p className={styles.optionNote}>
          Currently running at {resolved.toUpperCase()}. Collisions and the world layout are
          identical at every setting — only the visuals change.
        </p>
      </fieldset>

      <fieldset className={styles.optionRow}>
        <legend className="label">Audio</legend>
        <div className={styles.optionButtons}>
          <button type="button" data-on={!muted} onClick={() => getGame()?.setMuted(false)}>
            ON
          </button>
          <button type="button" data-on={muted} onClick={() => getGame()?.setMuted(true)}>
            MUTED
          </button>
        </div>
        <label className={styles.optionSlider}>
          <span className="label">Volume</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            onChange={(event) => getGame()?.setVolume(Number(event.target.value))}
            aria-label="Volume"
          />
          <span className={styles.optionValue}>{Math.round(volume * 100)}%</span>
        </label>
        <p className={styles.optionNote}>
          Every sound in the world is synthesised in the browser — there are no audio files.
          L mutes without opening this menu.
        </p>
      </fieldset>

      <fieldset className={styles.optionRow}>
        <legend className="label">World</legend>
        <div className={styles.optionButtons}>
          <button
            type="button"
            onClick={() => {
              getGame()?.resetObjects()
              store.getState().setOverlay(null)
            }}
          >
            RESET OBJECTS
          </button>
          <button
            type="button"
            onClick={() => {
              getGame()?.player.respawn()
              store.getState().setOverlay(null)
            }}
          >
            RESPAWN
          </button>
        </div>
        <p className={styles.optionNote}>
          Puts every cone, crate and barrier back where it started. Progress and achievements are
          untouched.
        </p>
      </fieldset>

      <fieldset className={styles.optionRow}>
        <legend className="label">Motion</legend>
        <div className={styles.optionButtons}>
          <button type="button" data-on={!reducedMotion} onClick={() => getGame()?.setReducedMotion(false)}>
            FULL
          </button>
          <button type="button" data-on={reducedMotion} onClick={() => getGame()?.setReducedMotion(true)}>
            REDUCED
          </button>
        </div>
        <p className={styles.optionNote}>
          Reduced motion removes camera shake, speed lines and the speed-reactive zoom. Nothing
          becomes unreachable.
        </p>
      </fieldset>
    </div>
  )
}
