import { Events } from '../core/Events'
import { Keyboard } from './Keyboard'
import { Pointer } from './Pointer'
import { Wheel } from './Wheel'
import { GamepadInput } from './Gamepad'

/* ============================================================
   PORTED FROM: sources/Game/Inputs/Inputs.js
   folio-2025 — Copyright (c) 2025 Bruno Simon — MIT
   See THIRD_PARTY_NOTICES.md.

   An action-map, not a key handler. Devices emit opaque keys
   ("Keyboard.KeyW", "Gamepad.r2"); actions collect the keys that
   mean the same thing and expose one boolean plus an analogue
   value. That is why a trigger and a key can drive the same
   throttle, and why remapping is a data change rather than a
   code change.

   `filters` gate whole groups of actions by context: with the
   filter set to `menu`, driving actions stop firing without any
   caller having to check whether a menu is open.

   Changes: TypeScript; bindings are separated from action
   definitions so they can be overridden and persisted (the brief
   asks for remappable controls); `mode` is exposed as a string
   union and DOM class side-effects are left to the UI layer.
   ============================================================ */

export type InputMode = 'keyboard' | 'gamepad' | 'touch'

export type ActionCategory = 'driving' | 'camera' | 'ui' | 'racing' | 'minigame'

export interface ActionDefinition {
  name: string
  categories: ActionCategory[]
  keys: string[]
  /** Fires on every start, even while already active (wheel, taps). */
  repeatable?: boolean
  /** Human label for the controls overlay. */
  label?: string
  /** Excluded from the remapping UI. */
  fixed?: boolean
}

export interface Action extends ActionDefinition {
  active: boolean
  /** 0..1 analogue value, or the payload of a `change`. */
  value: number
  trigger: 'start' | 'end' | 'change' | null
  activeKeys: Set<string>
}

export class Inputs {
  readonly events = new Events<string>()
  readonly actions = new Map<string, Action>()
  readonly filters = new Set<ActionCategory>()

  readonly keyboard: Keyboard
  readonly pointer: Pointer
  readonly wheel: Wheel
  readonly gamepad: GamepadInput

  mode: InputMode = 'keyboard'

  /** Per-action key overrides, layered over the definitions. */
  private overrides: Record<string, string[]> = {}

  constructor(element: HTMLElement) {
    this.keyboard = new Keyboard()
    this.pointer = new Pointer(element)
    this.wheel = new Wheel(element)
    this.gamepad = new GamepadInput()

    this.keyboard.events.on('down', ((code: string, key: string) => {
      this.setMode('keyboard')
      this.start(`Keyboard.${code}`)
      if (key !== code) this.start(`Keyboard.${key}`)
    }) as never)

    this.keyboard.events.on('up', ((code: string, key: string) => {
      this.end(`Keyboard.${code}`)
      if (key !== code) this.end(`Keyboard.${key}`)
    }) as never)

    this.gamepad.events.on('down', ((button: { name: string; value: number }) => {
      this.setMode('gamepad')
      this.start(`Gamepad.${button.name}`, button.value)
    }) as never)

    this.gamepad.events.on('up', ((button: { name: string }) => {
      this.end(`Gamepad.${button.name}`)
    }) as never)

    this.gamepad.events.on('change', ((button: { name: string; value: number }) => {
      this.change(`Gamepad.${button.name}`, button.value)
    }) as never)

    this.pointer.events.on('down', (() => {
      this.setMode(this.pointer.mode === 'mouse' ? 'keyboard' : 'touch')
      this.start('Pointer.any')
    }) as never)

    this.pointer.events.on('up', (() => {
      this.end('Pointer.any')
    }) as never)

    this.pointer.events.on('move', (() => {
      this.change('Pointer.any', 1)
    }) as never)

    this.wheel.events.on('roll', ((value: number) => {
      this.setMode('keyboard')
      this.start('Wheel.roll', value, true)
    }) as never)
  }

  /* ---- definitions & bindings ---------------------------- */

  add(definitions: ActionDefinition[]): void {
    for (const definition of definitions) {
      this.actions.set(definition.name, {
        ...definition,
        keys: this.overrides[definition.name] ?? definition.keys,
        active: false,
        value: 0,
        trigger: null,
        activeKeys: new Set(),
      })
    }
  }

  /** Applies stored key overrides. Call before `add`. */
  setOverrides(overrides: Record<string, string[]>): void {
    this.overrides = overrides
    for (const [name, keys] of Object.entries(overrides)) {
      const action = this.actions.get(name)
      if (action) {
        action.keys = keys
        action.activeKeys.clear()
        action.active = false
      }
    }
  }

