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
      color.set(n.id === active ? '#ff7a4d' : '#8f8d88')
      if (active && n.id !== active) color.multiplyScalar(0.22)
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
      color.set(lit && active ? '#ffd7c4' : '#6c6a66')
      if (active && !lit) color.multiplyScalar(0.16)
      projMesh.current.setColorAt(i, color)
    }
    projMesh.current.instanceMatrix.needsUpdate = true
    if (projMesh.current.instanceColor) projMesh.current.instanceColor.needsUpdate = true

    // Edge colours: only evidence for the hovered technology stays lit.
    const cAttr = edgeGeometry.getAttribute('color') as THREE.BufferAttribute
    for (let i = 0; i < edgeData.length; i++) {
      const on = !active || techNodes[edgeData[i].ti].id === active
      const v = on ? (active ? 0.9 : 0.045) : 0.006
      for (let k = 0; k < 6; k += 3) {
        cAttr.array[i * 6 + k] = v
        cAttr.array[i * 6 + k + 1] = v * (on && active ? 0.5 : 1)
        cAttr.array[i * 6 + k + 2] = v * (on && active ? 0.32 : 1)
      }
    }
    cAttr.needsUpdate = true
    ;(edges.current.material as THREE.LineBasicMaterial).opacity = opacity.current * (active ? 0.9 : 0.5)
    ;(techMesh.current.material as THREE.MeshBasicMaterial).opacity = opacity.current
    ;(projMesh.current.material as THREE.MeshBasicMaterial).opacity = opacity.current

    // Above the chip grid, not through it. The chapter reads as two
    // stacked halves: the evidence graph, then the taxonomy that
    // indexes it. Overlapping them made both unreadable.
    group.current.position.set(0, 5.2, -6)
    group.current.scale.setScalar(0.48)
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
