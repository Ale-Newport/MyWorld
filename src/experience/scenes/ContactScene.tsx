'use client'

import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { frame } from '@/state/journey'
import { readChapterProgress } from '@/hooks/useChapterProgress'
import { projects } from '@/content/projects'
import { techNodes } from '@/content/skills'
import { education } from '@/content/education'
import { experience } from '@/content/experience'
import { detectDevice } from '@/lib/perf'
import { clamp, damp, range, seeded, fibonacciSphere } from '@/lib/math'

/* ============================================================
   FINALE — the whole system, reassembled.
   Every entity the visitor passed (projects, technologies,
   degrees, roles) returns as one particle in a single structure
   around the Core. The structure responds gravitationally to
   the pointer: the visitor can pull the body of work around.
   The ending mirrors the beginning — one object, now surrounded
   by everything it built.
   ============================================================ */

interface Body { home: THREE.Vector3; pos: THREE.Vector3; vel: THREE.Vector3; size: number; kind: number }

const dummy = new THREE.Object3D()
const color = new THREE.Color()
const WHITE = new THREE.Color('#ffffff')
const pointer3 = new THREE.Vector3()
const tmp = new THREE.Vector3()

const KIND_COLOR = ['#d4491f', '#8d8b86', '#2f6f5e', '#c9c7c2']

export function ContactScene() {
  const device = useMemo(() => detectDevice(), [])
  const group = useRef<THREE.Group>(null!)
  const mesh = useRef<THREE.InstancedMesh>(null!)
  const opacity = useRef(0)

  /* One entity per real thing in the story, plus filler motes
     scaled by device tier so the structure reads as dense. */
  const bodies = useMemo<Body[]>(() => {
    const rand = seeded(112358)
    const entities: { size: number; kind: number }[] = [
      ...projects.map((p) => ({ size: p.importance === 'hero' ? 0.19 : p.importance === 'featured' ? 0.12 : 0.075, kind: 0 })),
      ...techNodes.map(() => ({ size: 0.055, kind: 1 })),
      ...education.map(() => ({ size: 0.22, kind: 2 })),
      ...experience.map(() => ({ size: 0.2, kind: 2 })),
    ]
    const filler = Math.round(340 * device.density)
    for (let i = 0; i < filler; i++) entities.push({ size: 0.018 + rand() * 0.026, kind: 3 })

    return entities.map((e, i) => {
      const [x, y, z] = fibonacciSphere(i, entities.length, 1)
      const shell = e.kind === 2 ? 2.6 : e.kind === 0 ? 4.4 + rand() * 1.6 : e.kind === 1 ? 6.6 + rand() * 1.2 : 8 + rand() * 5
      const home = new THREE.Vector3(x * shell, y * shell * 0.78, z * shell)
      return { home, pos: home.clone().multiplyScalar(4 + rand() * 6), vel: new THREE.Vector3(), size: e.size, kind: e.kind }
    })
  }, [device.density])

  useFrame((_, dt) => {
    const d = Math.min(0.04, dt)
    const t = readChapterProgress('contact')
    opacity.current = damp(opacity.current, clamp(range(t, 0, 0.16)), 3, d)
    group.current.visible = opacity.current > 0.004
    if (!group.current.visible) return

    // Reassembly strength ramps across the chapter.
    const gather = range(t, 0.05, 0.5)

    // Pointer becomes a gravity well in world space.
    pointer3.set(frame.pointerX * 7.5, frame.pointerY * 5, 2.2)

    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i]

      // Spring toward home position — the structure re-forms.
      tmp.copy(b.home).sub(b.pos).multiplyScalar(2.4 * gather)
      b.vel.add(tmp.multiplyScalar(d))

      // Pointer gravity, inverse-square with softening.
      tmp.copy(pointer3).sub(b.pos)
      const dist2 = tmp.lengthSq() + 2.2
      tmp.normalize().multiplyScalar((5.5 / dist2) * d * 12)
      b.vel.add(tmp)

      b.vel.multiplyScalar(Math.pow(0.12, d))
      b.pos.addScaledVector(b.vel, d)

      dummy.position.copy(b.pos)
      dummy.rotation.set(frame.time * 0.1 + i, frame.time * 0.07, 0)
      dummy.scale.setScalar(b.size * (0.4 + gather * 0.6))
      dummy.updateMatrix()
      mesh.current.setMatrixAt(i, dummy.matrix)

      color.set(KIND_COLOR[b.kind])
      const speed = clamp(b.vel.length() * 0.35, 0, 1)
      color.lerp(WHITE, speed * 0.55)
      mesh.current.setColorAt(i, color)
    }
    mesh.current.instanceMatrix.needsUpdate = true
    if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true
    ;(mesh.current.material as THREE.MeshBasicMaterial).opacity = opacity.current

    group.current.rotation.y = frame.time * 0.02
  })

  return (
    <group ref={group}>
      <instancedMesh ref={mesh} args={[undefined, undefined, bodies.length]} frustumCulled={false}>
        <icosahedronGeometry args={[1, 0]} />
        <meshBasicMaterial transparent opacity={0} toneMapped={false} />
      </instancedMesh>
    </group>
  )
}
