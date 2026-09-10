'use client'

import { useEffect, useRef, useState } from 'react'
import { useStore } from 'zustand'
import type { WorldStore } from '@/world/state/store'
import type { Game } from '@/world/Game'
import { districtById } from '@/content/world'
import { profile } from '@/content/profile'
import styles from './world.module.css'
import popup from './interaction.module.css'

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
  // Collapsed by default: the time is the news, the board is the detail.
  const [showBoard, setShowBoard] = useState(false)
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

      {/* ---- the contextual popup ---------------------------
           Anchored at the landmark, never a collider, and gone the
           moment you leave its radius. This replaced seven ten-metre
           billboards standing in the middle of the landscape. */}
      {prompt && (
        <div
          className={`${popup.popup} ${prompt.y < 0.26 ? popup.below : ''}`}
          style={{ left: `${prompt.x * 100}%`, top: `${prompt.y * 100}%` }}
        >
          <span className={popup.name}>{prompt.label}</span>
          {prompt.sublabel && <span className={popup.category}>{prompt.sublabel}</span>}
          <span className={popup.act}>
            <span className={popup.key}>
              {inputMode === 'gamepad' ? '✕' : inputMode === 'touch' ? 'TAP' : 'ENTER'}
            </span>
            <span className={popup.verb}>{prompt.action ?? 'Explore'}</span>
          </span>
        </div>
      )}

      {/* ---- the END SCREEN ---------------------------------
           A finished run is not a readout with different words in it.
           The time is what the screen is about, so the time is what is
           set large — the card used to typeset the word FINISH at
           three times the size of the lap it was announcing. */}
      {minigame?.result && (
        <div className={`${styles.minigame} ${popup.result}`}>
          <p className={popup.resultHead}>{minigame.result.headline}</p>
          <p className={popup.resultTime}>{minigame.result.time}</p>
          {minigame.result.newBest && <p className={popup.resultBest}>NEW PERSONAL BEST</p>}

          <button
            type="button"
            className={popup.boardToggle}
            aria-expanded={showBoard}
            onClick={() => setShowBoard((open) => !open)}
          >
            {showBoard ? 'Hide leaderboard' : 'View leaderboard'}
          </button>

          {showBoard && (
            <ol className={popup.board}>
              {minigame.result.board.map((entry, i) => (
                <li key={i} className={entry.you ? popup.boardYou : undefined}>
                  <span className={popup.boardRank}>{String(i + 1).padStart(2, '0')}</span>
                  <span className={popup.boardWho}>{entry.you ? 'YOU' : 'PREVIOUS'}</span>
                  <span className={popup.boardTime}>{entry.time}</span>
                  <span className={popup.boardWhen}>
                    {entry.at ? new Date(entry.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '—'}
                  </span>
                </li>
              ))}
            </ol>
          )}

          <div className={styles.minigameActions}>
            <button type="button" onClick={() => { const g = getGame(); if (!g) return; setShowBoard(false); g.minigames.cancel(); g.minigames.start(minigame.id) }}>Restart</button>
            <button type="button" onClick={() => { setShowBoard(false); getGame()?.minigames.cancel() }}>Exit</button>
          </div>
        </div>
      )}

      {/* ---- mini-game readout ------------------------------ */}
      {minigame && !minigame.result && (
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
              {/* `info` used to fall through to 'NOTE', so every toast that
                  was not an achievement or a district announced itself as a
                  dev note the visitor had not found. */}
              {n.kind === 'achievement' ? 'ACHIEVEMENT'
                : n.kind === 'district' ? 'DISTRICT'
                : n.kind === 'note' ? 'NOTE'
                : ''}
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
