'use client'

import { useEffect, useRef } from 'react'
import { useStore } from 'zustand'
import type { WorldStore } from '@/world/state/store'
import type { Game } from '@/world/Game'
import { districtById } from '@/content/world'
import { profile } from '@/content/profile'
import styles from './world.module.css'

/* ============================================================
   HUD

   Deliberately thin. The speed readout is the only thing here
   that changes every frame, and it is written straight to a DOM
   node from a rAF subscription — React never re-renders while
   driving. Everything else is discrete state: which district you
   are in, what you can press ENTER on, what just unlocked.
   ============================================================ */

interface Props {
  store: WorldStore
  getGame: () => Game | null
}

export function WorldHud({ store, getGame }: Props) {
  const district = useStore(store, (s) => s.district)
  const prompt = useStore(store, (s) => s.prompt)
  const notifications = useStore(store, (s) => s.notifications)
  const onboarding = useStore(store, (s) => s.onboarding)
  const inputMode = useStore(store, (s) => s.inputMode)
  const minigame = useStore(store, (s) => s.minigame)
  const overlay = useStore(store, (s) => s.overlay)

  const speedRef = useRef<HTMLSpanElement>(null)

  /* Speed is frame-rate state: written to the DOM, never to React. */
  useEffect(() => {
    let raf = 0
    let last = -1
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const game = getGame()
      if (!game?.vehicle) return
      const value = Math.round(game.sampleTelemetry().speed)
      if (value !== last) {
        last = value
        if (speedRef.current) speedRef.current.textContent = String(value).padStart(3, '0')
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [getGame])

  const current = district ? districtById[district] : null

  return (
    <div className={styles.hud} data-dimmed={overlay ? 'true' : 'false'}>
      {/* ---- top left: identity + exit ---------------------- */}
      <div className={styles.hudTopLeft}>
        <button
          type="button"
          className={styles.hudBrand}
          onClick={() => store.getState().setOverlay('pause')}
        >
          <span className={styles.hudMark}>{profile.initials}</span>
          <span className={styles.hudBrandName}>{profile.name}</span>
          <span className={styles.hudEsc}>ESC</span>
        </button>
      </div>

      {/* ---- top right: district ---------------------------- */}
      <div className={styles.hudTopRight}>
        {current && (
          <div className={styles.hudDistrict} key={current.id}>
            <span className={styles.hudDistrictLabel}>{current.label}</span>
            <span className={styles.hudDistrictBlurb}>{current.blurb}</span>
          </div>
        )}
      </div>

      {/* ---- bottom left: speed ----------------------------- */}
      <div className={styles.hudBottomLeft}>
        <div className={styles.hudSpeed}>
          <span ref={speedRef} className={styles.hudSpeedValue}>
            000
          </span>
          <span className={styles.hudSpeedUnit}>KM/H</span>
        </div>
      </div>

      {/* ---- bottom right: key hints ------------------------ */}
      <div className={styles.hudBottomRight}>
        <ul className={styles.hudKeys}>
          {inputMode === 'touch' ? (
            <>
              <li><b>DRAG</b> drive</li>
              <li><b>TAP</b> jump</li>
            </>
          ) : (
            <>
              <li><b>M</b> map</li>
              <li><b>R</b> respawn</li>
              <li><b>H</b> horn</li>
              <li><b>K</b> achievements</li>
            </>
          )}
        </ul>
      </div>

      {/* ---- centre: interact prompt ------------------------ */}
      {prompt && (
        <div
          className={styles.prompt}
          style={{ left: `${prompt.x * 100}%`, top: `${prompt.y * 100}%` }}
        >
          <span className={styles.promptKey}>
            {inputMode === 'gamepad' ? '✕' : inputMode === 'touch' ? 'TAP' : 'ENTER'}
          </span>
          <span className={styles.promptLabel}>{prompt.label}</span>
          {prompt.sublabel && <span className={styles.promptSub}>{prompt.sublabel}</span>}
        </div>
      )}

      {/* ---- mini-game readout ------------------------------ */}
      {minigame && (
        <div className={styles.minigame}>
          <p className={styles.minigameTitle}>{minigame.title}</p>
          {minigame.lines.map((line, i) => (
            <p key={i} className={styles.minigameLine}>{line}</p>
          ))}
          {minigame.progress !== null && (
            <div className={styles.minigameBar}>
              <span style={{ transform: `scaleX(${minigame.progress})` }} />
            </div>
          )}
          <div className={styles.minigameActions}>
            <button type="button" onClick={() => { const g = getGame(); if (!g) return; g.minigames.cancel(); g.minigames.start(minigame.id) }}>Restart</button>
            <button type="button" onClick={() => getGame()?.minigames.cancel()}>Exit game</button>
          </div>
        </div>
      )}

      {/* ---- notifications ---------------------------------- */}
      <div className={styles.notifications} role="status" aria-live="polite">
        {notifications.map((n) => (
          <div key={n.id} className={styles.notification} data-kind={n.kind}>
            <span className={styles.notificationKind}>
              {n.kind === 'achievement' ? 'ACHIEVEMENT' : n.kind === 'district' ? 'DISTRICT' : 'NOTE'}
            </span>
            <span className={styles.notificationTitle}>{n.title}</span>
            {n.body && <span className={styles.notificationBody}>{n.body}</span>}
          </div>
        ))}
      </div>

      {/* ---- first-run tutorial ----------------------------- */}
      {onboarding && (
        <div className={styles.onboarding}>
          <p>Start driving.</p>
        </div>
      )}
    </div>
  )
}
