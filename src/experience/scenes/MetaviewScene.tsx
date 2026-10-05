'use client'

import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { frame, useJourney } from '@/state/journey'
import { readChapterProgress } from '@/hooks/useChapterProgress'
import { detectDevice } from '@/lib/perf'
import { clamp, range, seeded, damp } from '@/lib/math'
import { lens, readSceneRegion } from '@/experience/camera/regions'

/* ============================================================
   METAVIEW — 500,000 documents become an embedding space.
   Beat 1  documents ignite as a flat sheet of points
   Beat 2  the sheet folds into a clustered galaxy
   Beat 3  a query enters, travels, and lights its neighbours
   Beat 4  retrieved context streams into the model

   The whole motion keeps to the chapter's design frame (1.3 : 1,
   see FRAMES in JourneyCamera), which the camera fits into the
   region the chapter lays out for it. The figures below are what
   keep it there along the full dolly from z 30 to z 13: the sheet
   faces the camera until it folds, the cloud only starts to turn
   once it is a cloud, the space is drawn at GALAXY_SCALE, and the
   query enters from inside the frame rather than from behind the
   lens.
   ============================================================ */

/** World size of the embedding space. The dolly ends 13 units out,
    so the farthest bridge of the cloud has to stay well short of it. */
const GALAXY_SCALE = 0.76
/** The cloud's long tail is drawn in, softly, beyond this radius… */
const TAIL_KNEE = 5.55
/** …and never reaches past this one, so the frame is spent on the
    clusters rather than on a few stray bridges at its edge. */
const TAIL_MAX = 7.4

const documentVertex = /* glsl */ `
  attribute float aCluster;
  attribute float aSeed;
  attribute vec3  aTarget;   // clustered galaxy position
  attribute vec3  aFlat;     // initial flat-sheet position

  uniform float uTime;
  uniform float uFold;       // 0 = flat sheet, 1 = galaxy
  uniform float uQueryT;     // 0..1 query travel
  uniform vec3  uQueryPos;
  uniform float uSize;
  uniform float uRetrieval;  // 0..1 how strongly neighbours light
  uniform float uLens;       // how far the camera shrank the frame to fit its region
  uniform float uKeep;       // share of the documents drawn (a small region draws fewer)

  varying float vHot;
  varying float vSeed;

  void main() {
    // Thinned by a hash that is independent of aSeed, which also sets
    // each point's ink: dropping by aSeed would drop the darkest first.
    if (fract(aSeed * 97.0 + aCluster * 0.137) > uKeep) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      vHot = 0.0;
      vSeed = 0.0;
      return;
    }
    vec3 p = mix(aFlat, aTarget, uFold);

    // Gentle drift so the space never feels frozen.
    p += vec3(
      sin(uTime * 0.22 + aSeed * 6.28),
      cos(uTime * 0.19 + aSeed * 4.12),
      sin(uTime * 0.16 + aSeed * 8.91)
    ) * 0.055 * uFold;

    // Relevance: proximity to the travelling query vector.
    float d = distance(p, uQueryPos);
    float hot = smoothstep(3.4, 0.4, d) * uRetrieval;
    vHot = hot;
    vSeed = aSeed;

    // Retrieved points are pulled a little toward the query —
    // retrieval made physical.
    p = mix(p, uQueryPos, hot * 0.16);

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    // Clamped: half a million documents have to read as a field of
    // fine grain, not a fog bank. Near points must not blow out.
    // Points are sized in pixels, so a frame shrunk into its region
    // shrinks them with it — or the cloud turns into a blot.
    gl_PointSize = clamp(uSize * (1.0 + hot * 2.4) * (110.0 / max(0.001, -mv.z)) * uLens, 0.8, 15.0 * uLens);
  }
`

const documentFragment = /* glsl */ `
  uniform vec3 uBase;
  uniform vec3 uHotColor;
  uniform float uOpacity;
  varying float vHot;
  varying float vSeed;

  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r = dot(c, c);
    if (r > 0.25) discard;
    float soft = 1.0 - smoothstep(0.05, 0.25, r);
    vec3 col = mix(uBase, uHotColor, vHot);
    // Alpha floor lifted from 0.10: additive blending let a tenth of a
    // point accumulate into something on black, but each point now has
    // to earn its own mark on paper. The spread across vSeed is what
    // keeps the cloud reading as grain rather than as a wash.
    float a = uOpacity * soft * (0.14 + vSeed * 0.30 + vHot * 0.80);
    gl_FragColor = vec4(col, a);
  }
`

