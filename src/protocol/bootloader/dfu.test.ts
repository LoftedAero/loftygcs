import { describe, expect, it } from 'vitest'
import { DfuseFlasher, parseDfuseLayout, type DfuDevice } from './dfu'

// A scripted STM32 ROM bootloader: tracks erased sectors, an address
// pointer, and written bytes, with the DNBUSY-then-poll status dance.
class FakeDfuDevice implements DfuDevice {
  erasedSectors: number[] = []
  written = new Map<number, Uint8Array>()
  private addressPointer = 0
  private busyPolls = 0
  private state = 2 // dfuIDLE

  constructor(private layout: string) {}

  memoryLayoutString() {
    return this.layout
  }

  async controlOut(request: number, _value: number, data?: Uint8Array): Promise<void> {
    if (request === 1) {
      // DNLOAD
      if (data && data.length === 5 && data[0] === 0x41) {
        const addr = new DataView(data.buffer, data.byteOffset).getUint32(1, true)
        this.erasedSectors.push(addr)
        this.state = 4 // dfuDNBUSY, must be polled through
        this.busyPolls = 2
      } else if (data && data.length === 5 && data[0] === 0x21) {
        this.addressPointer = new DataView(data.buffer, data.byteOffset).getUint32(1, true)
        this.state = 4
        this.busyPolls = 1
      } else if (data && data.length > 0) {
        this.written.set(this.addressPointer, new Uint8Array(data))
        this.state = 4
        this.busyPolls = 1
      } else {
        this.state = 7 // zero-length: manifest / leave
      }
    } else if (request === 4 || request === 6) {
      this.state = 2
    }
  }

  async controlIn(request: number, _value: number, length: number): Promise<Uint8Array> {
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
    expect(phases).toEqual(['erase', 'program', 'leave'])
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
