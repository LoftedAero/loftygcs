// STM32 ROM bootloader flashing over USB DFU (DfuSe, ST's extension). This is
// how a board without an ArduPilot bootloader gets one: hold BOOT0, plug in,
// and the chip enumerates as 0483:DF11. It is the protocol Betaflight
// Configurator and ArduPilot's Web DFU Loader use over WebUSB.
//
// `toIdle` is ported from Betaflight Configurator's
// `src/js/protocols/usbdfu.js` (GPL-3.0, like this file). Its comments
// document the DFU state-machine and H7 quirks and are the first reference
// for any stall here.
//
// Written against a narrow device interface rather than WebUSB's USBDevice so
// the flow can be tested against a scripted fake.

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

// DFU states. Which request returns a device to idle depends on its state.
const dfuIDLE = 2
const dfuDNBUSY = 4
const dfuDNLOAD_IDLE = 5
const dfuUPLOAD_IDLE = 9
const dfuERROR = 10

/** Bound on `toIdle`'s polling, so a bootloader that never settles errors. */
const MAX_IDLE_POLLS = 100

// Upper bound on one DNLOAD. The device's `wTransferSize` is the real limit
// and is usually smaller.
const MAX_TRANSFER_SIZE = 2048

// Used when a device does not report wTransferSize; every STM32 ROM loader
// accepts 1024.
const SAFE_TRANSFER_SIZE = 1024

export interface DfuDevice {
  /** DFU class control request with payload (host -> device). */
  controlOut(request: number, value: number, data?: Uint8Array): Promise<void>
  /** DFU class control request reading `length` bytes (device -> host). */
  controlIn(request: number, value: number, length: number): Promise<Uint8Array>
  /** The DfuSe interface name string, e.g. "@Internal Flash /0x08000000/04*016Kg,…". */
  memoryLayoutString(): string
  /**
   * `wTransferSize` from the device's DFU functional descriptor. DFU 1.1
   * §6.1.1 forbids a larger DNLOAD payload; an STM32 in ROM DFU that receives
   * one stalls, latches into dfuERROR and refuses everything, CLRSTATUS
   * included, until power-cycled. Absent means `SAFE_TRANSFER_SIZE`.
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

  /** The device's limit, capped at ours. */
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
   * Bring the device to dfuIDLE with the request its current state calls for.
   *
   * Ported from Betaflight Configurator's `src/js/protocols/usbdfu.js`
   * (GPL-3.0, as is this file):
   *
   * - CLRSTATUS is only for dfuERROR. Older ST/AT32/GD32 ROMs tolerate it
   *   elsewhere, but a strict ROM stalls it per spec. From download-idle or
   *   upload-idle the correct request is ABORT.
   * - Some H7 ROMs wedge in dfuDNBUSY after an erase. STM32CubeProgrammer
   *   unsticks them with an undocumented CLRSTATUS pair (the first answers
   *   errUNKNOWN/dfuERROR, the second OK/dfuIDLE). That is opt-in via
   *   `busyIsStuck`, for callers that have already waited out the device's
   *   poll timeout, since a strict ROM would stall it.
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
      // Set the pointer once per segment; the device advances it as wBlockNum
      // counts up from the DFU-mandated 2. Re-sending it per chunk would cost
      // a second busy-wait per block, because a DfuSe command is itself a
      // DNLOAD with its own poll timeout.
      await this.toIdle()
      await this.command(CMD_SET_ADDRESS, seg.address)
      let block = 2

      for (let offset = 0; offset < seg.data.length; offset += this.chunkSize) {
        const chunk = seg.data.subarray(offset, Math.min(offset + this.chunkSize, seg.data.length))
        const at = seg.address + offset
        // Report where a write failed: after a stall the device latches into
        // dfuERROR and needs a power cycle before it can be queried again.
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
   * Read the flash back and compare it byte for byte. This is the only
   * evidence the write happened: ST's AN3156 says "No error is returned when
   * performing Erase operations on write protected sectors", so a protected
   * board acks everything and keeps its old firmware.
   *
   * Addressed like `program`: set the pointer, return to dfuIDLE (uploads are
   * only served from there), then read from block 2.
   */
  async verify(segments: { address: number; data: Uint8Array }[]): Promise<void> {
    this.cb.onPhase?.('verify')
    const total = segments.reduce((a, s) => a + s.data.length, 0)
    let checked = 0
    for (const seg of segments) {
      // Idle, set the pointer, idle again (Betaflight's order). Writing
      // leaves the device in dnload-idle, where a strict ROM stalls a DfuSe
      // command, so it has to reach dfuIDLE before the pointer write.
      await this.toIdle()
      await this.command(CMD_SET_ADDRESS, seg.address)
      await this.toIdle()
      // The device advances its pointer as wBlockNum counts up from 2.
      let block = 2

      for (let offset = 0; offset < seg.data.length; offset += this.chunkSize) {
        const want = seg.data.subarray(offset, Math.min(offset + this.chunkSize, seg.data.length))
        const at = seg.address + offset
        // Say where a read failed; a stall on the first block and one half
        // way through are different bugs.
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
    // is a DNLOAD, so reach dfuIDLE first (as Betaflight's `leave()` does).
    await this.toIdle()
    await this.command(CMD_SET_ADDRESS, entryAddress)
    await this.device.controlOut(DFU_DNLOAD, 0)
    // The device manifests and re-enumerates; status may never answer.
    await this.getStatus().catch(() => {})
    this.cb.onLog?.('leaving DFU; board should boot.')
  }

  /**
   * `verify` can be turned off only for a ROM that will not serve an upload;
   * without it a write-protected no-op looks like success.
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
