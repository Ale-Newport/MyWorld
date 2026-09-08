import * as THREE from 'three'
import { Minigame } from './Minigame'
import { palette } from '../core/palette'
import { clamp } from '../core/maths'
import { textTexture } from '../world/materials'
import type { Bin } from '../core/Disposal'
import type { Game } from '../Game'
import type { TweenHandle } from '../core/Tween'
import { landmarkById, type MinigameId } from '@/content/world'

/* ============================================================
   CHESS PUZZLE

   The chess district already has a board you can drive across.
   This is the thing you can do while parked on it: one mate in
   one, chosen from a short list of candidate moves.

   Three decisions worth writing down.

   1. THERE IS NO CHESS ENGINE HERE, AND THERE SHOULD NOT BE.
      The real project (src/content/projects/personal.ts, slug
      `chess-assistant`) hands its reconstructed FEN to Stockfish.
      Shipping a rules engine — or worse, a chess library — into
      the /world bundle to validate four hard-coded moves would
      cost more than the whole mini-game is worth. So the
      positions and their candidate moves are literals, and the
      legality of every candidate and the soundness of every mate
      was checked by hand. The notes next to each position say
      what was checked.

   2. SELECTION IS ONE AXIS AND ONE BUTTON. Picking a square in
      two dimensions needs a pointer, and neither a d-pad nor a
      thumb on glass has one. What every device does have is the
      steering axis and the confirm button the visitor has been
      driving with for the last ten minutes: arrows or A/D, the
      d-pad or the left stick, or the touch joystick — all of them
      already mean "left" and "right". So the candidate moves are
      laid out as glowing squares, sorted left to right across the
      board, and the same axis that steers the car walks the
      cursor along them. Nothing new to learn, nothing that only
      works on a keyboard.

   3. IT IS OPTIONAL AND IT IS CANCELLABLE. The camera drops to
      look down at the board and the car is locked while you
      think, which is exactly the kind of state that traps people.
      `reset()` — the one method the base class calls on every
      cancel, every respawn and every stray — ends the cinematic
      and unlocks the car. Nothing else in this file is allowed to
      be the only place that does either.
   ============================================================ */

/* ---- board geometry -------------------------------------- */

/**
 * These two mirror `buildChessboard` in src/world/world/Landmarks.ts.
 * They are duplicated rather than shared because the builder keeps
 * them as locals; if the board there is ever resized, the highlights
 * here land on the wrong squares and this is the comment that says so.
 */
const CELL = 3.2
const HALF_BOARD = CELL * 4

/** Top face of the landmark's tiles, in the board group's local space. */
const SURFACE = 0.62
/** Top of the plate the tiles sit on. The corner marks stand out here. */
const PLATE = 0.5

/** Height of a piece's disc. The glyph lies flat on top of it. */
const DISC_HEIGHT = 0.5
const GLYPH_SIZE = 1.5

/** How far the camera tips off vertical when it looks at the board. */
const CAMERA_TILT = Math.PI * 0.17

/* ============================================================
   POSITIONS

   Squares are indices: a1 = 0, h1 = 7, a8 = 56. Pieces are
   written the way FEN writes them — uppercase White, lowercase
   Black — because the letter drawn on each disc IS the FEN
   character the real classifier would emit for that square.
   ============================================================ */

interface MoveSpec {
  /** Shown in the HUD. Algebraic, as the engine would print it. */
  san: string
  from: string
  to: string
  /** Exactly one per position. */
  mate?: boolean
}

interface PuzzleSpec {
  fen: string
  pieces: string
  moves: MoveSpec[]
}

