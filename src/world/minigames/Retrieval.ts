import * as THREE from 'three'
import { Minigame } from './Minigame'
import { palette } from '../core/palette'
import { clamp, dist2, seeded } from '../core/maths'
import { textTexture } from '../world/materials'
import { chamferedBox } from '../world/geometry'
import type { Bin } from '../core/Disposal'
import type { Game } from '../Game'
import { ZONE_HYSTERESIS, type Zone } from '../systems/Zones'
import type { MinigameId } from '@/content/world'
import { landmarkById } from '@/content/world'

/* ============================================================
   RETRIEVAL

   A RAG pipeline played as a driving game, in the AI lab. The
   corpus is already there — `lab-corpus` stands a field of thin
   pillars up as light. This adds the part of retrieval you cannot
   see in a document store: the clusters an embedding actually
   lands in.

   The loop is one query, three chunks:

     A query appears in the HUD. Five clusters light up around the
     corpus, each labelled with a region of the corpus, and exactly
     one answers the query. Drive into it and that chunk goes into
     context; the cluster dims and is spent. Three chunks, then the
     answer is generated and the run is over.

   Three decisions behind it:

   1. THE PIPELINE READOUT IS THE SCOREBOARD. The HUD strip
      QRY→EMB→RET→CTX→GEN lights one more stage per retrieval, so
      the thing being scored is the architecture rather than a
      clock. There is no timer and no best time: rewarding speed
      here would reward guessing, which is the opposite of what
      retrieval is.
   2. NOTHING IS SOLID. The clusters are light and a zone trigger.
      The car drives through them exactly as it drives through the
      corpus, so there is no geometry to get wedged in and the
      whole field stays a place you can cross at speed.
   3. ARMING IS MEASURED, NOT REMEMBERED. A cluster only counts if
      the player was OUTSIDE it when the round began, tested by
      distance rather than by the zone's own `isIn`. Without that,
      finishing round one parked inside a cluster would fail round
      two before the player had touched the throttle — and a
      disabled zone reports a `leave` it did not really have.

   A wrong cluster fails the run with WRONG CLUSTER and re-rolls,
   so a second attempt is a different set of queries. It is never
   a dead end: the run clears itself after the message, the
   terminal is a few seconds away, and every escape the base class
   binds still works because this game locks nothing.
   ============================================================ */

const ROUNDS = 3
const CLUSTER_COUNT = 5

/** Trigger radius in metres. Gameplay: never scaled by quality. */
const CLUSTER_RADIUS = 6.5
/** How far the clusters stand from the centre of the corpus. */
const CLUSTER_RING = 26

/**
 * Where each cluster stands, in degrees around the corpus, measured so
 * that 0° is +X and 90° is +Z (south).
 *
 * All five are in the NORTHERN half. They used to be spread all the way
 * round at [250, 310, 10, 70, 130], and two of them landed on top of
 * another mini-game: the cluster at 310° stood 70 cm from PACKET RUN's
 * third gate frame in the middle of its causeway, and the one at 250°
 * was 5.4 m from the NODE A monument, over the west ramp's foot. A
 * cluster zone is a cylinder that ignores height, so driving the
 * causeway 2.9 m above one of these rings triggered it. The southern
 * arc belongs to the causeway; the corpus is only ever approached from
 * the north anyway, because that is where the road and the terminal are.
 */
const CLUSTER_ANGLES = [22, 56, 90, 124, 158]

/** Past this distance from the corpus you are no longer in the field. */
const FIELD_RADIUS = 44

const BEAM_HEIGHT = 15
const LABEL_HEIGHT = 10.4
const LABEL_SIZE = 1.15

const SEED = 90210

/* ---- the pipeline ---------------------------------------- */

const STAGES = [
  { code: 'QRY', name: 'QUERY' },
  { code: 'EMB', name: 'EMBEDDING' },
  { code: 'RET', name: 'RETRIEVAL' },
  { code: 'CTX', name: 'CONTEXT' },
  { code: 'GEN', name: 'GENERATION' },
] as const

