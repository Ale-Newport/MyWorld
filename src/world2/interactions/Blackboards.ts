import type * as THREE from 'three'
import type { Bin } from '@/world/core/Disposal'
import type { Inputs } from '@/world/input/Inputs'
import type { References } from './references'

/* ============================================================
   THE CONTROL BLACKBOARDS

   Two boards in the level tell you how to work a screen: one by
   the project board, one in the lab. Each is authored THREE
   TIMES over — `refBlackboardLabelsMouseKeyboard`,
   `…GamepadXbox` and `…GamepadPlaystation` — three flat label
   meshes sharing one `blackboardLabels` atlas, stacked 2 cm
   apart on the same board face.

   That is not a mistake in the .blend. It is how the level ships
   a board that can speak three control schemes: the engine is
   supposed to show the one that matches the pad in your hands
   and hide the other two. Nothing here did, so all three drew at
   once and the board read as a smear of overlapping words —
   "NEXT" with a ghost of "PREV" through it, two arrows, two
   EXITs.

   The suffixes are shuffled between the two boards in the source
   file (the lab carries `…MouseKeyboard` while the project board
   carries `…MouseKeyboard.001`), so the pairing here is by
   COLLECTION — `blackBoard.001` is the lab's, `blackBoard.002`
   is the project board's — and never by index.
   ============================================================ */

/** Which authored variant answers to which control scheme. */
type Scheme = 'mouseKeyboard' | 'xbox' | 'playstation'

const VARIANT: Record<Scheme, string> = {
  mouseKeyboard: 'refBlackboardLabelsMouseKeyboard',
  xbox: 'refBlackboardLabelsGamepadXbox',
  playstation: 'refBlackboardLabelsGamepadPlaystation',
}

interface Board {
  collection: string
  labels: Map<Scheme, THREE.Object3D>
}

export class Blackboards {
  readonly boards: Board[] = []
  private scheme: Scheme = 'mouseKeyboard'

  constructor(private references: References, private inputs: Inputs, bin: Bin) {
    for (const collection of ['blackBoard.001', 'blackBoard.002']) {
      const labels = new Map<Scheme, THREE.Object3D>()
      for (const node of references.collection(collection)) {
        const source = String(node.userData.w2Source ?? node.name)
        // `refBlackboardLabelsGamepadXbox.001` and `…Xbox` are the same
        // variant on different boards: match the stem, ignore the suffix.
        const stem = source.replace(/\.\d+$/, '')
        for (const [scheme, name] of Object.entries(VARIANT) as [Scheme, string][]) {
          if (stem === name) labels.set(scheme, node)
        }
      }
      if (labels.size) this.boards.push({ collection, labels })
    }

    this.apply()

    const onMode = () => this.apply()
    const onType = () => this.apply()
    inputs.events.on('modeChange', onMode as never)
    inputs.gamepad.events.on('typeChange', onType as never)
    bin.add(() => {
      inputs.events.off('modeChange', onMode as never)
      inputs.gamepad.events.off('typeChange', onType as never)
    })
  }

  /** The scheme the boards are currently speaking. Read by the QA harness. */
  get showing(): Scheme { return this.scheme }

  /**
   * Touch reads the same board as mouse and keyboard: the atlas has no touch
   * variant, and its words — NEXT, PREV, OPEN, EXIT — are what the on-screen
   * buttons say anyway. A pad of unknown make gets the Xbox face, because
   * ABXY is the labelling most third-party pads print on their buttons.
   */
  private choose(): Scheme {
    if (this.inputs.mode !== 'gamepad') return 'mouseKeyboard'
    return this.inputs.gamepad.type === 'playstation' ? 'playstation' : 'xbox'
  }

  /**
   * Suppression rather than a plain `visible = false`: the validation panel's
   * scenery toggle re-derives visibility for every level mesh from its
   * category, and would otherwise light all three variants up again.
   */
  private apply(): void {
    this.scheme = this.choose()
    const environment = this.references.environment
    for (const board of this.boards) {
      for (const [scheme, node] of board.labels) {
        if (scheme === this.scheme) environment.unsuppress(node)
        else environment.suppress(node)
      }
    }
  }
}
