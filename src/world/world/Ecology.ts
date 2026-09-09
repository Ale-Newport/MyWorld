import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { Game } from '../Game'
import type { Bin } from '../core/Disposal'
import type { Physical } from '../physics/Physics'
import { seeded } from '../core/maths'
import { isFree } from '@/content/world-layout'
import { WORLD_RADIUS } from '@/content/world'
import { FOREST_POCKETS, inlandWater } from '@/content/world-environment'

/** Original, seeded island ecology. Instancing/chunks and reactive foliage are
 * informed by folio-2025 Trees, Foliage, Grass and Leaves (MIT; see notices).
 * No upstream models, textures or shaders are copied. Colliders are independent
 * of visual quality; a fixed pool follows the nearest trunks. */
type Instance = { p: THREE.Vector3; scale: THREE.Vector3; yaw: number; color: THREE.Color }
type Patch = { centre: THREE.Vector3; group: THREE.Group; detail: THREE.InstancedMesh[] }
export type TreeKind = 'oak' | 'birch' | 'pine' | 'cedar' | 'willow' | 'olive' | 'young' | 'landmark'
type Tree = { p: THREE.Vector3; radius: number; height: number; kind: TreeKind }
const KINDS: TreeKind[] = ['oak', 'birch', 'pine', 'cedar', 'willow', 'olive', 'young', 'landmark']

/** Chunk edge, metres. Chunks are square and axis-aligned. */
const CHUNK = 64

/**
 * Where each detail layer shrinks away, in metres FROM THE CAMERA.
 *
 * These used to be hard `mesh.visible` switches at 80 / 105 / 150 m
 * measured to the chunk's CENTRE — so a whole 64 m chunk of grass
 * appeared at once, and the boundary between the chunks that were on
 * and the chunks that were off swept around the car as a visible ring.
 * A shrink-to-nothing band plus a cull measured to the chunk's nearest
 * corner removes both halves of that: nothing switches, and what does
 * eventually switch is already invisible.
 */
const FADE = {
  grass: [86, 122] as [number, number],
  bush: [118, 168] as [number, number],
  flower: [64, 96] as [number, number],
  rock: [140, 190] as [number, number],
}
/** Per-layer cull distance: the end of the fade, plus a chunk's reach. */
const CULL: Record<number, number> = {
  3: FADE.bush[1] + 8,
  4: FADE.grass[1] + 8,
  5: FADE.flower[1] + 8,
  6: FADE.rock[1] + 8,
}

export class Ecology {
  readonly group = new THREE.Group()
  readonly trees: Tree[] = []
  readonly stats = { trees: 0, bushes: 0, grass: 0, flowers: 0, activeColliders: 0, visibleChunks: 0 }
  private patches: Patch[] = []
  private trunks: Physical[] = []
  private poolAt: number[] = []
  private time = { value: 0 }
  private wind = { value: new THREE.Vector2() }
  private car = { value: new THREE.Vector3() }
  private cam = { value: new THREE.Vector3() }
  private blast = { value: new THREE.Vector4(0, -100, 0, 0) }
  private scratch = new THREE.Object3D()
  private rand = seeded(904127)
  private leaves: { p: THREE.Vector3; v: THREE.Vector3; life: number; spin: number }[] = []
  private leafMesh!: THREE.InstancedMesh
  private birds!: THREE.InstancedMesh
  private nextLeaves = 0
  private nextDrift = 0
  private nextChunks = 0
  private lastChirp = 0
  private leafCursor = 0