  /** Rebinds one action at runtime. Returns the new key list. */
  rebind(name: string, keys: string[]): string[] | null {
    const action = this.actions.get(name)
    if (!action) return null
    action.keys = keys
    action.activeKeys.clear()
    action.active = false
    this.overrides[name] = keys
    this.events.trigger('rebind', [name, keys])
    return keys
  }

  get bindingOverrides(): Record<string, string[]> {
    return { ...this.overrides }
  }

  isActive(name: string): boolean {
    return this.actions.get(name)?.active ?? false
  }

  valueOf(name: string): number {
    const action = this.actions.get(name)
    return action?.active ? action.value : 0
  }

  /* ---- filters ------------------------------------------- */

  setFilters(categories: ActionCategory[]): void {
    // Anything that becomes forbidden must be released, or the car
    // keeps accelerating while the pause menu is open.
    this.filters.clear()
    for (const c of categories) this.filters.add(c)
    for (const action of this.actions.values()) {
      if (action.active && !this.allowed(action)) {
        action.activeKeys.clear()
        action.active = false
        action.value = 0
        action.trigger = 'end'
        this.events.trigger('actionEnd', [action])
        this.events.trigger(action.name, [action])
      }
    }
    this.events.trigger('filtersChange', [categories])
  }

  private allowed(action: Action): boolean {
    if (this.filters.size === 0) return true
    if (action.categories.length === 0) return true
    for (const category of action.categories) {
      if (this.filters.has(category)) return true
    }
    return false
  }

  /* ---- device → action ----------------------------------- */

  private start(key: string, value = 1, repeat = false): void {
    for (const action of this.actions.values()) {
      if (!action.keys.includes(key) || !this.allowed(action)) continue

      action.value = value
      action.activeKeys.add(key)
      action.trigger = 'start'

      if (repeat || action.repeatable) {
        this.events.trigger('actionStart', [action])
        this.events.trigger(action.name, [action])
      } else if (!action.active) {
        action.active = true
        this.events.trigger('actionStart', [action])
        this.events.trigger(action.name, [action])
      }
    }
  }

  private end(key: string): void {
    for (const action of this.actions.values()) {
      if (!action.keys.includes(key) || !action.active) continue
      action.activeKeys.delete(key)
      if (action.activeKeys.size > 0) continue
      action.active = false
      action.value = 0
      action.trigger = 'end'
      this.events.trigger('actionEnd', [action])
      this.events.trigger(action.name, [action])
    }
  }

  private change(key: string, value: number): void {
    for (const action of this.actions.values()) {
      if (!action.keys.includes(key) || !this.allowed(action)) continue
      if (action.value === value && action.trigger === 'change') continue
      action.value = value
      action.trigger = 'change'
      this.events.trigger('actionChange', [action])
      this.events.trigger(action.name, [action])
    }
  }

  private setMode(mode: InputMode): void {
    if (mode === this.mode) return
    this.mode = mode
    this.events.trigger('modeChange', [mode])
  }

  /** Forces touch mode; used when the route detects a coarse pointer. */
  assumeTouch(): void {
    this.setMode('touch')
  }

  /**
   * On-screen buttons drive actions through a synthetic key, so a
   * touch BOOST and a keyboard Shift are the same action with the
   * same lifecycle — nothing downstream has to know which it was.
   */
  pressTouchAction(name: string): void {
    this.setMode('touch')
    this.start(`Touch.${name}`, 1)
  }

  releaseTouchAction(name: string): void {
    this.end(`Touch.${name}`)
  }

  /** Frame-level poll. Order 0 on the ticker's `frame` channel. */
  update(): void {
    this.pointer.update()
    this.gamepad.update()
  }

  /** Releases everything. Used when the tab hides or a modal opens. */
  releaseAll(): void {
    this.keyboard.releaseAll()
    for (const action of this.actions.values()) {
      if (!action.active) continue
      action.activeKeys.clear()
      action.active = false
      action.value = 0
      action.trigger = 'end'
      this.events.trigger('actionEnd', [action])
      this.events.trigger(action.name, [action])
    }
  }

  destroy(): void {
    this.keyboard.destroy()
    this.pointer.destroy()
    this.wheel.destroy()
    this.gamepad.destroy()
    this.actions.clear()
    this.events.clear()
  }
}

/* ============================================================
   THE BINDINGS
   The brief's control scheme. Keyboard first, then gamepad, then
   the touch layer (which is a world-space joystick, not a key).
   ============================================================ */

