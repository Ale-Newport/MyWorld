'use client'

import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { frame, useJourney } from '@/state/journey'
import { coreVertex, coreFragment } from '@/experience/shaders/core'
import { damp, clamp } from '@/lib/math'
import { CORE_STATES, type CoreTransform } from './coreStates'

/**
 * THE CORE.
 * One persistent object for the entire journey. It never
 * unmounts; it morphs. Every chapter writes a target transform
 * and the Core damps toward it, so scrubbing backwards is
 * always continuous.
 */
const dummy = new THREE.Object3D()

export function Core() {
  const group = useRef<THREE.Group>(null!)
  const shell = useRef<THREE.Mesh>(null!)
  /* R3F clones the `uniforms` prop, so the shell's live material is
     the only thing worth writing to each frame. */
  const shellMat = useRef<THREE.ShaderMaterial>(null!)
  const ringA = useRef<THREE.Mesh>(null!)
  const ringB = useRef<THREE.Mesh>(null!)
  const shards = useRef<THREE.InstancedMesh>(null!)
  const target = useRef<CoreTransform>({ ...CORE_STATES.capsule })
  const current = useRef<CoreTransform>({ ...CORE_STATES.capsule })

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uMorph: { value: 0 },
      uEnergy: { value: 0 },
      uShatter: { value: 0 },
      uDarkness: { value: 0 },
      uAccent: { value: new THREE.Color('#d4491f') },
      uOpacity: { value: 1 },
    }),
    [],
  )

  const SHARDS = 24
  const shardSeeds = useMemo(
    () =>
      Array.from({ length: SHARDS }, (_, i) => ({
        r: 1.35 + (i % 5) * 0.3,
        a: (i / SHARDS) * Math.PI * 2 * 3.7,
        y: ((i % 7) / 7 - 0.5) * 1.8,
        s: 0.016 + ((i * 37) % 11) / 700,
        speed: 0.12 + ((i * 13) % 9) / 60,
      })),
    [],
  )

  useFrame((_, dt) => {
    const u = shellMat.current?.uniforms
    if (!u) return
    const d = Math.min(0.05, dt)
    const st = useJourney.getState()
    const next = CORE_STATES[st.coreState] ?? CORE_STATES.capsule
    target.current = next

    const c = current.current
    const k = 3.0
    c.scale = damp(c.scale, next.scale, k, d)
    c.x = damp(c.x, next.x, k, d)
    c.y = damp(c.y, next.y, k, d)
    c.z = damp(c.z, next.z, k, d)
    c.stretch = damp(c.stretch, next.stretch, k, d)
    c.spin = damp(c.spin, next.spin, k, d)
    c.ringSpread = damp(c.ringSpread, next.ringSpread, k, d)
    c.shatter = damp(c.shatter, next.shatter, k, d)
    c.opacity = damp(c.opacity, next.opacity, k * 1.6, d)
    c.tiltX = damp(c.tiltX, next.tiltX, k, d)

    const energy = clamp(Math.abs(frame.velocity) * 26, 0, 1)
    u.uTime.value = frame.time
    u.uEnergy.value = damp(u.uEnergy.value, energy, 4, d)
    u.uDarkness.value = frame.darkness
    u.uShatter.value = c.shatter
    u.uMorph.value = c.stretch * 0.5 + energy * 0.3
    u.uOpacity.value = c.opacity

    const g = group.current
    // Pointer parallax — the Core leans toward the cursor.
    g.position.set(
      c.x + frame.pointerX * 0.22,
      c.y + frame.pointerY * 0.16,
      c.z,
    )
    g.scale.setScalar(c.scale)
    g.rotation.y += d * (0.16 + c.spin * 0.9 + energy * 0.7)
    g.rotation.x = damp(g.rotation.x, c.tiltX + frame.pointerY * 0.14, 3, d)
    g.rotation.z = damp(g.rotation.z, -frame.pointerX * 0.1, 3, d)

    shell.current.scale.set(1, 1 + c.stretch, 1)

    // Rings open outward as the Core takes on structural roles.
    const rs = 1 + c.ringSpread
    ringA.current.scale.setScalar(rs)
    ringA.current.rotation.z += d * 0.4
    ringB.current.scale.setScalar(rs * 1.34)
    ringB.current.rotation.x += d * 0.26
    ringB.current.rotation.y -= d * 0.18
    const ringMatA = ringA.current.material as THREE.MeshBasicMaterial
    const ringMatB = ringB.current.material as THREE.MeshBasicMaterial
    const ringAlpha = c.opacity * (0.16 + c.ringSpread * 0.34)
    ringMatA.opacity = ringAlpha
    ringMatB.opacity = ringAlpha * 0.7
    const ringCol = frame.darkness > 0.5 ? 0.85 : 0.12
    ringMatA.color.setScalar(ringCol)
    ringMatB.color.setScalar(ringCol)

    // Orbiting shards — the Core's debris field / data satellites.
    const t = frame.time
    for (let i = 0; i < SHARDS; i++) {
      const s = shardSeeds[i]
      const ang = s.a + t * s.speed * (1 + c.ringSpread)
      const rad = s.r * (1 + c.ringSpread * 0.8)
      dummy.position.set(
        Math.cos(ang) * rad,
        s.y * (1 + c.ringSpread * 0.5) + Math.sin(t * 0.4 + i) * 0.06,
        Math.sin(ang) * rad,
      )
      dummy.rotation.set(ang * 1.7, ang, ang * 0.6)
      dummy.scale.setScalar(s.s * (0.6 + c.opacity * 0.8))
      dummy.updateMatrix()
      shards.current.setMatrixAt(i, dummy.matrix)
    }
    shards.current.instanceMatrix.needsUpdate = true
    const shardMat = shards.current.material as THREE.MeshBasicMaterial
    shardMat.opacity = c.opacity * 0.38
    shardMat.color.setScalar(frame.darkness > 0.5 ? 0.9 : 0.2)
  })

  return (
    <group ref={group}>
      {/* Shell: the recognisable silhouette — a capsule-monolith. */}
      <mesh ref={shell}>
        <capsuleGeometry args={[0.42, 0.86, 10, 56]} />
        <shaderMaterial
          ref={shellMat}
          vertexShader={coreVertex}
          fragmentShader={coreFragment}
          uniforms={uniforms}
          transparent
        />
      </mesh>

      {/* Equatorial ring — reads as instrumentation. */}
      <mesh ref={ringA} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.78, 0.0035, 3, 128]} />
        <meshBasicMaterial transparent opacity={0.22} />
      </mesh>
      <mesh ref={ringB} rotation={[Math.PI / 2.6, 0.4, 0]}>
        <torusGeometry args={[0.98, 0.0025, 3, 128]} />
        <meshBasicMaterial transparent opacity={0.15} />
      </mesh>

      <instancedMesh ref={shards} args={[undefined, undefined, 24]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial transparent opacity={0.5} />
      </instancedMesh>
    </group>
  )
}