/* ---- the corpus ------------------------------------------ */

/** Regions of the document store. One per cluster, per round. */
const TOPICS = [
  'SUPPORT TICKETS',
  'CONTRACTS',
  'INVOICES',
  'MEETING NOTES',
  'ONBOARDING DOCS',
  'RELEASE NOTES',
  'SECURITY POLICY',
  'MODEL EVALS',
  'INCIDENT REPORTS',
]

interface Query {
  /** Shown in the HUD. Kept short: the readout is large type. */
  text: string
  topic: string
  /**
   * Topics that would also be a defensible answer. Excluded from
   * the distractors so the round has exactly one right cluster —
   * an outage lives in both the incident log and the ticket queue,
   * and a game that punishes the reasonable reading is a bad game.
   */
  avoid?: string[]
}

const QUERIES: Query[] = [
  { text: 'REFUND ON INVOICE 4471', topic: 'INVOICES' },
  { text: 'CUSTOMER CANNOT LOG IN', topic: 'SUPPORT TICKETS', avoid: ['INCIDENT REPORTS'] },
  { text: 'RENEWAL TERMS FOR ACME', topic: 'CONTRACTS' },
  { text: 'ACTIONS FROM THE STANDUP', topic: 'MEETING NOTES' },
  { text: 'FIRST WEEK LAPTOP SETUP', topic: 'ONBOARDING DOCS' },
  { text: 'WHAT SHIPPED IN 2.4', topic: 'RELEASE NOTES' },
  { text: 'HOW LONG WE KEEP LOGS', topic: 'SECURITY POLICY' },
  { text: 'BLEU SCORE ON RERANKING', topic: 'MODEL EVALS' },
  { text: 'ROOT CAUSE OF THE OUTAGE', topic: 'INCIDENT REPORTS', avoid: ['SUPPORT TICKETS'] },
]

/* ---- colours, resolved once ------------------------------ */

const LIVE_COLOUR = new THREE.Color(palette.signalSoft)
const SPENT_COLOUR = new THREE.Color(palette.ink3)
const HIT_COLOUR = new THREE.Color(palette.chalk)
const MISS_COLOUR = new THREE.Color(palette.accent)
const LABEL_LIVE = new THREE.Color(palette.chalk)
const LABEL_SPENT = new THREE.Color(palette.ink4)

type Phase = 'idle' | 'seeking' | 'context' | 'generating' | 'missed'

interface Cluster {
  index: number
  /** World position on the ground, centre of the trigger. */
  position: THREE.Vector3
  group: THREE.Group
  /** Ring and pillars: the visible edge of the trigger. */
  material: THREE.MeshBasicMaterial
  beam: THREE.Mesh
  beamMaterial: THREE.MeshBasicMaterial
  label: THREE.Mesh
  labelMaterial: THREE.MeshBasicMaterial
  zone: Zone<number>
  /** False until the player has been outside it since the round began. */
  armed: boolean
  /** 0..1 fade-in, driven when a round starts. */
  appear: number
  /** 0..1 decaying hit or miss flash. */
  flash: number
  flashColour: THREE.Color
  spent: boolean
  /** Offsets the idle pulse so five clusters do not breathe in unison. */
  phase: number
}

interface Round {
  query: Query
  /** Index of the cluster holding the match. */
  answer: number
  /** Topic per cluster; null leaves a spent cluster's label alone. */
  labels: (string | null)[]
}

export class Retrieval extends Minigame {
  readonly id: MinigameId = 'retrieval'
  readonly title = 'RETRIEVAL'

  private group = new THREE.Group()
  private clusters: Cluster[] = []
  private labelTextures = new Map<string, { texture: THREE.CanvasTexture; aspect: number }>()

  private corpus = new THREE.Vector3()

