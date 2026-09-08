import * as THREE from 'three'
import { Minigame } from './Minigame'
import { palette } from '../core/palette'
import { clamp, formatTime, lerp, lineIntersectsCircle, seeded, smoothstep } from '../core/maths'
import { textTexture } from '../world/materials'
import { chamferedBox, convexHull } from '../world/geometry'
import type { Bin } from '../core/Disposal'
import type { Game } from '../Game'
import type { MinigameId } from '@/content/world'
import { landmarkById } from '@/content/world'

/* ============================================================
   PACKET RUN

   The VPN is an encrypted proxy: a threaded TCP relay on one
   machine, a local HTTP proxy on the other, Fernet on the wire
   between them. The only part of that a visitor can be shown
   rather than told is what encryption does to an observer, so
   that is the whole landmark. Two nodes, a link across dark
   water, and a stream of packets overhead that you can READ.

   Drive the gates in order and the link flips. The packets do
   not stop, do not change route and do not change size — they
   stop being legible. Same blocks, same cadence, nothing on the
   wire that says what they are. That is the demonstration, and
   it is why the plaintext state has to run first and has to run
   long enough to be read: without the before, the after is just
   dark boxes.

   Three decisions worth naming:

   1. THE RUN IS A ROUND TRIP. Out to node A, back to node B —
      a request and its reply. Eight gates, about twenty
      seconds. This is a technical landmark, not a chapter, and
      a second lap would add nothing the first did not say.
   2. THE HAZARD IS DRAWN, NOT DUG. The terrain heightfield is
      one shared collider for the whole world and this file owns
      none of it, so the channel under the causeway is painted
      dark water at ground level rather than excavated. It has
      no walls and no colliders: a car that ends up in it drives
      straight out in any direction. During a run, falling off
      the link returns you to the last gate you took — which is
      where the hazard actually bites.
   3. THE PACKETS RUN WHETHER OR NOT ANYONE IS PLAYING, on their
      own ticker subscription. The mini-game manager only ticks
      the ACTIVE game, so anything that must animate while idle
      cannot live in `update()`.

   Gate detection is the circuit's, deliberately: only the gate
   currently targeted can register, the test is a swept segment
   against a generous disc, and there is no direction check. You
   can reverse through the target and it counts.
   ============================================================ */

/** Deck top above the ground it crosses. Two ramps get you up. */
const DECK_RISE = 2.9
/** Half the drivable width of the causeway. */
const DECK_HALF = 5
/**
 * Length of each approach ramp. Shallow enough that a car at speed
 * climbs it rather than launching off the lip.
 */
const RAMP_RUN = 12
/** The shortest deck worth having between the two ramps. */
const MIN_DECK = 8
/** How far the ramp feet stop short of the node monuments. */
const NODE_CLEARANCE = 6

/**
 * A gate disc spans the full drivable width of the deck, so no line
 * of travel between the kerbs can pass the gate without touching it.
 */
const GATE_RADIUS = 5
const GATE_HEIGHT = 3

/** Height of the packet lines above the deck, and their lane offsets. */
const WIRE_RISE = 3.6
const LANE_OFFSET = 2.6
/** Metres per second along the link. Slow enough to read a label. */
const PACKET_SPEED = 8

/**
 * Gate order, as indices into the five physical gate frames
 * (west to east). Out to node A, then back: the same frames,
 * taken twice, which is what a round trip looks like.
 */
const ORDER = [3, 2, 1, 0, 1, 2, 3, 4]
/** After this many gates the run turns round. */
const TURN_AT = 4

/** Readable payloads. Ports and protocol are the project's own. */
const PLAINTEXT_LABELS = ['GET /', 'HOST:', ':8888', 'HELLO', 'ACK']

interface Gate {
  x: number
  y: number
  centre: THREE.Vector2
}

interface Packet {
  body: THREE.Mesh
  face: THREE.Mesh
  /** Position along the link at t=0, in 0..1. */
  offset: number
  /** +1 runs A to B, -1 runs B to A. */
  direction: number
}

export class PacketRun extends Minigame {
  readonly id: MinigameId = 'packets'
  readonly title = 'PACKET RUN'

  /* ---- link geometry, resolved from the landmarks ---------- */
  private nodeAx = 0
  private nodeBx = 0
  private linkZ = 0
  private rampAFoot = 0
  private rampBFoot = 0
  private deckX0 = 0
  private deckX1 = 0
  private deckY = 0
  private wireX0 = 0
  private wireX1 = 0

