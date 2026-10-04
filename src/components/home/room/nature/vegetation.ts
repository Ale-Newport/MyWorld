import * as THREE from 'three'
import { ROOM_CONFIG } from '../config'
import type { RoomPlan } from '../scene/compositions'
import { random, TAU } from '../lib/random'
import type { Botany, Leaf, Pruning } from './botany'
import type { LeafAtlas } from './sprites'
import {
  leafFrag, leafShadowFrag, leafShadowVert, leafVert,
  stemFrag, stemShadowFrag, stemVert,
} from '../render/natureShaders'

/* ============================================================
   VEGETATION MESHES
   Few draw calls, no per-leaf materials:

   · every stem in the hall is one merged tube buffer; growth is a
     uniform, and each vertex knows its stem's timing and where it
     sits along it, so the GPU decides how far each stem has got;
   · every leaf is one instance of a single bent card — its
     position, orientation, size, sprite and timing are instance
     attributes, so a whole wall of ivy is one draw;
   · shadows reuse the same buffers with a second vertex shader;
   · the buffers hold every candidate the hall has; pruning by the
     copy only rewrites each stem's cut and each leaf's size.

   Leaves are alpha-tested (with alpha-to-coverage under MSAA), so
   there is no sorting and nothing to go wrong when they overlap.
   ============================================================ */

export interface VegetationUniforms {
  tIrr: { value: THREE.Texture | null }
  uRes: { value: THREE.Vector2 }
  uKeyDir: { value: THREE.Vector3 }
  uKeyDirV: { value: THREE.Vector3 }
  uKeyColor: { value: THREE.Vector3 }
  uGrowth: { value: number }
  uTime: { value: number }
  uSway: { value: number }
  uSwayAmp: { value: number }
  uTakeover: { value: number }
}

/**
 * Draw order inside the frame pass (one scene, one render call): the
 * cached room, its depth, the shadows the plants lay on it, then the
 * plants themselves.
 */
export const FRAME_ORDER = { room: 0, depth: 1, contact: 2, cast: 3, stemShadow: 4, stems: 5, leaves: 6 } as const

/**
 * Every candidate stem and leaf of one hall, built once. The reading
 * field only ever decides how far each stem is grown and which leaves
 * are kept (`applyPrune`), so a new layout of the copy rewrites two
 * small attributes instead of rebuilding the buffers.
 */
export class Vegetation {
  readonly meshes: THREE.Mesh[] = []
  private disposables: Array<{ dispose(): void }> = []
  /** True if any leaf sways (worth redrawing on its own). */
  readonly swaying: boolean
  private stemRanges: Array<[number, number]> = []
  private stems: Array<{ parent: number; at: number; wild: number }>
  private cutAttr: THREE.BufferAttribute
  private leafAttr: THREE.InstancedBufferAttribute | null = null
  /** Instance index of each planned leaf (-1 where the tier thins it). */
  private leafSlot: Int32Array
  /** Per instance: the leaf's stem (-1 for litter) and its place along it. */
  private slotStem: Int32Array
  private slotS: Float32Array
  private litterBase: number
  private leafMat: THREE.ShaderMaterial
  /** The takeover's ivy sits at the end of both buffers, drawn only
      while there is a takeover: at rest it costs nothing at all. */
  private stemGeo: THREE.BufferGeometry
  private leafGeo: THREE.InstancedBufferGeometry
  private storyIndices: number
  private restInstances: number
  kept = { stems: 0, leaves: 0 }