  private rounds: Round[] = []
  private round = 0
  private retrieved = 0
  private stage = 0
  private phase: Phase = 'idle'
  private wandering = false
  private lit = false

  /** How many runs have been rolled. Keeps a retry from repeating. */
  private attempt = 0
  /** Invalidates delayed callbacks belonging to an abandoned run. */
  private token = 0

  constructor(game: Game, bin: Bin) {
    super(game, bin)
    // The furthest cluster is about 60 m from the terminal, so this
    // only fires when someone has genuinely left the lab.
    this.abandonRadius = 150
  }

  /* ========================================================
     BUILD
     ======================================================== */

  build(): void {
    const corpus = landmarkById['lab-corpus']
    const terminal = landmarkById['lab-retrieval']
    this.corpus.set(
      corpus.x,
      this.game.world.terrain.colliderHeightAt(corpus.x, corpus.z),
      corpus.z,
    )

    this.buildLabelTextures()
    this.buildClusters()
    this.buildBoard(terminal)

    this.game.renderer.scene.add(this.group)
    this.bin.object3D(this.group)
  }

  /**
   * One texture per topic, built once. Labels change three times a
   * run, and re-rasterising a canvas on every change would leak a
   * texture each time or cost a stall at the worst moment.
   */
  private buildLabelTextures(): void {
    for (const topic of TOPICS) {
      const { texture, aspect } = textTexture({
        text: topic,
        color: palette.chalk,
        letterSpacing: 0.16,
        weight: 600,
        size: 96,
      })
      this.labelTextures.set(topic, { texture, aspect })
      this.bin.add(() => texture.dispose())
    }
  }

  private buildClusters(): void {
    const rand = seeded(SEED)

    const ringGeometry = new THREE.RingGeometry(CLUSTER_RADIUS - 0.4, CLUSTER_RADIUS, 56)
    ringGeometry.rotateX(-Math.PI / 2)
    this.bin.add(() => ringGeometry.dispose())

    const beamGeometry = new THREE.CylinderGeometry(
      CLUSTER_RADIUS * 0.86, CLUSTER_RADIUS * 0.86, BEAM_HEIGHT, 20, 1, true,
    )
    this.bin.add(() => beamGeometry.dispose())

    // Base at the origin, so a pillar is scaled rather than moved.
    const pillarGeometry = new THREE.BoxGeometry(0.16, 1, 0.16)
    pillarGeometry.translate(0, 0.5, 0)
    this.bin.add(() => pillarGeometry.dispose())

    const labelGeometry = new THREE.PlaneGeometry(1, 1)
    this.bin.add(() => labelGeometry.dispose())

    for (let i = 0; i < CLUSTER_COUNT; i++) {
      const angle = (CLUSTER_ANGLES[i] * Math.PI) / 180
      const x = this.corpus.x + Math.cos(angle) * CLUSTER_RING
      const z = this.corpus.z + Math.sin(angle) * CLUSTER_RING
      const y = this.game.world.terrain.colliderHeightAt(x, z)

      const group = new THREE.Group()
      group.position.set(x, y, z)
      group.visible = false
      this.group.add(group)

      const material = this.game.materials.own(
        new THREE.MeshBasicMaterial({
          color: LIVE_COLOUR.clone(),
          transparent: true,
          opacity: 0,
          depthWrite: false,
          side: THREE.DoubleSide,
          toneMapped: false,
        }),
      )

      // The ring is drawn at exactly the trigger radius, so what the
      // player aims at is what the zone measures.
      const ring = new THREE.Mesh(ringGeometry, material)
      ring.position.y = 0.08
      ring.renderOrder = 2
      group.add(ring)

      const beamMaterial = this.game.materials.own(
        new THREE.MeshBasicMaterial({
          color: LIVE_COLOUR.clone(),
          transparent: true,
          opacity: 0,
          depthWrite: false,
          side: THREE.DoubleSide,
          toneMapped: false,
        }),
      )
      const beam = new THREE.Mesh(beamGeometry, beamMaterial)
      beam.position.y = BEAM_HEIGHT / 2
      beam.renderOrder = 3
      group.add(beam)

      // Pillars echo the corpus field they stand in. Decoration, so
      // the count follows quality; the ring and the zone do not.
      const pillars = this.game.quality.count(9, 4)
      for (let p = 0; p < pillars; p++) {
        const spin = (p / pillars) * Math.PI * 2 + rand() * 0.4
        const pillar = new THREE.Mesh(pillarGeometry, material)
        pillar.position.set(
          Math.cos(spin) * CLUSTER_RADIUS * 0.82,
          0,
          Math.sin(spin) * CLUSTER_RADIUS * 0.82,
        )
        pillar.scale.y = 3 + rand() * 4.5
        group.add(pillar)
      }

      const labelMaterial = this.game.materials.own(
        new THREE.MeshBasicMaterial({
          color: LABEL_LIVE.clone(),
          transparent: true,
          opacity: 0,
          depthWrite: false,
          side: THREE.DoubleSide,
          toneMapped: false,
        }),
      )
      const label = new THREE.Mesh(labelGeometry, labelMaterial)
      label.position.y = LABEL_HEIGHT
      label.renderOrder = 4
      group.add(label)

      const position = new THREE.Vector3(x, y, z)
      const zone = this.game.zones.create<number>(
        `retrieval-cluster-${i}`,
        'cylinder',
        position,
        CLUSTER_RADIUS,
        i,
      )
      zone.enabled = false

      const cluster: Cluster = {
        index: i,
        position,
        group,
        material,
        beam,
        beamMaterial,
        label,
        labelMaterial,
        zone,
        armed: false,
        appear: 0,
        flash: 0,
        flashColour: HIT_COLOUR.clone(),
        spent: false,
        phase: i * 1.27,
      }

      zone.events.on('enter', () => this.onEnter(cluster))
      zone.events.on('leave', () => {
        cluster.armed = true
      })
      this.bin.add(() => this.game.zones.remove(zone))

      this.clusters.push(cluster)
    }
  }

