// STM32 ROM bootloader flashing over USB DFU (DfuSe, the ST extension) --
// how a board with no ArduPilot bootloader gets one -- which is most of them,
// so this is an ordinary path and not a recovery: hold BOOT0, plug in, and the
// chip enumerates as 0483:DF11. Same protocol Betaflight's configurator and
// ArduPilot's Web DFU Loader speak over WebUSB, and **Betaflight's
// `src/js/protocols/usbdfu.js` is the reference to read before theorising
// about a stall here** -- it is GPL-3.0 as this is, its comments carry the
// state-machine and H7 findings that `toIdle` is ported from, and reasoning
// from this file instead cost several bench power-cycles.
//
// The class is written against a narrow device interface rather than
// WebUSB's USBDevice so the whole flow is testable against a scripted fake.

export const DFU_VENDOR_ID = 0x0483
export const DFU_PRODUCT_ID = 0xdf11

// DFU class requests.
const DFU_DNLOAD = 1
const DFU_UPLOAD = 2
const DFU_GETSTATUS = 3
const DFU_CLRSTATUS = 4
const DFU_ABORT = 6

// DfuSe command bytes (sent as DNLOAD block 0).
const CMD_SET_ADDRESS = 0x21
const CMD_ERASE = 0x41

// DFU states. Which request brings a device back to idle depends on which
// of these it is in, so they are no longer "the ones we care about".
const dfuIDLE = 2
const dfuDNBUSY = 4
const dfuDNLOAD_IDLE = 5
const dfuUPLOAD_IDLE = 9
const dfuERROR = 10

/** Bound on `toIdle`'s polling, so a bootloader that never settles errors. */
const MAX_IDLE_POLLS = 100

// The most this code will send in one DNLOAD, whatever a device claims it
// can take. The device's own `wTransferSize` is the real limit and is almost
// always smaller; this is only a ceiling.
const MAX_TRANSFER_SIZE = 2048

// What to use when a device does not tell us. 1024 is the DFU functional
// descriptor's most common value and is accepted by every STM32 ROM loader.
const SAFE_TRANSFER_SIZE = 1024

export interface DfuDevice {
  /** DFU class control request with payload (host -> device). */
  controlOut(request: number, value: number, data?: Uint8Array): Promise<void>
  /** DFU class control request reading `length` bytes (device -> host). */
  controlIn(request: number, value: number, length: number): Promise<Uint8Array>
  /** The DfuSe interface name string, e.g. "@Internal Flash /0x08000000/04*016Kg,…". */
  memoryLayoutString(): string
  /**
   * `wTransferSize` from the device's DFU functional descriptor.
   *
   * **Not a tuning knob -- a limit the device sets.** DFU 1.1 §6.1.1: the
   * host may not send a DNLOAD payload larger than this. Sending more is not
   * merely inefficient, it stalls the endpoint, and an STM32 in ROM DFU then
   * latches into dfuERROR and refuses everything afterwards -- including
   * CLRSTATUS -- until it is power-cycled. Measured on the bench against an
   * H7 that reports 1024 while this code sent 2048: the first data block
   * stalled, and the board stayed unusable across app restarts.
   *
   * Optional because a device that will not tell us is served by
   * `SAFE_TRANSFER_SIZE` rather than by a guess in the caller.
   */
  transferSize?: number | undefined
}

export interface FlashRegionSector {
  start: number
  end: number // exclusive
  sectorSize: number
}