  /* ---- run state ------------------------------------------- */
  private gates: Gate[] = []
  private reached = 0
  private hasPrevious = false
  private readonly previous = new THREE.Vector2()
  private readonly current = new THREE.Vector2()

  /* ---- the flip -------------------------------------------- */
  private encrypted = false
  private packets: Packet[] = []
  private packetBody!: THREE.MeshStandardMaterial
  private packetNose!: THREE.MeshBasicMaterial
  private cipherFace!: THREE.Material
  private wireMaterial!: THREE.MeshBasicMaterial
  private plainSign = new THREE.Group()
  private cipherSign = new THREE.Group()

  /* ---- scene ----------------------------------------------- */
  private group = new THREE.Group()
  private curtain!: THREE.Mesh
  private curtainMaterial!: THREE.ShaderMaterial
  private waterMaterial!: THREE.ShaderMaterial

  constructor(game: Game, bin: Bin) {
    super(game, bin)
    // The whole link is under sixty metres. Anything past this is
    // someone who has driven away, not someone taking a wide line.
    this.abandonRadius = 110
  }

  /* ========================================================
     BUILD
     ======================================================== */

  build(): void {
    const nodeA = landmarkById['vpn-node-a']
    const nodeB = landmarkById['vpn-node-b']
    this.nodeAx = nodeA.x
    this.nodeBx = nodeB.x
    this.linkZ = nodeA.z

    this.rampAFoot = this.nodeAx + NODE_CLEARANCE
    this.rampBFoot = this.nodeBx - NODE_CLEARANCE

    // The causeway is clearance + ramp + deck + ramp + clearance. If the
    // two nodes are closer together than that, the deck inverts and the
    // whole link builds inside out — which is what happened when the
    // relayout brought them to twenty-two metres apart and left this
    // game with no course at all. Shorten the ramps to fit rather than
    // build something impossible.
    const span = this.rampBFoot - this.rampAFoot
    const ramp = Math.min(RAMP_RUN, Math.max(3, (span - MIN_DECK) * 0.5))
    this.deckX0 = this.rampAFoot + ramp
    this.deckX1 = this.rampBFoot - ramp
    this.wireX0 = this.nodeAx + 4
    this.wireX1 = this.nodeBx - 4

    // The deck is level, so it clears the highest ground it crosses
    // rather than the ground at any one sample.
    let highest = -Infinity
    for (let x = this.rampAFoot; x <= this.rampBFoot; x += 2) {
      highest = Math.max(highest, this.groundAt(x))
    }
    this.deckY = highest + DECK_RISE

    this.buildChannel()
    this.buildCauseway()
    this.buildGantries()
    this.buildGates()
    this.buildPackets()

    this.game.renderer.scene.add(this.group)
    this.bin.object3D(this.group)

    // Packets, water and the target curtain animate in every state,
    // including when no one has started anything.
    const animate = () => this.animate()
    this.game.ticker.events.on('tick', animate, 15)
    this.bin.add(() => this.game.ticker.events.off('tick', animate))
  }

  private groundAt(x: number): number {
    return this.game.world.terrain.colliderHeightAt(x, this.linkZ)
  }

  /** Height of the drivable link at `x`: ground, ramp or deck. */
  private surfaceY(x: number): number {
    if (x <= this.rampAFoot || x >= this.rampBFoot) return this.groundAt(x)
    if (x >= this.deckX0 && x <= this.deckX1) return this.deckY

    if (x < this.deckX0) {
      const t = (x - this.rampAFoot) / (this.deckX0 - this.rampAFoot)
      return lerp(this.groundAt(this.rampAFoot), this.deckY, t)
    }
    const t = (x - this.rampBFoot) / (this.deckX1 - this.rampBFoot)
    return lerp(this.groundAt(this.rampBFoot), this.deckY, t)
  }

  /* ---- the hazard ------------------------------------------ */

