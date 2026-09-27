// Preallocated ring buffers for high-rate telemetry, written on every worker
// batch and read in requestAnimationFrame by the HUD and map. High-rate data
// never goes through React state.

export class RingBuffer {
  private buf: Float64Array
  private head = 0
  private filled = false

  constructor(capacity = 512) {
    this.buf = new Float64Array(capacity)
  }

  push(v: number) {
    this.buf[this.head] = v
    this.head = (this.head + 1) % this.buf.length
    if (this.head === 0) this.filled = true
  }

  latest(): number {
    const i = (this.head - 1 + this.buf.length) % this.buf.length
    return this.buf[i] ?? 0
  }

  /** Oldest-to-newest copy, for plotting. */
  toArray(): Float64Array {
    if (!this.filled) return this.buf.slice(0, this.head)
    const out = new Float64Array(this.buf.length)
    out.set(this.buf.subarray(this.head))
    out.set(this.buf.subarray(0, this.head), this.buf.length - this.head)
    return out
  }
}

export const telemetryRings = {
  rollRad: new RingBuffer(),
  pitchRad: new RingBuffer(),
  yawRad: new RingBuffer(),
  relAltM: new RingBuffer(),
  groundspeedMs: new RingBuffer(),
  batteryV: new RingBuffer(),
  latDeg: new RingBuffer(),
  lonDeg: new RingBuffer(),
  headingDeg: new RingBuffer(),
}
