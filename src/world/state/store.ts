import { createStore, type StoreApi } from 'zustand/vanilla'
import type { DistrictId, MinigameId } from '@/content/world'
import type { QualityLevel, QualityPreference } from '../core/Quality'
import type { InputMode } from '../input/Inputs'

/* ============================================================
   WORLD UI STATE

   The engine is imperative and runs at 60 Hz; React is not
   involved in a single frame of it. This store is the narrow
   bridge: the engine pushes discrete events (a panel opened, a
   district entered, an achievement unlocked) and React renders
   them.

   Nothing that changes every frame lives here. Speed, position
   and camera state are read directly off the engine by the few
   components that need them, through a rAF subscription — the
   same discipline the main portfolio uses with its `frame` object.

   A store is created PER MOUNT and handed to React through
   context, so leaving and re-entering /world starts genuinely
   clean rather than inheriting the last session's open panels.
   ============================================================ */

export type LoadStage = 'physics' | 'vehicle' | 'world' | 'projects' | 'audio'

export interface LoadStep {
  id: LoadStage
  label: string
  done: boolean
}

export interface Notification {
  id: number
  kind: 'achievement' | 'info' | 'district' | 'note'
  title: string
  body?: string
  /** Seconds to remain on screen. */
  duration: number
}

export interface PromptState {
  /** What the thing is called. The headline. */
  label: string
  /** One line: what kind of thing it is. */
  sublabel?: string
  /**
   * The verb, next to the key. `label` used to carry this — the
   * prompt read READ in large type with the project's name beneath
   * it, so every landmark in the world announced itself as "READ".
   */
  action?: string
  /** Screen position in 0..1, for anchoring. */
  x: number
  y: number
}

/**
 * `projects` is the archive browser behind the PROJECTS terminal. It is
 * a kind of its own rather than a `panel`, because a panel is about ONE
 * landmark and this is the whole inventory — the island stopped giving
 * a project a district each on the condition that one terminal could
 * still reach every one of them.
 */
export type OverlayKind =
  | 'panel'
  | 'projects'
  | 'map'
  | 'achievements'
  | 'options'
  | 'pause'
  | 'controls'

export interface WorldState {
  /* ---- boot ------------------------------------------- */
  steps: LoadStep[]
  loaded: boolean
  /** True once the visitor has pressed ENTER on the loader. */
  entered: boolean
  fatal: string | null

  /* ---- overlays --------------------------------------- */
  overlay: OverlayKind | null
  /** Landmark id backing the open panel. */
  panelId: string | null
  /** Screen-anchored interact prompt, or null. */
  prompt: PromptState | null

  /* ---- hud -------------------------------------------- */
  district: DistrictId | null
  notifications: Notification[]
  inputMode: InputMode
  onboarding: boolean

  /* ---- settings mirror -------------------------------- */
  quality: QualityLevel
  qualityPreference: QualityPreference
  muted: boolean
  volume: number
  reducedMotion: boolean

  /* ---- mini-games ------------------------------------- */
  minigame: {
    /**
     * The id was a bare `string`, which let the HUD's Restart button
     * hold the name of a mini-game that had been deleted with its
     * district — `minigames.start()` takes a string too, so the whole
     * path from card to manager compiled and the button just did
     * nothing. Naming the union makes a retired game a type error
     * here instead of a dead button at runtime.
     */
    id: MinigameId
    title: string
    /** Free-form lines the mini-game HUD renders. */
    lines: string[]
    /** Elapsed seconds, updated at most ~10 Hz. */
    time: number | null
    best: number | null
    /** 0..1, for progress-shaped games. */
    progress: number | null
    /**
     * A finished run's result card. When this is set the HUD shows the
     * END SCREEN — the time large, the standing, and the board — rather
     * than the running readout.
     */
    result?: {
      headline: string
      /** The thing the screen is actually about, set large. */
      time: string
      newBest: boolean
      /** Fastest first. `at` is epoch ms, or 0 if it predates dates. */
      board: { time: string; at: number; you: boolean }[]
    }
  } | null

  /* ---- actions ---------------------------------------- */
  setStep: (id: LoadStage, done: boolean) => void
  setLoaded: (v: boolean) => void
  setEntered: (v: boolean) => void
  setFatal: (message: string | null) => void
  setOverlay: (overlay: OverlayKind | null, panelId?: string | null) => void
  setPrompt: (prompt: PromptState | null) => void
  setDistrict: (district: DistrictId | null) => void
  notify: (notification: Omit<Notification, 'id'>) => void
  dismiss: (id: number) => void
  setInputMode: (mode: InputMode) => void
  setOnboarding: (v: boolean) => void
  setQuality: (level: QualityLevel, preference: QualityPreference) => void
  setAudio: (muted: boolean, volume: number) => void
  setReducedMotion: (v: boolean) => void
  setMinigame: (minigame: WorldState['minigame']) => void
}

export type WorldStore = StoreApi<WorldState>

const STEPS: LoadStep[] = [
  { id: 'physics', label: 'PHYSICS', done: false },
  { id: 'vehicle', label: 'VEHICLE', done: false },
  { id: 'world', label: 'WORLD', done: false },
  { id: 'projects', label: 'PROJECTS', done: false },
  { id: 'audio', label: 'AUDIO', done: false },
]

let notificationId = 0

export function createWorldStore(): WorldStore {
  return createStore<WorldState>((set, get) => ({
    steps: STEPS.map((s) => ({ ...s })),
    loaded: false,
    entered: false,
    fatal: null,

    overlay: null,
    panelId: null,
    prompt: null,

    district: null,
    notifications: [],
    inputMode: 'keyboard',
    onboarding: true,

    quality: 'high',
    qualityPreference: 'auto',
    muted: false,
    volume: 0.7,
    reducedMotion: false,

    minigame: null,

    setStep: (id, done) =>
      set((state) => ({
        steps: state.steps.map((s) => (s.id === id ? { ...s, done } : s)),
      })),
    setLoaded: (loaded) => set({ loaded }),
    setEntered: (entered) => set({ entered }),
    setFatal: (fatal) => set({ fatal }),

    setOverlay: (overlay, panelId = null) =>
      set({ overlay, panelId: overlay === 'panel' ? panelId : null }),
    setPrompt: (prompt) => set({ prompt }),
    setDistrict: (district) => set({ district }),

    notify: (notification) => {
      const id = ++notificationId
      set((state) => {
        // You can only be in one district. A second district notice
        // REPLACES the first rather than stacking under it — driving
        // through three districts in ten seconds used to leave three
        // "you have arrived" cards on screen at once, two of them
        // about places you had already left.
        const kept = notification.kind === 'district'
          ? state.notifications.filter((n) => n.kind !== 'district')
          : state.notifications
        // Three at a time, newest first. More than that and the
        // corner of the screen becomes a log file.
        return { notifications: [{ ...notification, id }, ...kept].slice(0, 3) }
      })
      window.setTimeout(() => get().dismiss(id), notification.duration * 1000)
    },
    dismiss: (id) =>
      set((state) => ({ notifications: state.notifications.filter((n) => n.id !== id) })),

    setInputMode: (inputMode) => set({ inputMode }),
    setOnboarding: (onboarding) => set({ onboarding }),
    setQuality: (quality, qualityPreference) => set({ quality, qualityPreference }),
    setAudio: (muted, volume) => set({ muted, volume }),
    setReducedMotion: (reducedMotion) => set({ reducedMotion }),
    setMinigame: (minigame) => set({ minigame }),
  }))
}
