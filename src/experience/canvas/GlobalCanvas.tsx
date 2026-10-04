'use client'

import { Suspense, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { SceneManager } from '@/experience/scenes/SceneManager'
import { JourneyCamera } from '@/experience/camera/JourneyCamera'
import { useJourney, frame } from '@/state/journey'
import { detectDevice, createFpsWatchdog } from '@/lib/perf'
import styles from './GlobalCanvas.module.css'

/**
 * The world's ground. The canvas clears to it at ZERO alpha: the
 * home journey's scrolled video sits beneath this layer and has to
 * show through, and everywhere else the DOM behind the canvas is
 * already this white. It still has to match `--bg-primary` in
 * tokens.css, because antialiased edges blend toward it. Set once,
 * as the clear colour rather than `scene.background`, which keeps
 * it clear of tone mapping.
 */
const GROUND = new THREE.Color('#f6f0e6')

function FpsGovernor() {
  const setTier = useJourney((s) => s.setPerformanceTier)
  const gl = useThree((s) => s.gl)
  const watchdog = useRef(
    createFpsWatchdog(() => {
      setTier('low')
      gl.setPixelRatio(1)
    }),
  )
  useFrame(() => watchdog.current.tick())
  return null
}

export function GlobalCanvas() {
  const [device] = useState(() => detectDevice())
  const reducedMotion = useJourney((s) => s.reducedMotion)
  const [contextLost, setContextLost] = useState(false)

  return (
    <div className={styles.canvasHost} aria-hidden="true">
      {!contextLost && (
        <Canvas
          gl={{
            antialias: device.tier !== 'low',
            alpha: true,
            powerPreference: 'high-performance',
            stencil: false,
            depth: true,
          }}
          dpr={device.dpr}
          camera={{ position: [0, 0, 7], fov: 42, near: 0.1, far: 400 }}
          frameloop={reducedMotion ? 'demand' : 'always'}
          onCreated={({ gl, scene }) => {
            // No tone mapping: this is a flat, editorial world, not a
            // photographic one, and ACES would pull the ground colour
            // away from the DOM's --bg-primary token.
            gl.toneMapping = THREE.NoToneMapping
            gl.setClearColor(GROUND, 0)
            if (process.env.NODE_ENV === 'development') {
              const w = window as unknown as {
                __frame?: typeof frame
                __gl?: THREE.WebGLRenderer
                __scene?: THREE.Scene
              }
              w.__frame = frame
              w.__gl = gl
              w.__scene = scene
            }
            const el = gl.domElement
            el.addEventListener('webglcontextlost', (e) => {
              e.preventDefault()
              setContextLost(true)
            })
          }}
        >
          <JourneyCamera />
          <FpsGovernor />
          <ambientLight intensity={0.5} />
          <directionalLight position={[4, 6, 5]} intensity={1.1} />
          <directionalLight position={[-5, -2, 3]} intensity={0.32} color="#9fb4c9" />
          <Suspense fallback={null}>
            <SceneManager />
          </Suspense>
        </Canvas>
      )}
    </div>
  )
}