  constructor(private game: Game, bin: Bin) {
    const r = this.rand
    const trunk = new THREE.CylinderGeometry(0.65, 1, 1, 6)
    trunk.translate(0, .5, 0)
    const crown = new THREE.IcosahedronGeometry(1, 1)
    const cone = new THREE.ConeGeometry(1, 1, 8)
    cone.translate(0, .5, 0)
    const blades: THREE.BufferGeometry[] = []
    for (let i = 0; i < 9; i++) {
      const blade = new THREE.BufferGeometry()
      blade.setAttribute('position', new THREE.Float32BufferAttribute([-.12, 0, 0, .12, 0, 0, .05, .9, .08], 3))
      blade.computeVertexNormals(); blade.rotateY(i * 2.4); blade.translate(Math.sin(i*5)*.4,0,Math.cos(i*3)*.4); blades.push(blade)
    }
    const grass = mergeGeometries(blades); blades.forEach(g => g.dispose())
    const flower = new THREE.IcosahedronGeometry(.22, 0)
    const rock = new THREE.IcosahedronGeometry(1, 0)
    // Trunks never fade: a tree is a silhouette on the skyline, and
    // its chunk is the only thing that ever switches it off.
    const solid = new THREE.MeshStandardMaterial({ roughness: .95 })
    const canopy = this.material(.085, .10)
    const bushMaterial = this.material(.38, .92, -1, .16, FADE.bush)
    const flowerMaterial = this.material(.38, 1.10, -1, 0, FADE.flower)
    const rockMaterial = this.material(0, 0, 0, 0, FADE.rock)
    rockMaterial.roughness = .95
    const grassMaterial = this.material(.55, 1.18, 0, 0, FADE.grass)
    grassMaterial.side = THREE.DoubleSide
    const buckets = new Map<string, { centre: THREE.Vector3; data: Instance[][] }>()
    const add = (layer: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, color: string, yaw = r() * 6.28) => {
      const key = `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`
      let bucket = buckets.get(key)
      if (!bucket) { bucket = { centre: new THREE.Vector3(Math.floor(x / CHUNK) * CHUNK + CHUNK / 2, 0, Math.floor(z / CHUNK) * CHUNK + CHUNK / 2), data: Array.from({ length: 7 }, () => []) }; buckets.set(key, bucket) }
      bucket.data[layer].push({ p: new THREE.Vector3(x, y, z), scale: new THREE.Vector3(sx, sy, sz), yaw, color: new THREE.Color(color).multiplyScalar(.87 + r() * .25) })
    }
    // A tree's family affects silhouette, branching, canopy height and palette.
    // The island is a third of the area it was, so the same tree count
    // is three times the density — and it still wants more. Trees are
    // instanced and share one geometry per part; the cost is the
    // collider pool, which is fixed and follows the nearest trunks.
    const treeTarget = Math.round(1250 * Math.max(0.34, game.quality.settings.density))
    for (let attempt = 0; attempt < treeTarget * 14 && this.trees.length < treeTarget; attempt++) {
      const pocket = FOREST_POCKETS[Math.floor(r() * FOREST_POCKETS.length)]
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * pocket[2]
      const x = pocket[0] + Math.cos(a) * d, z = pocket[1] + Math.sin(a) * d
      if (!this.allowed(x, z, 3.6) || this.trees.some(t => (t.p.x - x) ** 2 + (t.p.z - z) ** 2 < 22)) continue
      const family=r()
      const kind = z < -185 && family < .5 ? (family < .25 ? 'pine' : 'cedar') :
        inlandWater(x,z) && family < .65 ? 'willow' :
        z > 200 && family < .4 ? 'olive' : KINDS[Math.floor(r() * KINDS.length)]
      const young = kind === 'young', landmark = kind === 'landmark', tall = kind === 'birch' || kind === 'pine'
      const height = (young ? 4 : landmark ? 15 : tall ? 12 : 7) * (.8 + r() * .45)
      const radius = young ? .23 : landmark ? .85 : tall ? .37 : .48
      const y = game.world.terrain.colliderHeightAt(x, z)
      this.trees.push({ p: new THREE.Vector3(x, y, z), radius, height, kind })
      add(0, x, y, z, radius, height * .76, radius, kind === 'birch' ? '#dad8bf' : '#76654d')
      if (kind === 'pine' || kind === 'cedar') {
        for (let j = 0; j < 3; j++) add(2, x, y + height * (.27 + j * .2), z, height * (.32 - j * .07), height * .48, height * (.32 - j * .07), kind === 'pine' ? '#3d6a54' : '#537c55')
      } else {
        const clumps = young ? 2 : landmark ? 7 : 4
        for (let j = 0; j < clumps; j++) {
          const angle = j * 2.4, spread = j === 0 ? 0 : height * .18
          const width = height * (kind === 'olive' ? .3 : kind === 'birch' ? .15 : .24)
          const cy = height * (.73 + r() * .17) - (kind === 'willow' ? j * .6 : 0)
          const colour = kind === 'olive' ? '#8d9f65' : kind === 'birch' ? '#b2bc69' : kind === 'willow' ? '#6e9a68' : '#729651'
          add(1, x + Math.cos(angle) * spread, y + cy, z + Math.sin(angle) * spread, width, kind === 'willow' ? width * 1.65 : width * .8, width, colour)
          if (j > 0 && !young) add(0, x + Math.cos(angle) * spread * .65, y + height * .35, z + Math.sin(angle) * spread * .65, radius * .4, height * .43, radius * .4, '#75654d')
        }
      }
    }
    // Shuffled positions keep lowering density spatially uniform.
    // Scattered across the island rather than across the old 720 m
    // square: nine attempts in ten used to land in the sea and be
    // thrown away, which is why the ground looked bare.
    const scatterSpan = WORLD_RADIUS * 2.2
    const scatterCount = Math.round(140000 * Math.max(0.3, game.quality.settings.density))
    for (let i = 0; i < scatterCount; i++) {
      const x = (r() - .5) * scatterSpan, z = (r() - .5) * scatterSpan
      if (!this.allowed(x, z, .5)) continue
      const y = game.world.terrain.colliderHeightAt(x, z), water = inlandWater(x, z)
      const forest = FOREST_POCKETS.some(p => Math.hypot(x - p[0], z - p[1]) < p[2] * 1.18)
      if (i < scatterCount * 0.075 && forest) {
        const size = .8 + r() * 1.1
        add(3, x, y + size * .5, z, size * 1.25, size * .8, size, '#69864d'); this.stats.bushes++
      } else if (i % 23 === 0) {
        add(6, x, y + .18, z, .4 + r() * 1.2, .3 + r(), .5 + r(), '#929786')
      } else if (i % 6 === 0) {
        // Wildflowers, low mushrooms and shoreline reed heads.
        const mushroom = forest && i % 18 === 0
        add(5, x, y + (mushroom ? .28 : .65), z, mushroom ? 1.3 : .8, mushroom ? .6 : 1.2, 1, mushroom ? '#bc694e' : ['#e6d580', '#e7dfbd', '#b399b6'][i % 3]); this.stats.flowers++
      } else {
        const h = water ? 1.8 + r() : .45 + r() * .9
        add(4, x, y, z, 1 + r(), h, 1 + r(), forest ? '#71914e' : '#92ab61'); this.stats.grass++
      }
    }
    const geometries = [trunk, crown, cone, crown, grass, flower, rock]
    const materials = [solid, canopy, canopy, bushMaterial, grassMaterial, flowerMaterial, rockMaterial]
    for (const bucket of buckets.values()) {
      const group = new THREE.Group(), detail: THREE.InstancedMesh[] = []
      for (let layer = 0; layer < bucket.data.length; layer++) {
        const data = bucket.data[layer]; if (!data.length) continue
        const mesh = new THREE.InstancedMesh(geometries[layer], materials[layer], data.length)
        data.forEach((item, i) => {
          this.scratch.position.copy(item.p); this.scratch.rotation.set(0, item.yaw, 0); this.scratch.scale.copy(item.scale); this.scratch.updateMatrix()
          mesh.setMatrixAt(i, this.scratch.matrix); mesh.setColorAt(i, item.color)
        })
        mesh.computeBoundingSphere(); mesh.castShadow = layer < 3 && game.quality.settings.shadows; mesh.receiveShadow = true
        mesh.userData.capacity = data.length; mesh.userData.layer = layer
        group.add(mesh); if (layer >= 3) detail.push(mesh)
      }
      this.group.add(group); this.patches.push({ centre: bucket.centre, group, detail })
    }
    for (let i = 0; i < 96; i++) {
      this.trunks.push(game.physics.add({ type: 'fixed', category: 'object', enabled: false, position: { x: 0, y: -100, z: 0 }, colliders: [{ shape: 'cylinder', parameters: [2, .5] }] }))
      this.poolAt.push(-1)
    }
    this.stats.trees = this.trees.length
    const leaf = new THREE.PlaneGeometry(.35, .18)
    // Upstream runs 4096 leaves on a compute shader. This is a CPU pool,
    // so it is smaller — but 160 was few enough that a gust read as a
    // handful of specks rather than as weather.
    const leafPool = game.quality.count(420, 120)
    this.leafMesh = new THREE.InstancedMesh(leaf, new THREE.MeshStandardMaterial({ color: '#adb85f', side: THREE.DoubleSide, roughness: 1 }), leafPool)
    this.leafMesh.frustumCulled = false; this.group.add(this.leafMesh)
    for (let i = 0; i < leafPool; i++) {
      this.leaves.push({ p: new THREE.Vector3(), v: new THREE.Vector3(), life: 0, spin: 0 })
      this.leafMesh.setColorAt(i,new THREE.Color(['#adb85f','#c5a368','#8f9a57','#d0bc83'][i%4]))
    }
    const birdGeometry = new THREE.BufferGeometry()
    birdGeometry.setAttribute('position', new THREE.Float32BufferAttribute([0,0,.4,-1,0,-.25,0,.2,0,0,0,.4,0,.2,0,1,0,-.25], 3)); birdGeometry.computeVertexNormals()
    this.birds = new THREE.InstancedMesh(birdGeometry, new THREE.MeshBasicMaterial({ color: '#405446', side: THREE.DoubleSide }), 6)
    this.birds.frustumCulled = false; this.group.add(this.birds)
    game.renderer.scene.add(this.group); bin.object3D(this.group)
    const tick = () => this.update()
    game.ticker.events.on('tick', tick, 10); bin.add(() => game.ticker.events.off('tick', tick))
  }