  constructor(
    botany: Botany, litter: Leaf[], atlas: LeafAtlas, uniforms: VegetationUniforms, quality: { leafShare: number; msaa: number },
    /** The portal's canopy draws the same plants with its own light
        and without the shades they lay on a wall. */
    options: {
      leafFrag?: string
      stemFrag?: string
      shadows?: boolean
      uniforms?: Record<string, THREE.IUniform>
      /** Drawn in buffer order with premultiplied blending and no depth
          (the canopy, whose leaves are given back to front). */
      painter?: boolean
    } = {},
  ) {
    const shadows = options.shadows ?? true
    /* ---- stems ------------------------------------------------ */
    let verts = 0
    let tris = 0
    const RING = 5
    for (const st of botany.stems) {
      verts += st.points.length * RING
      tris += (st.points.length - 1) * RING * 2
    }
    const pos = new Float32Array(verts * 3)
    const off = new Float32Array(verts * 3)
    const nor = new Float32Array(verts * 3)
    const prev = new Float32Array(verts * 4)
    const stemA = new Float32Array(verts * 4)
    // Per vertex: the cut, and the takeover value that frees the stem.
    const cut = new Float32Array(verts * 2)
    const sArr = new Float32Array(verts)
    const idx = new Uint32Array(tris * 3)
    const t = new THREE.Vector3()
    const nn = new THREE.Vector3()
    const bn = new THREE.Vector3()
    const o = new THREE.Vector3()
    let v = 0
    let e = 0
    let storyIndices = -1
    for (const st of botany.stems) {
      if (st.wild >= 0 && storyIndices < 0) storyIndices = e
      const base = v
      const last = st.points.length - 1
      for (let i = 0; i <= last; i++) {
        const c = st.points[i]
        const n = st.normals[i]
        t.subVectors(st.points[Math.min(last, i + 1)], st.points[Math.max(0, i - 1)])
        if (t.lengthSq() < 1e-12) t.set(0, 1, 0)
        t.normalize()
        nn.copy(n).addScaledVector(t, -n.dot(t))
        if (nn.lengthSq() < 1e-8) nn.set(0, 0, 1)
        nn.normalize()
        bn.crossVectors(t, nn)
        const pc = st.points[Math.max(0, i - 1)]
        const ps = st.s[Math.max(0, i - 1)]
        for (let k = 0; k < RING; k++) {
          const ang = (k / RING) * TAU
          o.copy(nn).multiplyScalar(Math.cos(ang)).addScaledVector(bn, Math.sin(ang))
          pos.set([c.x, c.y, c.z], v * 3)
          off.set([o.x, o.y, o.z], v * 3)
          nor.set([n.x, n.y, n.z], v * 3)
          prev.set([pc.x, pc.y, pc.z, ps], v * 4)
          stemA.set([st.start, st.duration, 1, st.radius], v * 4)
          sArr[v] = st.s[i]
          v++
        }
        if (i > 0) {
          const r0 = base + (i - 1) * RING
          const r1 = base + i * RING
          // Counter-clockwise seen from outside the tube.
          for (let k = 0; k < RING; k++) {
            const k1 = (k + 1) % RING
            idx.set([r0 + k, r1 + k1, r1 + k, r0 + k, r0 + k1, r1 + k1], e)
            e += 6
          }
        }
      }
      this.stemRanges.push([base, v - base])
    }
    this.storyIndices = storyIndices < 0 ? e : storyIndices
    const stemGeo = new THREE.BufferGeometry()
    this.stemGeo = stemGeo
    stemGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    stemGeo.setAttribute('aOffset', new THREE.BufferAttribute(off, 3))
    stemGeo.setAttribute('aNormal', new THREE.BufferAttribute(nor, 3))
    stemGeo.setAttribute('aPrev', new THREE.BufferAttribute(prev, 4))
    stemGeo.setAttribute('aStem', new THREE.BufferAttribute(stemA, 4))
    this.cutAttr = new THREE.BufferAttribute(cut, 2)
    this.cutAttr.setUsage(THREE.DynamicDrawUsage)
    stemGeo.setAttribute('aCut', this.cutAttr)
    stemGeo.setAttribute('aS', new THREE.BufferAttribute(sArr, 1))
    stemGeo.setIndex(new THREE.BufferAttribute(idx, 1))
    this.disposables.push(stemGeo)

    const common = {
      tIrr: uniforms.tIrr,
      uRes: uniforms.uRes,
      uKeyDir: uniforms.uKeyDir,
      uKeyDirV: uniforms.uKeyDirV,
      uKeyColor: uniforms.uKeyColor,
      uGrowth: uniforms.uGrowth,
      uTime: uniforms.uTime,
      uSway: uniforms.uSway,
      uSwayAmp: uniforms.uSwayAmp,
      uTakeover: uniforms.uTakeover,
      ...options.uniforms,
    }
    // Shades multiply what is already there; they are drawn in the
    // opaque queue so that `renderOrder` alone sequences the pass.
    const multiply = {
      depthWrite: false,
      transparent: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.DstColorFactor,
      blendDst: THREE.ZeroFactor,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    } as const
    const stemMat = new THREE.ShaderMaterial({
      vertexShader: stemVert,
      fragmentShader: options.stemFrag ?? stemFrag,
      uniforms: { ...common, uShadow: { value: 0 } },
      side: THREE.FrontSide,
      ...(options.painter ? { depthTest: false, depthWrite: false } : {}),
    })
    const stemShadowMat = new THREE.ShaderMaterial({
      vertexShader: stemVert,
      fragmentShader: stemShadowFrag,
      uniforms: { ...common, uShadow: { value: 1 }, uStrength: { value: 0.55 } },
      side: THREE.DoubleSide,
      ...multiply,
    })
    this.disposables.push(stemMat, stemShadowMat)
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, order: number) => {
      const m = new THREE.Mesh(geo, mat)
      m.frustumCulled = false
      m.renderOrder = order
      this.meshes.push(m)
    }
    if (e) {
      add(stemGeo, stemMat, FRAME_ORDER.stems)
      if (shadows) add(stemGeo, stemShadowMat, FRAME_ORDER.stemShadow)
    }

