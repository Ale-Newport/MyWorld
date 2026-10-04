'use client'

import { useMemo, useRef, useState, useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { frame } from '@/state/journey'
import { readChapterProgress } from '@/hooks/useChapterProgress'
import { techNodes } from '@/content/skills'
import { projects } from '@/content/projects'
import { clamp, damp, range, seeded } from '@/lib/math'

/* ============================================================
   TECH TOOLBOX — an evidence lattice.
   Technologies on an inner shell, projects on an outer shell,
   an edge for every real use. Hovering a technology in the DOM
   layer lights only the projects that actually used it.
   ============================================================ */

const dummy = new THREE.Object3D()
const color = new THREE.Color()

/* Value scale, rebuilt for paper.
   Nodes    resting graphite, hovered technology in the house accent,
            the evidence it lights in the soft accent one step down.
   Edges    a luminance ramp that used to run 0.006 (off) to 0.9 (lit)
            straight into a vertexColors line material. On black those
            low numbers were a whisper; on white they are near-black,
            so the resting lattice drew LOUDER than the highlight it
            was meant to sit behind. The ramp is now three explicit
            colours running the other way — quiet is close to the page,
            lit is the accent.
   Dimming  approaches the paper rather than multiplying toward black,
            for the same reason. */
const PAPER = new THREE.Color('#ffffff')
const EDGE_LIT = new THREE.Color('#d4491f')
const EDGE_RESTING = new THREE.Color('#8a8882')
const EDGE_MUTED = new THREE.Color('#e4e2dd')

export function ToolboxScene() {
  const group = useRef<THREE.Group>(null!)
  const techMesh = useRef<THREE.InstancedMesh>(null!)
  const projMesh = useRef<THREE.InstancedMesh>(null!)
  const edges = useRef<THREE.LineSegments>(null!)
  const opacity = useRef(0)
  const [active, setActive] = useState<string | null>(null)

  useEffect(() => {
    const h = (e: Event) => setActive((e as CustomEvent<{ id: string | null }>).detail.id)
    window.addEventListener('toolbox:hover', h)
    return () => window.removeEventListener('toolbox:hover', h)
  }, [])

  /* ---- positions ------------------------------------------ */
  const { techPos, projPos, edgeData } = useMemo(() => {
    const rand = seeded(8181)
    const tp = techNodes.map((_, i) => {
      const a = (i / techNodes.length) * Math.PI * 2
      const y = ((i % 7) / 7 - 0.5) * 4.2
      const r = 2.8 + (i % 3) * 0.22
      return new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r)
    })
    const pp = projects.map((_, i) => {
      const a = (i / projects.length) * Math.PI * 2 + 0.4
      const y = ((i % 9) / 9 - 0.5) * 6.4
      const r = 6.2 + rand() * 1.2
      return new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r)
    })
    const ed: { ti: number; pi: number }[] = []
    techNodes.forEach((t, ti) => {
      t.evidence.forEach((pid) => {
        const pi = projects.findIndex((p) => p.id === pid)
        if (pi >= 0) ed.push({ ti, pi })
      })
    })
    return { techPos: tp, projPos: pp, edgeData: ed }
  }, [])

  const edgeGeometry = useMemo(() => {
    const pos = new Float32Array(edgeData.length * 6)
    edgeData.forEach((e, i) => {
      techPos[e.ti].toArray(pos, i * 6)
      projPos[e.pi].toArray(pos, i * 6 + 3)
    })
    const colors = new Float32Array(edgeData.length * 6)
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    return g
  }, [edgeData, techPos, projPos])

  useFrame((_, dt) => {
    const d = Math.min(0.05, dt)
    const t = readChapterProgress('toolbox')
    const vis = Math.min(range(t, 0, 0.14), 1 - range(t, 0.9, 1))
    opacity.current = damp(opacity.current, clamp(vis), 4, d)
    group.current.visible = opacity.current > 0.005
    if (!group.current.visible) return

    const activeNode = active ? techNodes.find((n) => n.id === active) : null
    const litProjects = new Set(activeNode?.evidence ?? [])

    for (let i = 0; i < techNodes.length; i++) {
      const n = techNodes[i]
      const on = !active || n.id === active
      dummy.position.copy(techPos[i])
      dummy.position.y += Math.sin(frame.time * 0.4 + i) * 0.05
      const s = (0.055 + n.weight * 0.028) * (n.id === active ? 2.3 : 1) * (on ? 1 : 0.42)
      dummy.scale.setScalar(s)
      dummy.rotation.set(frame.time * 0.2 + i, frame.time * 0.14, 0)
      dummy.updateMatrix()
      techMesh.current.setMatrixAt(i, dummy.matrix)
      color.set(n.id === active ? '#d4491f' : '#5c5a56')
      if (active && n.id !== active) color.lerp(PAPER, 0.72)
      techMesh.current.setColorAt(i, color)
    }
    techMesh.current.instanceMatrix.needsUpdate = true
    if (techMesh.current.instanceColor) techMesh.current.instanceColor.needsUpdate = true

    for (let i = 0; i < projects.length; i++) {
      const p = projects[i]
      const lit = !active || litProjects.has(p.id)
      dummy.position.copy(projPos[i])
      dummy.position.y += Math.sin(frame.time * 0.3 + i * 1.7) * 0.06
      dummy.scale.setScalar((p.importance === 'hero' ? 0.11 : p.importance === 'featured' ? 0.07 : 0.045) * (lit ? 1.3 : 0.6))
      dummy.rotation.set(0, frame.time * 0.1, 0)
      dummy.updateMatrix()
      projMesh.current.setMatrixAt(i, dummy.matrix)
      color.set(lit && active ? '#e8734d' : '#6c6a66')
      if (active && !lit) color.lerp(PAPER, 0.82)
      projMesh.current.setColorAt(i, color)
    }
    projMesh.current.instanceMatrix.needsUpdate = true
    if (projMesh.current.instanceColor) projMesh.current.instanceColor.needsUpdate = true

    // Edge colours: only evidence for the hovered technology stays lit.
    const cAttr = edgeGeometry.getAttribute('color') as THREE.BufferAttribute
    for (let i = 0; i < edgeData.length; i++) {
      const on = !active || techNodes[edgeData[i].ti].id === active
      const c = !on ? EDGE_MUTED : active ? EDGE_LIT : EDGE_RESTING
      for (let k = 0; k < 6; k += 3) {
        cAttr.array[i * 6 + k] = c.r
        cAttr.array[i * 6 + k + 1] = c.g
        cAttr.array[i * 6 + k + 2] = c.b
      }
    }
    cAttr.needsUpdate = true
    // The DOM half of this chapter is now a wall of logo tiles that
    // fills the pinned screen, so there is no band left to stand the
    // graph in. It sits behind the wall instead, at watermark
    // strength — until a technology is picked, and then the edges
    // that prove it come forward. Hovering a tile is what lights the
    // lattice; the lattice is never competing with the tile.
    //
    // TWO SYSTEMS WERE ANSWERING ONE QUESTION
    // The lift used to run the edges from 0.10 to 0.55 in rust
    // rays, which drew a grey-and-vermilion scribble across
    // x 490–1180 / y 370–560 of a near-white page — and the vine
    // that now threads the wall's own gutters answers the same
    // hover in the grid's own space. Two answers to one question
    // is one too many, so the lift drops to about a third of what
    // it was: enough that the lattice is visibly the thing being
    // asked, quiet enough that it stays a watermark and the plant
    // is what the eye follows. The resting strengths are
    // untouched; only the `lit` terms move.
    const lit = active ? 1 : 0
    ;(edges.current.material as THREE.LineBasicMaterial).opacity = opacity.current * (0.1 + lit * 0.15)
    ;(techMesh.current.material as THREE.MeshBasicMaterial).opacity = opacity.current * (0.22 + lit * 0.17)
    ;(projMesh.current.material as THREE.MeshBasicMaterial).opacity = opacity.current * (0.22 + lit * 0.18)

    group.current.position.set(0, 0.4, -9)
    group.current.scale.setScalar(0.72)
    group.current.rotation.y = frame.time * 0.045 + frame.pointerX * 0.42
    group.current.rotation.x = damp(group.current.rotation.x, -frame.pointerY * 0.18, 2.4, d)
  })

  return (
    <group ref={group}>
      <lineSegments ref={edges} geometry={edgeGeometry} frustumCulled={false}>
        <lineBasicMaterial vertexColors transparent opacity={0} depthWrite={false} />
      </lineSegments>
      <instancedMesh ref={techMesh} args={[undefined, undefined, techNodes.length]} frustumCulled={false}>
        <octahedronGeometry args={[1, 0]} />
        <meshBasicMaterial transparent opacity={0} toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={projMesh} args={[undefined, undefined, projects.length]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial transparent opacity={0} toneMapped={false} />
      </instancedMesh>
    </group>
  )
}
