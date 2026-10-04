'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import type { World2Game } from './World2Game'
import { EMPTY_GAMEPLAY, type Classification, type World2Status } from './types'
import styles from './world2.module.css'

const initial: World2Status = { ready: false, progress: 0, loading: 'Loading the Blender level', fatal: null, entered: false, paused: false, map: false, help: false, muted: true, touch: false, speed: 0, area: 'landing', interaction: null, topDown: false, colliders: false, fps: 60, drawCalls: 0, position: [0, 0, 0], heading: 0, achievementsOpen: false, gameplay: EMPTY_GAMEPLAY }
const label = (name: string) => name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, s => s.toUpperCase())
const areaText: Record<string, string> = {
  landing: 'The starting point. Head out along the paths and explore the island.',
  projects: 'A workshop for things made with code. Explore Alejandro’s projects in the portfolio.',
  career: 'Follow the path through the career area, or read the full story in the portfolio.',
  social: 'A little gathering place on the island. Find Alejandro’s contact links in the portfolio.',
  circuit: 'Follow the elevated track, negotiate its obstacles, and take the jump. Timed races are not enabled in this version.',
  bowling: 'The bowling alley and its props are here to explore. Scoring is not enabled in this version.',
}

interface Props {
  /** Came through the homepage's garden: no gate, no loader — see World2Route. */
  arriving?: boolean
  /** Driving (or failed): the cover may part. */
  onEntered?: () => void
}