  /**
   * A board by the terminal, carrying the chain the game teaches and
   * the two figures from the role that this district is about.
   */
  private buildBoard(terminal: { x: number; z: number }): void {
    const toField = new THREE.Vector2(
      this.corpus.x - terminal.x,
      this.corpus.z - terminal.z,
    ).normalize()

    // Six metres towards the field, then thirteen aside: the line
    // between the terminal and the corpus stays clear to drive, and the
    // board is out of the plate's driving area rather than 5.5 m from
    // the middle of it.
    const x = terminal.x + toField.x * 6 - toField.y * 13
    const z = terminal.z + toField.y * 6 + toField.x * 13
    const y = this.game.world.terrain.colliderHeightAt(x, z)
    const yaw = Math.atan2(terminal.x - x, terminal.z - z)

    const board = new THREE.Group()
    board.position.set(x, y, z)
    board.rotation.y = yaw
    this.group.add(board)

    // No colliders on any of it. This is a sign, and a sign a car can
    // be stopped dead by in the middle of a district's driving area is
    // furniture pretending to be architecture.
    const shadows = this.game.quality.settings.shadows

    const post = (offset: number) => {
      const geometry = chamferedBox(0.24, 3.4, 0.24, 0.04)
      const mesh = new THREE.Mesh(geometry, this.game.materials.get('metal'))
      mesh.position.set(offset, 1.7, 0)
      mesh.castShadow = shadows
      board.add(mesh)
      this.bin.add(() => geometry.dispose())
    }
    post(-3.2)
    post(3.2)

    const panelGeometry = chamferedBox(8.4, 2.5, 0.3, 0.08)
    const panel = new THREE.Mesh(panelGeometry, this.game.materials.get('graphite'))
    panel.position.set(0, 4.6, 0)
    panel.castShadow = shadows
    board.add(panel)
    this.bin.add(() => panelGeometry.dispose())

    const { texture, aspect } = textTexture({
      text: 'QUERY → EMBEDDING → RETRIEVAL → CONTEXT → GENERATION',
      sublines: ['90%+ RAG QUERY ACCURACY', '+35% TEXT-GENERATION RELEVANCE'],
      color: palette.chalk,
      letterSpacing: 0.1,
      weight: 600,
      size: 72,
    })
    this.bin.add(() => texture.dispose())

    const width = 7.8
    const faceGeometry = new THREE.PlaneGeometry(width, width / aspect)
    const face = new THREE.Mesh(
      faceGeometry,
      this.game.materials.own(
        new THREE.MeshBasicMaterial({
          map: texture,
          transparent: true,
          depthWrite: false,
          toneMapped: false,
        }),
      ),
    )
    face.position.set(0, 4.6, 0.17)
    face.renderOrder = 2
    board.add(face)
    this.bin.add(() => faceGeometry.dispose())
  }

