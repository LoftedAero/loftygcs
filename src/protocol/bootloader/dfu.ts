// STM32 ROM bootloader flashing over USB DFU (DfuSe, the ST extension) --
// the recovery path for boards with no ArduPilot bootloader: hold BOOT0,
// plug in, and the chip enumerates as 0483:DF11. Same protocol Betaflight's
// configurator and ArduPilot's Web DFU Loader speak over WebUSB.
//
// The class is written against a narrow device interface rather than
// WebUSB's USBDevice so the whole flow is testable against a scripted fake.

export const DFU_VENDOR_ID = 0x0483
export const DFU_PRODUCT_ID = 0xdf11

// DFU class requests.
const DFU_DNLOAD = 1
const DFU_GETSTATUS = 3
const DFU_CLRSTATUS = 4
const DFU_ABORT = 6

// DfuSe command bytes (sent as DNLOAD block 0).
const CMD_SET_ADDRESS = 0x21
const CMD_ERASE = 0x41

// DFU states we care about (dfuDNLOAD-IDLE = 5 is the implicit "ready").
const dfuDNBUSY = 4
const dfuERROR = 10

const TRANSFER_SIZE = 2048

export interface DfuDevice {
  /** DFU class control request with payload (host -> device). */
  controlOut(request: number, value: number, data?: Uint8Array): Promise<void>
  /** DFU class control request reading `length` bytes (device -> host). */
  controlIn(request: number, value: number, length: number): Promise<Uint8Array>
  /** The DfuSe interface name string, e.g. "@Internal Flash /0x08000000/04*016Kg,…". */
  memoryLayoutString(): string
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
  onPhase?: (phase: 'erase' | 'program' | 'leave') => void
  onProgress?: (pct: number) => void
  onLog?: (line: string) => void
}

export class DfuseFlasher {
  constructor(
    private device: DfuDevice,
    private cb: DfuCallbacks = {},
  ) {}

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

  async clearState(): Promise<void> {
    const s = await this.getStatus()
    if (s.state === dfuERROR) await this.device.controlOut(DFU_CLRSTATUS, 0)
    await this.device.controlOut(DFU_ABORT, 0).catch(() => {})
    await this.getStatus().catch(() => {})
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
      for (let offset = 0; offset < seg.data.length; offset += TRANSFER_SIZE) {
        const chunk = seg.data.subarray(offset, Math.min(offset + TRANSFER_SIZE, seg.data.length))
        // Set the pointer per chunk: slower than block arithmetic, immune
        // to block-counter disagreements across ROM revisions.
        await this.command(CMD_SET_ADDRESS, seg.address + offset)
        await this.device.controlOut(DFU_DNLOAD, 2, chunk)
        await this.waitReady()
        written += chunk.length
        this.cb.onProgress?.(Math.round((100 * written) / total))
      }
    }
  }

  /** Leave DFU: point at the entry address and send an empty download. */
  async leave(entryAddress: number): Promise<void> {
    this.cb.onPhase?.('leave')
    await this.command(CMD_SET_ADDRESS, entryAddress)
    await this.device.controlOut(DFU_DNLOAD, 0)
    // The device manifests and re-enumerates; status may never answer.
    await this.getStatus().catch(() => {})
    this.cb.onLog?.('leaving DFU; board should boot.')
  }

  async flash(segments: { address: number; data: Uint8Array }[]): Promise<void> {
    if (segments.length === 0) throw new Error('DFU: nothing to flash')
    await this.clearState()
    await this.eraseFor(segments)
    await this.program(segments)
    await this.leave(segments[0]!.address)
  }
}