const SPECS: PuzzleSpec[] = [
  /*
     BACK RANK. Rd8 is mate: the rook checks along the eighth,
     f8 and h8 are on that rank too, and f7/g7/h7 are the black
     king's own pawns. Nothing attacks d8 and no black piece can
     interpose — black pawns move down the board, not up it.
     Rd7, Rd4 and Kg2 are legal and are not even check.
  */
  {
    fen: '6k1/5ppp/8/8/8/8/8/3R2K1 w - -',
    pieces: 'Kg1 Rd1 kg8 pf7 pg7 ph7',
    moves: [
      { san: 'Rd8', from: 'd1', to: 'd8', mate: true },
      { san: 'Rd7', from: 'd1', to: 'd7' },
      { san: 'Rd4', from: 'd1', to: 'd4' },
      { san: 'Kg2', from: 'g1', to: 'g2' },
    ],
  },

  /*
     SMOTHERED. Nf7 is mate: the knight checks h8, and g8, g7 and
     h7 are all occupied by black's own men. A knight check cannot
     be blocked, and nothing black has attacks f7 — the rook on g8
     sees the g-file and the eighth rank, and a black pawn on g7
     captures towards f6, not f7. Ne8, Nf5 and Ne4 are the other
     legal knight moves offered; none of them is check.
  */
  {
    fen: '6rk/6pp/3N4/8/8/8/8/6K1 w - -',
    pieces: 'Kg1 Nd6 kh8 rg8 pg7 ph7',
    moves: [
      { san: 'Nf7', from: 'd6', to: 'f7', mate: true },
      { san: 'Ne8', from: 'd6', to: 'e8' },
      { san: 'Nf5', from: 'd6', to: 'f5' },
      { san: 'Ne4', from: 'd6', to: 'e4' },
    ],
  },

  /*
     LADDER. Rb8 is mate: the b-rook checks along the eighth while
     the a-rook covers the seventh, so g7, h7 and g8 are all gone.
     The other three candidates are the instructive misses — Ra8
     and Rh2 are both check, and both let the king out to g7 or
     g8 because the move abandoned the rank that was covering it.
  */
  {
    fen: '7k/R7/8/8/8/8/1R6/2K5 w - -',
    pieces: 'Kc1 Ra7 Rb2 kh8',
    moves: [
      { san: 'Rb8', from: 'b2', to: 'b8', mate: true },
      { san: 'Ra8', from: 'a7', to: 'a8' },
      { san: 'Rb7', from: 'b2', to: 'b7' },
      { san: 'Rh2', from: 'b2', to: 'h2' },
    ],
  },
]

/* ---- resolved forms -------------------------------------- */

interface Move {
  san: string
  from: number
  to: number
  mate: boolean
}

interface Puzzle {
  fen: string
  pieces: { glyph: string; square: number }[]
  moves: Move[]
}

/** 'd8' → 59. */
function squareOf(name: string): number {
  return (name.charCodeAt(1) - 49) * 8 + (name.charCodeAt(0) - 97)
}

const PUZZLES: Puzzle[] = SPECS.map((spec) => ({
  fen: spec.fen,
  pieces: spec.pieces.split(' ').map((entry) => ({
    glyph: entry[0],
    square: squareOf(entry.slice(1)),
  })),
  // Sorted by destination file, then rank: pushing the axis one way
  // always moves the highlight the same way across the board. In
  // authoring order it would jump about instead.
  moves: spec.moves
    .map((move) => ({
      san: move.san,
      from: squareOf(move.from),
      to: squareOf(move.to),
      mate: move.mate === true,
    }))
    .sort((a, b) => (a.to % 8) - (b.to % 8) || (a.to >> 3) - (b.to >> 3)),
}))

const MAX_MOVES = Math.max(...PUZZLES.map((p) => p.moves.length))
const MAX_PIECES = Math.max(...PUZZLES.map((p) => p.pieces.length))

/* ---- pooled objects -------------------------------------- */

interface PieceSlot {
  group: THREE.Group
  disc: THREE.Mesh
  glyph: THREE.Mesh
  square: number
}

interface Glyph {
  material: THREE.Material
  aspect: number
}

export class ChessPuzzle extends Minigame {
  readonly id: MinigameId = 'chess'
  readonly title = 'CHESS ASSISTANT'

  private puzzleIndex = 0
  private cursor = 0

  private group = new THREE.Group()
  private pieces: PieceSlot[] = []
  private candidates: THREE.Mesh[] = []
  private glyphs = new Map<string, Glyph>()

  private selectedTile!: THREE.Mesh
  private originTile!: THREE.Mesh
  private arrow = new THREE.Group()
  private arrowBar!: THREE.Mesh
  private arrowHead!: THREE.Mesh
  private sweep!: THREE.Mesh

  private selectedMaterial!: THREE.MeshBasicMaterial
  private originMaterial!: THREE.MeshBasicMaterial
  private arrowMaterial!: THREE.MeshBasicMaterial