  /* ========================================================
     ROLLING A RUN
     ======================================================== */

  /**
   * Three queries, three different clusters, fresh distractors.
   * Seeded rather than random: the first run of any reload is the
   * same run, and each retry after that differs.
   */
  private rollRun(): void {
    const rand = seeded(SEED + this.attempt * 977)
    this.attempt++

    const queries = shuffled(QUERIES, rand).slice(0, ROUNDS)
    // Answers land on distinct clusters, so a player parked in the
    // cluster they just retrieved always has to drive somewhere new.
    const answers = shuffled(
      this.clusters.map((cluster) => cluster.index),
      rand,
    )

    // A spent cluster keeps the label it was retrieved under, so those
    // topics leave the distractor pool. Two clusters both reading
    // CONTRACTS — one dim, one live — reads as a bug even though only
    // the live one can be entered.
    const spent = new Set<number>()
    const stale: string[] = []

    this.rounds = queries.map((query, index) => {
      const answer = answers[index]
      const distractors = shuffled(
        TOPICS.filter(
          (topic) =>
            topic !== query.topic &&
            !stale.includes(topic) &&
            !query.avoid?.includes(topic),
        ),
        rand,
      )

      let next = 0
      const labels: (string | null)[] = []
      for (let i = 0; i < CLUSTER_COUNT; i++) {
        if (spent.has(i)) labels.push(null)
        else labels.push(i === answer ? query.topic : distractors[next++])
      }
      spent.add(answer)
      stale.push(query.topic)

      return { query, answer, labels }
    })
  }

  /* ========================================================
     LIFECYCLE
     ======================================================== */

  start(): boolean {
    if (this.running) return true
    // The base sets state, origin and input filters, and calls
    // `reset`, which is what rolls the run.
    super.start()
    this.beginRound(0)
    this.publish()
    return true
  }

  protected reset(): void {
    this.token++
    this.round = 0
    this.retrieved = 0
    this.stage = 0
    this.phase = 'idle'
    this.wandering = false
    this.darken()
    this.rollRun()
  }

  /** Puts the field back to how the rest of the world sees it. */
  private darken(): void {
    this.lit = false
    for (const cluster of this.clusters) {
      cluster.group.visible = false
      cluster.zone.enabled = false
      cluster.armed = false
      cluster.appear = 0
      cluster.flash = 0
      cluster.spent = false
    }
  }