    this.stems = botany.stems.map((st) => ({ parent: st.parent, at: st.at, wild: st.wild }))

    /* ---- leaves ------------------------------------------------ */
    const r = random(ROOM_CONFIG.seed ^ 0x7e1f)
    const share = quality.leafShare
    // A lower tier thins the leaves evenly (never a whole region).
    this.leafSlot = new Int32Array(botany.leaves.length).fill(-1)
    const all: Array<{ l: Leaf; litter: number }> = []
    const kept = botany.leaves.map(() => share >= 1 || r() < share)
    const wild = (l: Leaf) => l.stem >= 0 && botany.stems[l.stem].wild >= 0
    // The story's leaves, the fallen ones, then the takeover's.
    botany.leaves.forEach((l, i) => {
      if (!kept[i] || wild(l)) return
      this.leafSlot[i] = all.length
      all.push({ l, litter: 0 })
    })
    this.litterBase = all.length
    for (const l of litter) all.push({ l, litter: 1 })
    this.restInstances = all.length
    botany.leaves.forEach((l, i) => {
      if (!kept[i] || !wild(l)) return
      this.leafSlot[i] = all.length
      all.push({ l, litter: 0 })
    })
    const card = new THREE.PlaneGeometry(1, 1, 4, 6)
    card.translate(0, 0.5, 0)
    const geo = new THREE.InstancedBufferGeometry()
    this.leafGeo = geo
    geo.index = card.index
    geo.setAttribute('position', card.getAttribute('position'))
    const n = all.length
    const iPos = new Float32Array(n * 3)
    const iNormal = new Float32Array(n * 3)
    const iDir = new Float32Array(n * 3)
    const iA = new Float32Array(n * 4)
    const iB = new Float32Array(n * 4)
    const iC = new Float32Array(n * 4)
    // Not admitted (by any takeover) until pruning says otherwise.
    const iD = new Float32Array(n).fill(9)
    this.slotStem = new Int32Array(n)
    this.slotS = new Float32Array(n)
    all.forEach(({ l, litter: lt }, i) => {
      iPos.set([l.position.x, l.position.y, l.position.z], i * 3)
      iNormal.set([l.normal.x, l.normal.y, l.normal.z], i * 3)
      iDir.set([l.direction.x, l.direction.y, l.direction.z], i * 3)
      iA.set([l.size, l.aspect, l.sprite, l.lift], i * 4)
      iB.set([l.birth, l.unfurl, l.roll, l.phase], i * 4)
      iC.set([l.sway, l.shade, lt, l.anchor], i * 4)
      this.slotStem[i] = lt ? -1 : l.stem
      this.slotS[i] = l.s
    })
    geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(iPos, 3))
    geo.setAttribute('iNormal', new THREE.InstancedBufferAttribute(iNormal, 3))
    geo.setAttribute('iDir', new THREE.InstancedBufferAttribute(iDir, 3))
    geo.setAttribute('iA', new THREE.InstancedBufferAttribute(iA, 4))
    this.leafAttr = new THREE.InstancedBufferAttribute(iD, 1)
    this.leafAttr.setUsage(THREE.DynamicDrawUsage)
    geo.setAttribute('iD', this.leafAttr)
    geo.setAttribute('iB', new THREE.InstancedBufferAttribute(iB, 4))
    geo.setAttribute('iC', new THREE.InstancedBufferAttribute(iC, 4))
    geo.instanceCount = n
    this.disposables.push(card, geo)
    this.setWild(false)
    this.swaying = all.some(({ l }) => l.sway > 0)

    // Alpha-to-coverage only means something with MSAA; without it a
    // hard cut at half coverage keeps the blades' edges where they are.
    const msaa = quality.msaa > 0
    this.leafMat = new THREE.ShaderMaterial({
      vertexShader: leafVert,
      fragmentShader: options.leafFrag ?? leafFrag,
      uniforms: { ...common, tAlbedo: { value: atlas.albedo }, tLeafNormal: { value: atlas.normal }, uAlphaCut: { value: options.painter ? 0.004 : msaa ? 0.04 : 0.5 } },
      side: THREE.DoubleSide,
      alphaToCoverage: msaa && !options.painter,
      transparent: false,
      ...(options.painter
        ? {
            depthTest: false,
            depthWrite: false,
            blending: THREE.CustomBlending,
            blendEquation: THREE.AddEquation,
            blendSrc: THREE.OneFactor,
            blendDst: THREE.OneMinusSrcAlphaFactor,
            blendSrcAlpha: THREE.OneFactor,
            blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
          }
        : {}),
    })
    const shadowMat = (mode: number, strength: number) =>
      new THREE.ShaderMaterial({
        vertexShader: leafShadowVert,
        fragmentShader: leafShadowFrag,
        uniforms: { ...common, tAlbedo: { value: atlas.albedo }, uMode: { value: mode }, uStrength: { value: strength } },
        side: THREE.DoubleSide,
        ...multiply,
      })
    const castMat = shadowMat(0, 0.42)
    const contactMat = shadowMat(1, 0.3)
    this.disposables.push(this.leafMat, castMat, contactMat)
    if (n) {
      add(geo, this.leafMat, FRAME_ORDER.leaves)
      if (shadows) {
        add(geo, contactMat, FRAME_ORDER.contact)
        add(geo, castMat, FRAME_ORDER.cast)
      }
    }
  }

  /**
   * Grow each stem only as far as `cuts`, keep only the admitted
   * leaves — and work out, for everything held back, when the portal's
   * takeover will let it go: a stem the copy stopped runs on from its
   * cut as the takeover rises (one the copy never let start, or whose
   * parent never reached it, starts later); a leaf beyond a cut unfurls
   * as its stem passes it; one held back on its own comes in at a
   * scattered moment of its own.
   */
  applyPrune(p: Pruning, litterKept: Uint8Array) {
    const cut = this.cutAttr.array as Float32Array
    const n = this.stemRanges.length
    const delay = new Float32Array(n)
    // When, in takeover terms, a freed stem reaches arc fraction s.
    // (A freed stem grows from its delay to `end`; stemVert does the same.)
    const reachAt = (i: number, s: number) => {
      const c = p.cuts[i]
      if (s <= c) return delay[i] > 0 ? delay[i] : -1
      const end = Math.max(0.9, delay[i] + 0.05)
      return delay[i] + (end - delay[i]) * ((s - c) / Math.max(1e-3, 1 - c))
    }
    let stems = 0
    for (let i = 0; i < n; i++) {
      const c = p.cuts[i]
      if (c > 0) stems++
      const st = this.stems[i]
      // The takeover's own ivy comes in from the frame inward; the
      // story's, stopped by the copy, runs on at once (or, if the copy
      // never let it start, a little later).
      let d = Math.min(0.85, c > 0 ? 0 : st.wild >= 0 ? 0.04 + 0.62 * st.wild : 0.12 + 0.4 * hash01(i * 7 + 3))
      // A branch cannot start before its parent has grown to its root
      // (even late in the takeover: no cap after this).
      if (st.parent >= 0) d = Math.max(d, reachAt(st.parent, st.at))
      delay[i] = Math.max(0, d)
      const [start, count] = this.stemRanges[i]
      for (let v = start; v < start + count; v++) {
        cut[v * 2] = c
        cut[v * 2 + 1] = delay[i]
      }
    }
    this.cutAttr.needsUpdate = true
    let leaves = 0
    if (this.leafAttr) {
      const at = this.leafAttr.array as Float32Array
      this.leafSlot.forEach((slot, i) => {
        if (slot < 0) return
        if (p.leaves[i] === 1) {
          at[slot] = -1
          leaves++
          return
        }
        const stem = this.slotStem[slot]
        const s = this.slotS[slot]
        const reach = reachAt(stem, s)
        // On a stretch the stem already covers: a moment of its own.
        at[slot] = reach < 0 ? 0.08 + 0.55 * hash01(slot * 13 + 5) : Math.min(0.99, reach + 0.015)
      })
      for (let i = 0; i < litterKept.length; i++) {
        const slot = this.litterBase + i
        at[slot] = litterKept[i] ? -1 : 0.2 + 0.6 * hash01(slot * 5 + 1)
      }
      this.leafAttr.needsUpdate = true
    }
    this.kept = { stems, leaves }
  }

  /** Draw the takeover's ivy (the end of both buffers), or not. */
  setWild(on: boolean) {
    this.stemGeo.setDrawRange(0, on ? Infinity : this.storyIndices)
    this.leafGeo.instanceCount = on ? (this.leafAttr?.count ?? 0) : this.restInstances
  }

  dispose() {
    for (const d of this.disposables) d.dispose()
    this.disposables = []
  }
}