  private buildChannel(): void {
    const x0 = this.rampAFoot + 4
    const x1 = this.rampBFoot - 4
    const halfDepth = 12

    // Segmented so every vertex sits on the terrain: one flat quad
    // would sink under the plate at one corner and float at another.
    const segmentsX = 36
    const segmentsZ = 12
    const geometry = new THREE.PlaneGeometry(x1 - x0, halfDepth * 2, segmentsX, segmentsZ)
    geometry.rotateX(-Math.PI / 2)
    const position = geometry.getAttribute('position') as THREE.BufferAttribute
    const centreX = (x0 + x1) / 2
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i) + centreX
      const z = position.getZ(i) + this.linkZ
      position.setY(i, this.game.world.terrain.colliderHeightAt(x, z) + 0.12)
    }
    position.needsUpdate = true

    this.waterMaterial = this.game.materials.own(
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: {
          uTime: { value: 0 },
          uDeep: { value: new THREE.Color(palette.voidDark) },
          uShallow: { value: new THREE.Color(palette.voidDark3) },
        },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          precision highp float;
          varying vec2 vUv;
          uniform float uTime;
          uniform vec3 uDeep;
          uniform vec3 uShallow;
          void main() {
            // Two slow bands crossing at a shallow angle. Cheaper than
            // a normal map and it reads as moving water at the only
            // distance anyone sees it from.
            float a = sin((vUv.x * 26.0) + uTime * 0.5);
            float b = sin((vUv.x * 9.0 - vUv.y * 14.0) - uTime * 0.32);
            float ripple = (a * 0.5 + b * 0.5) * 0.5 + 0.5;
            vec3 colour = mix(uDeep, uShallow, ripple * 0.35);
            // Fade the rectangle out at its edge so the channel does
            // not read as a decal someone forgot to blend.
            float edge = smoothstep(0.0, 0.09, vUv.x) * smoothstep(1.0, 0.91, vUv.x)
                       * smoothstep(0.0, 0.12, vUv.y) * smoothstep(1.0, 0.88, vUv.y);
            gl_FragColor = vec4(colour, edge * 0.94);
            #include <colorspace_fragment>
          }
        `,
      }),
    )

    const mesh = new THREE.Mesh(geometry, this.waterMaterial)
    mesh.position.set(centreX, 0, this.linkZ)
    mesh.renderOrder = 1
    this.group.add(mesh)
    this.bin.add(() => geometry.dispose())
  }

  /* ---- the crossing ---------------------------------------- */

  private buildCauseway(): void {
    const deckLength = this.deckX1 - this.deckX0
    const centreX = (this.deckX0 + this.deckX1) / 2

    // A plain box, not a chamfered one: the collider is a cuboid to
    // the deck's top face, and a bevelled visual edge would leave the
    // car apparently floating on the last half metre of the road.
    const deck = new THREE.BoxGeometry(deckLength, 0.5, DECK_HALF * 2)
    const deckMesh = new THREE.Mesh(deck, this.game.materials.tinted(palette.asphaltLight, 0.92, 0))
    deckMesh.position.set(centreX, this.deckY - 0.25, this.linkZ)
    deckMesh.receiveShadow = this.game.quality.settings.shadows
    deckMesh.castShadow = this.game.quality.settings.shadows
    this.group.add(deckMesh)
    this.bin.add(() => deck.dispose())

    this.game.physics.add({
      type: 'fixed',
      category: 'floor',
      position: { x: centreX, y: this.deckY - 0.25, z: this.linkZ },
      friction: 1,
      restitution: 0,
      colliders: [{ shape: 'cuboid', parameters: [deckLength / 2, 0.25, DECK_HALF] }],
    })

    // Struts down into the water. Decorative and collider-free: a car
    // that has fallen in should be able to drive out in a straight
    // line, not thread between posts.
    const pairs = this.game.quality.count(6, 3)
    const strut = new THREE.CylinderGeometry(0.22, 0.3, 1, 6)
    strut.translate(0, 0.5, 0)
    this.bin.add(() => strut.dispose())
    for (let i = 0; i < pairs; i++) {
      const x = lerp(this.deckX0 + 1.5, this.deckX1 - 1.5, pairs === 1 ? 0.5 : i / (pairs - 1))
      for (const sign of [-1, 1]) {
        const z = this.linkZ + sign * (DECK_HALF - 1.4)
        const foot = this.game.world.terrain.colliderHeightAt(x, z)
        const mesh = new THREE.Mesh(strut, this.game.materials.get('concreteDark'))
        mesh.position.set(x, foot, z)
        mesh.scale.y = this.deckY - 0.5 - foot
        this.group.add(mesh)
      }
    }

    this.buildRamp(this.rampAFoot, this.deckX0)
    this.buildRamp(this.rampBFoot, this.deckX1)

    // Kerbs: deck first, then one per ramp, pitched to the climb.
    // Set just inside the edge so they stand on the deck rather than
    // overhanging it, which from below is the difference between a
    // kerb and a strip of concrete floating in mid-air.
    for (const sign of [-1, 1]) {
      const z = this.linkZ + sign * (DECK_HALF - 0.1)
      this.buildKerb(this.deckX0, this.deckY, this.deckX1, this.deckY, z)
      this.buildKerb(this.rampAFoot, this.groundAt(this.rampAFoot), this.deckX0, this.deckY, z)
      this.buildKerb(this.rampBFoot, this.groundAt(this.rampBFoot), this.deckX1, this.deckY, z)
    }

    // Centre line, so the causeway reads as a road from the air.
    const dashes = this.game.quality.count(14, 7)
    const dash = new THREE.PlaneGeometry(1.8, 0.22)
    dash.rotateX(-Math.PI / 2)
    this.bin.add(() => dash.dispose())
    for (let i = 0; i < dashes; i++) {
      const x = lerp(this.deckX0 + 1, this.deckX1 - 1, i / Math.max(1, dashes - 1))
      const mesh = new THREE.Mesh(dash, this.game.materials.get('chalk'))
      mesh.position.set(x, this.deckY + 0.03, this.linkZ)
      mesh.renderOrder = 2
      this.group.add(mesh)
    }
  }

  /**
   * An approach wedge with a flat top edge. `rampGeometry` in
   * world/geometry deliberately kicks up at the lip because its ramps
   * are for jumping; a causeway approach wants the opposite, so this
   * builds its own hull and hands the same points to the collider.
   */
  private buildRamp(footX: number, topX: number): void {
    const foot = this.groundAt(footX)
    const rise = this.deckY - foot
    const length = Math.abs(topX - footX)
    const towards = Math.sign(topX - footX)
    // The tip is buried, so the car meets slope rather than a lip
    // wherever the terrain sits a few centimetres high.
    const sink = 0.4

    const hl = length / 2
    const points: THREE.Vector3[] = []
    for (const hw of [-DECK_HALF, DECK_HALF]) {
      points.push(new THREE.Vector3(-hl, -sink, hw))
      points.push(new THREE.Vector3(hl, -sink, hw))
      points.push(new THREE.Vector3(hl, rise, hw))
    }

    const geometry = convexHull(points)
    const mesh = new THREE.Mesh(geometry, this.game.materials.get('concrete'))
    const centreX = (footX + topX) / 2
    mesh.position.set(centreX, foot, this.linkZ)
    mesh.rotation.y = towards > 0 ? 0 : Math.PI
    mesh.castShadow = this.game.quality.settings.shadows
    mesh.receiveShadow = this.game.quality.settings.shadows
    this.group.add(mesh)
    this.bin.add(() => geometry.dispose())

    this.game.physics.add({
      type: 'fixed',
      category: 'floor',
      position: { x: centreX, y: foot, z: this.linkZ },
      rotation: new THREE.Quaternion().setFromEuler(
        new THREE.Euler(0, towards > 0 ? 0 : Math.PI, 0),
      ),
      friction: 1,
      restitution: 0,
      colliders: [
        { shape: 'hull', parameters: [new Float32Array(points.flatMap((p) => [p.x, p.y, p.z]))] },
      ],
    })
  }

  /** A kerb between two points on the link, pitched to match. */
  private buildKerb(x0: number, y0: number, x1: number, y1: number, z: number): void {
    const dx = x1 - x0
    const dy = y1 - y0
    const length = Math.hypot(dx, dy)
    const pitch = Math.atan2(dy, dx)
    const height = 0.62

    const geometry = chamferedBox(length, height, 0.45, 0.06)
    const mesh = new THREE.Mesh(geometry, this.game.materials.get('chalk'))
    mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2 + height / 2, z)
    mesh.rotation.z = pitch
    mesh.castShadow = this.game.quality.settings.shadows
    this.group.add(mesh)
    this.bin.add(() => geometry.dispose())

    this.game.physics.add({
      type: 'fixed',
      category: 'floor',
      position: { x: (x0 + x1) / 2, y: (y0 + y1) / 2 + height / 2, z },
      rotation: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, pitch)),
      friction: 0.4,
      restitution: 0.2,
      colliders: [{ shape: 'cuboid', parameters: [length / 2, height / 2, 0.225] }],
    })
  }

  /* ---- what the packets run on ----------------------------- */

  private buildGantries(): void {
    const beamY = this.deckY + WIRE_RISE + 0.6
    const stations = [
      this.wireX0,
      lerp(this.wireX0, this.wireX1, 0.25),
      lerp(this.wireX0, this.wireX1, 0.5),
      lerp(this.wireX0, this.wireX1, 0.75),
      this.wireX1,
    ]

    const mast = new THREE.BoxGeometry(0.3, 1, 0.3)
    mast.translate(0, 0.5, 0)
    this.bin.add(() => mast.dispose())
    const beam = new THREE.BoxGeometry(0.26, 0.26, (DECK_HALF + 1.4) * 2)
    this.bin.add(() => beam.dispose())

    for (const x of stations) {
      for (const sign of [-1, 1]) {
        const z = this.linkZ + sign * (DECK_HALF + 1.4)
        const foot = this.game.world.terrain.colliderHeightAt(x, z)
        const mesh = new THREE.Mesh(mast, this.game.materials.get('metal'))
        mesh.position.set(x, foot, z)
        mesh.scale.y = beamY - foot
        mesh.castShadow = this.game.quality.settings.shadows
        this.group.add(mesh)
      }

      // Masts carry no colliders, on the same principle as the
      // circuit's gate posts: a decorative post that stops a car at
      // speed is worse than one you can drive through.
      const beamMesh = new THREE.Mesh(beam, this.game.materials.get('metal'))
      beamMesh.position.set(x, beamY, this.linkZ)
      this.group.add(beamMesh)
    }

    // The two lines the packets run on. One material, so the flip is
    // a single colour write rather than a walk over every mesh.
    this.wireMaterial = this.game.materials.own(
      new THREE.MeshBasicMaterial({ color: new THREE.Color(palette.accent), toneMapped: false }),
    )
    const wire = new THREE.BoxGeometry(this.wireX1 - this.wireX0, 0.07, 0.07)
    this.bin.add(() => wire.dispose())
    for (const sign of [-1, 1]) {
      const mesh = new THREE.Mesh(wire, this.wireMaterial)
      mesh.position.set(
        (this.wireX0 + this.wireX1) / 2,
        this.deckY + WIRE_RISE + 0.5,
        this.linkZ + sign * LANE_OFFSET,
      )
      this.group.add(mesh)
    }

    this.buildSigns((this.wireX0 + this.wireX1) / 2, beamY)
  }

  /**
   * Two boards on the middle gantry, one visible at a time. Both are
   * built at load: swapping visibility costs nothing, whereas drawing
   * a canvas the moment the run completes costs a frame.
   */
  private buildSigns(x: number, beamY: number): void {
    const boards: [THREE.Group, string, string, string][] = [
      [this.plainSign, 'PLAINTEXT LINK', 'READABLE ON THE WIRE', palette.chalk],
      [this.cipherSign, 'ENCRYPTED TUNNEL', 'FERNET · AUTHENTICATED', palette.signalSoft],
    ]

    for (const [group, text, subline, colour] of boards) {
      const { texture, aspect } = textTexture({
        text,
        sublines: [subline],
        color: colour,
        letterSpacing: 0.1,
        size: 96,
        weight: 600,
      })
      this.bin.add(() => texture.dispose())

      const height = 1.6
      const width = height * aspect
      const backing = chamferedBox(0.18, height + 0.4, width + 0.5, 0.06)
      const backMesh = new THREE.Mesh(backing, this.game.materials.get('ink'))
      group.add(backMesh)
      this.bin.add(() => backing.dispose())

      const material = this.game.materials.own(
        new THREE.MeshBasicMaterial({
          map: texture, transparent: true, depthWrite: false, toneMapped: false,
        }),
      )
      // One plane per face rather than a double-sided one: mirrored
      // text on the back of a sign is worse than a second draw call.
      for (const sign of [-1, 1]) {
        const plane = new THREE.PlaneGeometry(width, height)
        const mesh = new THREE.Mesh(plane, material)
        mesh.position.x = sign * 0.1
        mesh.rotation.y = sign * (Math.PI / 2)
        group.add(mesh)
        this.bin.add(() => plane.dispose())
      }

      group.position.set(x, beamY + height / 2 + 0.5, this.linkZ)
      this.group.add(group)
    }

    this.cipherSign.visible = false
  }

  /* ---- the gates ------------------------------------------- */

  private buildGates(): void {
    // Five frames, west to east. The outer two stand at the node
    // terminals; the inner three sit on the deck and its ramp tops.
    const xs = [
      this.nodeAx + 4,
      this.deckX0,
      (this.deckX0 + this.deckX1) / 2,
      this.deckX1,
      this.rampBFoot,
    ]

    const post = new THREE.BoxGeometry(0.34, 1, 0.34)
    post.translate(0, 0.5, 0)
    this.bin.add(() => post.dispose())
    const lintel = new THREE.BoxGeometry(0.34, 0.22, (DECK_HALF + 0.6) * 2)
    this.bin.add(() => lintel.dispose())

    for (const x of xs) {
      const y = this.surfaceY(x)
      this.gates.push({ x, y, centre: new THREE.Vector2(x, this.linkZ) })

      // The frame is wider than the deck so the curtain covers the
      // whole drivable width, which stands the posts of the three
      // deck-level gates over open air. Each is stretched down to the
      // terrain under it and up to the lintel, rather than starting at
      // deck height and hanging there.
      for (const sign of [-1, 1]) {
        const z = this.linkZ + sign * (DECK_HALF + 0.6)
        const foot = this.game.world.terrain.colliderHeightAt(x, z)
        const mesh = new THREE.Mesh(post, this.game.materials.get('emissiveAccent'))
        mesh.position.set(x, foot, z)
        mesh.scale.y = y + GATE_HEIGHT - foot
        this.group.add(mesh)
      }
      const top = new THREE.Mesh(lintel, this.game.materials.get('emissiveAccent'))
      top.position.set(x, y + GATE_HEIGHT, this.linkZ)
      this.group.add(top)
    }

    // One curtain, teleported to whichever gate is next — the
    // circuit's trick, and the reason eight gates cost one draw call.
    const geometry = new THREE.PlaneGeometry(1, 1)
    this.curtainMaterial = this.game.materials.own(
      new THREE.ShaderMaterial({
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
        uniforms: {
          uTime: { value: 0 },
          uColor: { value: new THREE.Color(palette.accent) },
        },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          precision highp float;
          varying vec2 vUv;
          uniform float uTime;
          uniform vec3 uColor;
          void main() {
            // Bands travel across the gate, not down it: the curtain
            // is a slice of the packet stream, so it moves like one.
            float bands = step(0.55, fract(vUv.x * 7.0 - uTime * 0.7));
            float alpha = (1.0 - vUv.y) * (0.22 + bands * 0.5);
            if (alpha < 0.02) discard;
            gl_FragColor = vec4(uColor, alpha);
            #include <colorspace_fragment>
          }
        `,
      }),
    )
    this.curtain = new THREE.Mesh(geometry, this.curtainMaterial)
    this.curtain.rotation.y = Math.PI / 2
    this.curtain.scale.set((DECK_HALF + 0.6) * 2, GATE_HEIGHT, 1)
    this.curtain.visible = false
    this.curtain.renderOrder = 4
    this.group.add(this.curtain)
    this.bin.add(() => geometry.dispose())
  }

  /* ---- the packets ----------------------------------------- */

  private buildPackets(): void {
    const random = seeded(8080)

    this.packetBody = this.game.materials.own(
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(palette.chalk),
        roughness: 0.72,
        metalness: 0,
        flatShading: true,
      }),
    )
    this.packetNose = this.game.materials.own(
      new THREE.MeshBasicMaterial({ color: new THREE.Color(palette.accent), toneMapped: false }),
    )

    const faceMaterials = PLAINTEXT_LABELS.map((label) => {
      const texture = packetFace(label, palette.ink, palette.paper, false, random)
      this.bin.add(() => texture.dispose())
      return this.game.materials.own(
        new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }),
      )
    })

    const cipherTexture = packetFace('', palette.signalSoft, palette.voidDark2, true, random)
    this.bin.add(() => cipherTexture.dispose())
    this.cipherFace = this.game.materials.own(
      new THREE.MeshBasicMaterial({ map: cipherTexture, toneMapped: false }),
    )

    const body = chamferedBox(1.6, 0.52, 0.94, 0.07)
    this.bin.add(() => body.dispose())
    const face = new THREE.PlaneGeometry(1.42, 0.8)
    face.rotateX(-Math.PI / 2)
    this.bin.add(() => face.dispose())
    const nose = new THREE.BoxGeometry(0.1, 0.4, 0.86)
    this.bin.add(() => nose.dispose())

    const count = this.game.quality.count(18, 8)
    for (let i = 0; i < count; i++) {
      const direction = i % 2 === 0 ? 1 : -1
      const mesh = new THREE.Mesh(body, this.packetBody)
      mesh.castShadow = false

      const label = new THREE.Mesh(face, faceMaterials[i % faceMaterials.length])
      label.position.y = 0.27
      mesh.add(label)

      const tip = new THREE.Mesh(nose, this.packetNose)
      tip.position.x = direction * 0.82
      mesh.add(tip)

      this.group.add(mesh)
      this.packets.push({
        body: mesh,
        face: label,
        // Half a lane's spacing between the two directions, so the
        // two streams read as traffic rather than as one grid.
        offset: ((i >> 1) + (direction < 0 ? 0.5 : 0)) / Math.ceil(count / 2),
        direction,
      })
    }
  }

  /* ========================================================
     ALWAYS-ON ANIMATION
     ======================================================== */

  private animate(): void {
    const time = this.game.ticker.elapsedScaled
    this.waterMaterial.uniforms.uTime.value = time
    this.curtainMaterial.uniforms.uTime.value = time

    const span = this.wireX1 - this.wireX0
    const rate = PACKET_SPEED / span
    const y = this.deckY + WIRE_RISE

    for (const packet of this.packets) {
      let t = (packet.offset + time * rate) % 1
      if (t < 0) t += 1

      const x = packet.direction > 0
        ? this.wireX0 + t * span
        : this.wireX1 - t * span

      packet.body.position.set(x, y, this.linkZ + packet.direction * LANE_OFFSET)

      // Packets are made and consumed at the node terminals rather
      // than popping into existence halfway along the wire.
      const scale = smoothstep(t, 0, 0.05) * (1 - smoothstep(t, 0.95, 1))
      packet.body.visible = scale > 0.03
      packet.body.scale.setScalar(Math.max(scale, 0.001))
    }
  }

  /* ========================================================
     LIFECYCLE
     ======================================================== */

  start(): boolean {
    if (this.running) return true
    if (!super.start()) return false

    // Seed the swept test from where the run actually begins, so the
    // first frame cannot register a gate the player drove past before
    // pressing anything.
    this.previous.set(this.game.player.position.x, this.game.player.position.z)
    this.hasPrevious = true
    this.setTarget(0)
    this.publish()
    return true
  }

  protected reset(): void {
    this.reached = 0
    this.hasPrevious = false
    this.curtain.visible = false
    // Nothing else to undo. The run never locks the player, never
    // opens a cinematic and never disables a collider: the deck,
    // ramps and kerbs are permanent world geometry, on in every
    // state. The one camera move — the snap in `returnToLastGate` —
    // lands on the car in a frame and leaves no mode behind. So a
    // cancel at any moment leaves the world as the player found it.
  }

  /* ========================================================
     TICK
     ======================================================== */

  protected tick(delta: number): void {
    void delta
    const position = this.game.player.position

    // Off the link. The clock keeps running — losing the position is
    // the penalty, and a time penalty on top of it is punishment twice.
    if (
      position.x > this.rampAFoot &&
      position.x < this.rampBFoot &&
      Math.abs(position.z - this.linkZ) < 20 &&
      position.y < this.surfaceY(position.x) - 1.6
    ) {
      this.returnToLastGate()
      return
    }

    this.current.set(position.x, position.z)
    if (!this.hasPrevious) {
      this.previous.copy(this.current)
      this.hasPrevious = true
      return
    }

    const gate = this.gates[ORDER[this.reached]]
    // Proximity OR swept. Proximity alone misses a gate at speed,
    // because the car covers more than the disc in one step; the
    // swept test alone misses a car that has stopped inside the disc,
    // because a zero-length segment has no nearest point.
    const hit =
      this.current.distanceTo(gate.centre) <= GATE_RADIUS ||
      lineIntersectsCircle(this.previous, this.current, gate.centre, GATE_RADIUS)

    if (hit) {
      this.previous.copy(this.current)
      this.registerGate()
      return
    }

    this.previous.copy(this.current)
  }

  private registerGate(): void {
    this.reached++
    // Each gate a step sharper, so a run audibly climbs.
    this.game.audio?.blip(1 + (this.reached - 1) * 0.07)

    if (this.reached >= ORDER.length) {
      this.complete()
      return
    }
    this.setTarget(this.reached)
  }

  private setTarget(step: number): void {
    const gate = this.gates[ORDER[step]]
    this.curtain.visible = true
    this.curtain.position.set(gate.x, gate.y + GATE_HEIGHT / 2, this.linkZ)
  }

  private returnToLastGate(): void {
    // Facing the way the run was going when it went wrong. Heading
    // -X on the way out to node A, +X on the way back.
    const outbound = this.reached < TURN_AT
    const rotation = outbound ? Math.PI : 0
    const gateX = this.reached === 0
      ? this.rampBFoot
      : this.gates[ORDER[this.reached - 1]].x

    // Three metres back down the link, and clamped clear of both node
    // monuments: the gate at node A is close enough to the plinth that
    // an unclamped offset would put the car inside it.
    const x = clamp(gateX + (outbound ? 3 : -3), this.nodeAx + 5, this.nodeBx - 5)
    const position = new THREE.Vector3(x, this.surfaceY(x) + 2.2, this.linkZ)

    this.game.vehicle.moveTo(position, rotation)
    this.game.view.focusPoint.trackedPosition.copy(position)
    this.game.view.snapToTarget()
    this.hasPrevious = false
    this.game.audio?.play('fail')
  }

  /* ========================================================
     THE FLIP
     ======================================================== */

  private complete(): void {
    this.curtain.visible = false
    if (!this.encrypted) this.encrypt()

    this.game.achievements.set('tunnel', 1)
    this.game.view.kick(0.35)
    this.finish(this.elapsed)
  }

  /** One way, for the session. The link does not go back to plaintext. */
  private encrypt(): void {
    this.encrypted = true

    // Same blocks, same route, same cadence. Only the content goes.
    this.packetBody.color.set(palette.ink)
    this.packetBody.roughness = 0.5
    this.packetNose.color.set(palette.signalSoft)
    this.wireMaterial.color.set(palette.signalSoft)
    for (const packet of this.packets) packet.face.material = this.cipherFace

    this.plainSign.visible = false
    this.cipherSign.visible = true

    this.game.audio?.play('interact')
    this.game.store.getState().notify({
      kind: 'info',
      title: 'ENCRYPTED TUNNEL',
      body: 'Every payload on this link is a Fernet token now. Same blocks, same route — nothing on the wire says what they are.',
      duration: 5,
    })
  }

  /* ========================================================
     HUD
     ======================================================== */

  protected lines(): string[] {
    // The base class publishes once more after `tick` returns, which
    // is after a completed run has already written its result. This
    // is the line that has to survive that write.
    if (this.state === 'finished') return ['ENCRYPTED', formatTime(this.elapsed)]

    // The best time is not repeated here — `publish` hands it to the
    // HUD as its own field. Which way to drive is worth more space.
    return [
      formatTime(this.elapsed),
      `GATE ${Math.min(this.reached + 1, ORDER.length)}/${ORDER.length}`,
      this.hint() ?? '',
    ]
  }

  protected hint(): string | null {
    if (!this.running) return null
    return this.reached < TURN_AT ? 'OUT TO NODE A' : 'BACK TO NODE B'
  }

  protected progress(): number | null {
    return clamp(this.reached / ORDER.length, 0, 1)
  }

  /** Whether the link has been flipped this session. */
  get isEncrypted(): boolean {
    return this.encrypted
  }
}

