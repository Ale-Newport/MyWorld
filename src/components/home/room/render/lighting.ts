import * as THREE from 'three'
import { ROOM_CONFIG } from '../config'
import { random } from '../lib/random'
import { accumFrag, fullscreenVert, gbufferFrag, gbufferVert, shadowFrag, shadowVert } from './shaders'

/* ============================================================
   LIGHTING CACHE
   The hall is lit by three things, all soft:

   KEY     an unseen clerestory high on the left — a cone of
           directions, so pilasters throw long soft shadows;
   SKY     the even top light of a gallery, from every direction
           above, which is what puts contact shade into every
           corner, flute and soffit;
   BOUNCE  the floor's own reflected light, from below, which is
           why a white room's shadows are never black.

   Each sample is one shadow map and one full-screen pass that
   adds its contribution; ~130 of them converge to the lighting
   an offline renderer would give the bare architecture. It is
   recomputed only when the layout changes.
   ============================================================ */

interface LightSample {
  /** Direction towards the light (sky, bounce). */
  dir: THREE.Vector3
  /** Position on the window, for the key's area samples. */
  pos?: THREE.Vector3
  radiance: THREE.Vector3
  key: number
  excludeFloor: boolean
  excludePlaster?: boolean
}

/**
 * The part of the hall the lens sees: where rays through a grid over
 * the screen leave the hall's box (its walls, floor and vault are its
 * faces), as a box, with a margin for the lookups' offsets and jitter.
 * Everything drawn in front of those surfaces (pilasters, mouldings)
 * stands between them and the lens, so it is inside the box too.
 */
function seenBox(camera: THREE.PerspectiveCamera, hall: THREE.Box3): THREE.Box3 {
  const out = new THREE.Box3()
  const o = camera.position
  const p = new THREE.Vector3()
  const d = new THREE.Vector3()
  const N = 8
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      d.set((i / N) * 2 - 1, (j / N) * 2 - 1, 0.5).unproject(camera).sub(o).normalize()
      // Slab test: the ray's way out of the box.
      let t0 = 0
      let t1 = Infinity
      for (const k of ['x', 'y', 'z'] as const) {
        if (Math.abs(d[k]) < 1e-9) continue
        const a = (hall.min[k] - o[k]) / d[k]
        const b = (hall.max[k] - o[k]) / d[k]
        t0 = Math.max(t0, Math.min(a, b))
        t1 = Math.min(t1, Math.max(a, b))
      }
      if (t1 < t0 || !Number.isFinite(t1)) continue
      out.expandByPoint(p.copy(o).addScaledVector(d, t1))
    }
  }
  if (out.isEmpty()) return hall.clone()
  return out.expandByScalar(0.3).intersect(hall)
}

export interface CacheQuality {
  shadowSize: number
  keySamples: number
  skySamples: number
}

