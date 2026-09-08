/* ============================================================
   PORTED FROM: sources/Game/Events.js
   folio-2025 — Copyright (c) 2025 Bruno Simon — MIT
   https://github.com/brunosimon/folio-2025
   See THIRD_PARTY_NOTICES.md and ../vendor/LICENSE-folio-2025.md

   Ordered pub/sub. The `order` argument is what makes the whole
   engine's fixed tick sequence work: subscribers run in
   ascending order, so "vehicle pre-physics" (2) always runs
   before "physics step" (3) regardless of construction order.

   Changes from upstream: typed; `off()` returns whether it
   removed anything; added `clear()` so a Game instance can be
   torn down completely on route unmount.
   ============================================================ */

type Callback = (...args: never[]) => void

export class Events<Names extends string = string> {
  /** name → order → callbacks. Sparse arrays, iterated by index. */
  private callbacks = new Map<string, Map<number, Set<Callback>>>()

  on(name: Names, callback: (...args: never[]) => void, order = 1): this {
    let byOrder = this.callbacks.get(name)
    if (!byOrder) {
      byOrder = new Map()
      this.callbacks.set(name, byOrder)
    }
    let set = byOrder.get(order)
    if (!set) {
      set = new Set()
      byOrder.set(order, set)
    }
    set.add(callback as Callback)
    return this
  }

  /** Subscribe once; auto-unsubscribes after the first trigger. */
  once(name: Names, callback: (...args: never[]) => void, order = 1): this {
    const wrapped = ((...args: never[]) => {
      this.off(name, wrapped)
      ;(callback as (...a: never[]) => void)(...args)
    }) as Callback
    return this.on(name, wrapped, order)
  }

  off(name: Names, callback?: (...args: never[]) => void): boolean {
    const byOrder = this.callbacks.get(name)
    if (!byOrder) return false

    if (!callback) {
      this.callbacks.delete(name)
      return true
    }

    let removed = false
    for (const [order, set] of byOrder) {
      if (set.delete(callback as Callback)) removed = true
      if (set.size === 0) byOrder.delete(order)
    }
    if (byOrder.size === 0) this.callbacks.delete(name)
    return removed
  }

  trigger(name: Names, args: readonly unknown[] = []): this {
    const byOrder = this.callbacks.get(name)
    if (!byOrder) return this

    // Orders ascending. Snapshot both levels so a callback may
    // subscribe or unsubscribe during the trigger without the
    // iteration going wrong.
    const orders = Array.from(byOrder.keys()).sort((a, b) => a - b)
    for (const order of orders) {
      const set = byOrder.get(order)
      if (!set) continue
      for (const callback of Array.from(set)) {
        ;(callback as (...a: unknown[]) => void)(...args)
      }
    }
    return this
  }

  /** Drops every subscription. Called on teardown. */
  clear(): void {
    this.callbacks.clear()
  }

  /** Diagnostics only. */
  count(): number {
    let n = 0
    for (const byOrder of this.callbacks.values()) {
      for (const set of byOrder.values()) n += set.size
    }
    return n
  }
}