/* ============================================================
   PACKET FACES

   Drawn here rather than through `textTexture` because every
   packet must be exactly the same canvas size. The comparison
   only works if the blocks are identical and the CONTENT is the
   only thing that changes; a helper that sizes itself to its
   text would make the ciphertext block a different shape, which
   is the one thing encryption does not do here.
   ============================================================ */

const CIPHER_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz0123456789-_'

function packetFace(
  label: string,
  ink: string,
  paper: string,
  cipher: boolean,
  random: () => number,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 96
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('[world] 2D canvas unavailable')

  ctx.fillStyle = paper
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = ink
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  if (cipher) {
    // Drawn once and shared by every encrypted packet. Uniform is
    // the point: an observer cannot tell two ciphertexts apart, so
    // neither can the visitor.
    ctx.font = '600 30px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
    for (let row = 0; row < 3; row++) {
      let text = ''
      for (let i = 0; i < 11; i++) {
        text += CIPHER_ALPHABET[Math.floor(random() * CIPHER_ALPHABET.length)]
      }
      ctx.globalAlpha = row === 0 ? 1 : 0.6
      ctx.fillText(text, canvas.width / 2, 22 + row * 28)
    }
    ctx.globalAlpha = 1
  } else {
    ctx.font = '700 40px ui-sans-serif, system-ui, -apple-system, Helvetica, Arial, sans-serif'
    ctx.fillText(label, canvas.width / 2, 36)
    // The rest of the payload: too small to read at driving
    // distance, but visibly there and visibly structured.
    ctx.globalAlpha = 0.4
    ctx.fillRect(40, 64, 176, 6)
    ctx.fillRect(40, 78, 118, 6)
    ctx.globalAlpha = 1
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  texture.needsUpdate = true
  return texture
}
