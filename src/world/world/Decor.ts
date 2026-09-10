import type { Game } from '../Game'
import type { PropKind, PropOptions } from './Props'
import {
  planDecor, type DecorPlacement, type DecorPlan, type DecorThemeStats,
} from '@/content/world-decor'

/* ============================================================
   DECORATION

   The layer that answers "why does the island look empty".

   It owns no geometry, no group and no material, so it takes no
   `Bin`: every object it creates belongs to `Props`, which was
   already instancing, already disposing and already skipping
   sleeping bodies. What this class does is turn the manifest's
   plan into `props.add` calls with the ground height filled in.

   THE PLAN IS NOT MADE HERE. `planDecor()` in
   `content/world-decor.ts` decides every position, and it does so
   without importing THREE, which is what lets
   `scripts/world-decor-check.mjs` print the numbers this class is
   about to build rather than a headless approximation of them.
   The alternative — a placement loop in a renderer module and a
   second one in a script — is how the world came to hold four
   disagreeing copies of "may something stand here", one of which
   did not know about the labyrinth.

   WHAT IT REPORTS. `World.scatterProps` made 270 attempts, landed
   117 and said nothing about the other 153; whole sets vanished
   and nobody found out for months. `stats` carries placed against
   attempted per theme and the rejection histogram by zone kind,
   and in development it prints a summary at boot. A decoration
   system that ships half of what it was asked for is fine. One
   that does it silently is not.
   ============================================================ */

export class Decor {
  readonly plan: DecorPlan
  /** Per-theme placed / attempted / rejected-by-kind. Read by the
   *  dev HUD and by `scripts/world-decor-check.mjs`'s runtime twin. */
  readonly stats: readonly DecorThemeStats[]
  /** How many props actually reached the world, which is not the
   *  same as how many were planned if a kind ran out of capacity. */
  built = 0

  constructor(private game: Game) {
    this.plan = planDecor()
    this.stats = this.plan.themes

    const props = game.world.props
    const terrain = game.world.terrain

    /*
      RESERVE FIRST, AND RESERVE EXACTLY.

      The plan already knows how many of each kind it will place, so
      the capacity is that number plus whatever is standing already —
      `World.scatterProps` runs first and has its own cones and
      crates. Sized this way the "ran out of instances" warning can
      never fire, which matters because in production it does not
      warn at all: `add` returns null and the set is simply smaller
      than it says on the page.
    */
    for (const [kind, count] of Object.entries(this.plan.capacity)) {
      props.reserve(kind as PropKind, props.countOf(kind as PropKind) + count)
    }

    // Grouped by kind so each instanced mesh's buffers are flagged
    // once instead of once per prop.
    const batches = new Map<PropKind, { x: number; y: number; z: number; options: PropOptions }[]>()
    for (const placement of this.plan.placements) {
      const kind = placement.kind as PropKind
      let batch = batches.get(kind)
      if (!batch) batches.set(kind, (batch = []))
      batch.push({
        x: placement.x,
        // `colliderHeightAt` is the surface the car drives on, and
        // these are placed ASLEEP, so 3 cm is a seating tolerance
        // rather than a drop. Props that fall in are props that have
        // all crept a little way downhill before anyone arrives.
        y: terrain.colliderHeightAt(placement.x, placement.z) + 0.03 + placement.lift,
        z: placement.z,
        options: this.optionsFor(placement),
      })
    }

    for (const [kind, batch] of batches) {
      this.built += props.addMany(kind, batch).length
    }

    if (process.env.NODE_ENV === 'development') this.report()
  }

  private optionsFor(placement: DecorPlacement): PropOptions {
    return {
      rotation: placement.rotation,
      scale: placement.scale,
      colour: placement.colour,
      // Everything is addressable by its theme, so a mini-game or a
      // TIDY UP prompt can call `props.reset('decor-<theme>')` the
      // way RESTORE THE NAME and RESTOCK TNT already do. An entry
      // that named its own tag — the landing's cones — keeps it,
      // because CLEAN SWEEP counts that one.
      tag: placement.tag ?? `decor-${placement.theme}`,
    }
  }

  /** Everything in one theme back where it started. */
  reset(theme?: string): void {
    this.game.world.props.reset(theme ? `decor-${theme}` : undefined)
  }

  private report(): void {
    const lines = this.stats.map((theme) => {
      const reasons = Object.entries(theme.rejected)
        .sort((a, b) => b[1] - a[1])
        .map(([reason, n]) => `${reason} ${n}`)
        .join(', ')
      return `  ${theme.id.padEnd(14)} ${String(theme.placed).padStart(4)} of ${String(theme.attempted).padStart(5)} tried — ${reasons || 'nothing rejected'}`
    })
    console.info(
      `[world] decor: ${this.built} placed, ${this.plan.attempted} attempted, `
      + `closest pair ${this.plan.minSpacing.toFixed(2)} m\n${lines.join('\n')}`,
    )
  }
}