export const ACTION_DEFINITIONS: ActionDefinition[] = [
  { name: 'forward', label: 'Accelerate', categories: ['driving'], keys: ['Keyboard.ArrowUp', 'Keyboard.KeyW', 'Gamepad.up', 'Gamepad.r2'] },
  { name: 'backward', label: 'Reverse', categories: ['driving'], keys: ['Keyboard.ArrowDown', 'Keyboard.KeyS', 'Gamepad.down', 'Gamepad.l2'] },
  { name: 'left', label: 'Steer left', categories: ['driving'], keys: ['Keyboard.ArrowLeft', 'Keyboard.KeyA', 'Gamepad.left'] },
  { name: 'right', label: 'Steer right', categories: ['driving'], keys: ['Keyboard.ArrowRight', 'Keyboard.KeyD', 'Gamepad.right'] },
  { name: 'boost', label: 'Boost', categories: ['driving'], keys: ['Keyboard.ShiftLeft', 'Keyboard.ShiftRight', 'Gamepad.circle', 'Touch.boost'] },
  { name: 'brake', label: 'Brake', categories: ['driving'], keys: ['Keyboard.KeyB', 'Keyboard.ControlLeft', 'Gamepad.square', 'Touch.brake'] },
  { name: 'jump', label: 'Jump', categories: ['driving'], keys: ['Keyboard.Space', 'Keyboard.Numpad5', 'Gamepad.triangle', 'Touch.jump'] },
  { name: 'respawn', label: 'Respawn', categories: ['driving'], keys: ['Keyboard.KeyR', 'Gamepad.select', 'Touch.respawn'] },
  { name: 'horn', label: 'Horn', categories: ['driving'], keys: ['Keyboard.KeyH', 'Gamepad.l3', 'Touch.horn'] },
  { name: 'interact', label: 'Interact', categories: ['driving', 'minigame'], keys: ['Keyboard.Enter', 'Keyboard.KeyE', 'Gamepad.cross', 'Touch.interact'] },

  /* Hydraulics — one corner at a time, then pairs, then all four. */
  { name: 'hydraulicsAll', label: 'Hydraulics: all', categories: ['driving'], keys: ['Keyboard.Numpad0'] },
  { name: 'hydraulicsFront', label: 'Hydraulics: front', categories: ['driving'], keys: ['Keyboard.Numpad8'] },
  { name: 'hydraulicsBack', label: 'Hydraulics: back', categories: ['driving'], keys: ['Keyboard.Numpad2'] },
  { name: 'hydraulicsRight', label: 'Hydraulics: right', categories: ['driving'], keys: ['Keyboard.Numpad6', 'Gamepad.r1'] },
  { name: 'hydraulicsLeft', label: 'Hydraulics: left', categories: ['driving'], keys: ['Keyboard.Numpad4', 'Gamepad.l1'] },
  { name: 'hydraulicsFrontRight', label: 'Hydraulics: front right', categories: ['driving'], keys: ['Keyboard.Numpad9', 'Keyboard.Digit3'] },
  { name: 'hydraulicsFrontLeft', label: 'Hydraulics: front left', categories: ['driving'], keys: ['Keyboard.Numpad7', 'Keyboard.Digit2'] },
  { name: 'hydraulicsBackRight', label: 'Hydraulics: back right', categories: ['driving'], keys: ['Keyboard.Numpad3', 'Keyboard.Digit4'] },
  { name: 'hydraulicsBackLeft', label: 'Hydraulics: back left', categories: ['driving'], keys: ['Keyboard.Numpad1', 'Keyboard.Digit1'] },

  /* Camera */
  { name: 'zoom', label: 'Zoom', categories: ['camera'], keys: ['Wheel.roll'], repeatable: true, fixed: true },
  { name: 'zoomToggle', label: 'Zoom (pad)', categories: ['camera'], keys: ['Gamepad.r3'], fixed: true },
  { name: 'orbit', label: 'Orbit camera', categories: ['camera'], keys: ['Pointer.any'], fixed: true },
  { name: 'cameraReset', label: 'Reset camera', categories: ['camera'], keys: ['Keyboard.KeyC'] },

  /* UI — deliberately outside every category so they survive filters. */
  { name: 'map', label: 'Map', categories: [], keys: ['Keyboard.KeyM', 'Gamepad.start', 'Touch.map'] },
  { name: 'mute', label: 'Mute', categories: [], keys: ['Keyboard.KeyL'] },
  { name: 'pause', label: 'Pause', categories: [], keys: ['Keyboard.Escape'] },
  { name: 'achievements', label: 'Achievements', categories: [], keys: ['Keyboard.KeyK'] },
  { name: 'help', label: 'Controls', categories: [], keys: ['Keyboard.Slash', 'Keyboard.?'] },
]
