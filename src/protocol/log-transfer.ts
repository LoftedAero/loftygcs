// Dataflash logs over MAVLink's own log messages (LOG_REQUEST_LIST, LOG_ENTRY,
// LOG_REQUEST_DATA, LOG_DATA, LOG_REQUEST_END), as Mission Planner reads them.
//
// MAVFTP is faster but sees only files. A board that logs to an onboard
// flash chip (LOG_BACKEND_TYPE bit 2, AP_Logger_Block) has no files to list,
// and these messages are the only way to reach its logs. They also serve the
// SD card, so the client works on any vehicle.
//
// ArduPilot (AP_Logger_MAVLinkLogTransfer.cpp):
// - ignores every request while armed, saying "Disarm for log download" once;
// - drops a LOG_REQUEST_DATA that arrives while it is still sending, so gaps
//   are requested only once the stream in flight has ended;
// - ends a stream with a short packet (count < 90) or once the requested
//   count is sent;
// - sends as fast as its own port allows, whatever a radio behind it can
//   carry. The overflow is lost, usually with the packet that ends the
//   stream, so a stream that has gone quiet for several packet intervals is
//   taken as ended rather than waiting out a full timeout;
// - stops logging to a block device while a list or download is active,
//   until LOG_REQUEST_END, so every operation here ends with one;
// - numbers list entries from 1, oldest first. The entry number is not the
//   log's own number, which the protocol never states.
import { backoff, type RttEstimator } from './link-timing'
import type { FieldValue } from './types'

/** One log as the vehicle lists it. */
export interface LogEntryInfo {
  /** List entry, from 1 (oldest). Valid only until the vehicle logs again. */
  id: number
  /** Bytes. */
  size: number
  /** Seconds since 1970, or 0 when the vehicle had no time. */
  timeUtc: number
}

type SendFn = (msgName: string, fields: Record<string, FieldValue>) => void
type Progress = (got: number, total: number) => void

/** Bytes per LOG_DATA. */
const CHUNK = 90
/** Wait for the next LOG_ENTRY or LOG_DATA before asking again. */
const STALL_FLOOR_MS = 1000
/** Asks in a row that bring nothing before giving up. */
const RETRIES = 4
/**
 * A stream that has delivered and then gone quiet this many times its longest
 * gap between packets has ended, its tail lost.
 */
const QUIET_GAPS = 4
const QUIET_FLOOR_MS = 200

/** A read stopped by `cancel`, told apart from a failure by its message. */
export class LogTransferCancelled extends Error {
  constructor() {
    super('transfer canceled')
    this.name = 'LogTransferCancelled'
  }
}

interface Listing {
  kind: 'list'
  entries: Map<number, LogEntryInfo>
  /** Unknown until the first LOG_ENTRY. */
  numLogs: number | null
  resolve: (logs: LogEntryInfo[]) => void
  reject: (e: Error) => void
}

interface Reading {
  kind: 'read'
  id: number
  buf: Uint8Array
  /** One flag per 90-byte chunk. */
  have: Uint8Array
  got: number
  /** Where the log ends: its listed size, or sooner if a short packet says so. */
  end: number
  /** End of the range last asked for; the stream stops there. */
  askedTo: number
  /** When the last LOG_DATA arrived, and the longest gap seen between two. */
  lastAt: number
  gap: number
  onProgress: Progress
  resolve: (bytes: Uint8Array) => void
  reject: (e: Error) => void
}

type Active = (Listing | Reading) & { attempt: number }

