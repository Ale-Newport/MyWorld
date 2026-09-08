import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { Game } from '../Game'
import type { Bin } from '../core/Disposal'
import { roads, districts, WORLD_RADIUS } from '@/content/world'
import { isFree } from '@/content/world-layout'
import {
  LAKES, RIVER, BRIDGES, FOREST_POCKETS, CIRCUIT, CIRCUIT_TRACK,
  coastRadius, inlandWater,
} from '@/content/world-environment'

/* ============================================================
   SCENERY DETAIL

   The layer between "there is ground here" and "someone made this
   place": lanterns down the roads, fences where the land ends,
   benches looking at the water, tables in the clearings, signs at
   the junctions.

   In the reference, this is most of what fills a frame. Its
   opening view carries two lit lanterns, two fences, a bench and a
   roofed kiosk before you count a single tree, and that furniture
   is what makes the ground read as a place rather than as terrain
   with objects standing on it.

   EVERYTHING HERE IS DERIVED — from the road network, the lakes,
   the river, the forest pockets and the coast. Nothing is a
   hand-typed coordinate. The previous version of this file was a
   list of literal positions, and when the island was rebuilt every
   one of them ended up in the sea.

   Four merged geometries and one instanced set, so the whole layer
   is five draw calls.
   ============================================================ */

/** Walk a polyline dropping a point every `spacing` metres. */
function alongPolyline(
  points: readonly (readonly number[])[],
  spacing: number,
  from = 0,
): { x: number; z: number; angle: number }[] {
  const out: { x: number; z: number; angle: number }[] = []
  let carry = from
  for (let i = 0; i < points.length - 1; i++) {
    const [ax, az] = points[i]
    const [bx, bz] = points[i + 1]
    const length = Math.hypot(bx - ax, bz - az)
    if (length < 1e-3) continue
    const angle = Math.atan2(bz - az, bx - ax)
    for (let d = carry; d < length; d += spacing) {
      const t = d / length
      out.push({ x: ax + (bx - ax) * t, z: az + (bz - az) * t, angle })
    }
    carry = Math.max(0, carry + Math.ceil((length - carry) / spacing) * spacing - length)
  }
  return out
}

