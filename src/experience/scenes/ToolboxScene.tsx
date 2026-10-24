'use client'

import { useMemo, useRef, useState, useEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { frame, useJourney } from '@/state/journey'
import { readChapterProgress } from '@/hooks/useChapterProgress'
import { currentContent } from '@/state/content'
import { IDLE, ambient, subscribe } from '@/lib/ticker'
import { clamp, damp, range, seeded } from '@/lib/math'

/* ============================================================
   TECH TOOLBOX — an evidence lattice.
   Technologies on an inner shell, projects on an outer shell,
   an edge for every real use. Hovering a technology in the DOM
   layer lights only the projects that actually used it.
   ============================================================ */

const dummy = new THREE.Object3D()

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
   No dimming: picking a technology only ever adds emphasis to it
            and to its evidence; everything else stays at rest. */
const EDGE_LIT = new THREE.Color('#d4491f')
const EDGE_RESTING = new THREE.Color('#8a8882')
// The instances' own colours, parsed once.
const TECH_REST = new THREE.Color('#5c5a56')
const TECH_ON = new THREE.Color('#d4491f')
const PROJ_REST = new THREE.Color('#6c6a66')
const PROJ_LIT = new THREE.Color('#e8734d')

/* The lattice is a watermark, not an animation worth sixty frames a second:
   on the home journey the canvas draws on demand (GlobalCanvas) and this
   scene asks for its own frames, this many a second, only while it is on
   stage or still fading. Its slowest motion is a rotation of a few degrees
   a second, and that is motion only there to be alive: once the visitor has
   been still for a while it slows to a stop (`ambient`, lib/ticker), the
   lattice stops asking for frames and, with the rest of the page at rest,
   the shared loop sleeps until the next input. */
const PULSE_HZ = 30

export function ToolboxScene() {
  const { techNodes, projects } = currentContent()
  const group = useRef<THREE.Group>(null!)
  const techMesh = useRef<THREE.InstancedMesh>(null!)
  const projMesh = useRef<THREE.InstancedMesh>(null!)
  const edges = useRef<THREE.LineSegments>(null!)
  const opacity = useRef(0)
  /* The lattice's own clock, which runs only while it turns: tied to the page's clock (`frame.time`) it would
     jump by however long the loop had slept the moment it woke. */
  const clock = useRef(0)
  const [active, setActive] = useState<string | null>(null)
  const invalidate = useThree((st) => st.invalidate)

  useEffect(() => {
    const h = (e: Event) => setActive((e as CustomEvent<{ id: string | null }>).detail.id)
    window.addEventListener('toolbox:hover', h)
    return () => window.removeEventListener('toolbox:hover', h)
  }, [])

  /* ---- frames on demand ------------------------------------ */
  useEffect(() => {
    let acc = 0
    return subscribe((dt, now) => {
      const st = useJourney.getState()
      // With motion reduced nothing here moves (and nothing ever asked for a frame).
      if (st.reducedMotion) return IDLE
      const r = st.ranges.find((x) => x.id === 'toolbox')
      const raw = r && r.end > r.start ? (frame.progress - r.start) / (r.end - r.start) : -1
      // From a little before the chapter, so the camera (which damps toward each chapter's shot) is
      // already there when the lattice starts to show. Away from it the lattice has nothing to ask for
      // and the shared loop is free to sleep.
      if (!((raw > -0.35 && raw < 1.05) || opacity.current > 0.005)) {
        acc = 0
        return IDLE
      }
      // Come to rest and nothing about to change it: what it last drew is what it shows. An input wakes it.
      if (ambient(now) === 0) {
        acc = 0
        return IDLE
      }
      acc += dt
      if (acc < 1 / PULSE_HZ - 0.002) return
      acc = 0
      invalidate()
    }, 'toolbox-lattice')
  }, [invalidate])

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
  }, [techNodes, projects])

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

  /* What picking a technology changes, worked out when it changes and not on
     every frame: which tile and which projects are emphasised, and the colours
     and edge colours that go with them. */
  const picked = useRef<{
    techNodes: unknown
    projects: unknown
    for: string | null | undefined
    techScale: Float32Array
    projLit: Uint8Array
  } | null>(null)

  useFrame((_, dt) => {
    const d = Math.min(0.05, dt)
    clock.current += d * ambient(performance.now())
    const time = clock.current
    const t = readChapterProgress('toolbox')
    const vis = Math.min(range(t, 0, 0.14), 1 - range(t, 0.9, 1))
    opacity.current = damp(opacity.current, clamp(vis), 4, d)
    group.current.visible = opacity.current > 0.005
    if (!group.current.visible) return

    /* Picking a technology EMPHASISES it and, when the wall shows
       its evidence at all, the projects and edges that prove it.
       Nothing else is faded: the other technologies keep their
       resting size and colour, exactly like the tiles above. */
    // Worked out again when the picked technology changes or the content does (the editor's live preview).
    let pick = picked.current
    if (!pick || pick.techNodes !== techNodes || pick.projects !== projects) {
      pick = picked.current = { techNodes, projects, for: undefined, techScale: new Float32Array(techNodes.length), projLit: new Uint8Array(projects.length) }
    }
    if (pick.for !== active) {
      pick.for = active
      const activeNode = active ? techNodes.find((n) => n.id === active) : null
      const showsEvidence = !!activeNode && (activeNode.showCount || activeNode.showNames)
      const litProjects = new Set(showsEvidence ? activeNode!.evidence : [])
      for (let i = 0; i < techNodes.length; i++) {
        const on = techNodes[i].id === active
        pick.techScale[i] = on ? 2.3 : 1
        techMesh.current.setColorAt(i, on ? TECH_ON : TECH_REST)
      }
      for (let i = 0; i < projects.length; i++) {
        const lit = litProjects.has(projects[i].id)
        pick.projLit[i] = lit ? 1 : 0
        projMesh.current.setColorAt(i, lit ? PROJ_LIT : PROJ_REST)
      }
      if (techMesh.current.instanceColor) techMesh.current.instanceColor.needsUpdate = true
      if (projMesh.current.instanceColor) projMesh.current.instanceColor.needsUpdate = true
      // Edge colours: the evidence of the picked technology lights up; every other edge stays at rest.
      const cAttr = edgeGeometry.getAttribute('color') as THREE.BufferAttribute
      for (let i = 0; i < edgeData.length; i++) {
        const c = showsEvidence && techNodes[edgeData[i].ti].id === active ? EDGE_LIT : EDGE_RESTING
        for (let k = 0; k < 6; k += 3) {
          cAttr.array[i * 6 + k] = c.r
          cAttr.array[i * 6 + k + 1] = c.g
          cAttr.array[i * 6 + k + 2] = c.b
        }
      }
      cAttr.needsUpdate = true
    }

    for (let i = 0; i < techNodes.length; i++) {
      const n = techNodes[i]
      dummy.position.copy(techPos[i])
      dummy.position.y += Math.sin(time * 0.4 + i) * 0.05
      dummy.scale.setScalar((0.055 + n.weight * 0.028) * pick.techScale[i])
      dummy.rotation.set(time * 0.2 + i, time * 0.14, 0)
      dummy.updateMatrix()
      techMesh.current.setMatrixAt(i, dummy.matrix)
    }
    techMesh.current.instanceMatrix.needsUpdate = true

    for (let i = 0; i < projects.length; i++) {
      const p = projects[i]
      dummy.position.copy(projPos[i])
      dummy.position.y += Math.sin(time * 0.3 + i * 1.7) * 0.06
      dummy.scale.setScalar((p.importance === 'hero' ? 0.11 : p.importance === 'featured' ? 0.07 : 0.045) * (pick.projLit[i] ? 1.3 : 1))
      dummy.rotation.set(0, time * 0.1, 0)
      dummy.updateMatrix()
      projMesh.current.setMatrixAt(i, dummy.matrix)
    }
    projMesh.current.instanceMatrix.needsUpdate = true

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
    group.current.rotation.y = time * 0.045 + frame.pointerX * 0.42
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
