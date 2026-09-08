'use client'

import { useCallback, useEffect, useState } from 'react'
import type { WorldStore } from '@/world/state/store'
import type { Game } from '@/world/Game'
import styles from './world.module.css'

/* ============================================================
   CONTROLS

   Lists every action and what it is bound to, and lets a
   keyboard binding be changed. The engine already treats
   bindings as data — an action collects opaque device keys and
   exposes one boolean — so rebinding is a list edit rather than
   a code path, and overrides persist in the save file.

   Only keyboard keys are rebindable. Gamepad and touch bindings
   stay fixed: a controller's face buttons have a conventional
   meaning that a portfolio should not surprise anyone about, and
   the touch buttons are drawn from the same list they bind.

   The capture state deliberately swallows the next keypress
   rather than using a dialog. Anything else means Escape cannot
   be rebound, and Escape is the one key someone with a
   non-standard keyboard is most likely to need to move.
   ============================================================ */

interface Props {
  store: WorldStore
  getGame: () => Game | null
}

/** "Keyboard.ArrowUp" → "↑". Device prefixes are noise in a list. */
function pretty(key: string): string {
  if (key.startsWith('Gamepad.')) return `pad ${key.slice(8)}`
  if (key.startsWith('Touch.')) return 'touch'
  if (key.startsWith('Wheel.')) return 'wheel'
  if (key.startsWith('Pointer.')) return 'drag'

  const code = key.replace('Keyboard.', '')
  const named: Record<string, string> = {
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    Space: 'Space', Enter: 'Enter', Escape: 'Esc', Slash: '/',
    ShiftLeft: 'L Shift', ShiftRight: 'R Shift', ControlLeft: 'L Ctrl',
  }
  if (named[code]) return named[code]
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`
  return code
}

const isKeyboard = (key: string) => key.startsWith('Keyboard.')

export function WorldControls({ getGame }: Props) {
  const [capturing, setCapturing] = useState<string | null>(null)
  const [, force] = useState(0)
  const redraw = useCallback(() => force((n) => n + 1), [])

  useEffect(() => {
    if (!capturing) return
    const game = getGame()
    if (!game) return

    // Swallow the key rather than letting it reach the world.
    game.inputs.keyboard.capture = false

    const onKey = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()

      if (event.code === 'Escape' && capturing !== 'pause') {
        setCapturing(null)
        return
      }

      const action = game.inputs.actions.get(capturing)
      if (action) {
        // Replace only the keyboard bindings; the pad and the touch
        // buttons keep whatever they had.
        const kept = action.keys.filter((k) => !isKeyboard(k))
        game.inputs.rebind(capturing, [`Keyboard.${event.code}`, ...kept])
        game.save.data.settings.bindings = game.inputs.bindingOverrides
        game.save.schedule()
      }
      setCapturing(null)
      redraw()
    }

    window.addEventListener('keydown', onKey, { capture: true })
    return () => {
      window.removeEventListener('keydown', onKey, { capture: true })
      game.inputs.keyboard.capture = true
    }
  }, [capturing, getGame, redraw])

  const game = getGame()
  if (!game) return null

  const actions = Array.from(game.inputs.actions.values()).filter((a) => a.label)

  const reset = () => {
    game.save.data.settings.bindings = {}
    game.save.flush()
    // Bindings are applied at construction, so a reset needs a
    // reload to take effect. Saying so is better than a UI that
    // appears to do nothing.
    window.location.reload()
  }

  return (
    <div className={styles.controls}>
      <p className="label">Controls</p>
      <h2 className={styles.overlayTitle}>Key bindings</h2>

      <p className={styles.optionNote}>
        Click a key to rebind it. Escape cancels. Gamepad and touch bindings are fixed.
      </p>

      <ul className={styles.bindingList}>
        {actions.map((action) => {
          const keyboard = action.keys.filter(isKeyboard)
          const other = action.keys.filter((k) => !isKeyboard(k))
          return (
            <li key={action.name}>
              <span className={styles.bindingName}>{action.label}</span>
              <span className={styles.bindingKeys}>
                {action.fixed ? (
                  <span className={styles.bindingFixed}>
                    {action.keys.map(pretty).join(' · ')}
                  </span>
                ) : (
                  <>
                    <button
                      type="button"
                      className={styles.bindingKey}
                      data-capturing={capturing === action.name}
                      onClick={() => setCapturing(action.name)}
                    >
                      {capturing === action.name
                        ? 'PRESS A KEY'
                        : keyboard.map(pretty).join(' / ') || 'UNBOUND'}
                    </button>
                    {other.length > 0 && (
                      <span className={styles.bindingFixed}>{other.map(pretty).join(' · ')}</span>
                    )}
                  </>
                )}
              </span>
            </li>
          )
        })}
      </ul>

      <button type="button" className={styles.bindingReset} onClick={reset}>
        Reset to defaults
      </button>
    </div>
  )
}
