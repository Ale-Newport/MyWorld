'use client'

import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { frame, useJourney } from '@/state/journey'
import { readChapterProgress } from '@/hooks/useChapterProgress'
import { detectDevice } from '@/lib/perf'
import { clamp, damp, range, seeded } from '@/lib/math'
import { lens, readSceneRegion } from '@/experience/camera/regions'

/* ============================================================
   STOCK — concurrency made spatial.
   Four lanes, one per trader thread. Orders travel each lane
   toward a central matching plane; matched pairs annihilate.
   Order rate is driven by scroll velocity, so the visitor
   physically accelerates the market.

   The lanes are depth for the order book the chapter draws in the
   DOM, so their region IS the book's box: the camera fits the
   chapter's design frame (2.2 : 1, see FRAMES in JourneyCamera)
   into it. Nine units behind the look target, the orbit sweeps
   them across that frame from left to right; at LANES_SCALE the
   sweep, the pointer's turn and the match flashes all stay inside
   it. Standing still (reduced motion) there is no flow to show and
   the book is drawn full, so the lanes stand down.
   ============================================================ */

const LANES_SCALE = 0.78

const LANES = 4
const dummy = new THREE.Object3D()
const color = new THREE.Color()

/* Value scale on white. The four lanes have to stay four legible
   threads at a 60% alpha, so each one is a mid-dark hue rather than
   the mid-tones that used to sit on the void. A match used to blend
   the order 75% toward white, which on this page is the payoff moment
   erasing itself — matching now pulls the order to the house accent,
   the one colour reserved for a thing having happened. */
const LANE_COLORS = ['#d4491f', '#2f6f5e', '#4a5675', '#6e6540']
const MATCH = new THREE.Color('#d4491f')

interface Order { lane: number; t: number; side: 1 | -1; size: number; speed: number; alive: boolean }

export function StockScene() {
  const device = useMemo(() => detectDevice(), [])
  const group = useRef<THREE.Group>(null!)
  const mesh = useRef<THREE.InstancedMesh>(null!)
  const opacity = useRef(0)

  const MAX = Math.round(260 * device.density)
  const orders = useMemo<Order[]>(
    () => Array.from({ length: MAX }, () => ({ lane: 0, t: 0, side: 1 as 1 | -1, size: 0.1, speed: 1, alive: false })),
    [MAX],
  )
  const rand = useMemo(() => seeded(31337), [])
  const spawnAcc = useRef(0)
  const cursor = useRef(0)

  useFrame((_, dt) => {
    const d = Math.min(0.05, dt)
    const t = readChapterProgress('stock')
    const s = useJourney.getState()

    // Drawn only on its own chapter, only into its own region, and only
    // once the camera has finished moving the frame there.
    const own = s.chapter === 'stock' && lens.chapter === 'stock' && !s.reducedMotion && readSceneRegion('stock') !== undefined
    const vis = Math.min(range(t, 0, 0.12), 1 - range(t, 0.88, 1))
    opacity.current = own ? damp(opacity.current, clamp(vis) * lens.settled, 4, d) : 0
    group.current.visible = opacity.current > 0.005
    if (!group.current.visible) return

    // Rate ramps with chapter progress AND scroll velocity.
    const base = 6 + range(t, 0, 1) * 90
    const boost = 1 + Math.min(4, Math.abs(frame.velocity) * 90)
    spawnAcc.current += base * boost * d

    while (spawnAcc.current >= 1) {
      spawnAcc.current -= 1
      const o = orders[cursor.current]
      cursor.current = (cursor.current + 1) % MAX
      o.lane = Math.floor(rand() * LANES)
      o.side = rand() < 0.5 ? 1 : -1
      o.t = 0
      o.size = 0.035 + rand() * 0.08
      o.speed = 0.5 + rand() * 0.75
      o.alive = true
    }

    let n = 0
    for (const o of orders) {
      if (!o.alive) {
        dummy.scale.setScalar(0.0001)
        dummy.updateMatrix()
        mesh.current.setMatrixAt(n++, dummy.matrix)
        continue
      }
      o.t += o.speed * d * 0.85
      if (o.t >= 1) { o.alive = false }

      const laneY = (o.lane - (LANES - 1) / 2) * 1.05
      // Orders converge on x = 0, the matching plane.
      const x = o.side * (1 - o.t) * 7.5
      // Vertical settle into the price ladder near the match.
      const y = laneY * (1 - o.t * 0.55) + Math.sin(o.t * Math.PI) * 0.14 * o.side
      const z = (o.lane - 1.5) * 0.5

      dummy.position.set(x, y, z)
      dummy.rotation.set(0, 0, o.side * (1 - o.t) * 0.5)
      // Flash at the moment of match.
      const flash = o.t > 0.93 ? 2.6 : 1
      dummy.scale.set(o.size * 3.4 * flash, o.size * flash, o.size * flash)
      dummy.updateMatrix()
      mesh.current.setMatrixAt(n, dummy.matrix)

      color.set(LANE_COLORS[o.lane])
      if (o.t > 0.93) color.lerp(MATCH, 0.75)
      // Travel dims the ends of the run rather than brightening the
      // middle: the old 1.25x peak pushed every lane toward the page.
      color.multiplyScalar(0.35 + (1 - Math.abs(o.t - 0.5) * 2) * 0.65)
      mesh.current.setColorAt(n, color)
      n++
    }
    mesh.current.count = MAX
    mesh.current.instanceMatrix.needsUpdate = true
    if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true
    ;(mesh.current.material as THREE.MeshBasicMaterial).opacity = opacity.current * 0.6

    // The DOM canvas owns this chapter; the 3D streams sit far behind
    // it as depth, not as a second diagram competing for attention.
    group.current.position.set(0, 0, -9)
    group.current.scale.setScalar(LANES_SCALE)
    group.current.rotation.y = damp(group.current.rotation.y, -0.34 + frame.pointerX * 0.26, 2.6, d)
    group.current.rotation.x = damp(group.current.rotation.x, frame.pointerY * 0.12, 2.6, d)
  })

  return (
    <group ref={group}>
      <instancedMesh ref={mesh} args={[undefined, undefined, MAX]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial transparent opacity={0} toneMapped={false} />
      </instancedMesh>

      {/* The matching plane — a ruled hairline, since the thing every
          lane converges on cannot be the same colour as the page. */}
      <mesh position={[0, 0, -0.4]}>
        <planeGeometry args={[0.012, 5.2]} />
        <meshBasicMaterial color="#3a3a3e" transparent opacity={0.55} />
      </mesh>
    </group>
  )
}
