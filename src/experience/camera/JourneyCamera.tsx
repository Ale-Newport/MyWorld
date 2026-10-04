'use client'

import { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useJourney, frame } from '@/state/journey'
import { damp } from '@/lib/math'
import type { ChapterId } from '@/content/types'

interface Shot {
  pos: [number, number, number]
  look: [number, number, number]
  fov: number
}

/**
 * One camera for the whole journey. Each chapter declares a
 * start and end shot; the camera interpolates within the
 * chapter and damps across boundaries, so there is never a cut.
 *
 * These shots were originally framed on a single travelling
 * object. That object is gone, but the numbers are kept: every
 * scene that remains is built around the origin, and the light
 * chapters — which now show only the field — depend on the low
 * look targets to hold the ground at a grazing angle. Raising
 * them would tilt the field out of frame and leave those
 * chapters with nothing at all.
 */
const SHOTS: Record<ChapterId, [Shot, Shot]> = {
  prelude:   [{ pos: [0, 0.3, 6.5], look: [0, -0.5, 0],  fov: 36 }, { pos: [0, 0.8, 11],  look: [0, -0.9, 0],   fov: 44 }],
  about:     [{ pos: [0, 0.8, 11],  look: [0, -0.9, 0],  fov: 44 }, { pos: [0, 3.2, 26],  look: [0, -1.2, 0],   fov: 52 }],
  education: [{ pos: [-6, 2.2, 14], look: [0, -0.3, 0],  fov: 46 }, { pos: [7, 1.6, 11],  look: [1, -0.4, 0],   fov: 44 }],
  pansofia:  [{ pos: [0, 0.4, 9],   look: [0, 0.2, 0],   fov: 40 }, { pos: [0, 0.2, 6.4], look: [0, 0.2, 0],    fov: 38 }],
  teaching:  [{ pos: [0, 0, 8],     look: [0, 0, 0],     fov: 40 }, { pos: [0.6, 0, 7],   look: [0, 0, 0],      fov: 40 }],
  focus:     [{ pos: [0, 0, 8],     look: [0, 0, 0],     fov: 38 }, { pos: [2.4, 1.0, 5], look: [0, 0, 0],      fov: 46 }],
  gym:       [{ pos: [0, 0.4, 9],   look: [0, 0, 0],     fov: 40 }, { pos: [-2.2, 0.6, 7],look: [0, 0, 0],      fov: 42 }],
  metaview:  [{ pos: [0, 1.2, 30],  look: [0, 0, 0],     fov: 50 }, { pos: [0, -0.6, 13], look: [0, 0, 0],      fov: 46 }],
  chess:     [{ pos: [0, 1.4, 9],   look: [0, 0, 0],     fov: 40 }, { pos: [0, 4.2, 6],   look: [0, 0, 0],      fov: 44 }],
  stock:     [{ pos: [-4, 0, 9],    look: [0, 0, 0],     fov: 44 }, { pos: [4, 0.4, 7],   look: [0, 0, 0],      fov: 48 }],
  universe:  [{ pos: [0, 0, 12],    look: [0, 0, 0],     fov: 50 }, { pos: [0, 0, 30],    look: [0, 0, 0],      fov: 56 }],
  toolbox:   [{ pos: [0, 0, 30],    look: [0, 0, 0],     fov: 40 }, { pos: [0, 0, 24],    look: [0, 0, 0],      fov: 40 }],
  contact:   [{ pos: [0, 0, 9],     look: [0, 0, 0],     fov: 40 }, { pos: [0, 0, 34],    look: [0, 0, 0],      fov: 58 }],
}

const tmpPos = new THREE.Vector3()
const tmpLook = new THREE.Vector3()
const curLook = new THREE.Vector3()

export function JourneyCamera() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const initialised = useRef(false)

  useFrame((_, dt) => {
    const d = Math.min(0.05, dt)
    const s = useJourney.getState()
    const r = s.ranges.find((x) => x.id === s.chapter)
    if (!r) return

    const span = Math.max(1e-6, r.end - r.start)
    const t = Math.min(1, Math.max(0, (frame.progress - r.start) / span))
    const ease = t * t * (3 - 2 * t)

    const [a, b] = SHOTS[s.chapter] ?? SHOTS.prelude
    tmpPos.set(
      a.pos[0] + (b.pos[0] - a.pos[0]) * ease,
      a.pos[1] + (b.pos[1] - a.pos[1]) * ease,
      a.pos[2] + (b.pos[2] - a.pos[2]) * ease,
    )
    tmpLook.set(
      a.look[0] + (b.look[0] - a.look[0]) * ease,
      a.look[1] + (b.look[1] - a.look[1]) * ease,
      a.look[2] + (b.look[2] - a.look[2]) * ease,
    )
    const fov = a.fov + (b.fov - a.fov) * ease

    // Pointer drift — subtle, never disorienting.
    const drift = s.reducedMotion ? 0 : 1
    tmpPos.x += frame.pointerX * 0.55 * drift
    tmpPos.y += frame.pointerY * 0.4 * drift

    if (!initialised.current) {
      camera.position.copy(tmpPos)
      curLook.copy(tmpLook)
      initialised.current = true
    } else {
      const k = s.reducedMotion ? 30 : 3.4
      camera.position.x = damp(camera.position.x, tmpPos.x, k, d)
      camera.position.y = damp(camera.position.y, tmpPos.y, k, d)
      camera.position.z = damp(camera.position.z, tmpPos.z, k, d)
      curLook.x = damp(curLook.x, tmpLook.x, k, d)
      curLook.y = damp(curLook.y, tmpLook.y, k, d)
      curLook.z = damp(curLook.z, tmpLook.z, k, d)
    }

    camera.lookAt(curLook)
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = damp(camera.fov, fov, 3.4, d)
      camera.updateProjectionMatrix()
    }
  })

  return null
}