/** Parse ST's flash-layout descriptor string into sectors. */
export function parseDfuseLayout(desc: string): FlashRegionSector[] {
  // "@Internal Flash /0x08000000/04*016Kg,01*064Kg,07*128Kg"
  const m = desc.match(/\/\s*0x([0-9a-fA-F]+)\s*\/\s*(.+)$/)
  if (!m) throw new Error(`unrecognized DfuSe layout: ${desc}`)
  let address = Number.parseInt(m[1]!, 16)
  const sectors: FlashRegionSector[] = []
  for (const part of m[2]!.split(',')) {
    const sm = part.trim().match(/^(\d+)\*(\d+)([KMB]?)\w?$/)
    if (!sm) throw new Error(`unrecognized DfuSe sector group: ${part}`)
    const count = Number.parseInt(sm[1]!, 10)
    const unit = sm[3] === 'K' ? 1024 : sm[3] === 'M' ? 1024 * 1024 : 1
    const size = Number.parseInt(sm[2]!, 10) * unit
    for (let i = 0; i < count; i++) {
      sectors.push({ start: address, end: address + size, sectorSize: size })
      address += size
    }
  }
  return sectors
}

export interface DfuCallbacks {
  onPhase?: (phase: 'erase' | 'program' | 'verify' | 'leave') => void
  onProgress?: (pct: number) => void
  onLog?: (line: string) => void
}

export class DfuseFlasher {
  constructor(
    private device: DfuDevice,
    private cb: DfuCallbacks = {},
  ) {}

  /** The device's own limit, floored at ours; never larger than it allows. */
  private get chunkSize(): number {
    const reported = this.device.transferSize ?? 0
    return reported > 0 ? Math.min(reported, MAX_TRANSFER_SIZE) : SAFE_TRANSFER_SIZE
  }

  private async getStatus(): Promise<{ status: number; pollMs: number; state: number }> {
    const b = await this.device.controlIn(DFU_GETSTATUS, 0, 6)
    if (b.length < 6) throw new Error('DFU: short status reply')
    return {
      status: b[0]!,
      pollMs: b[1]! | (b[2]! << 8) | (b[3]! << 16),
      state: b[4]!,
    }
  }

  /** Poll until the device leaves dfuDNBUSY; error states throw. */
  private async waitReady(): Promise<void> {
    for (;;) {
      const s = await this.getStatus()
      if (s.state === dfuERROR) {
        await this.device.controlOut(DFU_CLRSTATUS, 0)
        throw new Error(`DFU error status ${s.status}`)
      }
      if (s.state !== dfuDNBUSY) return
      await new Promise((r) => setTimeout(r, Math.max(s.pollMs, 1)))
    }
  }

  private async command(cmd: number, address: number): Promise<void> {
    const payload = new Uint8Array(5)
    payload[0] = cmd
    new DataView(payload.buffer).setUint32(1, address, true)
    await this.device.controlOut(DFU_DNLOAD, 0, payload)
    await this.waitReady()
  }

  /**
   * Bring the device to dfuIDLE by sending the request its *current* state
   * asks for -- never a fixed pair of requests.
   *
   * Ported from Betaflight Configurator's `src/js/protocols/usbdfu.js`
   * (GPL-3.0, as is this file), whose comments carry two findings that cost
   * this bench three power cycles to half-rediscover:
   *
   * - **CLRSTATUS outside dfuERROR is not harmless.** Older ST/AT32/GD32
   *   ROMs tolerate it; a strict one STALLs it, exactly per spec. Their note
   *   says it "aborted the flash right at the start of the verify phase
   *   (device was in dfuDNLOAD_IDLE after writing)" -- which is the failure
   *   measured here, to the phase. From a download- or upload-idle state the
   *   correct request is ABORT.
   * - **Some H7 ROMs wedge in dfuDNBUSY after an erase** and never settle,
   *   so polling alone hangs forever. STM32CubeProgrammer unsticks them with
   *   an undocumented CLRSTATUS pair: the first answers errUNKNOWN/dfuERROR,
   *   the second OK/dfuIDLE. That is only correct for a caller that has
   *   already waited out the device's own reported poll timeout, so it is
   *   opt-in via `busyIsStuck` rather than done to every busy device -- a
   *   strict ROM must never be sent a CLRSTATUS it would rightly STALL.
   */
  private async toIdle({ busyIsStuck = false } = {}): Promise<void> {
    for (let poll = 0; poll < MAX_IDLE_POLLS; poll++) {
      const s = await this.getStatus()
      if (s.state === dfuIDLE) return
      const wait = () => new Promise((r) => setTimeout(r, Math.max(s.pollMs, 1)))
      if (s.state === dfuDNLOAD_IDLE || s.state === dfuUPLOAD_IDLE) {
        await wait()
        await this.device.controlOut(DFU_ABORT, 0)
      } else if (s.state === dfuERROR || (busyIsStuck && s.state === dfuDNBUSY)) {
        await wait()
        await this.device.controlOut(DFU_CLRSTATUS, 0)
      } else {
        // Busy, sync or manifesting: it is working. Wait as it asked.
        await wait()
      }
    }
    throw new Error(`DFU: device never reached idle after ${MAX_IDLE_POLLS} polls`)
  }

