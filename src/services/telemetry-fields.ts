// A ring buffer per telemetry field, built as the fields arrive rather than
// declared in advance. The status list reads the latest value of each; the
// plots read the history.
//
// Not a React store: a couple of hundred fields at 10 Hz would spend the
// frame budget on reconciliation. Components poll at whatever rate suits
// them (a few Hz for a list, rAF for a plot).

/** ~90 seconds of history at the 10 Hz the engine samples at. */
const CAPACITY = 900

export interface Samples {
  /** Wall-clock milliseconds, oldest first. */
  t: Float64Array
  v: Float64Array
}

class FieldSeries {
  private times = new Float64Array(CAPACITY)
  private values = new Float64Array(CAPACITY)
  private head = 0
  private filled = false

  push(at: number, value: number) {
    this.times[this.head] = at
    this.values[this.head] = value
    this.head = (this.head + 1) % CAPACITY
    if (this.head === 0) this.filled = true
  }

  latest(): number {
    return this.values[(this.head - 1 + CAPACITY) % CAPACITY] ?? 0
  }

  /** Oldest-to-newest copy. Copied because the caller iterates while we write. */
  snapshot(): Samples {
    if (!this.filled) {
      return { t: this.times.slice(0, this.head), v: this.values.slice(0, this.head) }
    }
    const t = new Float64Array(CAPACITY)
    const v = new Float64Array(CAPACITY)
    const tail = CAPACITY - this.head
    t.set(this.times.subarray(this.head))
    t.set(this.times.subarray(0, this.head), tail)
    v.set(this.values.subarray(this.head))
    v.set(this.values.subarray(0, this.head), tail)
    return { t, v }
  }
}

class FieldRegistry {
  private series = new Map<string, FieldSeries>()
  /** Bumped whenever a name appears for the first time, so lists can tell. */
  private generation = 0

  apply(at: number, values: Record<string, number>) {
    for (const [name, value] of Object.entries(values)) {
      let s = this.series.get(name)
      if (!s) {
        s = new FieldSeries()
        this.series.set(name, s)
        this.generation++
      }
      s.push(at, value)
    }
  }

  /** Every field seen so far, sorted, so the list does not reshuffle. */
  names(): string[] {
    return [...this.series.keys()].sort()
  }

  /** Changes only when a new field appears; lets a list skip rebuilding. */
  version(): number {
    return this.generation
  }

  has(name: string): boolean {
    return this.series.has(name)
  }

  latest(name: string): number | undefined {
    return this.series.get(name)?.latest()
  }

  samples(name: string): Samples | undefined {
    return this.series.get(name)?.snapshot()
  }

  clear() {
    this.series.clear()
    this.generation++
  }
}

export const fieldRegistry = new FieldRegistry()
