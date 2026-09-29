// A radio link to put between the engine and SITL: limited bandwidth each
// way, latency, occasional lost packets, and a small downlink buffer that
// drops what does not fit. Like ELRS and SiK radios, it reports that buffer to
// the autopilot in RADIO_STATUS, so ArduPilot slows its streams the way it
// would on the real link instead of flooding the buffer.
//
// The defaults approximate ELRS in MAVLink mode at 333 Hz Full: about 46
// messages (1.8 kB) a second down.
import { encodeFrame } from '../protocol/frames'

export interface SlowLinkOptions {
  downBytesPerSec: number
  upBytesPerSec: number
  /** One-way delay added to every packet. */
  latencyMs: number
  /** Chance that a packet is lost in flight. */
  lossRate: number
  /** Downlink buffer; bytes arriving when it is full are dropped. */
  bufferBytes: number
  /** Bytes per over-the-air packet. */
  packetBytes: number
}

export const ELRS_333_FULL: SlowLinkOptions = {
  downBytesPerSec: 1800,
  upBytesPerSec: 1000,
  latencyMs: 100,
  lossRate: 0.005,
  // The ELRS receiver's MAVLink buffer (MAV_INPUT_BUF_LEN).
  bufferBytes: 1024,
  packetBytes: 32,
}

const TICK_MS = 20
const RADIO_STATUS_MS = 100
/** Where SiK radios report from; ArduPilot acts on RADIO_STATUS from any sender. */
const RADIO_SYSID = 51
const RADIO_COMPID = 68

class Pipe {
  private queue: number[] = []
  private credit = 0

  constructor(
    private bytesPerSec: number,
    private capacity: number,
  ) {}

  push(bytes: Uint8Array) {
    const room = this.capacity - this.queue.length
    for (let i = 0; i < Math.min(room, bytes.length); i++) this.queue.push(bytes[i]!)
  }

  /** Packets the link can carry in the elapsed time. */
  take(dtMs: number, packetBytes: number): Uint8Array[] {
    this.credit = Math.min(this.credit + (this.bytesPerSec * dtMs) / 1000, packetBytes * 4)
    const out: Uint8Array[] = []
    while (this.queue.length > 0 && this.credit >= Math.min(packetBytes, this.queue.length)) {
      const n = Math.min(packetBytes, this.queue.length)
      out.push(Uint8Array.from(this.queue.splice(0, n)))
      this.credit -= n
    }
    return out
  }

  get fill(): number {
    return this.queue.length / this.capacity
  }
}

export class SlowLink {
  private down: Pipe
  private up: Pipe
  private timers: ReturnType<typeof setInterval>[] = []
  private pending = new Set<ReturnType<typeof setTimeout>>()
  private seq = 0
  /** Counters for a test to report or assert on. */
  stats = { lostPackets: 0, deliveredDown: 0, deliveredUp: 0 }

  constructor(
    private toGcs: (bytes: Uint8Array) => void,
    private toVehicle: (bytes: Uint8Array) => void,
    private opts: SlowLinkOptions = ELRS_333_FULL,
  ) {
    this.down = new Pipe(opts.downBytesPerSec, opts.bufferBytes)
    // The uplink buffer is generous: a GCS rarely sends enough to fill one.
    this.up = new Pipe(opts.upBytesPerSec, opts.bufferBytes * 4)
  }

  fromVehicle(bytes: Uint8Array) {
    this.down.push(bytes)
  }

  fromGcs(bytes: Uint8Array) {
    this.up.push(bytes)
  }

  start() {
    this.timers.push(setInterval(() => this.tick(), TICK_MS))
    this.timers.push(setInterval(() => this.sendRadioStatus(), RADIO_STATUS_MS))
  }

  stop() {
    for (const t of this.timers) clearInterval(t)
    for (const t of this.pending) clearTimeout(t)
    this.timers = []
    this.pending.clear()
  }

  private tick() {
    for (const p of this.down.take(TICK_MS, this.opts.packetBytes)) {
      this.deliver(p, this.toGcs)
      this.stats.deliveredDown += p.length
    }
    for (const p of this.up.take(TICK_MS, this.opts.packetBytes)) {
      this.deliver(p, this.toVehicle)
      this.stats.deliveredUp += p.length
    }
  }

  private deliver(packet: Uint8Array, to: (b: Uint8Array) => void) {
    if (Math.random() < this.opts.lossRate) {
      this.stats.lostPackets++
      return
    }
    const t = setTimeout(() => {
      this.pending.delete(t)
      to(packet)
    }, this.opts.latencyMs)
    this.pending.add(t)
  }

  /** txbuf is the free share of the downlink buffer, which ArduPilot throttles on. */
  private sendRadioStatus() {
    const frame = encodeFrame(
      'RADIO_STATUS',
      {
        rxerrors: 0,
        fixed: 0,
        rssi: 200,
        remrssi: 200,
        txbuf: Math.round(100 * (1 - this.down.fill)),
        noise: 0,
        remnoise: 0,
      },
      this.seq++ & 0xff,
      RADIO_SYSID,
      RADIO_COMPID,
    )
    this.toVehicle(frame)
  }
}