  /** Public entry for the same, used before a flash begins. */
  async clearState(): Promise<void> {
    await this.toIdle()
  }

  /** Erase every sector any segment touches. */
  async eraseFor(segments: { address: number; data: Uint8Array }[]): Promise<void> {
    this.cb.onPhase?.('erase')
    const layout = parseDfuseLayout(this.device.memoryLayoutString())
    const needed = layout.filter((sec) =>
      segments.some((seg) => seg.address < sec.end && seg.address + seg.data.length > sec.start),
    )
    if (needed.length === 0) throw new Error('DFU: firmware does not overlap device flash')
    let done = 0
    for (const sec of needed) {
      this.cb.onLog?.(`erase sector @ 0x${sec.start.toString(16)}`)
      await this.command(CMD_ERASE, sec.start)
      this.cb.onProgress?.(Math.round((100 * ++done) / needed.length))
    }
  }

  async program(segments: { address: number; data: Uint8Array }[]): Promise<void> {
    this.cb.onPhase?.('program')
    const total = segments.reduce((a, s) => a + s.data.length, 0)
    let written = 0
    for (const seg of segments) {
      // The pointer is set once, then the device walks it as wBlockNum counts
      // up from the DFU-mandated 2 -- the same shape as the read-back, and
      // Betaflight's.
      //
      // This used to re-send the address before every chunk, on the theory
      // that it was immune to block-counter disagreements across ROM
      // revisions. What it was actually immune to never came up; the cost
      // did. A DfuSe command is a DNLOAD, so the device goes dnbusy and
      // reports a poll timeout for it exactly as it does for a real write --
      // meaning every block paid **two** busy-waits, one of them for an
      // address-pointer write that touches no flash. Measured on an H7:
      // 1,634 blocks at 151 ms each, 247 s for 1.6 MB, against a read-back
      // of the same bytes over the same bus in 8 s.
      await this.toIdle()
      await this.command(CMD_SET_ADDRESS, seg.address)
      let block = 2

      for (let offset = 0; offset < seg.data.length; offset += this.chunkSize) {
        const chunk = seg.data.subarray(offset, Math.min(offset + this.chunkSize, seg.data.length))
        const at = seg.address + offset
        // A failure here says *where*. A write that stalls part way through
        // 1,633 blocks is the hard kind to diagnose -- the device latches
        // into dfuERROR and has to be power-cycled before anything can be
        // asked again, so each guess costs a physical trip to the bench.
        try {
          await this.device.controlOut(DFU_DNLOAD, block++, chunk)
          await this.waitReady()
        } catch (err) {
          const where = `0x${at.toString(16)} (block ${offset / this.chunkSize + 1} of ${Math.ceil(
            seg.data.length / this.chunkSize,
          )}, ${written} of ${total} bytes written)`
          throw new Error(
            `${err instanceof Error ? err.message : String(err)} — failed at ${where}`,
          )
        }
        written += chunk.length
        this.cb.onProgress?.(Math.round((100 * written) / total))
      }
    }
  }

