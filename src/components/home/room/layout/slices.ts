/* ============================================================
   WORK THAT GIVES THE PAGE ITS FRAMES BACK

   Some of what the room does is a few dozen milliseconds of
   arithmetic (reading the copy's layout, rasterising it, planning
   the plants around it) and it has to happen when the page has
   changed under it — which is as likely to be in the middle of a
   scroll as anywhere. Run in one go it is a dropped frame or
   three; run as a generator that `yield`s between its pieces it is
   a piece or two of a frame's slack at a time.

   `sliced` drives such a generator: each slice runs pieces until its
   budget is spent (always at least one, so it always advances),
   then hands the thread back and asks to be called again. When the
   browser has idle periods it uses those, with a timeout so that a
   page that never goes idle still finishes; without
   `requestIdleCallback` (Safari) a short timer stands in.

   No imports, so a test can load it with a clock of its own.
   ============================================================ */

export interface SliceOptions {
  /** Longest a slice keeps going once it has done a piece, ms (read afresh for every slice if it is a function). */
  budget: number | (() => number)
  /** The slack a slice leaves in an idle period, ms. */
  reserve?: number
  /** Longest wait for an idle period before a slice runs anyway, ms. */
  timeout?: number
  now?: () => number
  /** Where the next slice is asked for. Returns how to take the request back. Default: idle time, else a timer. */
  schedule?: (run: (idle: { timeRemaining(): number; didTimeout: boolean } | null) => void, timeout: number) => () => void
  /** After each slice: how long it ran (ms) and how many pieces it did (a QA probe). */
  onSlice?: (ms: number, pieces: number) => void
  onDone?: () => void
  onError?: (e: unknown) => void
}

export interface Sliced {
  /** Stop where it is; the generator is closed. */
  cancel(): void
  readonly done: boolean
}

type IdleHost = {
  requestIdleCallback?: (cb: (d: { timeRemaining(): number; didTimeout: boolean }) => void, o?: { timeout: number }) => number
  cancelIdleCallback?: (h: number) => void
}

/** Idle time where the browser has it; a timer of a frame's length where it has not. */
export function idleSchedule(run: (idle: { timeRemaining(): number; didTimeout: boolean } | null) => void, timeout: number): () => void {
  const w = globalThis as unknown as IdleHost
  if (typeof w.requestIdleCallback === 'function') {
    const h = w.requestIdleCallback((d) => run(d), { timeout })
    return () => w.cancelIdleCallback?.(h)
  }
  const h = setTimeout(() => run(null), 16)
  return () => clearTimeout(h)
}

export function sliced(job: Generator<unknown, unknown, unknown>, options: SliceOptions): Sliced {
  const { reserve = 2, timeout = 150 } = options
  const budgetNow = () => (typeof options.budget === 'function' ? options.budget() : options.budget)
  const now = options.now ?? (() => performance.now())
  const schedule = options.schedule ?? idleSchedule
  let done = false
  let cancelNext: (() => void) | null = null
  const finish = () => {
    done = true
    cancelNext = null
  }
  const slice = (idle: { timeRemaining(): number; didTimeout: boolean } | null) => {
    cancelNext = null
    if (done) return
    // An idle period that has almost run out is left alone, unless it is the timeout that called us.
    if (idle && !idle.didTimeout && idle.timeRemaining() <= reserve) {
      cancelNext = schedule(slice, timeout)
      return
    }
    const t0 = now()
    const budget = budgetNow()
    const limit = idle && !idle.didTimeout ? Math.min(budget, idle.timeRemaining() - reserve) : budget
    let pieces = 0
    try {
      do {
        pieces++
        if (job.next().done) {
          finish()
          options.onSlice?.(now() - t0, pieces)
          options.onDone?.()
          return
        }
      } while (now() - t0 < limit)
    } catch (e) {
      finish()
      options.onError?.(e)
      return
    }
    options.onSlice?.(now() - t0, pieces)
    cancelNext = schedule(slice, timeout)
  }
  cancelNext = schedule(slice, timeout)
  return {
    cancel() {
      if (done) return
      const stop = cancelNext
      finish()
      stop?.()
      try { job.return(undefined) } catch { /* a job that is running right now, or already closed */ }
    },
    get done() { return done },
  }
}
