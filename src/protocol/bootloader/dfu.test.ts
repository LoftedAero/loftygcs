import { describe, expect, it } from 'vitest'
import { DfuseFlasher, parseDfuseLayout, type DfuDevice } from './dfu'

// A scripted STM32 ROM bootloader: tracks erased sectors, an address
// pointer, and written bytes, with the DNBUSY-then-poll status dance.
class FakeDfuDevice implements DfuDevice {
  erasedSectors: number[] = []
  written = new Map<number, Uint8Array>()
  private addressPointer = 0
  private readCursor = 0
  private writeCursor = 0
  private expectBlock = 2
  private expectWriteBlock = 2
  private busyPolls = 0
  private state = 2 // dfuIDLE

  /**
   * `writeProtected` acks every erase and every download and stores nothing,
   * which is exactly what AN3156 says a protected board does. It is the
   * failure the verify pass exists to catch, so it is modelled here rather
   * than assumed.
   */
  /** Every data payload this device was handed, in order. */
  chunks: number[] = []
  /** Set when the host broke the wTransferSize contract. */
  stalled = false

  constructor(
    private layout: string,
    private writeProtected = false,
    readonly transferSize?: number,
  ) {}

  memoryLayoutString() {
    return this.layout
  }

  async controlOut(request: number, _value: number, data?: Uint8Array): Promise<void> {
    if (request === 1) {
      // A DNLOAD -- including every DfuSe command, which is a DNLOAD with
      // wBlockNum 0 -- is illegal while the device is serving reads. This is
      // what stalled `leave()` on the bench after a clean verify.
      if (this.state === 9) throw new Error('stalled: DNLOAD from dfuUPLOAD_IDLE')
      // DNLOAD
      if (data && data.length === 5 && data[0] === 0x41) {
        const addr = new DataView(data.buffer, data.byteOffset).getUint32(1, true)
        this.erasedSectors.push(addr)
        this.state = 4 // dfuDNBUSY, must be polled through
        this.busyPolls = 2
      } else if (data && data.length === 5 && data[0] === 0x21) {
        this.addressPointer = new DataView(data.buffer, data.byteOffset).getUint32(1, true)
        // A fresh pointer restarts the block walk, for reads and writes
        // alike: the device advances its own cursor per block from here.
        this.readCursor = this.addressPointer
        this.writeCursor = this.addressPointer
        this.expectBlock = 2
        this.expectWriteBlock = 2
        this.state = 4
        this.busyPolls = 1
      } else if (data && data.length > 0) {
        // A real STM32 stalls a payload larger than the wTransferSize it
        // advertised, and latches into dfuERROR for the rest of the session.
        this.chunks.push(data.length)
        if (this.transferSize !== undefined && data.length > this.transferSize) {
          this.stalled = true
          this.state = 10 // dfuERROR
          throw new Error('stalled: payload over wTransferSize')
        }
        // wBlockNum counts up from 2 and the device walks its own cursor.
        if (_value !== this.expectWriteBlock) {
          throw new Error(`stalled: DNLOAD block ${_value}, expected ${this.expectWriteBlock}`)
        }
        this.expectWriteBlock++
        if (!this.writeProtected) this.written.set(this.writeCursor, new Uint8Array(data))
        this.writeCursor += data.length
        this.state = 4
        this.busyPolls = 1
      } else {
        this.state = 7 // zero-length: manifest / leave
      }
    } else if (request === 4) {
      // CLRSTATUS. A strict ROM -- the STM32C5, and this fake -- STALLs this
      // outside dfuERROR, per the DFU spec. Sending it blindly to return to
      // idle is the bug Betaflight documents and this code had.
      if (this.state !== 10) throw new Error('stalled: CLRSTATUS outside dfuERROR')
      this.state = 2
    } else if (request === 6) {
      this.state = 2 // ABORT: legal from any of the idle-ish states
    }
  }

  async controlIn(request: number, _value: number, length: number): Promise<Uint8Array> {
    if (request === 2) {
      // UPLOAD. Two things a real DfuSe device insists on, both modelled
      // because the code got both wrong against hardware:
      //   - it must be in dfuIDLE; reading straight out of dnload-idle after
      //     a write is what stalled on the bench;
      //   - wBlockNum counts up from 2 and the device walks its own pointer,
      //     rather than the host re-setting the address for every block.
      // Legal from idle (the first read) and from upload-idle (the rest).
      if (this.state !== 2 && this.state !== 9) {
        throw new Error(`stalled: UPLOAD in state ${this.state}`)
      }
      this.state = 9 // dfuUPLOAD_IDLE
      if (_value !== this.expectBlock) {
        throw new Error(`stalled: UPLOAD block ${_value}, expected ${this.expectBlock}`)
      }
      this.expectBlock++
      const stored = this.written.get(this.readCursor)
      this.readCursor += length
      const out = new Uint8Array(length).fill(0xff)
      if (stored) out.set(stored.subarray(0, length))
      return out
    }
    if (request !== 3) throw new Error(`unexpected controlIn ${request}`)
    const b = new Uint8Array(length)
    if (this.state === 4 && this.busyPolls-- <= 0) this.state = 5 // -> DNLOAD_IDLE
    b[0] = 0 // status OK
    b[1] = 1 // 1 ms poll
    b[4] = this.state
    return b
  }
}