  /**
   * May something grow here?
   *
   * This used to be twenty lines of hand-written geometry that
   * disagreed with the near-identical twenty lines in
   * SceneryDetails.ts and the third set in world.ts. It is now one
   * call into `world-layout`, which is also what the tower and island
   * generators, the respawn audit and `scripts/world-layout-check.mjs`
   * ask — so a rule fixed there is fixed everywhere, and grass can no
   * longer grow on the racing line because one of three copies of the
   * track test was missing a term.
   */
  private allowed(x: number, z: number, clearance: number): boolean {
    return isFree(x, z, {
      clearance,
      coastMargin: 10,
      // Reeds and willows belong on a bank, not four metres up it.
      shore: 0.8,
      margin: {
        // Vegetation frames a road, it does not grow in it.
        road: 2.5,
        // Trackside, not on the run-off: the old rule kept scatter
        // 14.6 m off the centreline and this matches it.
        circuit: 2,
        // A ramp needs its whole run-up clear, not just its lip.
        ramp: 8,
        // Undergrowth against a wall is fine; a tree through one is not.
        landmark: 1.5,
        plate: 1,
        water: 0.8,
      },
    })
  }

  /**
   * @param sway   wind amplitude, world metres per unit of blade height
   * @param bend   how far the plant lays over for a car on top of it,
   *               in RADIANS about its own root. Never a length.
   * @param pivot  local Y of the root. 0 for geometry that grows from
   *               its origin (blades); -1 for a centred ball (a bush,
   *               a flower head), which pivots about the bottom of the
   *               unit sphere instead of about its middle.
   * @param squash how much the canopy compresses as it leans, 0..1.
   * @param fade   [start, end] metres from the camera over which the
   *               instance shrinks away. Reaches past anything the
   *               chunk culler will hide, so a plant is always already
   *               gone before its chunk switches off.
   */
  private material(
    sway: number, bend: number, pivot = 0, squash = 0,
    fade: [number, number] = [1e5, 2e5],
  ): THREE.MeshStandardMaterial {
    const material = new THREE.MeshStandardMaterial({ roughness: .92 })
    const ecoFade = { value: new THREE.Vector2(fade[0], fade[1]) }
    material.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, {
        ecoTime: this.time, ecoWind: this.wind, ecoCar: this.car,
        ecoBlast: this.blast, ecoCam: this.cam, ecoFade,
      })
      shader.vertexShader = `varying vec3 vEcoWorld; uniform float ecoTime; uniform vec2 ecoWind; uniform vec3 ecoCar; uniform vec4 ecoBlast; uniform vec3 ecoCam; uniform vec2 ecoFade;\n${shader.vertexShader}`
      shader.fragmentShader = `varying vec3 vEcoWorld; uniform vec3 ecoCar;\n${shader.fragmentShader}`
      if(bend<.2)shader.fragmentShader=shader.fragmentShader.replace('#include <alphatest_fragment>',`#include <alphatest_fragment>
        float veil=(1.-smoothstep(3.,7.,length(vEcoWorld.xz-ecoCar.xz)))*step(ecoCar.y+2.,vEcoWorld.y);
        if(fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453)<veil*.85)discard;
      `)
      /*
        A plant hit by the car ROTATES ABOUT ITS ROOT. It does not
        stretch, and it does not scale: a vertex h above the root ends
        up at (h·sinθ, h·cosθ), which is the same h from the root that
        it started at. The previous version pushed the tip sideways by
        a fixed multiple of its height and only dropped it a little,
        which lengthened a 0.9 m blade to 2.2 m — the starburst of long
        spikes that appeared around a parked car.

        The height is measured in WORLD metres and the displacement is
        converted back through the instance's own scale, because these
        instances are scaled anisotropically (a tuft is up to twice as
        wide as it is tall). Rotating in local space and letting the
        instance matrix stretch the result afterwards is the same bug
        one level down.
      */
      /* The lean is worked out at `beginnormal_vertex`, which three.js
         runs FIRST, so the same angle can turn the normal as well as
         the position. Bending a blade without turning its normal is
         what made the flattened patch under the car go dark: a blade
         lying face-up was still being lit as though it stood on edge. */
      shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>', `
        #include <beginnormal_vertex>
        vec3 ecoRoot = (instanceMatrix * vec4(0.,${pivot.toFixed(1)},0.,1.)).xyz;
        // Instance scale, as world metres per local unit.
        float ecoSxz = max(1e-4, length(instanceMatrix[0].xyz));
        float ecoSy  = max(1e-4, length(instanceMatrix[1].xyz));
        // Local axes in world XZ, so a world direction can be expressed
        // in the instance's own frame (the instances only ever yaw).
        vec2 ecoAx = normalize(instanceMatrix[0].xz + vec2(1e-6, 0.));
        vec2 ecoAz = normalize(instanceMatrix[2].xz + vec2(0., 1e-6));