const qv = new THREE.Vector3()

export function MetaviewScene() {
  const device = useMemo(() => detectDevice(), [])
  const points = useRef<THREE.Points>(null!)
  /* R3F clones the `uniforms` object it is given, so the memo below
     is only the initial value — every per-frame write has to go
     through the live material. */
  const mat = useRef<THREE.ShaderMaterial>(null!)
  const group = useRef<THREE.Group>(null!)
  const queryMesh = useRef<THREE.Mesh>(null!)

  /* ---- geometry: one buffer, built once ------------------ */
  const { geometry } = useMemo(() => {
    const n = Math.round(28000 * device.density)
    const rand = seeded(20260601)
    const flat = new Float32Array(n * 3)
    const target = new Float32Array(n * 3)
    const cluster = new Float32Array(n)
    const seed = new Float32Array(n)

    // Nine semantic clusters — the shape of a real embedding space:
    // dense cores, sparse bridges between related topics.
    const CLUSTERS = 9
    const centres: [number, number, number][] = []
    for (let c = 0; c < CLUSTERS; c++) {
      const a = (c / CLUSTERS) * Math.PI * 2
      const r = 2.9 + rand() * 2.7
      centres.push([
        Math.cos(a) * r + (rand() - 0.5) * 1.6,
        (rand() - 0.5) * 4.4,
        Math.sin(a) * r + (rand() - 0.5) * 1.6,
      ])
    }

    for (let i = 0; i < n; i++) {
      // Flat sheet: a wide plane of undifferentiated documents.
      const gx = (i % 220) / 220 - 0.5
      const gy = Math.floor(i / 220) / (n / 220) - 0.5
      flat[i * 3] = gx * 37
      flat[i * 3 + 1] = gy * 21.5
      flat[i * 3 + 2] = (rand() - 0.5) * 0.4

      // Galaxy: gaussian around a cluster centre, plus a bridge tail.
      const c = Math.floor(rand() * CLUSTERS)
      const centre = centres[c]
      const spread = 0.75 + rand() * 1.5
      const g = () => (rand() + rand() + rand() - 1.5) * spread
      const bridge = rand() < 0.12 ? 1.6 : 1
      let x = centre[0] + g() * bridge
      let y = centre[1] + g() * 0.7 * bridge
      let z = centre[2] + g() * bridge
      const len = Math.hypot(x, y, z)
      if (len > TAIL_KNEE) {
        const k = (TAIL_KNEE + (TAIL_MAX - TAIL_KNEE) * Math.tanh((len - TAIL_KNEE) / (TAIL_MAX - TAIL_KNEE))) / len
        x *= k
        y *= k
        z *= k
      }
      target[i * 3] = x
      target[i * 3 + 1] = y
      target[i * 3 + 2] = z
      cluster[i] = c
      seed[i] = rand()
    }

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(flat.slice(), 3))
    geo.setAttribute('aFlat', new THREE.BufferAttribute(flat, 3))
    geo.setAttribute('aTarget', new THREE.BufferAttribute(target, 3))
    geo.setAttribute('aCluster', new THREE.BufferAttribute(cluster, 1))
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1))
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 40)
    return { geometry: geo }
  }, [device.density])

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uFold: { value: 0 },
      uQueryT: { value: 0 },
      uQueryPos: { value: new THREE.Vector3(0, 0, 0) },
      uSize: { value: device.tier === 'low' ? 1.7 : 1.25 },
      uRetrieval: { value: 0 },
      uLens: { value: 1 },
      uKeep: { value: 1 },
      /* Value scale, drawn on white: every document is a graphite
         speck that takes light away from the page, and relevance is
         the only thing allowed to carry colour. uBase was a mid grey
         that only existed as accumulated glow; here it has to be dark
         enough for a single point to register. The retrieved
         neighbourhood takes the soft accent so the query core below,
         which is the deep accent, still reads as the source. */
      uBase: { value: new THREE.Color('#4c4c55') },
      uHotColor: { value: new THREE.Color('#e8734d') },
      uOpacity: { value: 0 },
    }),
    [device.tier],
  )

  /* The cloud turns only once it is a cloud: a slow orbit wound up
     while folded. Read from the clock it was any angle at all by the
     time a visitor arrived, which put the sheet edge-on to the lens. */
  const orbit = useRef(0)

  const queryPath = useMemo(
    () =>
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(-14, 4.5, 8),
        new THREE.Vector3(-6, 1.2, 3),
        new THREE.Vector3(-1.4, -1.6, -1),
        new THREE.Vector3(2.8, 0.6, 1.4),
        new THREE.Vector3(0, 0, 0),
      ]),
    [],
  )

  useFrame((_, dt) => {
    const u = mat.current?.uniforms
    if (!u) return
    const d = Math.min(0.05, dt)
    const s = useJourney.getState()
    const reduced = s.reducedMotion
    // Standing still, the space is shown resolved: folded, the query
    // most of the way through it, its neighbourhood lit.
    const t = reduced ? 0.62 : readChapterProgress('metaview')
    const ease = (from: number, to: number, k: number) => (reduced ? to : damp(from, to, k, d))
    u.uTime.value = reduced ? 0 : frame.time

    // Beat 1 → 2 : the sheet folds into clusters.
    const fold = range(t, 0.10, 0.42)
    u.uFold.value = ease(u.uFold.value, fold * fold * (3 - 2 * fold), 4)

    // Drawn only on its own chapter, only into its own region, and only
    // once the camera has finished moving the frame there.
    const own = s.chapter === 'metaview' && lens.chapter === 'metaview' && readSceneRegion('metaview') !== undefined
    const vis = reduced ? 1 : Math.min(range(t, 0.0, 0.08), 1 - range(t, 0.93, 1.0))
    if (own) u.uOpacity.value = ease(u.uOpacity.value, clamp(vis) * lens.settled, 4)
    else u.uOpacity.value = 0
    u.uLens.value = lens.scale
    u.uKeep.value = clamp(0.3 + lens.scale * 1.1, 0.45, 1)

    // Beat 3 : the query travels the space.
    const qt = range(t, 0.44, 0.72)
    u.uQueryT.value = qt
    queryPath.getPointAt(clamp(qt, 0.001, 0.999), qv)
    ;(u.uQueryPos.value as THREE.Vector3).copy(qv)
    u.uRetrieval.value = ease(u.uRetrieval.value, range(t, 0.46, 0.60), 3)

    if (queryMesh.current) {
      queryMesh.current.position.copy(qv)
      const size = 0.14 * clamp(range(t, 0.42, 0.5) - range(t, 0.80, 0.9))
      queryMesh.current.scale.setScalar(Math.max(0.0001, size))
      queryMesh.current.visible = size > 0.001
    }

    // Centred on the look axis: the region, not an offset, keeps it
    // clear of the type now.
    group.current.position.set(0, 0, 0)
    group.current.scale.setScalar(GALAXY_SCALE)
    // Slow orbit + pointer parallax.
    if (!reduced) orbit.current += d * 0.035 * u.uFold.value
    const px = reduced ? 0 : frame.pointerX
    const py = reduced ? 0 : frame.pointerY
    group.current.rotation.y = orbit.current + px * 0.28
    group.current.rotation.x = ease(group.current.rotation.x, -py * 0.16 - t * 0.12, 2)
    group.current.visible = u.uOpacity.value > 0.005
  })

  return (
    <group ref={group}>
      {/* Normal blending, not additive: additive can only ever add
          light, so on a white page all 28,000 points composited to
          exactly nothing. */}
      <points ref={points} geometry={geometry} frustumCulled={false}>
        <shaderMaterial
          ref={mat}
          vertexShader={documentVertex}
          fragmentShader={documentFragment}
          uniforms={uniforms}
          transparent
          depthWrite={false}
        />
      </points>

      {/* The query vector itself. */}
      <mesh ref={queryMesh}>
        <sphereGeometry args={[1, 16, 16]} />
        <meshBasicMaterial color="#d4491f" />
      </mesh>
    </group>
  )
}