/** A fixed pseudo-random 0..1 per integer. */
function hash01(i: number) {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453
  return x - Math.floor(x)
}

/** Fallen leaves gathered against the skirting and in the corners. */
export function buildLitter(plan: RoomPlan, seed: number, count: number): Leaf[] {
  const r = random(seed ^ 0x1177)
  const out: Leaf[] = []
  const W = plan.width
  for (let i = 0; i < count; i++) {
    // Mostly within a metre of the wall, bunched towards the corners
    // and the pilasters' bases, where the draught leaves them.
    const near = r()
    const anchor = r() < 0.5 ? (r() < 0.5 ? -1 : 1) * plan.bay : (r() - 0.5) * W
    const x = anchor + (r() - 0.5) * (near < 0.6 ? 1.2 : 3.5)
    const z = 0.07 + Math.pow(r(), 1.8) * 1.6
    const a = r() * TAU
    out.push({
      position: new THREE.Vector3(x, 0.002, z),
      normal: new THREE.Vector3(0, 1, 0),
      direction: new THREE.Vector3(Math.cos(a), 0, Math.sin(a)),
      size: ROOM_CONFIG.vines.leafScale * plan.foliage * (0.55 + r() * 0.35),
      aspect: 0.75 + r() * 0.25,
      sprite: Math.floor(r() * 32),
      birth: 0.42 + r() * 0.5,
      unfurl: 0.04 + r() * 0.04,
      lift: r() * 0.25,
      roll: (r() - 0.5) * 0.6,
      phase: r() * TAU,
      sway: 0,
      stem: -1,
      s: 0,
      shade: 0.82 + r() * 0.18,
      anchor: 0.002,
    })
  }
  return out
}
