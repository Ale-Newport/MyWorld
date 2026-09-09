'use client'

import { useMemo, useRef, useState, useCallback, useEffect } from 'react'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { frame, useJourney } from '@/state/journey'
import { readChapterProgress } from '@/hooks/useChapterProgress'
import { projects, categoryAccent } from '@/content/projects'
import { detectDevice } from '@/lib/perf'
import { clamp, range, damp, fibonacciSphere, seeded } from '@/lib/math'

/* ============================================================
   PROJECT UNIVERSE
   Every project the visitor has passed becomes a node in one
   constellation. Instanced — one draw call for the whole
   archive. Hover/tap raises a node; clicking opens its case
   study. Filters dim rather than remove, so the shape of the
   whole body of work stays legible.
   ============================================================ */

const NODES = projects.length

/* Scratch objects. Module scope, because these are pure scribble
   space reused every frame — allocating them per mount buys
   nothing and makes them look like state, which they are not. */
const dummy = new THREE.Object3D()
const color = new THREE.Color()

/* The page, as a colour. Every "quiet" state in this scene now moves
   toward it: on black, dimming meant multiplying a node down, but the
   same multiply on white makes the filtered-out nodes the darkest
   marks on screen — the loudest thing in a view that is asking them to
   step back. Receding here means approaching the paper. */
const PAPER = new THREE.Color('#ffffff')

