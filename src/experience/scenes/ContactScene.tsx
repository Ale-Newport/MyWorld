'use client'

import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
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
   degrees, roles) returns as one particle in a single structure.
   The structure responds gravitationally to the pointer: the
   visitor can pull the body of work around. The ending mirrors
   the beginning — open space, now full of what was built in it.
   ============================================================ */

interface Body { home: THREE.Vector3; pos: THREE.Vector3; vel: THREE.Vector3; size: number; kind: number }

const dummy = new THREE.Object3D()
const color = new THREE.Color()
const pointer3 = new THREE.Vector3()
const tmp = new THREE.Vector3()

/* Value scale on white, in reading order: projects take the house
   accent, technologies a graphite, degrees and roles the secondary
   signal, and the filler motes the palest graphite the page will
   still hold. The last two were a mid grey and a near-white chosen
   against the void; on paper they were the difference between a dense
   structure and forty dots. */
const KIND_COLOR = ['#d4491f', '#6e6c67', '#2f6f5e', '#93908a']

/* Speed used to blend toward white, so the bodies the pointer pulls
   fastest dissolved into the background at exactly the moment the
   visitor made them move. On paper, energy is density: they burn in. */
const BURN = new THREE.Color('#151517')

/* ------------------------------------------------------------
   THE LAST FEW PER CENT

   The gateway at the foot of this chapter opens onto a place that
   is warm: sand and roads seen almost from above, a turquoise
   lagoon through them, whole-frame average #ad9272. The structure
   on this page is cool and graphite by design, and a body of work
   that hands over to the island without ever having been warmed
   reads as two sites rather than one place with a door in it.

   So a minority of the motes drift toward the island's own two
   colours over the last few per cent of the journey, and slow
   while they do it. It is the cheapest possible foreshadow: no
   new system, no asset, no second canvas — one more read of a
   progress figure this loop already had in its hand, in the scene
   that was already running at exactly this chapter.

   A MINORITY, deliberately. Every mote turning sand-coloured is a
   palette change, which is a different page; one in five is a
   drift, which is a hint that somewhere else exists.
   ------------------------------------------------------------ */
const ISLAND = [new THREE.Color('#f0c090'), new THREE.Color('#78c0c0')]
/** Where the warming starts, in whole-journey progress. */
const WARM_FROM = 0.958
/** One body in this many takes the island's colour. */
const WARM_EVERY = 5

export function ContactScene() {
  const device = useMemo(() => detectDevice(), [])
  const gl = useThree((s) => s.gl)
  const group = useRef<THREE.Group>(null!)
  const mesh = useRef<THREE.InstancedMesh>(null!)
  const opacity = useRef(0)
  const released = useRef(false)

  /* ============================================================
     HANDING THE GPU OVER

     /world2 builds a WebGLRenderer of its own and then parses
     thirteen megabytes of geometry into it. Unmounting a React
     tree disposes an R3F scene graph, but a renderer only truly
     gives its context back when it is told to, and browsers cap
     how many may be alive at once — so for the length of the
     route swap the homepage would be holding one context while
     the world asked for a second.

     The portal says when. It fires `journey:leaving` a beat
     before `router.push`, by which point the veil is opaque and
     every frame this scene would still draw is a frame nobody can
     see. This listener is here, in the scene that owns the canvas
     from the inside, because the alternative is reaching into
     GlobalCanvas from a chapter — and the canvas belongs to the
     journey, not to the gateway.

     A custom event rather than an import: this scene lives in the
     R3F reconciler, which no DOM context crosses, and the page
     already speaks this idiom (`universe:filter`, `toolbox:hover`).
     ============================================================ */
  useEffect(() => {
    const leave = () => {
      if (released.current) return
      released.current = true
      if (group.current) group.current.visible = false
      /* `dispose()` frees what three.js allocated; the context
         itself is only handed back by the extension, and a browser
         that does not expose it simply keeps the context until the
         tree unmounts a moment later — which is the behaviour this
         is an improvement over, not a requirement of. */
      gl.dispose()
      const lose = gl.getContext().getExtension('WEBGL_lose_context')
      lose?.loseContext()
    }
    window.addEventListener('journey:leaving', leave)
    return () => window.removeEventListener('journey:leaving', leave)
  }, [gl])

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
    if (released.current) return
    const d = Math.min(0.04, dt)
    const t = readChapterProgress('contact')
    opacity.current = damp(opacity.current, clamp(range(t, 0, 0.16)), 3, d)
    group.current.visible = opacity.current > 0.004
    if (!group.current.visible) return

    // Reassembly strength ramps across the chapter.
    const gather = range(t, 0.05, 0.5)

    /* How near the gateway the page is, on the whole journey's own
       figure rather than this chapter's — the door is at the foot
       of the document, not at the end of the contact range. */
    const warm = range(frame.progress, WARM_FROM, 1)

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

      /* The chosen few slow to a drift as the gate approaches. It
         is the same damping the rest use, taken further: a mote
         that is about to become somewhere else should stop
         behaving like a particle in a structure. */
      const island = i % WARM_EVERY === 0 ? warm : 0
      b.vel.multiplyScalar(Math.pow(0.12 - island * 0.09, d))
      b.pos.addScaledVector(b.vel, d)

      dummy.position.copy(b.pos)
      dummy.rotation.set(frame.time * 0.1 + i, frame.time * 0.07, 0)
      dummy.scale.setScalar(b.size * (0.4 + gather * 0.6))
      dummy.updateMatrix()
      mesh.current.setMatrixAt(i, dummy.matrix)

      color.set(KIND_COLOR[b.kind])
      const speed = clamp(b.vel.length() * 0.35, 0, 1)
      color.lerp(BURN, speed * 0.55)
      // Sand or lagoon, alternating, and never all the way there:
      // 0.72 is a mote that has caught the light off somewhere
      // else, and 1 would be a mote that had already left.
      if (island > 0) color.lerp(ISLAND[(i / WARM_EVERY) % 2 === 0 ? 0 : 1], island * 0.72)
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