  private whiteMaterial!: THREE.Material
  private blackMaterial!: THREE.Material

  private readonly boardCentre = new THREE.Vector3()
  private readonly cameraPosition = new THREE.Vector3()

  /** Last frame's confirm state. Starts held, so the ENTER that
      opened the puzzle has to be released before it plays a move. */
  private interactHeld = true
  /** Set by the touch joystick's tap, consumed on the next tick. */
  private tapped = false
  /** Hysteresis latch for the steering axis. */
  private axisLatched = false

  private releaseTimer: TweenHandle | null = null
  private moveTween: TweenHandle | null = null

  constructor(game: Game, bin: Bin) {
    super(game, bin)
    // The board is 26 m across and you have to be parked on it, so
    // anything past 40 m from the centre means the car left.
    this.abandonRadius = 40
  }

  /* ========================================================
     BUILD
     ======================================================== */

  build(): void {
    // Prefer the built landmark's own transform over the content
    // coordinates: if the board is ever moved or turned, the
    // overlay follows it rather than drifting off on its own.
    const handle = this.game.world.landmarks.get('chess-board')
    const landmark = landmarkById['chess-board']
    if (handle) {
      this.group.position.copy(handle.group.position)
      this.group.quaternion.copy(handle.group.quaternion)
    } else if (landmark) {
      const y = this.game.world.terrain.colliderHeightAt(landmark.x, landmark.z)
      this.group.position.set(landmark.x, y, landmark.z)
    }
    this.boardCentre.copy(this.group.position).setY(this.group.position.y + SURFACE)

    this.buildMaterials()
    this.buildGrid()
    this.buildBrackets()
    this.buildTiles()
    this.buildArrow()
    this.buildSweep()
    this.buildPieces()

    this.group.visible = false
    this.game.renderer.scene.add(this.group)
    this.bin.object3D(this.group)

    const onTap = () => {
      this.tapped = true
    }
    this.game.nipple?.events.on('tap', onTap)
    this.bin.add(() => this.game.nipple?.events.off('tap', onTap))
  }

  private buildMaterials(): void {
    const materials = this.game.materials

    this.selectedMaterial = materials.own(new THREE.MeshBasicMaterial({
      color: new THREE.Color(palette.accent),
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      toneMapped: false,
    }))
    this.originMaterial = materials.own(new THREE.MeshBasicMaterial({
      color: new THREE.Color(palette.accentSoft),
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
      toneMapped: false,
    }))
    this.arrowMaterial = materials.own(new THREE.MeshBasicMaterial({
      color: new THREE.Color(palette.accent),
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      toneMapped: false,
    }))

    // Discs read as pieces from above; the FEN letter on top says
    // which piece. Case carries the side, exactly as FEN does.
    this.whiteMaterial = materials.get('chalk')
    this.blackMaterial = materials.get('ink')
  }

  /**
   * A registration dot in the corner of every square: the 64 crops
   * the per-square classifier looks at. Purely decorative, so the
   * count thins out on weak hardware — the dots are never read by
   * anything the puzzle depends on.
   */
  private buildGrid(): void {
    const wanted = this.game.quality.count(64, 16)
    const stride = Math.max(1, Math.ceil(64 / wanted))
    const squares: number[] = []
    for (let square = 0; square < 64; square += stride) squares.push(square)

    const geometry = new THREE.PlaneGeometry(0.34, 0.34)
    geometry.rotateX(-Math.PI / 2)
    this.bin.add(() => geometry.dispose())

    const material = this.game.materials.own(new THREE.MeshBasicMaterial({
      color: new THREE.Color(palette.chalk3),
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      toneMapped: false,
    }))

    const mesh = new THREE.InstancedMesh(geometry, material, squares.length)
    const matrix = new THREE.Matrix4()
    squares.forEach((square, i) => {
      const x = fileX(square) - CELL * 0.42
      const z = rankZ(square) + CELL * 0.42
      matrix.makeTranslation(x, SURFACE + 0.02, z)
      mesh.setMatrixAt(i, matrix)
    })
    mesh.instanceMatrix.needsUpdate = true
    mesh.renderOrder = 3
    this.group.add(mesh)
  }