export default function World2Experience({ arriving = false, onEntered }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const dialog = useRef<HTMLElement>(null)
  const game = useRef<World2Game | null>(null)
  const [status, setStatus] = useState(initial)
  const held = useRef(new Set<string>())

  /*
    Focus the dialog itself, not a control inside it. The close button used to
    carry `autoFocus`, which meant the very Enter press that opened a panel
    landed on that button as soon as React rendered it — the map, the controls
    and the achievements list all opened and shut again in one keystroke.
  */
  useEffect(() => {
    if (status.paused) dialog.current?.focus()
  }, [status.paused, status.map, status.help, status.achievementsOpen])

  useEffect(() => {
    if (!status.paused) return
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const targets = host.current?.querySelectorAll<HTMLElement>('[role=dialog] button, [role=dialog] a[href]')
      if (!targets?.length) return
      const first = targets[0], last = targets[targets.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    window.addEventListener('keydown', trap)
    return () => window.removeEventListener('keydown', trap)
  }, [status.paused])

  useEffect(() => {
    const element = host.current
    if (!element) return
    let disposed = false
    let instance: World2Game | null = null
    const canvas = document.createElement('canvas')
    canvas.className = styles.canvas; canvas.tabIndex = 0
    canvas.setAttribute('aria-label', 'Drive the Blender island. WASD or arrows to move. Press question mark for all controls.')
    element.prepend(canvas)
    void import('./World2Game').then(async ({ World2Game }) => {
      if (disposed) return
      instance = new World2Game(canvas, element, next => { if (!disposed) setStatus(next) })
      game.current = instance
      await instance.init()
    }).catch(error => {
      if (disposed) return
      console.error('[world2]', error)
      instance?.destroy()
      setStatus(current => ({ ...current, fatal: error instanceof Error ? error.message : 'World2 could not start.' }))
    })
    const release = () => { for (const action of held.current) instance?.inputs.releaseTouchAction(action); held.current.clear() }
    window.addEventListener('blur', release)
    window.addEventListener('pointercancel', release)
    return () => {
      disposed = true; release(); window.removeEventListener('blur', release); window.removeEventListener('pointercancel', release)
      instance?.destroy(); if (game.current === instance) game.current = null; canvas.remove()
    }
  }, [])

  /*
    THE HOMEPAGE'S CONTRACT. A visitor who pushed through the garden at
    the foot of the portfolio has already made the gesture this gate
    asks for, so they are entered the moment the level is ready — under
    the leaves, which part once they are driving (see World2Route).
  */
  useEffect(() => {
    if (!arriving || !status.ready || status.entered || status.fatal) return
    game.current?.enter()
  }, [arriving, status.ready, status.entered, status.fatal])

  useEffect(() => {
    if (status.entered || status.fatal) onEntered?.()
  }, [status.entered, status.fatal, onEntered])

  const release = (action: string) => { held.current.delete(action); game.current?.inputs.releaseTouchAction(action) }
  const overlay = status.paused || !status.entered || status.fatal
  return <div className={styles.experience} ref={host} data-world2-ready={status.ready} data-world2-entered={status.entered}>
    <header className={styles.header}>
      <Link href="/" className={styles.brand} aria-label="Back to portfolio">AN<span>WORLD 02</span></Link>
      <div className={styles.toolbar}>
        <Link href="/world">World 01 ↗</Link>
        {status.entered && <>
          <button onClick={() => game.current?.toggleMap()} aria-pressed={status.map}>Map <kbd>M</kbd></button>
          <button onClick={() => game.current?.toggleHelp()}>Controls <kbd>?</kbd></button>
          <button onClick={() => game.current?.toggleMute()} aria-label={status.muted ? 'Enable sound' : 'Mute sound'}>{status.muted ? 'Sound off' : 'Sound on'}</button>
        </>}
      </div>
    </header>

    {!status.entered && !(arriving && !status.fatal) && <div className={styles.loading}>
      <div className={styles.intro}>
        <p className={styles.eyebrow}>A SECOND WORLD TO EXPLORE</p>
        <h1>Take the<br /><em>scenic route.</em></h1>
        <p>Same little car. A whole new island.<br />Follow the paths, find a corner, take a jump.</p>
        {status.fatal ? <div role="alert"><p>{status.fatal}</p><Link href="/">Return to the portfolio →</Link></div> : <>
          <div className={styles.progress} role="progressbar" aria-label={status.loading} aria-valuenow={Math.round(status.progress)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${status.progress}%` }} /></div>
          <p className={styles.loadLabel} role="status">{status.loading}<span>{Math.round(status.progress)}%</span></p>
          <button className={styles.enter} disabled={!status.ready} onClick={() => game.current?.enter()}>{status.ready ? 'Start driving' : 'Preparing your drive'} <span>↗</span></button>
        </>}
        <div className={styles.quickControls}><span><kbd>W A S D</kbd> Drive</span><span><kbd>SHIFT</kbd> Boost</span><span><kbd>SPACE</kbd> Jump</span></div>
        <p className={styles.credit}>Level by Bruno Simon · folio-2025 · MIT</p>
      </div>
    </div>}

    {status.entered && !overlay && <>
      <div className={styles.location}><span>EXPLORING</span><strong>{label(status.area)}</strong></div>
      <div className={styles.speed}><strong>{Math.round(status.speed).toString().padStart(2, '0')}</strong><span>KM/H</span></div>
      <Gameplay status={status} game={game} />
      <div className={styles.bottom}>
        <span>{status.touch ? 'Drag the ground to steer · Tap to jump' : 'WASD to drive · Shift to boost · Space to jump'}</span>
        <button onClick={() => game.current?.player.respawn()}>Reset <kbd>R</kbd></button>
      </div>
      {status.touch && <div className={styles.touch} aria-label="Touch driving controls">{[...(status.gameplay.prompt ? ['interact'] : []), 'boost', 'brake', 'jump', 'horn'].map(action => <button key={action}
        onPointerDown={event => { event.preventDefault(); if (action === 'interact') { game.current?.interact(); return } event.currentTarget.setPointerCapture(event.pointerId); held.current.add(action); game.current?.inputs.pressTouchAction(action) }}
        onPointerUp={() => release(action)} onPointerCancel={() => release(action)} onLostPointerCapture={() => release(action)}>{action === 'interact' ? status.gameplay.prompt : label(action)}</button>)}</div>}
    </>}

    {status.entered && status.fatal && <div className={styles.modalBackdrop}><section className={styles.modal} role="alert"><h2>Drive interrupted</h2><p>{status.fatal}</p><Link href="/">Back to portfolio</Link></section></div>}
    {status.entered && status.paused && !status.fatal && <div className={styles.modalBackdrop}>
      <section ref={dialog} tabIndex={-1} className={`${styles.modal} ${status.map ? styles.mapModal : ''}`} role="dialog" aria-modal="true" aria-label={status.map ? 'Island map' : status.achievementsOpen ? 'Achievements' : status.help ? 'Driving controls' : 'Drive paused'}>
        <button className={styles.close} onClick={() => { game.current?.setPaused(false); host.current?.querySelector('canvas')?.focus() }}>Close <kbd>ESC</kbd></button>
        {status.achievementsOpen ? <Awards status={status} /> : status.map ? <World2Map status={status} game={game} /> : status.help ? <>
          <p className={styles.eyebrow}>BEHIND THE WHEEL</p><h2>Make yourself at home.</h2>
          <dl className={styles.controls}>{[
            ['WASD / arrows', 'Accelerate, reverse and steer'], ['Enter / E', 'Interact with whatever is in range'], ['K', 'Achievements'], ['Shift', 'Boost'], ['B / left Ctrl', 'Brake'], ['Space', 'Jump with the suspension'], ['1–4 / numpad', 'Individual wheel hydraulics'], ['R', 'Return to the nearest authored respawn'], ['H', 'Honk'], ['Drag / right drag', 'Orbit / pan the camera'], ['Wheel / pinch', 'Zoom'], ['C', 'Reset camera'], ['M / L / Esc', 'Map / sound / pause'], ['Gamepad', 'Left stick steer · triggers drive · face buttons boost, brake and jump'], ['Touch', 'Drag the ground to drive · tap to jump · two fingers orbit and pinch'],
          ].map(([key, meaning]) => <div key={key}><dt>{key}</dt><dd>{meaning}</dd></div>)}</dl>
        </> : status.interaction ? <>
          <p className={styles.eyebrow}>A PLACE ON THE ISLAND</p><h2>{label(status.interaction)}</h2>
          <p>{areaText[status.interaction] ?? 'An authored corner of the island. Explore the scenery, then follow the next path.'}</p>
          {['projects', 'career', 'social'].includes(status.interaction) && <Link className={styles.link} href={status.interaction === 'projects' ? '/projects' : '/'}>Explore the portfolio ↗</Link>}
          <button className={styles.enter} onClick={() => game.current?.setPaused(false)}>Keep driving →</button>
        </> : <><p className={styles.eyebrow}>TAKE A BREATHER</p><h2>Parked for a moment.</h2><button className={styles.enter} onClick={() => game.current?.setPaused(false)}>Keep driving →</button><Link className={styles.link} href="/">Back to the portfolio</Link></>}
      </section>
    </div>}

    {process.env.NODE_ENV === 'development' && status.ready && status.entered && <details className={styles.debug}>
      <summary>Level validation · {Math.round(status.fps)} fps</summary>
      <div><button onClick={() => game.current?.toggleTopDown()} aria-pressed={status.topDown}>Top-down</button><button onClick={() => game.current?.toggleColliders()} aria-pressed={status.colliders}>Colliders</button></div>
      <label><input type="checkbox" onChange={e => game.current?.environment.setClassificationColors(e.target.checked)} /> Classification colours</label>
      {(['terrain', 'roads', 'water', 'vegetation', 'scenery'] as Classification[]).map(category => <label key={category}><input type="checkbox" defaultChecked onChange={e => game.current?.environment.setVisible(category, e.target.checked)} /> {category}</label>)}
      <small>{status.drawCalls} draws · {status.position.map(n => n.toFixed(1)).join(', ')}</small>
    </details>}
  </div>
}

/**
 * The gameplay HUD. Deliberately thin: the mini-games say what they have to
 * say on their own authored screens, and this only carries what a driver
 * genuinely cannot read off a board — the clock, the countdown, the award
 * that just landed.
 */
function Gameplay({ status, game }: { status: World2Status; game: React.RefObject<World2Game | null> }) {
  const { activity, headline, timer, lines, notice } = status.gameplay
  return <>
    {notice && <div className={styles.notice} role="status">
      <span>ACHIEVEMENT</span><strong>{notice.title}</strong><em>{notice.body}</em>
    </div>}
    {(headline || timer) && <div className={styles.headline} role="status" aria-live="polite">
      {headline && <strong>{headline}</strong>}
      {timer && <code>{timer}</code>}
      {lines.length > 0 && <span>{lines.join(' · ')}</span>}
    </div>}
    {activity && <div className={styles.activity}>
      <button onClick={() => game.current?.interactions.circuit.restart()}>Restart <kbd>R</kbd></button>
      <button onClick={() => game.current?.interactions.exitActivity()}>Exit <kbd>ESC</kbd></button>
    </div>}
  </>
}

/** The award list. The pillar in the achievements area shows the same state. */
function Awards({ status }: { status: World2Status }) {
  const { achievements, achievementsUnlocked, achievementsTotal } = status.gameplay
  return <>
    <p className={styles.eyebrow}>WHAT YOU HAVE FOUND</p>
    <h2>{achievementsUnlocked} of {achievementsTotal}.</h2>
    <ul className={styles.awards}>
      {achievements.map(award => <li key={award.id} data-unlocked={award.unlocked}>
        <strong>{award.title}</strong>
        <span>{award.description}</span>
        <em>{award.unlocked ? 'Done' : `${Math.min(award.progress, award.target)} / ${award.target}`}</em>
      </li>)}
    </ul>
  </>
}

function World2Map({ status, game }: { status: World2Status; game: React.RefObject<World2Game | null> }) {
  // The map uses the exported source terrain bounds, supplied after loading.
  const [bounds, setBounds] = useState<{ min: number[]; max: number[] } | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    void fetch('/world2/world-manifest.json', { signal: controller.signal }).then(r => r.json()).then(m => setBounds(m.bounds)).catch(() => {})
    return () => controller.abort()
  }, [])
  const place = (px: number, pz: number) => bounds
    ? { left: `${(px - bounds.min[0]) / (bounds.max[0] - bounds.min[0]) * 100}%`, top: `${(pz - bounds.min[2]) / (bounds.max[2] - bounds.min[2]) * 100}%` }
    : { left: '50%', top: '50%' }
  // The pins are the authored area anchors, not a second list of coordinates.
  const areas = game.current?.environment.areas ?? []
  const player = place(status.position[0], status.position[2])
  return <><p className={styles.eyebrow}>FIND YOUR WAY</p><h2>The island, at a glance.</h2><div className={styles.map}>
    <img src="/world2/map.png" alt="Top-down map generated from the Blender island, showing roads, scenery and vegetation." />
    {areas.map(area => <button
      key={area.name}
      type="button"
      className={styles.mapPin}
      style={place(area.position.x, area.position.z)}
      data-here={area.name === status.area}
      onClick={() => game.current?.travelTo(area.name)}
      title={`Drive to ${label(area.name)}`}
    ><i /><b>{label(area.name)}</b></button>)}
    <span className={styles.mapPlayer} style={{ ...player, transform: `translate(-50%, -50%) rotate(${status.heading}rad)` }} aria-label="Your position">➤</span>
  </div><p className={styles.mapCaption}>You are in {label(status.area)} · Your car is the orange arrow · Pick a place to drive straight to it</p></>
}