export function UniverseScene() {
  const device = useMemo(() => detectDevice(), [])
  const mesh = useRef<THREE.InstancedMesh>(null!)
  const halo = useRef<THREE.InstancedMesh>(null!)
  const lines = useRef<THREE.LineSegments>(null!)
  const group = useRef<THREE.Group>(null!)

  const setActiveProject = useJourney((s) => s.setActiveProject)
  const universeFilter = useUniverseFilter()
  const [hovered, setHovered] = useState(-1)


  /* ---- layout: importance drives radius ------------------ */
  const layout = useMemo(() => {
    const rand = seeded(70707)
    return projects.map((p, i) => {
      const [x, y, z] = fibonacciSphere(i, NODES, 1)
      const r =
        p.importance === 'hero' ? 3.0 + rand() * 0.8
        : p.importance === 'featured' ? 6.0 + rand() * 1.6
        : 9.0 + rand() * 3.0
      const size =
        p.importance === 'hero' ? 0.30
        : p.importance === 'featured' ? 0.19
        : 0.115
      return {
        base: new THREE.Vector3(x * r, y * r * 0.72, z * r),
        size,
        drift: 0.2 + rand() * 0.5,
        phase: rand() * Math.PI * 2,
        // Category colour only. A client site's real brand colour is
        // meaningful inside its case study, but forty of them in one
        // constellation reads as a chart, not a body of work.
        color: new THREE.Color(categoryAccent[p.category]),
      }
    })
  }, [])

  /* ---- constellation edges: shared technology ------------ */
  const edgeGeometry = useMemo(() => {
    const pos: number[] = []
    for (let i = 0; i < projects.length; i++) {
      for (let j = i + 1; j < projects.length; j++) {
        const a = projects[i]
        const b = projects[j]
        if (a.category !== b.category) continue
        const d = layout[i].base.distanceTo(layout[j].base)
        if (d > 6.5) continue
        pos.push(...layout[i].base.toArray(), ...layout[j].base.toArray())
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    return g
  }, [layout])

  const opacity = useRef(0)

  useFrame((_, dt) => {
    const d = Math.min(0.05, dt)
    const t = readChapterProgress('universe')

    const vis = Math.min(range(t, 0.0, 0.14), 1 - range(t, 0.92, 1.0))
    opacity.current = damp(opacity.current, clamp(vis), 4, d)
    group.current.visible = opacity.current > 0.004
    if (!group.current.visible) return

    // Expansion: the archive opens outward as the chapter runs.
    const expand = 0.55 + range(t, 0.0, 0.7) * 0.55

    group.current.rotation.y = frame.time * 0.028 + frame.pointerX * 0.5
    group.current.rotation.x = damp(group.current.rotation.x, -frame.pointerY * 0.28, 2.5, d)

    for (let i = 0; i < NODES; i++) {
      const L = layout[i]
      const dim = universeFilter.matches[i] ? 1 : 0.16
      const isHover = i === hovered
      const pulse = 1 + Math.sin(frame.time * L.drift + L.phase) * 0.05

      dummy.position.copy(L.base).multiplyScalar(expand)
      dummy.position.y += Math.sin(frame.time * 0.35 + L.phase) * 0.09
      dummy.scale.setScalar(L.size * pulse * (isHover ? 1.9 : 1) * (0.35 + dim * 0.65))
      dummy.rotation.set(frame.time * 0.12 + L.phase, frame.time * 0.09, 0)
      dummy.updateMatrix()
      mesh.current.setMatrixAt(i, dummy.matrix)

      color.copy(L.color)
      // Hover deepens and saturates. Lifting lightness, as this did,
      // walks the hovered node toward the background on a white page.
      if (isHover) color.offsetHSL(0, 0.18, -0.12)
      if (!universeFilter.matches[i]) color.lerp(PAPER, 0.72)
      mesh.current.setColorAt(i, color)

      // Halo billboards give small nodes presence without extra draws.
      // On paper that presence is a soft aura in the node's own colour,
      // not a glow: it carries the node's dimming with it, so filtered
      // nodes shed their halo instead of gaining a dark ring.
      dummy.scale.multiplyScalar(1.9)
      dummy.rotation.set(0, 0, 0)
      dummy.updateMatrix()
      halo.current.setMatrixAt(i, dummy.matrix)
      halo.current.setColorAt(i, color)
    }
    mesh.current.instanceMatrix.needsUpdate = true
    halo.current.instanceMatrix.needsUpdate = true
    if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true
    if (halo.current.instanceColor) halo.current.instanceColor.needsUpdate = true

    const mat = mesh.current.material as THREE.MeshBasicMaterial
    mat.opacity = opacity.current
    const hmat = halo.current.material as THREE.MeshBasicMaterial
    hmat.opacity = opacity.current * 0.13
    const lmat = lines.current.material as THREE.LineBasicMaterial
    // 0.08 was an ink-on-void hairline. The same alpha in graphite on
    // white is nothing at all, and the shared-technology graph is the
    // only thing here saying the archive is one body of work.
    lmat.opacity = opacity.current * 0.22
    lines.current.scale.setScalar(expand)
  })

  /* ---- pointer -------------------------------------------- */
  const onMove = useCallback((e: ThreeEvent<PointerEvent>) => {
    if (e.instanceId === undefined) return
    setHovered(e.instanceId)
    document.body.style.setProperty('--universe-hover', String(e.instanceId))
    window.dispatchEvent(new CustomEvent('universe:hover', { detail: { index: e.instanceId } }))
  }, [])

  const onOut = useCallback(() => {
    setHovered(-1)
    window.dispatchEvent(new CustomEvent('universe:hover', { detail: { index: -1 } }))
  }, [])

  const onClick = useCallback((e: ThreeEvent<MouseEvent>) => {
    if (e.instanceId === undefined) return
    setActiveProject(projects[e.instanceId].slug)
  }, [setActiveProject])

  useEffect(() => () => { document.body.style.removeProperty('--universe-hover') }, [])

  const geoDetail = device.tier === 'low' ? 0 : 1

  return (
    <group ref={group}>
      <instancedMesh
        ref={mesh}
        args={[undefined, undefined, NODES]}
        onPointerMove={onMove}
        onPointerOut={onOut}
        onClick={onClick}
        frustumCulled={false}
      >
        <icosahedronGeometry args={[1, geoDetail]} />
        <meshBasicMaterial transparent opacity={0} toneMapped={false} />
      </instancedMesh>

      <instancedMesh ref={halo} args={[undefined, undefined, NODES]} frustumCulled={false}>
        <sphereGeometry args={[1, 8, 8]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} toneMapped={false} />
      </instancedMesh>

      <lineSegments ref={lines} geometry={edgeGeometry} frustumCulled={false}>
        <lineBasicMaterial color="#3f3f47" transparent opacity={0} depthWrite={false} />
      </lineSegments>
    </group>
  )
}

/** Filter state is owned by the DOM layer; the scene listens. */
function useUniverseFilter() {
  const [filter, setFilter] = useState('all')
  useEffect(() => {
    const h = (e: Event) => setFilter((e as CustomEvent<{ id: string }>).detail.id)
    window.addEventListener('universe:filter', h)
    return () => window.removeEventListener('universe:filter', h)
  }, [])

  const matches = useMemo(() => {
    if (filter === 'all') return projects.map(() => true)
    return projects.map((p) => {
      switch (filter) {
        case 'ai-ml': return p.category === 'ai-ml'
        case 'software': return p.category === 'software'
        case 'web': return p.category === 'web'
        case 'mobile': return p.category === 'mobile'
        case '3d': return p.category === '3d'
        case 'university': return p.source === 'university' || p.category === 'university'
        case 'experiment': return p.category === 'experiment'
        case 'client': return p.source === 'client'
        default: return true
      }
    })
  }, [filter])

  return { filter, matches }
}
