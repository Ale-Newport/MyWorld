import type { PerformanceTier } from '@/state/journey'

export interface DeviceProfile {
  tier: PerformanceTier
  isMobile: boolean
  isTouch: boolean
  dpr: number
  /** Multiplier applied to every particle / instance count. */
  density: number
  shadows: boolean
  postProcessing: boolean
  physics: boolean
}

let cached: DeviceProfile | null = null

export function detectDevice(): DeviceProfile {
  if (cached) return cached
  if (typeof window === 'undefined') {
    return { tier: 'high', isMobile: false, isTouch: false, dpr: 1, density: 1, shadows: true, postProcessing: true, physics: true }
  }

  const nav = navigator as Navigator & { deviceMemory?: number; hardwareConcurrency?: number }
  const cores = nav.hardwareConcurrency ?? 4
  const memory = nav.deviceMemory ?? 4
  const isTouch = window.matchMedia('(pointer: coarse)').matches
  const width = window.innerWidth
  const isMobile = width < 768 || (isTouch && width < 1024)

  // WebGL capability probe — cheap, one-off.
  let maxTexture = 4096
  let renderer = ''
  try {
    const c = document.createElement('canvas')
    const gl = (c.getContext('webgl2') || c.getContext('webgl')) as WebGLRenderingContext | null
    if (gl) {
      maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number
      const dbg = gl.getExtension('WEBGL_debug_renderer_info')
      if (dbg) renderer = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) ?? '')
      const lose = gl.getExtension('WEBGL_lose_context')
      lose?.loseContext()
    }
  } catch { /* probing is best-effort */ }

  const weakGpu = /swiftshader|llvmpipe|software|angle \(intel\)? ?hd/i.test(renderer)

  let tier: PerformanceTier = 'high'
  if (isMobile || cores <= 4 || memory <= 4 || maxTexture < 4096 || weakGpu) tier = 'medium'
  if ((isMobile && (cores <= 4 || memory <= 3)) || cores <= 2 || memory <= 2 || weakGpu) tier = 'low'

  const dpr = tier === 'low' ? 1 : tier === 'medium' ? Math.min(1.5, window.devicePixelRatio) : Math.min(2, window.devicePixelRatio)

  cached = {
    tier,
    isMobile,
    isTouch,
    dpr,
    density: tier === 'low' ? 0.28 : tier === 'medium' ? 0.55 : 1,
    shadows: tier === 'high',
    postProcessing: tier !== 'low',
    physics: tier !== 'low',
  }
  return cached
}

/** Scale a count by device density, with a floor. */
export function scaled(count: number, floor = 8): number {
  const d = cached?.density ?? 1
  return Math.max(floor, Math.round(count * d))
}

/** Runtime FPS watchdog — downgrades tier if the device struggles. */
export function createFpsWatchdog(onDowngrade: () => void) {
  let frames = 0
  let last = performance.now()
  let strikes = 0
  let active = true
  return {
    tick() {
      if (!active) return
      frames++
      const now = performance.now()
      if (now - last < 2000) return
      const fps = (frames * 1000) / (now - last)
      frames = 0
      last = now
      if (fps < 32) {
        strikes++
        if (strikes >= 2) { active = false; onDowngrade() }
      } else {
        strikes = 0
      }
    },
    stop() { active = false },
  }
}