        vec2 ecoAway = ecoRoot.xz - ecoCar.xz;
        // Only what the car is actually standing among, and only what
        // is on its own level: a bush under a bridge does not flatten
        // because a car crosses above it.
        float ecoReach = 1. - smoothstep(.75, 2.5, length(ecoAway));
        float ecoNear = ecoReach * step(abs(ecoRoot.y - ecoCar.y), 2.6);
        vec2 ecoFromBlast = ecoRoot.xz - ecoBlast.xz;
        float ecoBoom = (1.-smoothstep(0.,20.,length(ecoFromBlast))) * ecoBlast.w;

        // One combined lean: the strongest influence wins the direction.
        vec2 ecoPush = normalize(ecoAway+vec2(.001)) * ecoNear
                     + normalize(ecoFromBlast+vec2(.001)) * ecoBoom * .55;
        float ecoAngle = min(${bend.toFixed(2)}, length(ecoPush) * ${bend.toFixed(2)});
        vec2 ecoDirW = normalize(ecoPush + vec2(1e-5));
        vec2 ecoDirL = vec2(dot(ecoDirW, ecoAx), dot(ecoDirW, ecoAz));

        // Rodrigues about the horizontal axis perpendicular to the lean,
        // so the normal follows the geometry exactly.
        vec3 ecoAxis = vec3(ecoDirL.y, 0., -ecoDirL.x);
        objectNormal = objectNormal * cos(ecoAngle)
                     + cross(ecoAxis, objectNormal) * sin(ecoAngle)
                     + ecoAxis * dot(ecoAxis, objectNormal) * (1. - cos(ecoAngle));
      `)
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
        #include <begin_vertex>
        vec3 root = ecoRoot;
        float wave = sin(ecoTime*1.4 + root.x*.23 + root.z*.17);
        float tip = max(0., position.y - ${pivot.toFixed(1)});
        transformed.xz += ecoWind * wave * ${sway.toFixed(2)} * (tip+.15);

        // World height of this vertex above the root.
        float ecoH = max(0., transformed.y - ${pivot.toFixed(1)}) * ecoSy;
        transformed.xz += ecoDirL * (ecoH * sin(ecoAngle)) / ecoSxz;
        transformed.y  -= (ecoH * (1. - cos(ecoAngle))) / ecoSy;
        ${squash > 0 ? `
        // A volumetric plant also compresses and its leaves shake.
        transformed.xz *= 1. - ${squash.toFixed(2)} * ecoNear;
        transformed.xz += vec2(sin(ecoTime*21.+root.x*3.1), cos(ecoTime*17.+root.z*2.7))
                          * ecoNear * .05 * tip;` : ''}

        // Distance fade. Instances shrink into the ground long before
        // the chunk they live in is culled, so nothing ever pops.
        float ecoFar = distance(root, ecoCam);
        transformed *= 1. - smoothstep(ecoFade.x, ecoFade.y, ecoFar);

        vEcoWorld=(modelMatrix*instanceMatrix*vec4(transformed,1.)).xyz;
      `)
    }
    material.customProgramCacheKey = () => `ecology-${sway}-${bend}-${pivot}-${squash}-${fade[0]}`
    return material
  }

  burst(at: THREE.Vector3, force = 1): void {
    this.blast.value.set(at.x, at.y, at.z, force)
    for (let i = 0; i < this.game.quality.count(28,8); i++) {
      const leaf = this.leaves[this.leafCursor++ % this.leaves.length]
      leaf.p.copy(at).add(new THREE.Vector3((this.rand() - .5) * 5, 3 + this.rand() * 5, (this.rand() - .5) * 5))
      leaf.v.set((this.rand() - .5) * 5 * force, this.rand() * 3, (this.rand() - .5) * 5 * force); leaf.life = 5 + this.rand() * 3; leaf.spin = this.rand() * 6
    }
  }

  private update(): void {
    const { game } = this, dt = Math.min(.05, game.ticker.delta), now = game.ticker.elapsed
    this.time.value = now; this.car.value.copy(game.player.position)
    // Vegetation fades against the CAMERA, not the car: at maximum
    // zoom-out the camera is thirty metres behind, and fading against
    // the car puts the boundary inside the frame.
    this.cam.value.copy(game.view.position)
    this.wind.value.copy(game.weather.windDirection).multiplyScalar(.3 + game.weather.windStrength)
    this.blast.value.w *= Math.exp(-dt * 3)
    if (now > this.nextChunks) {
      // Faster than the old 0.35 s: a boosting car covers twelve metres
      // in that time, which was enough to outrun the cull update.
      this.nextChunks = now + .12; this.stats.visibleChunks = 0
      const distance = game.quality.settings.drawDistance
      const eye = game.view.position
      for (const patch of this.patches) {
        // Distance to the NEAREST POINT of the chunk, not to its
        // centre. A 64 m chunk measured from its middle is wrong by up
        // to 45 m at the corners, which is what quantised the boundary
        // into something the eye could follow.
        const dx = Math.max(0, Math.abs(eye.x - patch.centre.x) - CHUNK / 2)
        const dz = Math.max(0, Math.abs(eye.z - patch.centre.z) - CHUNK / 2)
        const d = Math.hypot(dx, dz)
        patch.group.visible = d < distance + 46
        if (patch.group.visible) this.stats.visibleChunks++
        for (const mesh of patch.detail) {
          const layer = mesh.userData.layer as number
          mesh.visible = d < CULL[layer]
          mesh.count = Math.round(mesh.userData.capacity * (layer === 4 ? Math.max(.2, game.quality.settings.density) : Math.max(.45, game.quality.settings.density)))
        }
      }
      const near = this.trees.map((t, i) => ({ i, d: t.p.distanceToSquared(game.player.position) })).filter(t => t.d < 65 ** 2).sort((a,b) => a.d-b.d).slice(0, this.trunks.length)
      this.stats.activeColliders = near.length
      for (let i = 0; i < this.trunks.length; i++) {
        const physical = this.trunks[i], index = near[i]?.i ?? -1
        if (this.poolAt[i] === index) continue
        this.poolAt[i] = index; physical.body.setEnabled(index >= 0)
        if (index < 0) continue
        const tree = this.trees[index]
        physical.body.setTranslation({ x: tree.p.x, y: tree.p.y + 2, z: tree.p.z }, false)
        physical.colliders[0].setRadius(tree.radius)
      }
      if (now > this.nextLeaves && game.vehicle.xzSpeed > 2) {
        const nearest = near[0] && this.trees[near[0].i]
        if (nearest && nearest.p.distanceTo(game.player.position) < 6) { this.burst(nearest.p, .4); this.nextLeaves = now + 1.2; game.audio.environment('leaves',.6) }
      }
      if(now>this.nextDrift&&near.length) {
        const density=game.quality.settings.density
        this.nextDrift=now+(1.8+this.rand()*2)/(1+game.weather.windStrength)
        const tree=this.trees[near[Math.floor(this.rand()*Math.min(near.length,12))].i]
        for(let i=0;i<Math.ceil(4*density);i++) {
          const leaf=this.leaves[this.leafCursor++%this.leaves.length]
          leaf.p.copy(tree.p);leaf.p.x+=(this.rand()-.5)*3;leaf.p.z+=(this.rand()-.5)*3;leaf.p.y+=tree.height*.8
          leaf.v.set(this.rand()-.5,-.2-this.rand(),this.rand()-.5);leaf.life=6+this.rand()*4;leaf.spin=this.rand()*6
        }
      }
    }
    this.leaves.forEach((leaf, i) => {
      leaf.life -= dt
      this.scratch.scale.setScalar(leaf.life > 0 ? Math.min(1, leaf.life)*(.65+i%5*.14) : 0)
      if (leaf.life > 0) {
        leaf.v.y -= dt * 1.8; leaf.v.x += Math.sin(now * 2 + i) * dt; leaf.p.addScaledVector(leaf.v, dt)
        leaf.p.x += this.wind.value.x * dt; leaf.p.z += this.wind.value.y * dt

        // The car's wake. A leaf a car drives through should lift and
        // spin away from it, not sit there while the world moves past.
        const carDx = leaf.p.x - this.car.value.x
        const carDz = leaf.p.z - this.car.value.z
        const carDistance = Math.hypot(carDx, carDz)
        if (carDistance < 7 && Math.abs(leaf.p.y - this.car.value.y) < 4) {
          const push = (1 - carDistance / 7) * Math.min(1, game.vehicle.xzSpeed / 9)
          const inverse = 1 / (carDistance || 1)
          leaf.v.x += carDx * inverse * push * 13 * dt
          leaf.v.z += carDz * inverse * push * 13 * dt
          leaf.v.y += push * 9 * dt
          leaf.spin += push * 7 * dt
          leaf.life = Math.max(leaf.life, 1.6)
        }
        leaf.p.y = Math.max(game.world.terrain.colliderHeightAt(leaf.p.x, leaf.p.z) + .1, leaf.p.y)
        leaf.spin += dt * 2; this.scratch.position.copy(leaf.p); this.scratch.rotation.set(leaf.spin, leaf.spin * .3, leaf.spin * .8)
      }
      this.scratch.updateMatrix(); this.leafMesh.setMatrixAt(i, this.scratch.matrix)
    })
    this.leafMesh.instanceMatrix.needsUpdate = true
    const birdPhase = now % 105, flock = Math.floor(now / 105) % 3 === 0 ? 6 : 2
    const count = birdPhase < 22 ? Math.max(1,Math.round(flock*game.quality.settings.density)) : 0
    this.birds.count = count
    for (let i = 0; i < count; i++) {
      this.scratch.position.set(game.player.position.x - 75 + birdPhase * 6 + i * 2.6, 30 + Math.sin(now * .4 + i) * 3 + i, game.player.position.z - 24 + i * 3)
      this.scratch.rotation.set(0, -Math.PI / 2, Math.sin(now * 9 + i) * .35); this.scratch.scale.set(1, 1 + Math.sin(now * 9 + i) * .75, 1); this.scratch.updateMatrix(); this.birds.setMatrixAt(i, this.scratch.matrix)
    }
    this.birds.instanceMatrix.needsUpdate = true
    if (count && now - this.lastChirp > 12) { this.lastChirp = now; game.audio.environment('bird',.4) }
  }
}