export function buildSceneryDetails(game: Game, bin: Bin): void {
  const group = new THREE.Group()
  const wood: THREE.BufferGeometry[] = []
  const metal: THREE.BufferGeometry[] = []
  const stone: THREE.BufferGeometry[] = []
  const lights: THREE.BufferGeometry[] = []
  const rand = (() => { let s = 0x9e3779b9; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) })()
  const density = game.quality.settings.density

  const box = (
    out: THREE.BufferGeometry[], x: number, y: number, z: number,
    w: number, h: number, d: number, angle = 0,
  ) => {
    const g = new THREE.BoxGeometry(w, h, d)
    if (angle) g.rotateY(angle)
    g.translate(x, y, z)
    out.push(g)
  }
  const ground = (x: number, z: number) => game.terrain.colliderHeightAt(x, z)
  /**
   * Is this a spot a player could actually stand and look at something?
   * `onPaving` is for furniture that belongs on a forecourt — lanterns
   * light paving, and rejecting them from it was leaving every plate in
   * the world unlit.
   *
   * One call into `world-layout`, like the ecology scatter. The two used
   * to carry near-identical hand-written rules with different numbers
   * (coast margin 6 against 10, track clearance 0 against 5), which is
   * how a bench came to stand on the racing line while a tree three
   * metres away was correctly rejected.
   */
  const usable = (x: number, z: number, clear = 6, onPaving = false) => {
    if (ground(x, z) < 0.2) return false
    return isFree(x, z, {
      clearance: clear,
      coastMargin: 8,
      allow: onPaving ? ['plate'] : [],
      margin: { circuit: 5, ramp: 6, water: 1.5 },
    })
  }

  /* ---- lanterns -------------------------------------------
     Down every road, alternating sides. The reference lights its
     paths this way and it is most of why its nights read. */
  const lanterns: { x: number; z: number }[] = []
  const lanternSpacing = 21 / Math.max(0.5, density)
  let side = 1
  for (const road of roads) {
    for (const point of alongPolyline(road.points, lanternSpacing, 8)) {
      side = -side
      const offset = road.width * 0.5 + 2.2
      const x = point.x + Math.sin(point.angle) * offset * side
      const z = point.z - Math.cos(point.angle) * offset * side
      if (!usable(x, z, 3, true)) continue
      lanterns.push({ x, z })
    }
  }
  // And down the pit straight, where the track meets the road network.
  for (const point of alongPolyline(CIRCUIT_TRACK.slice(0, 6), 34, 10)) {
    const x = point.x + Math.sin(point.angle) * (CIRCUIT.width * 0.5 + 4)
    const z = point.z - Math.cos(point.angle) * (CIRCUIT.width * 0.5 + 4)
    if (usable(x, z, 3, true)) lanterns.push({ x, z })
  }
  for (const { x, z } of lanterns) {
    const y = ground(x, z)
    box(metal, x, y + 1.9, z, 0.22, 3.8, 0.22)
    box(metal, x, y + 3.9, z, 0.5, 0.14, 0.5)
    box(lights, x, y + 3.5, z, 0.44, 0.62, 0.44)
    box(metal, x, y + 0.12, z, 0.7, 0.24, 0.7)
    game.physics.add({
      type: 'fixed', category: 'object',
      position: { x, y: y + 1.9, z },
      colliders: [{ shape: 'cuboid', parameters: [0.16, 1.9, 0.16] }],
    })
  }

  /* ---- benches, looking at something -----------------------
     A bench facing nothing is furniture. Each of these faces the
     water it was placed for. */
  const seats: { x: number; z: number; facing: number }[] = []
  for (const lake of LAKES) {
    for (const bearing of [0.6, 2.6, 4.3]) {
      const r = Math.max(lake.rx, lake.rz) + 7
      const x = lake.x + Math.cos(bearing) * r
      const z = lake.z + Math.sin(bearing) * r
      if (usable(x, z, 5)) seats.push({ x, z, facing: bearing + Math.PI })
    }
  }
  // Two on the coast, looking out.
  for (const bearing of [1.1, 3.9]) {
    const r = coastRadius(Math.cos(bearing), Math.sin(bearing), WORLD_RADIUS) - 26
    const x = Math.cos(bearing) * r
    const z = Math.sin(bearing) * r
    if (usable(x, z, 5)) seats.push({ x, z, facing: bearing })
  }
  for (const seat of seats) {
    const y = ground(seat.x, seat.z)
    const a = -seat.facing
    for (let plank = 0; plank < 3; plank++) {
      box(wood, seat.x, y + 0.72, seat.z, 3.6, 0.16, 0.28, a)
      wood[wood.length - 1].translate(Math.sin(a) * (plank - 1) * 0.34, 0, Math.cos(a) * (plank - 1) * 0.34)
    }
    box(wood, seat.x, y + 1.42, seat.z, 3.6, 0.74, 0.15, a)
    wood[wood.length - 1].translate(Math.sin(a) * -0.5, 0, Math.cos(a) * -0.5)
    for (const dx of [-1.4, 1.4]) {
      box(metal, seat.x + Math.cos(a) * dx, y + 0.38, seat.z - Math.sin(a) * dx, 0.14, 0.76, 0.9, a)
    }
    game.physics.add({
      type: 'fixed', category: 'object',
      position: { x: seat.x, y: y + 0.7, z: seat.z },
      colliders: [{ shape: 'cuboid', parameters: [1.9, 0.6, 0.6] }],
    })
  }

  /* ---- fences ----------------------------------------------
     Where the ground stops. Along the seaward edge of the coast
     road and either side of both bridges. */
  const rails: { x: number; z: number; angle: number }[] = []
  for (const bridge of BRIDGES) {
    for (const s of [-1, 1]) {
      for (let d = -bridge.length * 0.5; d <= bridge.length * 0.5; d += 2.6) {
        rails.push({ x: bridge.x + d, z: bridge.z + s * (bridge.width * 0.5 + 0.4), angle: 0 })
      }
    }
  }
  for (const rail of rails) {
    const y = ground(rail.x, rail.z)
    box(wood, rail.x, y + 1.0, rail.z, 0.18, 2, 0.18)
    box(wood, rail.x + 1.3, y + 1.55, rail.z, 2.6, 0.14, 0.14)
    box(wood, rail.x + 1.3, y + 0.95, rail.z, 2.6, 0.14, 0.14)
  }

  /* ---- clearings -------------------------------------------
     A table and a ring of stones in the larger woods: a reason to
     drive into a forest rather than past it. */
  const clearings = FOREST_POCKETS
    .filter((p) => p[2] >= 18)
    .filter((_, i) => i % 2 === 0)
    .slice(0, Math.max(2, Math.round(6 * density)))
  for (const [px, pz, pr] of clearings) {
    const x = px + (rand() - 0.5) * pr * 0.5
    const z = pz + (rand() - 0.5) * pr * 0.5
    if (!usable(x, z, 6)) continue
    const y = ground(x, z)
    box(wood, x, y + 0.78, z, 2.6, 0.16, 1.3)
    for (const [dx, dz] of [[-1.1, 0], [1.1, 0]]) box(wood, x + dx, y + 0.4, z + dz, 0.16, 0.8, 1.1)
    for (const s of [-1, 1]) box(wood, x, y + 0.46, z + s * 0.95, 2.6, 0.14, 0.34)
    game.physics.add({
      type: 'fixed', category: 'object',
      position: { x, y: y + 0.6, z },
      colliders: [{ shape: 'cuboid', parameters: [1.3, 0.5, 0.7] }],
    })
    // A cold fire ring, so the clearing reads as used.
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2
      box(stone, x + 3 + Math.cos(a) * 1.1, y + 0.18, z + Math.sin(a) * 1.1, 0.5, 0.36, 0.5, a)
    }
  }

  /* ---- junction signs --------------------------------------
     Named for where they actually point, read off the districts. */
  const hub = districts.find((d) => d.id === 'hub')
  if (hub) {
    const targets = ['circuit', 'archive', 'lab', 'client'] as const
    for (const id of targets) {
      const target = districts.find((d) => d.id === id)
      if (!target) continue
      const bearing = Math.atan2(target.z - hub.z, target.x - hub.x)
      const r = (hub.plate ?? 24) + 16
      const x = hub.x + Math.cos(bearing) * r
      const z = hub.z + Math.sin(bearing) * r
      if (!usable(x, z, 4, true)) continue
      const y = ground(x, z)
      box(metal, x, y + 2.1, z, 0.18, 4.2, 0.18)
      game.playground.label(`${target.short} →`, group, new THREE.Vector3(x, y + 4.4, z), 7, 1.3)
      game.physics.add({
        type: 'fixed', category: 'object',
        position: { x, y: y + 2.1, z },
        colliders: [{ shape: 'cuboid', parameters: [0.14, 2.1, 0.14] }],
      })
    }
  }

  /* ---- reeds at the waterline ------------------------------ */
  const reedGeometry = new THREE.ConeGeometry(0.16, 1.7, 4)
  reedGeometry.translate(0, 0.85, 0)
  const reedMaterial = new THREE.MeshStandardMaterial({ color: '#7f8a4e', roughness: 0.95 })
  const reedCount = Math.round(1800 * Math.max(0.3, density))
  const reeds = new THREE.InstancedMesh(reedGeometry, reedMaterial, reedCount)
  const scratch = new THREE.Object3D()
  let placed = 0
  for (let attempt = 0; attempt < reedCount * 22 && placed < reedCount; attempt++) {
    const lake = LAKES[Math.floor(rand() * LAKES.length)]
    const onRiver = rand() < 0.4
    let x: number, z: number
    if (onRiver) {
      const i = Math.floor(rand() * (RIVER.points.length - 1))
      const t = rand()
      const [ax, az] = RIVER.points[i]
      const [bx, bz] = RIVER.points[i + 1]
      const side = rand() < 0.5 ? -1 : 1
      x = ax + (bx - ax) * t + side * (RIVER.width * 0.5 + rand() * 3)
      z = az + (bz - az) * t
    } else {
      const a = rand() * Math.PI * 2
      const r = 0.94 + rand() * 0.16
      x = lake.x + Math.cos(a) * lake.rx * r
      z = lake.z + Math.sin(a) * lake.rz * r
    }
    const water = inlandWater(x, z)
    // Only in the shallows: the fringe, not the middle of the lake.
    if (!water || water.edge < -2.4 || water.edge > 2.2) continue
    scratch.position.set(x, ground(x, z) + 0.1, z)
    scratch.rotation.set((rand() - 0.5) * 0.3, rand() * 6.28, (rand() - 0.5) * 0.3)
    scratch.scale.setScalar(0.7 + rand() * 0.8)
    scratch.updateMatrix()
    reeds.setMatrixAt(placed++, scratch.matrix)
  }
  reeds.count = placed
  reeds.castShadow = false
  reeds.receiveShadow = true
  reeds.instanceMatrix.needsUpdate = true
  group.add(reeds)
  bin.add(() => { reedGeometry.dispose(); reedMaterial.dispose() })

  for (const [pieces, color, emissive] of [
    [wood, '#9f875f', false],
    [metal, '#536955', false],
    [stone, '#8d8f86', false],
    [lights, '#e7cc83', true],
  ] as const) {
    if (!pieces.length) continue
    const geometry = mergeGeometries([...pieces])
    pieces.forEach((g) => g.dispose())
    if (!geometry) continue
    const material = new THREE.MeshStandardMaterial({
      color, roughness: 0.86,
      emissive: emissive ? color : '#000000',
      emissiveIntensity: emissive ? 0.9 : 0,
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.castShadow = !emissive && game.quality.settings.shadows
    mesh.receiveShadow = true
    group.add(mesh)
    bin.add(() => { geometry.dispose(); material.dispose() })
  }

  game.renderer.scene.add(group)
  bin.object3D(group)
}
