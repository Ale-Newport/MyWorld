import { Events } from './Events'

/* ============================================================
   QUALITY
   Expanded from sources/Game/Quality.js (folio-2025, MIT —
   Copyright (c) 2025 Bruno Simon). Upstream has two levels and
   a user-agent sniff. The brief here asks for LOW / MEDIUM /
   HIGH / AUTO with a runtime governor, so this adds a capability
   probe, a per-level settings table and an FPS watchdog that can
   step down (and, if the machine recovers, back up once).

   Rule that must not be broken: quality changes what the world
   LOOKS like, never what it COLLIDES with. Physics props,
   colliders, terrain shape and every trigger radius are
   identical at LOW and HIGH — otherwise a phone and a desktop
   would be playing different games.
   ============================================================ */

export type QualityLevel = 'low' | 'medium' | 'high'
export type QualityPreference = QualityLevel | 'auto'

export interface QualitySettings {
  /** Multiplier on renderer pixel ratio, before the device cap. */
  pixelRatio: number
  shadows: boolean
  shadowMapSize: number
  /** Multiplier applied to every instanced/particle count. */
  density: number
  /** Metres. Beyond this, decorative instances are not built. */
  drawDistance: number
  /** Tyre-track render target resolution; 0 disables tracks. */
  trackResolution: number
  grass: boolean
  foliage: boolean
  weatherParticles: number
  /** Anti-aliasing on the main target. */
  antialias: boolean
  /** Cheap depth-of-field / vignette composite. */
  postProcessing: boolean
  /** Reflective water plane vs. flat colour. */
  reflections: boolean
}

const SETTINGS: Record<QualityLevel, QualitySettings> = {
  low: {
    pixelRatio: 1,
    shadows: false,
    shadowMapSize: 512,
    density: 0.28,
    drawDistance: 150,
    trackResolution: 0,
    grass: false,
    foliage: false,
    weatherParticles: 120,
    antialias: false,
    postProcessing: false,
    reflections: false,
  },
  medium: {
    pixelRatio: 1.35,
    shadows: true,
    shadowMapSize: 1024,
    density: 0.6,
    drawDistance: 230,
    trackResolution: 512,
    grass: true,
    foliage: true,
    weatherParticles: 500,
    antialias: true,
    postProcessing: false,
    reflections: false,
  },
  high: {
    pixelRatio: 2,
    shadows: true,
    shadowMapSize: 2048,
    density: 1,
    drawDistance: 340,
    trackResolution: 1024,
    grass: true,
    foliage: true,
    weatherParticles: 1200,
    antialias: true,
    postProcessing: true,
    reflections: true,
  },
}

export interface DeviceProbe {
  isMobile: boolean
  isTouch: boolean
  cores: number
  memory: number
  maxTextureSize: number
  renderer: string
  weakGpu: boolean
  devicePixelRatio: number
  webgl2: boolean
  /** No WebGL at all — the route must show a fallback. */
  unsupported: boolean
}

export function probeDevice(): DeviceProbe {
  if (typeof window === 'undefined') {
    return {
      isMobile: false, isTouch: false, cores: 8, memory: 8,
      maxTextureSize: 4096, renderer: '', weakGpu: false,
      devicePixelRatio: 1, webgl2: true, unsupported: false,
    }
  }

  const nav = navigator as Navigator & { deviceMemory?: number; hardwareConcurrency?: number }
  const cores = nav.hardwareConcurrency ?? 4
  const memory = nav.deviceMemory ?? 4
  const isTouch = window.matchMedia('(pointer: coarse)').matches
  const isMobile =
    /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (isTouch && Math.min(window.innerWidth, window.innerHeight) < 820)

  let maxTextureSize = 0
  let renderer = ''
  let webgl2 = false
  let unsupported = true

  try {
    const canvas = document.createElement('canvas')
    const gl2 = canvas.getContext('webgl2')
    const gl = (gl2 ?? canvas.getContext('webgl')) as WebGLRenderingContext | null
    if (gl) {
      unsupported = false
      webgl2 = Boolean(gl2)
      maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number
      const dbg = gl.getExtension('WEBGL_debug_renderer_info')
      if (dbg) renderer = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) ?? '')
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    }
  } catch {
    /* probing is best-effort */
  }

  const weakGpu = /swiftshader|llvmpipe|software|basic render|angle \(intel\)? ?hd/i.test(renderer)

  return {
    isMobile, isTouch, cores, memory, maxTextureSize, renderer, weakGpu,
    devicePixelRatio: window.devicePixelRatio || 1,
    webgl2, unsupported,
  }
}