export class LightingCache {
  readonly gbuffer: THREE.WebGLRenderTarget
  readonly irradiance: THREE.WebGLRenderTarget
  private shadow: THREE.WebGLRenderTarget
  private shadowCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 50)
  private persp = new THREE.PerspectiveCamera(30, 1, 0.5, 60)
  private gbufferMat: THREE.ShaderMaterial
  private shadowMat: THREE.ShaderMaterial
  private accumMat: THREE.ShaderMaterial
  private quad: THREE.Mesh
  private quadScene = new THREE.Scene()
  private scene = new THREE.Scene()
  private mesh: THREE.Mesh
  private samples: LightSample[] = []
  private index = 0
  private bounds = new THREE.Sphere()
  private corners: THREE.Vector3[] = []
  /** The corners of what the lens actually sees of the hall (see `begin`), and their centre. */
  private seen: THREE.Vector3[] = []
  private seenCentre = new THREE.Vector3()
  private seenRadius = 1
  private shadowSize: number

  constructor(
    private renderer: THREE.WebGLRenderer,
    geometry: THREE.BufferGeometry,
    quality: CacheQuality,
    floatable: boolean,
  ) {
    this.shadowSize = quality.shadowSize
    this.gbuffer = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.UnsignedByteType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
      depthTexture: new THREE.DepthTexture(1, 1, THREE.UnsignedIntType),
    })
    // Read at texel centres (where filtering changes nothing) and, on
    // flat surfaces, at texel corners for a cheap 3×3 tent: filtered
    // where the format allows it (half floats always; full floats only
    // with OES_texture_float_linear), else the corners read nearest.
    const filter = !floatable || renderer.extensions.has('OES_texture_float_linear') ? THREE.LinearFilter : THREE.NearestFilter
    this.irradiance = new THREE.WebGLRenderTarget(1, 1, {
      type: floatable ? THREE.FloatType : THREE.HalfFloatType,
      minFilter: filter,
      magFilter: filter,
      depthBuffer: false,
    })
    this.shadow = new THREE.WebGLRenderTarget(this.shadowSize, this.shadowSize, {
      type: THREE.UnsignedByteType,
      depthBuffer: true,
      depthTexture: new THREE.DepthTexture(this.shadowSize, this.shadowSize, THREE.UnsignedIntType),
    })
    this.shadow.depthTexture!.minFilter = THREE.NearestFilter
    this.shadow.depthTexture!.magFilter = THREE.NearestFilter

    this.gbufferMat = new THREE.ShaderMaterial({ vertexShader: gbufferVert, fragmentShader: gbufferFrag, side: THREE.DoubleSide })
    this.shadowMat = new THREE.ShaderMaterial({
      vertexShader: shadowVert,
      fragmentShader: shadowFrag,
      side: THREE.DoubleSide,
      colorWrite: false,
      uniforms: { uExcludeFloor: { value: 0 }, uExcludePlaster: { value: 0 } },
    })
    this.accumMat = new THREE.ShaderMaterial({
      vertexShader: fullscreenVert,
      fragmentShader: accumFrag,
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendEquationAlpha: THREE.AddEquation,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneFactor,
      uniforms: {
        tNormal: { value: this.gbuffer.texture },
        tDepth: { value: this.gbuffer.depthTexture },
        tShadow: { value: this.shadow.depthTexture },
        uShadowVP: { value: new THREE.Matrix4() },
        uShadowView: { value: new THREE.Matrix4() },
        uLightPos: { value: new THREE.Vector3() },
        uLightNormal: { value: new THREE.Vector3(0, 0, -1) },
        uPersp: { value: 0 },
        uNear: { value: 0.05 },
        uFar: { value: 20 },
        uLightDir: { value: new THREE.Vector3() },
        uRadiance: { value: new THREE.Vector3() },
        uKey: { value: 0 },
        uTexel: { value: 0.01 },
        uJitter: { value: 0.0 },
        uSeed: { value: 0 },
        uBias: { value: 0.0005 },
        uShadowSize: { value: new THREE.Vector2(this.shadowSize, this.shadowSize) },
        uInvProj: { value: new THREE.Matrix4() },
        uCamWorld: { value: new THREE.Matrix4() },
      },
    })
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.accumMat)
    this.quad.frustumCulled = false
    this.quadScene.add(this.quad)
    this.mesh = new THREE.Mesh(geometry, this.gbufferMat)
    this.mesh.frustumCulled = false
    this.scene.add(this.mesh)
    this.buildSamples(quality)
    this.accumMat.uniforms.uLightNormal.value.set(...ROOM_CONFIG.light.key.window.normal).normalize()
  }

  /** Total samples and how many are done. */
  get progress() {
    return { done: this.index, total: this.samples.length }
  }

  get complete() {
    return this.index >= this.samples.length
  }

  private buildSamples(q: CacheQuality) {
    const L = ROOM_CONFIG.light
    const r = random(ROOM_CONFIG.seed ^ 0x11b7)
    const samples: LightSample[] = []
    // KEY: points spread over an unseen window behind and to the
    // left of the viewer. Each is a true point light with its own
    // perspective shadow map, so light falls off across the hall and
    // every shadow is cast from where the window really is.
    const win = L.key.window
    const wc = new THREE.Vector3(...win.center)
    const wn = new THREE.Vector3(...win.normal).normalize()
    const wu = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), wn).normalize()
    const wv = new THREE.Vector3().crossVectors(wn, wu).normalize()
    const ref = new THREE.Vector3(...L.key.reference)
    const pts: THREE.Vector3[] = []
    const side = Math.ceil(Math.sqrt(q.keySamples))
    for (let i = 0; i < q.keySamples; i++) {
      // Jittered grid over the window's face.
      const gx = ((i % side) + r()) / side - 0.5
      const gy = (Math.floor(i / side) % side + r()) / side - 0.5
      pts.push(wc.clone().addScaledVector(wu, gx * win.size[0]).addScaledVector(wv, gy * win.size[1]))
    }
    // Normalise so a wall at the reference point, facing the window
    // squarely, would receive exactly `key.intensity`.
    let eRef = 0
    for (const pt of pts) {
      const toL = pt.clone().sub(ref)
      const d2 = toL.lengthSq()
      toL.normalize()
      eRef += Math.max(0, toL.dot(new THREE.Vector3(0, 0, 1))) * Math.max(0, -toL.dot(wn)) / d2
    }
    const kScale = eRef > 0 ? 1 / eRef : 0
    const keyCol = new THREE.Vector3(...L.key.color).multiplyScalar(L.key.intensity * kScale)
    for (const pt of pts) {
      samples.push({ dir: pt.clone().sub(ref).normalize(), pos: pt, radiance: keyCol.clone(), key: kScale, excludeFloor: false })
    }
    // Sky: Fibonacci sphere, upper hemisphere, weighted by a sky
    // that is brightest overhead and towards the open side of the
    // hall (behind the viewer), then normalised so that an open,
    // upward-facing surface receives exactly `sky.intensity`.
    const sky: LightSample[] = []
    const bounce: LightSample[] = []
    const N = q.skySamples * 2
    for (let i = 0; i < N; i++) {
      const k = i + 0.5
      const y = 1 - (2 * k) / N
      const rr = Math.sqrt(Math.max(0, 1 - y * y))
      const th = Math.PI * (1 + Math.sqrt(5)) * k
      const dir = new THREE.Vector3(Math.cos(th) * rr, y, Math.sin(th) * rr)
      if (y > 0.02) {
        // A gallery's top light: strongest overhead, a little from
        // the open side of the hall behind the viewer.
        const w = Math.pow(y, 0.6) * (0.85 + 0.15 * Math.max(0, dir.z))
        sky.push({ dir, radiance: new THREE.Vector3(w, w, w), key: 0, excludeFloor: false })
      } else if (y < -0.02 && i % 2 === 0) {
        const w = 0.6 + 0.4 * -y
        bounce.push({ dir, radiance: new THREE.Vector3(w, w, w), key: 0, excludeFloor: true })
      }
    }
    const norm = (list: LightSample[], n: THREE.Vector3, intensity: number, color: readonly number[]) => {
      let e = 0
      for (const s of list) e += s.radiance.x * Math.max(0, s.dir.dot(n))
      const k = e > 0 ? intensity / e : 0
      for (const s of list) s.radiance.set(color[0], color[1], color[2]).multiplyScalar(s.radiance.x * k)
    }
    norm(sky, new THREE.Vector3(0, 1, 0), L.sky.intensity, L.sky.color)
    norm(bounce, new THREE.Vector3(0, -1, 0), L.bounce.intensity, L.bounce.color)
    // WALL BOUNCE: the lit back wall is itself a broad, dim source. It
    // is what keeps the floor at its foot, the pilasters' flanks and
    // the soffits from going grey in a white room.
    const wall: LightSample[] = []
    const NW = Math.max(8, Math.round(q.skySamples / 3))
    for (let i = 0; i < NW; i++) {
      const k = i + 0.5
      const y = -0.3 + 1.0 * (k / NW)
      const a = Math.PI * (1 + Math.sqrt(5)) * k
      const rr = Math.sqrt(Math.max(0, 1 - y * y))
      // Directions pointing back towards the wall (z < 0).
      const dir = new THREE.Vector3(Math.cos(a) * rr * 0.8, y, -Math.abs(Math.sin(a)) * rr - 0.2).normalize()
      const w = Math.max(0.05, -dir.z)
      wall.push({ dir, radiance: new THREE.Vector3(w, w, w), key: 0, excludeFloor: false, excludePlaster: true })
    }
    norm(wall, new THREE.Vector3(0, 0, -1), L.wallBounce.intensity, L.wallBounce.color)
    // Interleave so a partial cache is never lopsided.
    const all = [...samples, ...sky, ...bounce, ...wall]
    const order = all.map((s, i) => ({ s, k: (i * 0.6180339887) % 1 }))
    order.sort((a, b) => a.k - b.k)
    this.samples = order.map((o) => o.s)
  }

  /** Size the targets and draw the G-buffer for a new view. */
  begin(camera: THREE.PerspectiveCamera, width: number, height: number, bounds: THREE.Box3) {
    this.gbuffer.setSize(width, height)
    this.irradiance.setSize(width, height)
    bounds.getBoundingSphere(this.bounds)
    const boxCorners = (b: THREE.Box3) => {
      const out: THREE.Vector3[] = []
      for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) out.push(new THREE.Vector3(x, y, z))
      return out
    }
    this.corners = boxCorners(bounds)
    const seen = seenBox(camera, bounds)
    this.seen = boxCorners(seen)
    seen.getCenter(this.seenCentre)
    this.seenRadius = seen.getBoundingSphere(new THREE.Sphere()).radius
    const r = this.renderer
    const prevTarget = r.getRenderTarget()
    r.setRenderTarget(this.gbuffer)
    r.setClearColor(0x000000, 0)
    r.clear(true, true, false)
    this.mesh.material = this.gbufferMat
    r.render(this.scene, camera)
    r.setRenderTarget(this.irradiance)
    r.setClearColor(0x000000, 0)
    r.clear(true, false, false)
    r.setRenderTarget(prevTarget)
    const u = this.accumMat.uniforms
    u.uInvProj.value.copy(camera.projectionMatrixInverse)
    u.uCamWorld.value.copy(camera.matrixWorld)
    this.index = 0
  }

  /** Accumulate samples until the time budget (ms) is spent. */
  step(budgetMs: number, maxSamples = Infinity): boolean {
    const r = this.renderer
    const prevTarget = r.getRenderTarget()
    const t0 = performance.now()
    const R = this.bounds.radius
    const c = this.bounds.center
    const u = this.accumMat.uniforms
    let n = 0
    while (this.index < this.samples.length) {
      const s = this.samples[this.index++]
      let cam: THREE.Camera
      if (s.pos) {
        // Perspective from the point on the window, aimed at what the
        // lens sees. Its frustum is fitted to the corners of THAT part
        // of the hall as the light sees them, not of the whole hall: a
        // phone frames a bay four metres across of a hall nine wide,
        // and a map spread over all nine spent most of its texels on
        // stone nobody sees — every pilaster's shadow came out of a
        // texel a centimetre or more wide, jittered over two more, which
        // on a phone is a blur several pixels deep. Anything that
        // can shade a seen point stands on the line from it to the
        // light, so it is inside this frustum too; the near plane still
        // comes from the whole hall, so nothing between is clipped.
        const pc = this.persp
        const aim = this.seenCentre
        const dist = s.pos.distanceTo(aim)
        pc.position.copy(s.pos)
        pc.up.set(0, 1, 0)
        pc.lookAt(aim)
        pc.updateMatrixWorld(true)
        const inv = pc.matrixWorldInverse.copy(pc.matrixWorld).invert()
        let maxTan = 0
        let zMin = Infinity
        let zMax = 0
        const v = new THREE.Vector3()
        for (const corner of this.seen) {
          const z = -v.copy(corner).applyMatrix4(inv).z
          maxTan = Math.max(maxTan, Math.abs(v.x / z), Math.abs(v.y / z))
          zMax = Math.max(zMax, z)
        }
        for (const corner of this.corners) zMin = Math.min(zMin, -v.copy(corner).applyMatrix4(inv).z)
        pc.near = Math.max(0.3, zMin * 0.95)
        pc.far = zMax * 1.05
        pc.fov = THREE.MathUtils.radToDeg(2 * Math.atan(maxTan * 1.02))
        pc.aspect = 1
        pc.updateProjectionMatrix()
        cam = pc
        u.uPersp.value = 1
        u.uNear.value = pc.near
        u.uFar.value = pc.far
        u.uLightPos.value.copy(s.pos)
        // Texel footprint at the hall, for offsets and jitter.
        u.uTexel.value = (2 * maxTan * 1.02 * dist) / this.shadowSize
      } else {
        // Orthographic for a direction of sky, across what the lens sees
        // (an occluder shades a seen point along this direction, so it
        // stands within the same width) and deep enough to take in the
        // whole hall behind it towards the sky.
        const oc = this.shadowCam
        const aim = this.seenCentre
        const back = aim.distanceTo(c) + R + 0.05
        oc.left = -this.seenRadius
        oc.right = this.seenRadius
        oc.top = this.seenRadius
        oc.bottom = -this.seenRadius
        oc.near = 0.05
        oc.far = back + this.seenRadius + 0.1
        oc.position.copy(aim).addScaledVector(s.dir, back)
        oc.up.copy(Math.abs(s.dir.y) > 0.95 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0))
        oc.lookAt(aim)
        oc.updateProjectionMatrix()
        oc.updateMatrixWorld(true)
        cam = oc
        u.uPersp.value = 0
        u.uNear.value = oc.near
        u.uFar.value = oc.far
        u.uTexel.value = (2 * this.seenRadius) / this.shadowSize
      }

      this.shadowMat.uniforms.uExcludeFloor.value = s.excludeFloor ? 1 : 0
      this.shadowMat.uniforms.uExcludePlaster.value = s.excludePlaster ? 1 : 0
      this.mesh.material = this.shadowMat
      r.setRenderTarget(this.shadow)
      r.clear(false, true, false)
      r.render(this.scene, cam)

      u.uShadowVP.value.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse)
      u.uShadowView.value.copy(cam.matrixWorldInverse)
      u.uLightDir.value.copy(s.dir)
      u.uRadiance.value.copy(s.radiance)
      u.uKey.value = s.key
      u.uBias.value = 0.004
      // The key's spread is two texels of its map, which is fitted to
      // what the lens sees, so it narrows with the map: its edges are the
      // crisp ones (a pilaster's on the wall). The sky's keeps the width
      // it always had, three and a half texels of a map over the whole
      // hall: each of its few dozen directions throws a hard-edged shadow
      // of some far moulding across the wall, and that width is what
      // dissolves their edges into one gradient on white plaster.
      u.uJitter.value = s.key > 0 ? u.uTexel.value * 2.0 : ((2 * R) / this.shadowSize) * 3.5
      u.uSeed.value = this.index
      r.setRenderTarget(this.irradiance)
      r.render(this.quadScene, cam)
      n++
      // CPU time alone undercounts: the GPU work is queued, so the
      // number of samples per call is capped as well.
      if ((performance.now() - t0 > budgetMs && n >= 2) || n >= maxSamples) break
    }
    this.mesh.material = this.gbufferMat
    r.setRenderTarget(prevTarget)
    return this.complete
  }

  dispose() {
    this.gbuffer.depthTexture?.dispose()
    this.gbuffer.dispose()
    this.irradiance.dispose()
    this.shadow.depthTexture?.dispose()
    this.shadow.dispose()
    this.gbufferMat.dispose()
    this.shadowMat.dispose()
    this.accumMat.dispose()
    this.quad.geometry.dispose()
  }
}