export class LogTransferClient {
  private active: Active | null = null
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private send: SendFn,
    private target: () => { sysid: number; compid: number },
    private rtt?: RttEstimator,
  ) {}

  /** Feed LOG_ENTRY and LOG_DATA here. */
  handleMessage(msgName: string, fields: Record<string, FieldValue>) {
    const a = this.active
    if (!a) return
    if (msgName === 'LOG_ENTRY' && a.kind === 'list') this.onEntry(a, fields)
    else if (msgName === 'LOG_DATA' && a.kind === 'read') this.onData(a, fields)
  }

  /** Every log on the vehicle, oldest first. */
  list(): Promise<LogEntryInfo[]> {
    return new Promise((resolve, reject) => {
      this.begin({ kind: 'list', entries: new Map(), numLogs: null, resolve, reject, attempt: 0 })
      this.askList(0, 0xffff)
    })
  }

  /** Read one log, by its list entry and listed size. */
  read(id: number, size: number, onProgress: Progress = () => {}): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      if (size <= 0) {
        reject(new Error('the log is empty'))
        return
      }
      const r: Reading & { attempt: number } = {
        kind: 'read',
        id,
        buf: new Uint8Array(size),
        have: new Uint8Array(Math.ceil(size / CHUNK)),
        got: 0,
        end: size,
        askedTo: 0,
        lastAt: 0,
        gap: 0,
        onProgress,
        resolve,
        reject,
        attempt: 0,
      }
      this.begin(r)
      this.askData(r, 0, size)
    })
  }

  /** Stop the read in progress; it rejects with LogTransferCancelled. */
  cancel() {
    if (this.active?.kind === 'read') this.fail(new LogTransferCancelled())
  }

  /** Abandon whatever is running (link closed). Nothing is sent. */
  abort(reason: string) {
    const a = this.active
    if (!a) return
    this.clear()
    a.reject(new Error(reason))
  }

  private begin(a: Active) {
    if (this.active) throw new Error('a log transfer is already running')
    this.active = a
  }

  // --- listing ---

  private askList(start: number, end: number) {
    const t = this.target()
    this.send('LOG_REQUEST_LIST', {
      targetSystem: t.sysid,
      targetComponent: t.compid,
      start,
      end,
    })
    this.arm()
  }

  private onEntry(a: Listing & { attempt: number }, f: Record<string, FieldValue>) {
    const numLogs = f.numLogs as number
    a.numLogs = numLogs
    a.attempt = 0
    if (numLogs === 0) {
      this.finish(() => a.resolve([]))
      return
    }
    const id = f.id as number
    if (id >= 1 && id <= numLogs) {
      a.entries.set(id, { id, size: f.size as number, timeUtc: f.timeUtc as number })
    }
    if (a.entries.size >= numLogs) {
      this.finish(() => a.resolve([...a.entries.values()].sort((x, y) => x.id - y.id)))
    } else {
      this.arm()
    }
  }

  // --- reading ---

  private askData(r: Reading, ofs: number, count: number) {
    const t = this.target()
    r.askedTo = ofs + count
    r.lastAt = 0
    this.send('LOG_REQUEST_DATA', {
      targetSystem: t.sysid,
      targetComponent: t.compid,
      id: r.id,
      ofs,
      count,
    })
    this.arm()
  }

  private onData(r: Reading & { attempt: number }, f: Record<string, FieldValue>) {
    if ((f.id as number) !== r.id) return
    const ofs = f.ofs as number
    const count = Math.min(f.count as number, CHUNK)
    // Every request starts on a chunk boundary, so anything else is stale.
    if (ofs % CHUNK !== 0 || ofs >= r.end) return
    const chunk = ofs / CHUNK
    const n = Math.min(count, r.end - ofs)
    if (!r.have[chunk] && n > 0) {
      r.buf.set((f.data as number[]).slice(0, n), ofs)
      r.have[chunk] = 1
      r.got += n
      r.attempt = 0
    }
    // A short packet marks the end of the log.
    if (count < CHUNK) r.end = Math.min(r.end, ofs + count)
    r.onProgress(Math.min(r.got, r.end), r.end)

    if (this.missingFrom(r) === null) {
      this.finish(() => r.resolve(r.buf.slice(0, r.end)))
      return
    }
    // The stream in flight has ended; ask for what it missed.
    if (count < CHUNK || ofs + count >= r.askedTo) {
      this.askGap(r)
      return
    }
    const now = Date.now()
    if (r.lastAt) r.gap = Math.max(r.gap, now - r.lastAt)
    r.lastAt = now
    this.arm(Math.max(QUIET_FLOOR_MS, QUIET_GAPS * r.gap))
  }

  /** First chunk not yet received, or null when the log is whole. */
  private missingFrom(r: Reading): number | null {
    const chunks = Math.ceil(r.end / CHUNK)
    for (let i = 0; i < chunks; i++) if (!r.have[i]) return i
    return null
  }

  /** Ask for the first run of missing chunks. */
  private askGap(r: Reading) {
    const first = this.missingFrom(r)
    if (first === null) return
    const chunks = Math.ceil(r.end / CHUNK)
    let last = first
    while (last + 1 < chunks && !r.have[last + 1]) last++
    const ofs = first * CHUNK
    this.askData(r, ofs, Math.min(r.end, (last + 1) * CHUNK) - ofs)
  }

  // --- timing ---

  /** Start the wait for the next reply; `quietMs` shortens it mid-stream. */
  private arm(quietMs = Infinity) {
    if (this.timer) clearTimeout(this.timer)
    const a = this.active
    if (!a) return
    const wait = this.rtt
      ? this.rtt.timeout(STALL_FLOOR_MS, a.attempt)
      : backoff(STALL_FLOOR_MS, a.attempt)
    this.timer = setTimeout(() => this.onStall(), Math.min(wait, quietMs))
  }

  private onStall() {
    const a = this.active
    if (!a) return
    if (a.attempt >= RETRIES) {
      this.fail(new Error(a.kind === 'list' ? 'log list timed out' : 'log download timed out'))
      return
    }
    a.attempt++
    if (a.kind === 'read') {
      this.askGap(a)
      return
    }
    if (a.numLogs === null) {
      this.askList(0, 0xffff)
      return
    }
    let lo = Infinity
    let hi = 0
    for (let id = 1; id <= a.numLogs; id++) {
      if (a.entries.has(id)) continue
      lo = Math.min(lo, id)
      hi = id
    }
    this.askList(lo, hi)
  }

  // --- ending ---

  /** Every ending sends LOG_REQUEST_END, which lets a block logger log again. */
  private finish(settle: () => void) {
    this.clear()
    this.sendEnd()
    settle()
  }

  private fail(err: Error) {
    const a = this.active
    if (!a) return
    this.finish(() => a.reject(err))
  }

  private sendEnd() {
    const t = this.target()
    this.send('LOG_REQUEST_END', { targetSystem: t.sysid, targetComponent: t.compid })
  }

  private clear() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.active = null
  }
}