  private beginRound(index: number): void {
    this.round = index
    this.phase = 'seeking'
    this.lit = true

    const round = this.rounds[index]
    const player = this.game.player.position
    // Derived from the zone's own hysteresis, not written independently:
    // 1.1 against the zone's 1.08 left a 13 cm band in which a cluster
    // was outside the zone (so no `leave` could arm it) and measured as
    // unarmed (so no `enter` could count it) — and if that cluster held
    // the answer the round could not be won at all.
    const armDistance = (CLUSTER_RADIUS * ZONE_HYSTERESIS) ** 2

    for (const cluster of this.clusters) {
      const topic = round.labels[cluster.index]
      if (topic !== null) this.setLabel(cluster, topic)

      cluster.group.visible = true
      if (cluster.spent) {
        cluster.zone.enabled = false
        continue
      }

      cluster.zone.enabled = true
      // Measured, not remembered: a disabled zone reports a `leave`
      // it never had, so its own state cannot be trusted here.
      cluster.armed =
        dist2(player.x, player.z, cluster.position.x, cluster.position.z) > armDistance
      cluster.appear = 0
    }

    this.game.audio.blip(0.82)
  }

  private setLabel(cluster: Cluster, topic: string): void {
    const label = this.labelTextures.get(topic)
    if (!label) return
    cluster.labelMaterial.map = label.texture
    cluster.labelMaterial.needsUpdate = true
    cluster.label.scale.set(LABEL_SIZE * label.aspect, LABEL_SIZE, 1)
  }

  /* ========================================================
     THE ANSWER
     ======================================================== */

  private onEnter(cluster: Cluster): void {
    if (this.state !== 'running' || this.phase !== 'seeking') return
    if (!cluster.armed || cluster.spent) return

    if (cluster.index === this.rounds[this.round].answer) this.retrieve(cluster)
    else this.miss(cluster)
  }

  private retrieve(cluster: Cluster): void {
    cluster.spent = true
    cluster.flash = 1
    cluster.flashColour.copy(HIT_COLOUR)

    this.retrieved++
    this.stage = Math.min(this.retrieved, STAGES.length - 1)
    this.phase = 'context'
    for (const other of this.clusters) other.zone.enabled = false

    // Each chunk is 14% sharper than the last, so a run audibly builds.
    this.game.audio.blip(1 + this.retrieved * 0.14)
    this.game.view.kick(0.16)

    const token = this.token
    this.game.tweens.delay(1.3, () => {
      if (token !== this.token || this.state !== 'running') return
      if (this.retrieved >= ROUNDS) this.generate()
      else this.beginRound(this.round + 1)
    })
  }

  private miss(cluster: Cluster): void {
    cluster.flash = 1
    cluster.flashColour.copy(MISS_COLOUR)
    for (const other of this.clusters) other.zone.enabled = false

    this.phase = 'missed'
    this.game.audio.play('fail')
    this.game.view.kick(0.22)

    // The base clears the message and calls `reset`, which re-rolls.
    this.fail('WRONG CLUSTER')
  }

  private generate(): void {
    this.phase = 'generating'
    this.stage = STAGES.length - 1
    this.game.audio.play('note')

    const token = this.token
    this.game.tweens.delay(1.6, () => {
      if (token !== this.token || this.state !== 'running') return
      this.game.achievements.set('retrieval', 1)
      this.finish()
      // The result card sits for five seconds; the field goes dark
      // after it, not during it.
      this.game.tweens.delay(5.2, () => {
        if (token !== this.token) return
        this.darken()
      })
    })
  }

  /* ========================================================
     TICK
     ======================================================== */

  update(delta: number): void {
    // Runs in every state, so the miss flash and the result beat are
    // still animated after the base has stopped ticking the game.
    if (this.lit) this.animate(delta, this.game.ticker.elapsedScaled)
    super.update(delta)
  }

  protected tick(delta: number): void {
    void delta
    const player = this.game.player.position
    // Driving out of the field is legal and cancels nothing. The
    // clusters are small against the corpus, so from far enough out
    // the readout has to point back rather than leave a player hunting.
    this.wandering =
      this.phase === 'seeking' &&
      dist2(player.x, player.z, this.corpus.x, this.corpus.z) > FIELD_RADIUS * FIELD_RADIUS
  }

