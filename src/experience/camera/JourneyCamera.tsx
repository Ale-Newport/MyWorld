'use client'

import { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useJourney, frame } from '@/state/journey'
import { getLenis } from '@/hooks/useLenisScroll'
import { clamp, damp } from '@/lib/math'
import type { ChapterId } from '@/content/types'
import { lens, readSceneRegion, regionOnScreen } from './regions'

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

/* ============================================================
   DESIGN FRAMES

   A chapter whose subject has a region of its own on the stage
   (<SceneRegion>) composes that subject for a frame of a fixed
   shape: this aspect ratio, the full height of the rail's field
   of view, centred on the look axis. Each scene keeps its whole
   motion envelope — fly-ins, spread, pointer-driven rotation —
   inside that frame for the length of its chapter.

   The camera then contains the frame in the region: as large as
   the region allows and centred in it, by shifting and scaling the
   projection (an off-axis lens, not a move — the rails, and with
   them the dolly and the orbit, are exactly as they were). The
   shift follows the stage as it scrolls in and out, so a subject
   arrives and leaves with its own copy instead of over the copy of
   the chapter next door.

   Chapters not listed here are drawn across the whole screen.
   ============================================================ */
const FRAMES: Partial<Record<ChapterId, number>> = {
  metaview: 1.3,
  chess: 1.3,
  stock: 2.2,
}

/** How long the projection takes to travel to a new chapter's region. */
const HANDOFF = 0.45

interface Fit {
  /** Scale of the design frame against the full screen. */
  s: number
  /** Where the frame's centre lands, in normalised device coordinates. */
  x: number
  y: number
}

const box = { x: 0, y: 0, w: 0, h: 0 }

function fitFor(chapter: ChapterId, W: number, H: number, scrollY: number, out: Fit): Fit {
  const aspect = FRAMES[chapter]
  const region = aspect ? readSceneRegion(chapter) : undefined
  if (!aspect || !region || W < 1 || H < 1) {
    out.s = 1
    out.x = 0
    out.y = 0
    return out
  }
  regionOnScreen(region, scrollY, box)
  const fh = Math.min(box.h, box.w / aspect, H)
  out.s = Math.max(0.01, fh / H)
  out.x = (2 * (box.x + box.w / 2)) / W - 1
  out.y = 1 - (2 * (box.y + box.h / 2)) / H
  return out
}

const tmpPos = new THREE.Vector3()
const tmpLook = new THREE.Vector3()
const curLook = new THREE.Vector3()

export function JourneyCamera() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const initialised = useRef(false)
  const fit = useRef({
    now: { s: 1, x: 0, y: 0 } as Fit,
    from: { s: 1, x: 0, y: 0 } as Fit,
    to: { s: 1, x: 0, y: 0 } as Fit,
    chapter: null as ChapterId | null,
    blend: 1,
    applied: { s: 1, x: 0, y: 0, w: 0, h: 0, fov: 0 },
  })

  useFrame((state, dt) => {
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

    const first = !initialised.current
    /* With motion reduced the canvas draws only when asked (on scroll),
       so a damped camera would come to rest wherever the last request
       left it, part of the way to its shot. It goes straight there. */
    if (first || s.reducedMotion) {
      camera.position.copy(tmpPos)
      curLook.copy(tmpLook)
      camera.fov = fov
      initialised.current = true
    } else {
      const k = 3.4
      camera.position.x = damp(camera.position.x, tmpPos.x, k, d)
      camera.position.y = damp(camera.position.y, tmpPos.y, k, d)
      camera.position.z = damp(camera.position.z, tmpPos.z, k, d)
      curLook.x = damp(curLook.x, tmpLook.x, k, d)
      curLook.y = damp(curLook.y, tmpLook.y, k, d)
      curLook.z = damp(curLook.z, tmpLook.z, k, d)
      if (Math.abs(camera.fov - fov) > 0.01) camera.fov = damp(camera.fov, fov, 3.4, d)
    }
    camera.lookAt(curLook)

    /* ---- the lens: the active chapter's design frame, in its region ---- */
    const f = fit.current
    const W = state.size.width
    const H = state.size.height
    const scrollY = getLenis()?.scroll ?? window.scrollY
    fitFor(s.chapter, W, H, scrollY, f.to)
    if (f.chapter !== s.chapter) {
      // Leave from wherever the projection is now, so a chapter change
      // mid-handoff never jumps — and do not travel at all between two
      // chapters that frame the same way (the ground's, say).
      f.from.s = f.now.s
      f.from.x = f.now.x
      f.from.y = f.now.y
      f.chapter = s.chapter
      const same = Math.abs(f.to.s - f.now.s) < 1e-3 && Math.abs(f.to.x - f.now.x) < 1e-3 && Math.abs(f.to.y - f.now.y) < 1e-3
      f.blend = first || same ? 1 : 0
    }
    f.blend = s.reducedMotion ? 1 : clamp(f.blend + d / HANDOFF)
    const e = f.blend * f.blend * (3 - 2 * f.blend)
    f.now.s = f.from.s + (f.to.s - f.from.s) * e
    f.now.x = f.from.x + (f.to.x - f.from.x) * e
    f.now.y = f.from.y + (f.to.y - f.from.y) * e
    lens.scale = f.now.s
    lens.chapter = s.chapter
    lens.settled = e

    const p = f.applied
    const changed =
      Math.abs(p.s - f.now.s) > 1e-5 || Math.abs(p.x - f.now.x) > 1e-5 || Math.abs(p.y - f.now.y) > 1e-5 ||
      p.w !== W || p.h !== H || Math.abs(p.fov - camera.fov) > 1e-4
    if (!changed) return
    p.s = f.now.s
    p.x = f.now.x
    p.y = f.now.y
    p.w = W
    p.h = H
    p.fov = camera.fov

    if (Math.abs(f.now.s - 1) < 1e-4 && Math.abs(f.now.x) < 1e-4 && Math.abs(f.now.y) < 1e-4) {
      if (camera.view?.enabled) camera.clearViewOffset()
      else camera.updateProjectionMatrix()
      return
    }
    /* The frame drawn at scale `s` around its centre (x, y) is the same
       picture as a window of the full projection that is 1/s the size
       of the screen — which is what setViewOffset describes, in the
       screen's own pixels. */
    const sc = f.now.s
    camera.setViewOffset(
      W, H,
      (W / 2) * (1 - (1 + f.now.x) / sc),
      (H / 2) * (1 - (1 - f.now.y) / sc),
      W / sc, H / sc,
    )
  })

  return null
}