  /** The four corners the board-corner regressor solves for. */
  private buildBrackets(): void {
    const geometry = new THREE.BoxGeometry(1, 1, 1)
    this.bin.add(() => geometry.dispose())
    const material = this.game.materials.get('emissiveAccent')

    const length = 3
    const thickness = 0.32
    const height = 0.08
    // Past the outermost tiles but inside the plate's edge, which is
    // the only strip of board the squares do not already cover.
    const inset = HALF_BOARD + 0.5
    const y = PLATE + height / 2

    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const along = new THREE.Mesh(geometry, material)
        along.scale.set(length, height, thickness)
        along.position.set(sx * (inset - length / 2), y, sz * inset)
        this.group.add(along)

        const across = new THREE.Mesh(geometry, material)
        across.scale.set(thickness, height, length)
        across.position.set(sx * inset, y, sz * (inset - length / 2))
        this.group.add(across)
      }
    }
  }

  private buildTiles(): void {
    const geometry = new THREE.PlaneGeometry(CELL * 0.88, CELL * 0.88)
    geometry.rotateX(-Math.PI / 2)
    this.bin.add(() => geometry.dispose())

    const candidateMaterial = this.game.materials.own(new THREE.MeshBasicMaterial({
      color: new THREE.Color(palette.signalSoft),
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
      toneMapped: false,
    }))

    for (let i = 0; i < MAX_MOVES; i++) {
      const tile = new THREE.Mesh(geometry, candidateMaterial)
      tile.renderOrder = 4
      tile.visible = false
      this.group.add(tile)
      this.candidates.push(tile)
    }

    this.originTile = new THREE.Mesh(geometry, this.originMaterial)
    this.originTile.renderOrder = 4
    this.group.add(this.originTile)

    // Drawn after the candidates so the chosen square always wins.
    this.selectedTile = new THREE.Mesh(geometry, this.selectedMaterial)
    this.selectedTile.renderOrder = 5
    this.group.add(this.selectedTile)
  }

  /**
   * The move arrow the real pipeline draws once Stockfish answers.
   * Pivoted at one end so a single mesh serves every move: set the
   * group's rotation, scale the bar's length, slide the head.
   */
  private buildArrow(): void {
    const bar = new THREE.PlaneGeometry(1, 0.55)
    bar.rotateX(-Math.PI / 2)
    bar.translate(0.5, 0, 0)
    this.bin.add(() => bar.dispose())

    this.arrowBar = new THREE.Mesh(bar, this.arrowMaterial)
    // On the meshes, not on the group: `renderOrder` is per-object
    // and a group does not pass its own down to its children.
    this.arrowBar.renderOrder = 5
    this.arrow.add(this.arrowBar)

    const head = new THREE.ConeGeometry(0.85, 1.6, 3)
    head.rotateZ(-Math.PI / 2)
    this.bin.add(() => head.dispose())

    this.arrowHead = new THREE.Mesh(head, this.arrowMaterial)
    // Flattened, and lifted by more than its own half-height, so no
    // part of it sinks below the tiles and gets clipped by them.
    this.arrowHead.scale.y = 0.18
    this.arrowHead.position.y = 0.16
    this.arrowHead.renderOrder = 5
    this.arrow.add(this.arrowHead)

    this.arrow.position.y = SURFACE + 0.05
    this.group.add(this.arrow)
  }

  /** One pass of the classifier, drawn once as the camera settles. */
  private buildSweep(): void {
    const geometry = new THREE.PlaneGeometry(HALF_BOARD * 2, 1.1)
    geometry.rotateX(-Math.PI / 2)
    this.bin.add(() => geometry.dispose())

    this.sweep = new THREE.Mesh(
      geometry,
      this.game.materials.own(new THREE.MeshBasicMaterial({
        color: new THREE.Color(palette.signalSoft),
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
        toneMapped: false,
      })),
    )
    this.sweep.position.y = SURFACE + 0.04
    this.sweep.renderOrder = 6
    this.sweep.visible = false
    this.group.add(this.sweep)
  }

  private buildPieces(): void {
    const disc = new THREE.CylinderGeometry(0.98, 1.12, DISC_HEIGHT, 14, 1)
    disc.translate(0, DISC_HEIGHT / 2, 0)
    this.bin.add(() => disc.dispose())

    const plane = new THREE.PlaneGeometry(1, 1)
    plane.rotateX(-Math.PI / 2)
    this.bin.add(() => plane.dispose())

    // One texture per distinct FEN character across all positions,
    // not one per piece on the board.
    const characters = new Set<string>()
    for (const puzzle of PUZZLES) {
      for (const piece of puzzle.pieces) characters.add(piece.glyph)
    }
    for (const character of characters) {
      const white = character === character.toUpperCase()
      const { texture, aspect } = textTexture({
        text: character,
        size: 96,
        padding: 10,
        weight: 700,
        letterSpacing: 0,
        color: white ? palette.ink : palette.chalk,
      })
      this.bin.add(() => texture.dispose())
      const material = this.game.materials.own(new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      }))
      this.glyphs.set(character, { material, aspect })
    }

    const shadows = this.game.quality.settings.shadows
    for (let i = 0; i < MAX_PIECES; i++) {
      const group = new THREE.Group()
      group.visible = false

      const discMesh = new THREE.Mesh(disc, this.whiteMaterial)
      discMesh.castShadow = shadows
      group.add(discMesh)

      const glyphMesh = new THREE.Mesh(plane, this.arrowMaterial)
      glyphMesh.position.y = DISC_HEIGHT + 0.02
      glyphMesh.renderOrder = 6
      group.add(glyphMesh)

      this.group.add(group)
      this.pieces.push({ group, disc: discMesh, glyph: glyphMesh, square: 0 })
    }
  }

  /* ========================================================
     LIFECYCLE
     ======================================================== */

  start(): boolean {
    if (this.running) return true

    this.reset()
    this.elapsed = 0
    this.state = 'running'
    this.cursor = 0

    // The stray test is measured from the board, not from wherever
    // the car happened to stop, so a car nudged off the plate still
    // cancels at a sensible distance.
    this.origin.copy(this.boardCentre)
    this.game.inputs.setFilters([])

    // The ENTER that opened the landmark is still down when we get
    // here — InteractivePoints starts the mini-game from the same
    // press we are about to read. Treating it as already held means
    // it has to be released before it can play anything, so a long
    // press on the prompt cannot instantly lose the puzzle.
    this.interactHeld = true
    this.tapped = false

    this.applyPuzzle()

    this.game.player.setState('locked')
    this.game.view.startCinematic(this.cameraPosition, this.boardCentre)

    this.publish()
    this.events.trigger('start')
    return true
  }

  /**
   * Wider than the base class's: ESCAPE has to work while the result
   * or the NOT MATE card is still up, because the camera is still
   * down at the board during both.
   */
  cancel(reason: 'player' | 'strayed' | 'respawn' = 'player'): void {
    if (this.state === 'idle') return
    this.state = 'idle'
    this.reset()
    this.game.store.getState().setMinigame(null)
    this.events.trigger('cancel', [reason])
  }

  protected reset(): void {
    // Everything this mini-game takes hold of is given back here,
    // because this is the method the base class calls on cancel, on
    // respawn, on straying and on opening the map. `endCinematic`
    // and `setState('default')` must never live anywhere else only.
    this.game.view.endCinematic()
    this.game.player.setState('default')

    this.releaseTimer?.kill()
    this.releaseTimer = null
    // A mating move still sliding across the board would otherwise
    // keep animating over the position `applyPuzzle` just laid out.
    this.moveTween?.kill()
    this.moveTween = null

    this.group.visible = false
    this.sweep.visible = false
    this.interactHeld = true
    this.tapped = false
    this.axisLatched = false
  }

  /* ========================================================
     PER-FRAME
     ======================================================== */

  update(delta: number): void {
    // The chosen square keeps breathing while the COMPLETE and the
    // NOT MATE cards are up; `super.update` stops at that point.
    if (this.state === 'finished' || this.state === 'failed') this.pulse()
    super.update(delta)
  }

  protected tick(delta: number): void {
    void delta
    this.pulse()
    this.updateSweep()

    const axis = this.axis()
    if (this.axisLatched) {
      if (Math.abs(axis) < 0.35) this.axisLatched = false
    } else if (Math.abs(axis) > 0.6) {
      // One step per push, not one per frame: a held arrow key
      // should not race through four candidates in a tenth of a
      // second, and the analogue stick would do exactly that.
      this.axisLatched = true
      this.step(Math.sign(axis))
    }

    // Rising edge only. The touch layer has no `interact` binding at
    // all, so a tap inside the joystick's dead zone is the confirm
    // there; the car is locked, so nothing else claims that tap.
    const held = this.game.inputs.isActive('interact')
    const confirmed = this.tapped || (held && !this.interactHeld)
    this.interactHeld = held
    this.tapped = false
    if (confirmed) this.play()
  }

  /**
   * Steering, from whichever device is driving. Positive is right.
   * Player.updatePrePhysics reads the same three sources with the
   * same signs — positive `steering` turns left, hence the flips.
   */
  private axis(): number {
    const inputs = this.game.inputs
    let value = 0
    if (inputs.isActive('left')) value -= 1
    if (inputs.isActive('right')) value += 1

    const stick = inputs.gamepad.joysticks.left
    if (value === 0 && stick.active) value = stick.safeX

    if (value === 0) {
      const touch = this.game.nipple?.intent()
      if (touch) value = -touch.steering
    }
    return clamp(value, -1, 1)
  }

  private step(direction: number): void {
    const moves = this.puzzle.moves
    this.cursor = (this.cursor + direction + moves.length) % moves.length
    this.game.audio?.blip(1 + this.cursor * 0.08)
    this.showSelection()
  }

  private pulse(): void {
    if (this.game.reducedMotion) {
      this.selectedMaterial.opacity = 0.62
      return
    }
    const t = this.game.ticker.elapsedScaled
    this.selectedMaterial.opacity = 0.5 + Math.sin(t * 4) * 0.16
  }

  private updateSweep(): void {
    // A single pass as the camera arrives, then it gets out of the
    // way. A scan line that never stops is just a distraction.
    if (this.game.reducedMotion || this.elapsed > 1.6) {
      this.sweep.visible = false
      return
    }
    const progress = this.elapsed / 1.6
    this.sweep.visible = true
    this.sweep.position.z = HALF_BOARD - progress * HALF_BOARD * 2
  }

  /* ========================================================
     THE MOVE
     ======================================================== */

  private play(): void {
    const move = this.puzzle.moves[this.cursor]
    this.game.audio?.play('interact')

    if (!move.mate) {
      // Back to the board, not out of it: `fail` holds the card for
      // a couple of seconds and then calls `reset`, which hands the
      // camera back. The visitor is still parked in the zone, so
      // ENTER starts the same position again.
      this.game.audio?.play('fail')
      this.game.view.kick(0.4)
      this.fail('NOT MATE')
      return
    }

    // Every mating move in this file lands on an empty square, so
    // playing it is a slide with nothing to capture.
    const slot = this.pieces.find((piece) => piece.group.visible && piece.square === move.from)
    if (slot) {
      slot.square = move.to
      this.moveTween = this.game.tweens.to(
        slot.group.position,
        { x: fileX(move.to), z: rankZ(move.to) },
        { duration: 0.45 },
      )
    }

    this.selectedMaterial.color.set(palette.signal)
    this.arrowMaterial.color.set(palette.signal)

    this.game.achievements.set('checkmate', 1)
    this.finish(null)

    // `finish` leaves its card up for five seconds and never calls
    // `reset`, so the camera needs its own way back. Two seconds is
    // long enough to see the mate land.
    this.releaseTimer = this.game.tweens.delay(2.2, () => {
      this.releaseTimer = null
      this.game.view.endCinematic()
      this.game.player.setState('default')
      this.group.visible = false
    })

    // The next visit gets the next position. The board is only
    // rebuilt by `start`, so this does not disturb what is on screen.
    this.puzzleIndex = (this.puzzleIndex + 1) % PUZZLES.length
  }

  /* ========================================================
     DRESSING THE BOARD
     ======================================================== */

  private get puzzle(): Puzzle {
    return PUZZLES[this.puzzleIndex]
  }

  private applyPuzzle(): void {
    const puzzle = this.puzzle

    this.selectedMaterial.color.set(palette.accent)
    this.arrowMaterial.color.set(palette.accent)

    this.pieces.forEach((slot, i) => {
      const piece = puzzle.pieces[i]
      if (!piece) {
        slot.group.visible = false
        return
      }
      const glyph = this.glyphs.get(piece.glyph)
      const white = piece.glyph === piece.glyph.toUpperCase()

      slot.square = piece.square
      slot.group.visible = true
      slot.group.position.set(fileX(piece.square), SURFACE, rankZ(piece.square))
      slot.disc.material = white ? this.whiteMaterial : this.blackMaterial
      if (glyph) {
        slot.glyph.material = glyph.material
        slot.glyph.scale.set(GLYPH_SIZE * glyph.aspect, 1, GLYPH_SIZE)
      }
    })

    this.candidates.forEach((tile, i) => {
      const move = puzzle.moves[i]
      tile.visible = move !== undefined
      if (move) tile.position.set(fileX(move.to), SURFACE + 0.01, rankZ(move.to))
    })

    this.placeCamera()
    this.showSelection()
    this.group.visible = true
  }

  private showSelection(): void {
    const move = this.puzzle.moves[this.cursor]

    this.selectedTile.position.set(fileX(move.to), SURFACE + 0.015, rankZ(move.to))
    this.originTile.position.set(fileX(move.from), SURFACE + 0.01, rankZ(move.from))

    const fromX = fileX(move.from)
    const fromZ = rankZ(move.from)
    const dx = fileX(move.to) - fromX
    const dz = rankZ(move.to) - fromZ
    const length = Math.hypot(dx, dz)

    this.arrow.position.set(fromX, SURFACE + 0.05, fromZ)
    // Negated Z, as everywhere else in this project that turns a
    // world-space direction into a Y rotation.
    this.arrow.rotation.y = Math.atan2(-dz, dx)
    this.arrowBar.scale.x = Math.max(0.01, length - 1.4)
    this.arrowHead.position.x = Math.max(0, length - 0.8)
  }

  /**
   * Straight down the board from the south, far enough back that
   * the whole board fits the 25° lens. The distance is solved from
   * the viewport rather than hard-coded: on a portrait phone the
   * same camera would cut the a- and h-files off the sides.
   */
  private placeCamera(): void {
    const camera = this.game.view.camera
    const halfHeight = Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5))
    const ratio = Math.max(0.35, this.game.viewport.ratio)

    const span = HALF_BOARD + 2
    // Looked at from this tilt the board is foreshortened front to
    // back by cos(tilt), so it needs less vertical room than it does
    // horizontal. The 25° lens is narrow, hence the long distances.
    const byHeight = (span * Math.cos(CAMERA_TILT)) / halfHeight
    const byWidth = span / (halfHeight * ratio)
    const distance = Math.max(byWidth, byHeight, 30)

    this.cameraPosition.set(
      this.boardCentre.x,
      this.boardCentre.y + Math.cos(CAMERA_TILT) * distance,
      this.boardCentre.z + Math.sin(CAMERA_TILT) * distance,
    )
  }

  /* ========================================================
     HUD
     ======================================================== */

  /**
   * `finish` and `fail` write the card the player is meant to read,
   * and `Minigame.update` publishes once more after `tick` returns.
   * Without this guard that last publish lands on the same frame and
   * replaces COMPLETE — or NOT MATE — with the live readout. Here it
   * would also be the WRONG readout: `play` has already stepped
   * `puzzleIndex` on, so `lines` would print the next position's FEN
   * over a board still showing this one.
   */
  protected publish(): void {
    if (!this.running) return
    super.publish()
  }

  protected lines(): string[] {
    const puzzle = this.puzzle
    const move = puzzle.moves[this.cursor]
    return [
      'CAMERA → CNN → BOARD → FEN → STOCKFISH → MOVE',
      puzzle.fen,
      '99.6% PIECE RECOGNITION',
      'MATE IN ONE — WHITE TO PLAY',
      `◂ ${move.san} ▸   ENTER PLAYS   ESC LEAVES`,
    ]
  }

  protected progress(): number | null {
    // Nothing here progresses. A bar that filled as you scrolled
    // through candidates would be reporting a fiction.
    return null
  }
}

/* ============================================================
   SQUARE → BOARD SPACE

   The landmark lays its tiles out from row 0 at -Z, and colours
   them `(row + col) % 2`, which puts a dark square on a1 — a real
   board. So rank 1 is the +Z edge, nearest a camera placed to the
   south, and files run a to h along +X.
   ============================================================ */

function fileX(square: number): number {
  return ((square % 8) - 3.5) * CELL
}

function rankZ(square: number): number {
  return (3.5 - (square >> 3)) * CELL
}