  private animate(delta: number, time: number): void {
    const camera = this.game.view.camera.position

    for (const cluster of this.clusters) {
      if (!cluster.group.visible) continue

      cluster.appear = Math.min(1, cluster.appear + delta * 1.6)
      cluster.flash = Math.max(0, cluster.flash - delta * 0.85)

      const base = cluster.spent ? SPENT_COLOUR : LIVE_COLOUR
      const pulse = cluster.spent ? 0.14 : 0.5 + Math.sin(time * 2.1 + cluster.phase) * 0.16

      cluster.material.color.copy(base).lerp(cluster.flashColour, cluster.flash)
      cluster.material.opacity = clamp((pulse + cluster.flash * 0.45) * cluster.appear, 0, 1)

      cluster.beamMaterial.color.copy(base).lerp(cluster.flashColour, cluster.flash)
      cluster.beamMaterial.opacity = clamp(
        ((cluster.spent ? 0.04 : 0.1) + cluster.flash * 0.3) * cluster.appear,
        0,
        1,
      )
      cluster.beam.rotation.y += delta * (cluster.spent ? 0.05 : 0.22)

      // Yaw-only billboard: labels stay upright, and stay readable
      // from the driving camera whichever side you approach from.
      cluster.label.rotation.y = Math.atan2(
        camera.x - cluster.position.x,
        camera.z - cluster.position.z,
      )
      cluster.label.position.y = LABEL_HEIGHT + Math.sin(time * 1.3 + cluster.phase) * 0.22
      cluster.labelMaterial.color.copy(cluster.spent ? LABEL_SPENT : LABEL_LIVE)
      cluster.labelMaterial.opacity = cluster.appear
    }
  }

  /* ========================================================
     HUD
     ======================================================== */

  /**
   * `fail` and `finish` write the card the player is meant to read.
   * This game gets away without the guard today only because its misses
   * arrive from a Zone handler on the `fixed` channel rather than from
   * inside `tick` — an accident of ordering, not a design. Guarded like
   * VideoPipeline's and OrderRush's so it stays true.
   */
  protected publish(force = false): void {
    if (!this.running) return
    super.publish(force)
  }

  protected briefing(): string {
    return 'DRIVE INTO THE CLUSTER THAT ANSWERS THE QUERY'
  }

  protected lines(): string[] {
    if (this.state === 'countdown') {
      return [Math.ceil(this.leadInLeft).toFixed(0), 'GET READY', this.briefing()]
    }
    if (this.state !== 'running' || this.rounds.length === 0) return [this.title]
    return [this.rounds[this.round].query.text, this.strip(), `${this.status()} · ESC TO LEAVE`]
  }

  /** QRY→EMB→ret→ctx→gen. Lower case is a stage not reached yet. */
  private strip(): string {
    return STAGES.map((stage, i) => (i <= this.stage ? stage.code : stage.code.toLowerCase()))
      .join('→')
  }

  private status(): string {
    switch (this.phase) {
      case 'seeking':
        if (this.wandering) return 'BACK TO THE CORPUS'
        return this.retrieved === 0
          ? 'DRIVE INTO THE MATCH'
          : `RETRIEVING CHUNK ${this.retrieved + 1}/${ROUNDS}`
      case 'context':
        return `CHUNK ${this.retrieved}/${ROUNDS} RETRIEVED`
      case 'generating':
        return 'GENERATING THE ANSWER'
      case 'missed':
        return 'WRONG CLUSTER'
      default:
        return `EMBEDDING THE ${STAGES[0].name}`
    }
  }

  protected progress(): number | null {
    return clamp(this.retrieved / ROUNDS, 0, 1)
  }
}

/* ============================================================
   HELPERS
   ============================================================ */

/** Fisher–Yates on a copy, driven by a seeded generator. */
function shuffled<T>(items: readonly T[], rand: () => number): T[] {
  const copy = items.slice()
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    const swap = copy[i]
    copy[i] = copy[j]
    copy[j] = swap
  }
  return copy
}
