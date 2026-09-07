'use client'

import { Suspense, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { Core } from '@/experience/core/Core'
import { SceneManager } from '@/experience/scenes/SceneManager'
import { JourneyCamera } from '@/experience/camera/JourneyCamera'
import { useJourney, frame } from '@/state/journey'
import { detectDevice, createFpsWatchdog } from '@/lib/perf'
import styles from './GlobalCanvas.module.css'

const PAPER = new THREE.Color('#f4f2ee')
const VOID = new THREE.Color('#0a0a0b')
const bg = new THREE.Color()

/**
 * The world's ground colour follows the chapter theme. Driven
 * through the clear colour rather than `scene.background` so it
 * is unaffected by tone mapping — the light chapters have to be
 * exactly the paper colour the DOM is using, or the seam shows.
 */
function WorldBackground() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined') {
    ;(window as unknown as { __scene?: THREE.Scene }).__scene = scene
  }

  useFrame(() => {
    bg.copy(PAPER).lerp(VOID, frame.darkness)
    gl.setClearColor(bg, 1)
  }, -1)

  return null
}

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
  const playgroundActive = useJourney((s) => s.playgroundActive)
  const [contextLost, setContextLost] = useState(false)

  return (
    <div
      className={styles.canvasHost}
      aria-hidden="true"
      data-interactive={playgroundActive ? 'true' : 'false'}
    >
      {!contextLost && (
        <Canvas
          gl={{
            antialias: device.tier !== 'low',
            alpha: false,
            powerPreference: 'high-performance',
            stencil: false,
            depth: true,
          }}
          dpr={device.dpr}
          camera={{ position: [0, 0, 7], fov: 42, near: 0.1, far: 400 }}
          frameloop={reducedMotion ? 'demand' : 'always'}
          onCreated={({ gl }) => {
            // No tone mapping: this is a flat, editorial world, not a
            // photographic one, and ACES would pull the paper colour
            // away from the DOM's --paper token.
            gl.toneMapping = THREE.NoToneMapping
            gl.setClearColor(PAPER, 1)
            if (process.env.NODE_ENV === 'development') {
              const w = window as unknown as { __frame?: typeof frame; __gl?: THREE.WebGLRenderer }
              w.__frame = frame
              w.__gl = gl
            }
            const el = gl.domElement
            el.addEventListener('webglcontextlost', (e) => {
              e.preventDefault()
              setContextLost(true)
            })
          }}
        >
          <WorldBackground />
          <JourneyCamera />
          <FpsGovernor />
          <ambientLight intensity={0.5} />
          <directionalLight position={[4, 6, 5]} intensity={1.1} />
          <directionalLight position={[-5, -2, 3]} intensity={0.32} color="#9fb4c9" />
          <Suspense fallback={null}>
            <Core />
            <SceneManager />
          </Suspense>
        </Canvas>
      )}
    </div>
  )
}