export function autoLevel(probe: DeviceProbe): QualityLevel {
  if (probe.unsupported) return 'low'
  if (probe.weakGpu) return 'low'
  if (probe.cores <= 2 || probe.memory <= 2) return 'low'
  if (probe.isMobile) return probe.cores >= 6 && probe.memory >= 6 ? 'medium' : 'low'
  if (probe.cores <= 4 || probe.memory <= 4 || probe.maxTextureSize < 4096) return 'medium'
  return 'high'
}

export class Quality {
  readonly events = new Events<'change'>()
  readonly probe: DeviceProbe

  preference: QualityPreference
  level: QualityLevel
  settings: QualitySettings

  /** Auto mode only: how many times the governor has stepped down. */
  private downgrades = 0
  private strikes = 0
  private recoveries = 0
  private windowFrames = 0
  private windowStart = 0

  constructor(preference: QualityPreference = 'auto', probe = probeDevice()) {
    this.probe = probe
    this.preference = preference
    this.level = preference === 'auto' ? autoLevel(probe) : preference
    this.settings = SETTINGS[this.level]
  }

  /** Renderer pixel ratio for the current level, capped by the device. */
  get pixelRatio(): number {
    return Math.min(this.settings.pixelRatio, this.probe.devicePixelRatio)
  }

  /** Scales a decorative instance count. Never used for colliders. */
  count(base: number, floor = 0): number {
    return Math.max(floor, Math.round(base * this.settings.density))
  }

  setPreference(preference: QualityPreference): void {
    this.preference = preference
    this.downgrades = 0
    this.strikes = 0
    this.recoveries = 0
    this.apply(preference === 'auto' ? autoLevel(this.probe) : preference)
  }

  private apply(level: QualityLevel): void {
    if (level === this.level) return
    this.level = level
    this.settings = SETTINGS[level]
    this.events.trigger('change', [level])
  }

  /**
   * Called once per rendered frame. In `auto` mode only, steps the
   * level down after two consecutive bad two-second windows, and
   * allows exactly one step back up if the machine recovers — so a
   * borderline device cannot oscillate forever.
   */
  governor(now: number): void {
    if (this.preference !== 'auto') return

    this.windowFrames++
    if (this.windowStart === 0) this.windowStart = now
    const span = now - this.windowStart
    if (span < 2000) return

    const fps = (this.windowFrames * 1000) / span
    this.windowFrames = 0
    this.windowStart = now

    if (fps < 34) {
      this.strikes++
      this.recoveries = 0
      if (this.strikes >= 2 && this.downgrades < 2) {
        this.strikes = 0
        this.downgrades++
        this.apply(this.level === 'high' ? 'medium' : 'low')
      }
      return
    }

    this.strikes = 0
    if (fps > 56 && this.downgrades > 0 && this.level !== 'high') {
      this.recoveries++
      // Six good windows (~12 s) before spending the one upgrade.
      if (this.recoveries >= 6) {
        this.recoveries = 0
        this.downgrades = 3 // spend it: no further automatic upgrades
        this.apply(this.level === 'low' ? 'medium' : 'high')
      }
    }
  }

  destroy(): void {
    this.events.clear()
  }
}

export const qualitySettings = SETTINGS
