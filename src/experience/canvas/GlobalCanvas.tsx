'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { SceneManager, scenesFor } from '@/experience/scenes/SceneManager'
import { JourneyCamera } from '@/experience/camera/JourneyCamera'
import { useJourney, frame } from '@/state/journey'
import { detectDevice, createFpsWatchdog } from '@/lib/perf'
import { subscribe } from '@/lib/ticker'
import { sceneRegionsVersion } from '@/experience/camera/regions'
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

/** One frame on demand whenever the set of mounted scenes changes, so a scene that leaves is cleared from the canvas. */
function Settle({ live }: { live: boolean }) {
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => { invalidate() }, [live, invalidate])
  return null
}

/* With motion reduced the canvas draws on demand, and for a long time
   nothing on the page made a demand: the copy scrolled on and the
   canvas kept showing whatever it last drew — the galaxy's sheet of
   points went on hanging behind the chess chapter. Nothing animates
   on this path, but the subjects still have to arrive and leave with
   their chapters and keep to their regions, so a frame is drawn
   whenever the scroll, the chapter or a region has moved. */
function DrawOnScroll({ active }: { active: boolean }) {
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => {
    if (!active) return
    let progress = -1
    let chapter = ''
    let regions = -1
    return subscribe(() => {
      const s = useJourney.getState()
      const v = sceneRegionsVersion()
      if (frame.progress === progress && s.chapter === chapter && v === regions) return
      progress = frame.progress
      chapter = s.chapter
      regions = v
      invalidate()
    })
  }, [active, invalidate])
  return null
}

/* Handing the GPU over: on the way into /world the portal fires
   `journey:leaving` once the leaves cover the page, and every frame
   this canvas would still draw is one nobody sees. The context goes
   back now rather than when React unmounts the tree a moment later,
   so the world's renderer never waits on ours. */
function ReleaseOnLeave() {
  const gl = useThree((s) => s.gl)
  useEffect(() => {
    const leave = () => {
      gl.dispose()
      gl.getContext().getExtension('WEBGL_lose_context')?.loseContext()
    }
    window.addEventListener('journey:leaving', leave)
    return () => window.removeEventListener('journey:leaving', leave)
  }, [gl])
  return null
}

export function GlobalCanvas() {
  const [device] = useState(() => detectDevice())
  const reducedMotion = useJourney((s) => s.reducedMotion)
  /* The canvas only draws continuously while a scene is mounted
     near the active chapter. Between them (most of the homepage,
     which has one scene) it holds still instead of clearing an
     empty full-screen frame sixty times a second over the room. */
  const live = useJourney((s) => scenesFor(s.chapter, s.journeyId).length > 0)
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
          frameloop={reducedMotion || !live ? 'demand' : 'always'}
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
          <Settle live={live} />
          <DrawOnScroll active={reducedMotion && live} />
          <ReleaseOnLeave />
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