const LAYOUT = '@Internal Flash  /0x08000000/04*016Kg,01*064Kg,07*128Kg'

describe('parseDfuseLayout', () => {
  it('expands ST sector groups into absolute sectors', () => {
    const sectors = parseDfuseLayout(LAYOUT)
    expect(sectors).toHaveLength(12)
    expect(sectors[0]).toEqual({ start: 0x08000000, end: 0x08004000, sectorSize: 16 * 1024 })
    expect(sectors[4]).toEqual({ start: 0x08010000, end: 0x08020000, sectorSize: 64 * 1024 })
    expect(sectors[11]!.end).toBe(0x08000000 + 4 * 16384 + 65536 + 7 * 131072)
  })

  it('rejects strings that are not layouts', () => {
    expect(() => parseDfuseLayout('STM32 BOOTLOADER')).toThrow(/unrecognized/)
  })
})

describe('DfuseFlasher', () => {
  it('erases only the touched sectors, writes chunks, and leaves', async () => {
    const device = new FakeDfuDevice(LAYOUT)
    const phases: string[] = []
    const flasher = new DfuseFlasher(device, { onPhase: (p) => phases.push(p) })

    // 20 KB at flash start: spans the first two 16 KB sectors only.
    const data = new Uint8Array(20 * 1024).map((_, i) => i & 0xff)
    await flasher.flash([{ address: 0x08000000, data }])

    expect(device.erasedSectors).toEqual([0x08000000, 0x08004000])
    // Chunks of 2048 at sequential addresses, all bytes accounted for.
    const totalWritten = [...device.written.values()].reduce((a, c) => a + c.length, 0)
    expect(totalWritten).toBe(data.length)
    expect(device.written.get(0x08000000)?.[5]).toBe(5)
    expect(device.written.has(0x08000000 + 2048)).toBe(true)
    expect(phases).toEqual(['erase', 'program', 'verify', 'leave'])
  })

  it('catches a write-protected board that acked everything', async () => {
    // AN3156: "No error is returned when performing Erase operations on
    // write protected sectors." So the run completes cleanly and the board
    // still holds its old firmware -- the read-back is the only thing that
    // can tell the difference.
    const device = new FakeDfuDevice(LAYOUT, true)
    const flasher = new DfuseFlasher(device)
    const data = new Uint8Array(4096).map((_, i) => i & 0xff)
    await expect(flasher.flash([{ address: 0x08000000, data }])).rejects.toThrow(
      /Verify failed at 0x8000000: read 0xff, expected 0x00.*write protected/s,
    )
    // It got all the way through erase and program without a complaint.
    expect(device.erasedSectors).toEqual([0x08000000])
  })

  it('can be asked to skip the read-back, for a ROM that will not serve one', async () => {
    const device = new FakeDfuDevice(LAYOUT, true)
    const phases: string[] = []
    const flasher = new DfuseFlasher(device, { onPhase: (p) => phases.push(p) })
    await flasher.flash([{ address: 0x08000000, data: new Uint8Array(512) }], { verify: false })
    expect(phases).toEqual(['erase', 'program', 'leave'])
  })

  // DFU 1.1 §6.1.1: the host may not send a DNLOAD payload larger than the
  // wTransferSize the device advertised in its functional descriptor. This
  // was a hardcoded 2048 against a board that reports 1024, which stalled the
  // first data block and left the board in dfuERROR -- refusing everything
  // afterwards, CLRSTATUS included, across app restarts, until it was
  // physically power-cycled. Bench-measured on an STM32H7.
  it('never sends more in one block than the device said it can take', async () => {
    const device = new FakeDfuDevice(LAYOUT, false, 1024)
    const flasher = new DfuseFlasher(device)
    const data = new Uint8Array(5000).map((_, i) => i & 0xff)
    await flasher.flash([{ address: 0x08000000, data }], { verify: false })
    expect(device.stalled).toBe(false)
    expect(Math.max(...device.chunks)).toBeLessThanOrEqual(1024)
  })

  it('uses a safe block size when the device declares none', async () => {
    // A device that reports nothing is not an invitation to pick a big
    // number: unknown takes the value every STM32 ROM loader accepts.
    const device = new FakeDfuDevice(LAYOUT)
    const flasher = new DfuseFlasher(device)
    await flasher.flash([{ address: 0x08000000, data: new Uint8Array(3000) }], { verify: false })
    expect(Math.max(...device.chunks)).toBeLessThanOrEqual(1024)
  })

  it('refuses firmware that misses the device flash entirely', async () => {
    const device = new FakeDfuDevice(LAYOUT)
    const flasher = new DfuseFlasher(device)
    await expect(
      flasher.flash([{ address: 0x20000000, data: new Uint8Array(16) }]),
    ).rejects.toThrow(/does not overlap/)
    expect(device.erasedSectors).toHaveLength(0)
  })
})
