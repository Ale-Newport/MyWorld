import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { Game } from '../Game'
import type { Bin } from '../core/Disposal'
import type { Physical } from '../physics/Physics'
import { seeded } from '../core/maths'
import { roads, landmarks, ramps, respawns, districts } from '@/content/world'
import { FOREST_POCKETS, PLAY_SPOTS, CIRCUIT, RELAY_POINTS, WATERFALL, inlandWater, lineDistance } from '@/content/world-environment'

/** Original, seeded island ecology. Instancing/chunks and reactive foliage are
 * informed by folio-2025 Trees, Foliage, Grass and Leaves (MIT; see notices).
 * No upstream models, textures or shaders are copied. Colliders are independent
 * of visual quality; a fixed pool follows the nearest trunks. */
type Instance = { p: THREE.Vector3; scale: THREE.Vector3; yaw: number; color: THREE.Color }
type Patch = { centre: THREE.Vector3; group: THREE.Group; detail: THREE.InstancedMesh[] }
export type TreeKind = 'oak' | 'birch' | 'pine' | 'cedar' | 'willow' | 'olive' | 'young' | 'landmark'
type Tree = { p: THREE.Vector3; radius: number; height: number; kind: TreeKind }
const KINDS: TreeKind[] = ['oak', 'birch', 'pine', 'cedar', 'willow', 'olive', 'young', 'landmark']

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
    const solid = new THREE.MeshStandardMaterial({ roughness: .95 })
    const canopy = this.material(.085, .10)
    const flexible = this.material(.38, 1.3)
    const grassMaterial = this.material(.55, 2.3)
    grassMaterial.side = THREE.DoubleSide
    const buckets = new Map<string, { centre: THREE.Vector3; data: Instance[][] }>()
    const add = (layer: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, color: string, yaw = r() * 6.28) => {
      const key = `${Math.floor(x / 64)},${Math.floor(z / 64)}`
      let bucket = buckets.get(key)
      if (!bucket) { bucket = { centre: new THREE.Vector3(Math.floor(x / 64) * 64 + 32, 0, Math.floor(z / 64) * 64 + 32), data: Array.from({ length: 7 }, () => []) }; buckets.set(key, bucket) }
      bucket.data[layer].push({ p: new THREE.Vector3(x, y, z), scale: new THREE.Vector3(sx, sy, sz), yaw, color: new THREE.Color(color).multiplyScalar(.87 + r() * .25) })
    }
    // A tree's family affects silhouette, branching, canopy height and palette.
    for (let attempt = 0; attempt < 11000 && this.trees.length < 920; attempt++) {
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
    for (let i = 0; i < 57000; i++) {
      const x = (r() - .5) * 670, z = (r() - .5) * 670
      if (!this.allowed(x, z, .5)) continue
      const y = game.world.terrain.colliderHeightAt(x, z), water = inlandWater(x, z)
      const forest = FOREST_POCKETS.some(p => Math.hypot(x - p[0], z - p[1]) < p[2] * 1.18)
      if (i < 2400 && forest) {
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
    const materials = [solid, canopy, canopy, flexible, grassMaterial, flexible, solid]
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
    this.leafMesh = new THREE.InstancedMesh(leaf, new THREE.MeshStandardMaterial({ color: '#adb85f', side: THREE.DoubleSide, roughness: 1 }), 160)
    this.leafMesh.frustumCulled = false; this.group.add(this.leafMesh)
    for (let i = 0; i < 160; i++) {
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

  private allowed(x: number, z: number, clearance: number): boolean {
    if (Math.hypot(x, z) > 336) return false
    if (Math.hypot(x-WATERFALL.x,z-WATERFALL.z)<15+clearance) return false
    if (Math.hypot(x - CIRCUIT.x, z - CIRCUIT.z) < 80) return false
    if (districts.some(d => ['labyrinth','lab','chess','focus','gym','network','stock'].includes(d.id) && Math.hypot(x-d.x,z-d.z)<d.radius+7)) return false
    const water = inlandWater(x, z)
    if (water && water.edge > -.8) return false
    if (roads.some(road => lineDistance(x, z, road.points) < road.width / 2 + clearance + 1.5)) return false
    if (landmarks.some(p => Math.hypot(x - p.x, z - p.z) < Math.max(9, p.radius ?? 12) + clearance + 3)) return false
    if (respawns.some(p => Math.hypot(x - p.x, z - p.z) < 9 + clearance)) return false
    if (PLAY_SPOTS.some(p => Math.hypot(x - p.x, z - p.z) < p.radius + clearance)) return false
    if (RELAY_POINTS.some(p => Math.hypot(x-p[0],z-p[1])<9+clearance)) return false
    if (ramps.some(p => Math.hypot(x - p.x, z - p.z) < p.length + 14)) return false
    // Preserve whole arenas, not just their centre markers.
    if (Math.hypot(x + 206, z - 129) < 66 || Math.hypot(x + 4, z + 176) < 57 || Math.hypot(x, z) < 59) return false
    return true
  }

  private material(sway: number, bend: number): THREE.MeshStandardMaterial {
    const material = new THREE.MeshStandardMaterial({ roughness: .92 })
    material.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, { ecoTime: this.time, ecoWind: this.wind, ecoCar: this.car, ecoBlast: this.blast })
      shader.vertexShader = `varying vec3 vEcoWorld; uniform float ecoTime; uniform vec2 ecoWind; uniform vec3 ecoCar; uniform vec4 ecoBlast;\n${shader.vertexShader}`
      shader.fragmentShader = `varying vec3 vEcoWorld; uniform vec3 ecoCar;\n${shader.fragmentShader}`
      if(bend<.2)shader.fragmentShader=shader.fragmentShader.replace('#include <alphatest_fragment>',`#include <alphatest_fragment>
        float veil=(1.-smoothstep(3.,7.,length(vEcoWorld.xz-ecoCar.xz)))*step(ecoCar.y+2.,vEcoWorld.y);
        if(fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453)<veil*.85)discard;
      `)
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
        #include <begin_vertex>
        vec3 root = (instanceMatrix * vec4(0.,0.,0.,1.)).xyz;
        float wave = sin(ecoTime*1.4 + root.x*.23 + root.z*.17);
        float tip = max(0., position.y);
        transformed.xz += ecoWind * wave * ${sway.toFixed(2)} * (tip+.15);
        vec2 away = root.xz - ecoCar.xz;
        float nearCar = 1. - smoothstep(1.,5.,length(away));
        transformed.xz += normalize(away+vec2(.001)) * nearCar * ${bend.toFixed(2)} * tip;
        transformed.y -= nearCar * tip * ${Math.min(.55, bend * .15).toFixed(2)};
        vec2 fromBlast = root.xz - ecoBlast.xz;
        transformed.xz += normalize(fromBlast+vec2(.001)) * (1.-smoothstep(0.,20.,length(fromBlast))) * ecoBlast.w * tip * .5;
        vEcoWorld=(modelMatrix*instanceMatrix*vec4(transformed,1.)).xyz;
      `)
    }
    material.customProgramCacheKey = () => `ecology-${sway}-${bend}`
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
    this.wind.value.copy(game.weather.windDirection).multiplyScalar(.3 + game.weather.windStrength)
    this.blast.value.w *= Math.exp(-dt * 3)
    if (now > this.nextChunks) {
      this.nextChunks = now + .35; this.stats.visibleChunks = 0
      const distance = game.quality.settings.drawDistance
      for (const patch of this.patches) {
        const d = patch.centre.distanceTo(game.player.position)
        patch.group.visible = d < distance + 46
        if (patch.group.visible) this.stats.visibleChunks++
        for (const mesh of patch.detail) {
          const layer = mesh.userData.layer as number
          mesh.visible = d < (layer === 4 ? 80 : layer === 3 ? 150 : 105)
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