  /**
   * Read the flash back and compare it byte for byte.
   *
   * This is not belt-and-braces, it is the only evidence the write happened.
   * ST's own AN3156 says of the erase command: *"No error is returned when
   * performing Erase operations on write protected sectors"* -- so a clean
   * run of acks proves nothing at all about a protected board, which will
   * answer yes to everything and boot the firmware it already had.
   * Betaflight's configurator verifies unconditionally for the same reason.
   *
   * The read is addressed the way `program` writes: set the pointer, drop
   * back to dfuIDLE (an upload is only served from there), then block 2
   * reads from the pointer.
   */
  async verify(segments: { address: number; data: Uint8Array }[]): Promise<void> {
    this.cb.onPhase?.('verify')
    const total = segments.reduce((a, s) => a + s.data.length, 0)
    let checked = 0
    for (const seg of segments) {
      // Reading is entered once per segment, not once per block: idle, then
      // set the pointer, then idle again -- Betaflight's exact order, and
      // the order this got wrong. Writing leaves the device in dnload-idle,
      // where a DfuSe command (itself a DNLOAD) is what a strict ROM stalls;
      // reaching dfuIDLE *first* is what makes the pointer write legal.
      await this.toIdle()
      await this.command(CMD_SET_ADDRESS, seg.address)
      await this.toIdle()
      // The device walks its own pointer from there, one transfer per block,
      // which is why wBlockNum counts up from the DFU-mandated 2 instead of
      // the address being re-sent for every chunk.
      let block = 2

      for (let offset = 0; offset < seg.data.length; offset += this.chunkSize) {
        const want = seg.data.subarray(offset, Math.min(offset + this.chunkSize, seg.data.length))
        const at = seg.address + offset
        // A transport failure among 1,633 reads is indistinguishable from
        // every other unless it says where it happened: a stall on the first
        // is a different bug from a stall half way through.
        let got: Uint8Array
        try {
          got = await this.device.controlIn(DFU_UPLOAD, block++, want.length)
        } catch (err) {
          throw new Error(
            `${err instanceof Error ? err.message : String(err)} — read-back failed at 0x${at.toString(
              16,
            )} (block ${offset / this.chunkSize + 1} of ${Math.ceil(
              seg.data.length / this.chunkSize,
            )}, after ${checked} of ${total} bytes checked)`,
          )
        }
        for (let i = 0; i < want.length; i++) {
          if (got[i] !== want[i]) {
            const hex = (n: number | undefined) => `0x${(n ?? 0).toString(16).padStart(2, '0')}`
            throw new Error(
              `Verify failed at 0x${(at + i).toString(16)}: read ${hex(got[i])}, ` +
                `expected ${hex(want[i])}. The board may be write protected.`,
            )
          }
        }
        checked += want.length
        this.cb.onProgress?.(Math.round((100 * checked) / total))
      }
    }
  }

  /** Leave DFU: point at the entry address and send an empty download. */
  async leave(entryAddress: number): Promise<void> {
    this.cb.onPhase?.('leave')
    // The read-back leaves the device in dfuUPLOAD_IDLE, and a DfuSe command
    // is itself a DNLOAD -- the same illegal transition that stalled the
    // start of verify, one step later. Betaflight's `leave()` opens with
    // clearStatus for exactly this reason. Reach dfuIDLE first.
    await this.toIdle()
    await this.command(CMD_SET_ADDRESS, entryAddress)
    await this.device.controlOut(DFU_DNLOAD, 0)
    // The device manifests and re-enumerates; status may never answer.
    await this.getStatus().catch(() => {})
    this.cb.onLog?.('leaving DFU; board should boot.')
  }

  /**
   * `verify` is an option only so that a board whose ROM will not serve an
   * upload can still be flashed; it defaults on, and turning it off means
   * the run can no longer tell success from a write-protected no-op.
   */
  async flash(
    segments: { address: number; data: Uint8Array }[],
    { verify = true }: { verify?: boolean } = {},
  ): Promise<void> {
    if (segments.length === 0) throw new Error('DFU: nothing to flash')
    await this.clearState()
    await this.eraseFor(segments)
    await this.program(segments)
    if (verify) await this.verify(segments)
    await this.leave(segments[0]!.address)
  }
}
