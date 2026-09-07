'use client'

import { useMemo, useRef, useEffect, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { frame, useJourney } from '@/state/journey'
import { readChapterProgress } from '@/hooks/useChapterProgress'
import { detectDevice } from '@/lib/perf'
import { clamp, damp, range, seeded } from '@/lib/math'

/* ============================================================
   UNIVERSITY PLAYGROUND
   The timeline becomes ground and the Core becomes a rover the
   visitor can drive. Installations stand for early projects.
   Deliberately optional: the chapter scrolls past on its own,
   and CONTINUE JOURNEY is always one scroll away.

   Physics is a small hand-rolled car model — no engine, because
   a 400 KB physics dependency for one chapter is not a trade
   worth making.
   ============================================================ */

export interface Installation {
  slug: string
  label: string
  type: string
  stack: string
  x: number
  z: number
  /** Which procedural structure is built at this site. */
  form: 'maze' | 'orbit' | 'cards' | 'grid' | 'ticker' | 'voxel' | 'board'
}

export const INSTALLATIONS: Installation[] = [
  { slug: 'labyrinth',        label: 'LABYRINTH',       type: 'Search algorithms', stack: 'JS · Canvas',       x: -11, z: -6,  form: 'maze' },
  { slug: 'three-body-problem', label: 'THREE BODY',    type: 'Physics simulation', stack: 'JS · Verlet',      x: 10,  z: -9,  form: 'orbit' },
  { slug: 'cinquillo-fair-variant', label: 'CINQUILLO 2.0', type: 'Game AI research', stack: 'Python · MCTS · RL', x: -4, z: -14, form: 'cards' },
  { slug: 'dots-and-boxes',   label: 'DOTS & BOXES',    type: 'Game variant',      stack: 'JS · Canvas',       x: 5,   z: 6,   form: 'grid' },
  { slug: 'stock-market-simulator', label: 'ORDER BOOK', type: 'Concurrency',      stack: 'Java · Threads',    x: 14,  z: 3,   form: 'ticker' },
  { slug: 'minecraft-seeds',  label: 'SEED FINDER',     type: 'Procedural search', stack: 'Python · C',        x: -13, z: 7,   form: 'voxel' },
  { slug: 'chess-assistant',  label: 'CHESS',           type: 'Computer vision',   stack: 'TensorFlow · CV',   x: 0,   z: 12,  form: 'board' },
]

interface RoverState {
  x: number; z: number; heading: number; speed: number; steer: number
}

export function PlaygroundScene() {
  const device = useMemo(() => detectDevice(), [])
  const group = useRef<THREE.Group>(null!)
  const rover = useRef<THREE.Group>(null!)
  const ground = useRef<THREE.Mesh>(null!)
  const trailRef = useRef<THREE.Points>(null!)
  const setPlaygroundActive = useJourney((s) => s.setPlaygroundActive)
  const setActiveProject = useJourney((s) => s.setActiveProject)
  const [near, setNear] = useState<Installation | null>(null)

  const state = useRef<RoverState>({ x: 0, z: 4, heading: 0, speed: 0, steer: 0 })
  const keys = useRef<Record<string, boolean>>({})
  const touch = useRef({ x: 0, y: 0 })
  const opacity = useRef(0)

  /* ---- input ---------------------------------------------- */
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase()
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
        if (useJourney.getState().playgroundActive) e.preventDefault()
        keys.current[k] = true
      }
      if (k === 'e' && useJourney.getState().playgroundActive) {
        const n = nearestRef.current
        if (n) setActiveProject(n.slug)
      }
    }
    const up = (e: KeyboardEvent) => { keys.current[e.key.toLowerCase()] = false }
    const blur = () => { keys.current = {} }
    window.addEventListener('keydown', down, { passive: false })
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)

    const touchHandler = (e: Event) => {
      const d = (e as CustomEvent<{ x: number; y: number }>).detail
      touch.current.x = d.x
      touch.current.y = d.y
    }
    window.addEventListener('playground:touch', touchHandler)

    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
      window.removeEventListener('playground:touch', touchHandler)
    }
  }, [setActiveProject])

  const nearestRef = useRef<Installation | null>(null)

  /* ---- procedural installations --------------------------- */
  const installGeo = useMemo(() => {
    const rand = seeded(4242)
    return INSTALLATIONS.map((inst) => {
      const parts: { p: [number, number, number]; s: [number, number, number]; r: number }[] = []
      const N = device.tier === 'low' ? 10 : 22
      for (let i = 0; i < N; i++) {
        switch (inst.form) {
          case 'maze': {
            const gx = (i % 5) - 2
            const gz = Math.floor(i / 5) - 2
            if (rand() < 0.35) break
            parts.push({ p: [gx * 0.9, 0.45, gz * 0.9], s: [0.12, 0.9, 0.9], r: rand() < 0.5 ? 0 : Math.PI / 2 })
            break
          }
          case 'orbit': {
            const a = (i / N) * Math.PI * 2
            const r = 1.4 + (i % 3) * 0.6
            parts.push({ p: [Math.cos(a) * r, 0.7 + Math.sin(a * 2) * 0.4, Math.sin(a) * r], s: [0.14, 0.14, 0.14], r: 0 })
            break
          }
          case 'cards': {
            parts.push({ p: [(i % 6) * 0.42 - 1.1, 0.1 + Math.floor(i / 6) * 0.06, Math.floor(i / 6) * 0.5 - 0.6], s: [0.34, 0.02, 0.5], r: (rand() - 0.5) * 0.35 })
            break
          }
          case 'grid': {
            const gx = (i % 5) - 2
            const gz = Math.floor(i / 5) - 2
            parts.push({ p: [gx * 0.7, 0.06, gz * 0.7], s: [0.08, 0.12, 0.08], r: 0 })
            break
          }
          case 'ticker': {
            parts.push({ p: [(i - N / 2) * 0.26, 0.2 + rand() * 1.5, 0], s: [0.16, 0.4 + rand() * 1.1, 0.16], r: 0 })
            break
          }
          case 'voxel': {
            parts.push({ p: [(i % 4) * 0.55 - 0.8, 0.28 + Math.floor(rand() * 3) * 0.5, Math.floor(i / 4) * 0.55 - 0.8], s: [0.5, 0.5, 0.5], r: 0 })
            break
          }
          case 'board': {
            const gx = i % 8
            const gz = Math.floor(i / 8)
            parts.push({ p: [gx * 0.36 - 1.26, 0.02, gz * 0.36 - 1.26], s: [0.34, 0.03, 0.34], r: 0 })
            break
          }
        }
      }
      return { inst, parts }
    })
  }, [device.tier])

  /* ---- rover trail ---------------------------------------- */
  const TRAIL = 90
  const trail = useMemo(() => new Float32Array(TRAIL * 3), [])
  const trailIdx = useRef(0)

  useFrame((_, dt) => {
    const d = Math.min(0.05, dt)
    const t = readChapterProgress('playground')
    const active = t > 0.02 && t < 0.98

    const vis = Math.min(range(t, 0, 0.1), 1 - range(t, 0.9, 1))
    opacity.current = damp(opacity.current, clamp(vis), 4, d)
    group.current.visible = opacity.current > 0.005
    if (!group.current.visible) return

    if (useJourney.getState().playgroundActive !== active) setPlaygroundActive(active)

    /* ---- car model: acceleration, steering, drag ---------- */
    const s = state.current
    const k = keys.current
    const fwd = (k['w'] || k['arrowup'] ? 1 : 0) - (k['s'] || k['arrowdown'] ? 1 : 0) + (-touch.current.y)
    const turn = (k['a'] || k['arrowleft'] ? 1 : 0) - (k['d'] || k['arrowright'] ? 1 : 0) + (-touch.current.x)

    s.speed += fwd * 14 * d
    s.speed *= Math.pow(0.06, d)                  // drag
    s.speed = clamp(s.speed, -5, 9)
    s.steer = damp(s.steer, turn * 2.3, 9, d)
    // Steering authority scales with speed — feels like a vehicle.
    s.heading += s.steer * d * clamp(Math.abs(s.speed) / 3, 0, 1)
    s.x += Math.sin(s.heading) * s.speed * d
    s.z += Math.cos(s.heading) * s.speed * d
    s.x = clamp(s.x, -19, 19)
    s.z = clamp(s.z, -19, 19)

    frame.roverX = s.x
    frame.roverZ = s.z
    frame.roverHeading = s.heading

    rover.current.position.set(s.x, 0.28, s.z)
    rover.current.rotation.y = s.heading
    rover.current.rotation.z = damp(rover.current.rotation.z, -s.steer * 0.11, 8, d)
    rover.current.rotation.x = damp(rover.current.rotation.x, -clamp(s.speed / 40, -0.1, 0.1), 8, d)

    /* ---- trail -------------------------------------------- */
    trailIdx.current = (trailIdx.current + 1) % TRAIL
    trail[trailIdx.current * 3] = s.x
    trail[trailIdx.current * 3 + 1] = 0.05
    trail[trailIdx.current * 3 + 2] = s.z
    const attr = trailRef.current.geometry.getAttribute('position') as THREE.BufferAttribute
    attr.needsUpdate = true
    ;(trailRef.current.material as THREE.PointsMaterial).opacity = opacity.current * 0.35

    /* ---- proximity ---------------------------------------- */
    let found: Installation | null = null
    let best = 4.2
    for (const inst of INSTALLATIONS) {
      const dist = Math.hypot(inst.x - s.x, inst.z - s.z)
      if (dist < best) { best = dist; found = inst }
    }
    if (found?.slug !== nearestRef.current?.slug) {
      nearestRef.current = found
      setNear(found)
      window.dispatchEvent(new CustomEvent('playground:near', { detail: found }))
    }

    ground.current.position.set(0, -0.02, 0)
    ;(ground.current.material as THREE.MeshBasicMaterial).opacity = opacity.current * 0.9
  })

  useEffect(() => () => { setPlaygroundActive(false) }, [setPlaygroundActive])
  void near

  return (
    <group ref={group}>
      {/* Ground plate */}
      <mesh ref={ground} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[46, 80]} />
        <meshBasicMaterial color="#e6e3dd" transparent opacity={0} />
      </mesh>
      <gridHelper args={[60, 60, '#cfcbc2', '#e2ded6']} position={[0, 0.001, 0]} />

      {/* Installations */}
      {installGeo.map(({ inst, parts }) => (
        <group key={inst.slug} position={[inst.x, 0, inst.z]}>
          {parts.map((part, i) => (
            <mesh key={i} position={part.p} rotation={[0, part.r, 0]}>
              <boxGeometry args={part.s} />
              <meshStandardMaterial color="#2a2a2e" roughness={0.75} metalness={0.05} />
            </mesh>
          ))}
          {/* Marker post so installations read from a distance. */}
          <mesh position={[0, 0.85, 0]}>
            <cylinderGeometry args={[0.012, 0.012, 1.7, 6]} />
            <meshBasicMaterial color="#d4491f" transparent opacity={0.55} />
          </mesh>
          <mesh position={[0, 0.006, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[2.7, 2.74, 64]} />
            <meshBasicMaterial color="#d4491f" transparent opacity={0.16} side={THREE.DoubleSide} />
          </mesh>
        </group>
      ))}

      {/* The Core, as a rover */}
      <group ref={rover}>
        <mesh castShadow>
          <boxGeometry args={[0.44, 0.2, 0.68]} />
          <meshStandardMaterial color="#1a1a1d" roughness={0.4} metalness={0.3} />
        </mesh>
        <mesh position={[0, 0.16, -0.04]}>
          <capsuleGeometry args={[0.13, 0.14, 4, 16]} />
          <meshStandardMaterial color="#d4491f" roughness={0.35} />
        </mesh>
        <mesh position={[0, 0.02, 0.4]}>
          <boxGeometry args={[0.3, 0.05, 0.14]} />
          <meshBasicMaterial color="#ffb08a" />
        </mesh>
        {[[-0.26, -0.08, 0.24], [0.26, -0.08, 0.24], [-0.26, -0.08, -0.24], [0.26, -0.08, -0.24]].map((p, i) => (
          <mesh key={i} position={p as [number, number, number]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.1, 0.1, 0.07, 12]} />
            <meshStandardMaterial color="#131316" roughness={0.9} />
          </mesh>
        ))}
      </group>

      <points ref={trailRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[trail, 3]} count={TRAIL} />
        </bufferGeometry>
        <pointsMaterial size={0.06} color="#d4491f" transparent opacity={0} sizeAttenuation depthWrite={false} />
      </points>
    </group>
  )
}
