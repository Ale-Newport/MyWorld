'use client'

import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { frame, useJourney } from '@/state/journey'
import { fieldVertex, fieldFragment } from '@/experience/shaders/field'
import { detectDevice } from '@/lib/perf'
import { clamp, damp, seeded } from '@/lib/math'

/**
 * THE FIELD.
 * The measured ground the Core travels across through every
 * light chapter. It doubles as the career timeline: the spine
 * lights up behind the Core as the journey progresses.
 */
export function FieldScene() {
  const mesh = useRef<THREE.Mesh>(null!)
  /* See MetaviewScene: R3F clones `uniforms`, so writes go through
     the live material, not the memo. */
  const mat = useRef<THREE.ShaderMaterial>(null!)
  const motes = useRef<THREE.Points>(null!)
  const device = useMemo(() => detectDevice(), [])

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uDarkness: { value: 0 },
      uFade: { value: 0 },
      uAmp: { value: 0.35 },
      uAccent: { value: new THREE.Color('#d4491f') },
      uProgress: { value: 0 },
    }),
    [],
  )

  // Airborne dust — gives the light world depth without weight.
  const { positions, count } = useMemo(() => {
    const n = Math.round(620 * device.density)
    const rand = seeded(90210)
    const arr = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      arr[i * 3] = (rand() - 0.5) * 60
      arr[i * 3 + 1] = (rand() - 0.5) * 24
      arr[i * 3 + 2] = (rand() - 0.5) * 40
    }
    return { positions: arr, count: n }
  }, [device.density])

  const moteMat = useRef<THREE.PointsMaterial>(null!)

  useFrame((_, dt) => {
    const u = mat.current?.uniforms
    if (!u) return
    const d = Math.min(0.05, dt)
    const s = useJourney.getState()
    u.uTime.value = frame.time
    u.uDarkness.value = frame.darkness
    u.uProgress.value = frame.progress

    // The field fades in as the story leaves the prelude and out
    // as it enters the dark chapters.
    const lightChapter = ['prelude', 'about', 'kcl', 'pansofia', 'teaching', 'focus', 'gym', 'ucl'].includes(s.chapter)
    const preludeFade = s.chapter === 'prelude' ? clamp((frame.progress - 0.004) * 90) : 1
    const target = lightChapter ? preludeFade : 0
    u.uFade.value = damp(u.uFade.value, target, 2.2, d)
    u.uAmp.value = damp(u.uAmp.value, 0.3 + Math.abs(frame.velocity) * 6, 3, d)

    mesh.current.visible = u.uFade.value > 0.01
    if (motes.current) {
      motes.current.rotation.y += d * 0.012
      motes.current.position.x = -frame.pointerX * 0.9
      motes.current.position.y = -frame.pointerY * 0.6
      if (moteMat.current) {
        moteMat.current.opacity = u.uFade.value * 0.18
        moteMat.current.color.setScalar(frame.darkness > 0.5 ? 0.85 : 0.25)
      }
      motes.current.visible = u.uFade.value > 0.01
    }
  })

  return (
    <group>
      <mesh ref={mesh} rotation={[-Math.PI / 2, 0, 0]} position={[0, -4.1, 0]}>
        <planeGeometry args={[80, 70, 1, 1]} />
        <shaderMaterial
          ref={mat}
          vertexShader={fieldVertex}
          fragmentShader={fieldFragment}
          uniforms={uniforms}
          transparent
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      <points ref={motes}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} count={count} />
        </bufferGeometry>
        <pointsMaterial ref={moteMat} size={0.035} transparent opacity={0.3} sizeAttenuation depthWrite={false} />
      </points>
    </group>
  )
}
