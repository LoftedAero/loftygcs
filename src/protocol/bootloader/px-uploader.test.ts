import { describe, expect, it } from 'vitest'
import {
  ByteQueue,
  PxUploader,
  bootloaderCrc32,
} from './px-uploader'

// A scripted ArduPilot bootloader on the far end of the link: enough state
// machine to accept the real command sequence, remember what got
// programmed, and answer GET_CRC the way hardware does (whole flash, erased
// bytes 0xff). If the uploader and this fake agree on the CRC, the
// uploader's padding + CRC math is self-consistent end to end.
class FakeBootloader {
  flash: Uint8Array
  programOffset = 0
  erased = false
  eraseCount = 0
  private rx: number[] = []

  constructor(
    public link: ByteQueue,
    private boardId: number,
    private fwSize: number,
  ) {
    this.flash = new Uint8Array(fwSize).fill(0xff)
  }

  static create(boardId: number, fwSize: number) {
    const holder: { fake?: FakeBootloader } = {}
    const queue = new ByteQueue((bytes) => queueMicrotask(() => holder.fake?.receive(bytes)))
    holder.fake = new FakeBootloader(queue, boardId, fwSize)
    return holder.fake
  }

  private reply(bytes: number[]) {
    this.link.push(new Uint8Array(bytes))
  }

  private replyWord(word: number) {
    this.reply([word & 0xff, (word >> 8) & 0xff, (word >> 16) & 0xff, (word >>> 24) & 0xff])
  }

  receive(bytes: Uint8Array) {
    this.rx.push(...bytes)
    // Process complete commands (terminated by EOC 0x20 at expected spots).
    for (;;) {
      if (this.rx.length < 2) return
      const cmd = this.rx[0]!
      if (cmd === 0x21 && this.rx[1] === 0x20) {
        this.rx.splice(0, 2)
        this.reply([0x12, 0x10])
      } else if (cmd === 0x22) {
        if (this.rx.length < 3) return
        const param = this.rx[1]!
        this.rx.splice(0, 3)
        if (param === 1) this.replyWord(5) // bl rev
        else if (param === 2) this.replyWord(this.boardId)
        else if (param === 3) this.replyWord(0)
        else this.replyWord(this.fwSize)
        this.reply([0x12, 0x10])
      } else if (cmd === 0x23 && this.rx[1] === 0x20) {
        this.rx.splice(0, 2)
        this.erased = true
        this.eraseCount++
        this.flash.fill(0xff)
        this.programOffset = 0
        this.reply([0x12, 0x10])
      } else if (cmd === 0x27) {
        if (this.rx.length < 2) return
        const len = this.rx[1]!
        if (this.rx.length < 3 + len) return
        const data = this.rx.slice(2, 2 + len)
        this.rx.splice(0, 3 + len)
        this.flash.set(data, this.programOffset)
        this.programOffset += len
        this.reply([0x12, 0x10])
      } else if (cmd === 0x29 && this.rx[1] === 0x20) {
        this.rx.splice(0, 2)
        this.replyWord(bootloaderCrc32(this.flash))
        this.reply([0x12, 0x10])
      } else if (cmd === 0x30 && this.rx[1] === 0x20) {
        this.rx.splice(0, 2)
        // reboot: no reply
      } else {
        return
      }
    }
  }
}

function testImage(len: number): Uint8Array {
  return new Uint8Array(len).map((_, i) => (i * 13 + 7) & 0xff)
}

describe('PxUploader', () => {
  it('runs the full flash sequence and the CRCs agree', async () => {
    const fake = FakeBootloader.create(140, 4096)
    const phases: string[] = []
    const uploader = new PxUploader(fake.link, { onPhase: (p) => phases.push(p) })

    await uploader.sync()
    const info = await uploader.identify()
    expect(info.boardId).toBe(140)
    expect(info.fwSize).toBe(4096)

    const image = testImage(1001) // deliberately not word-aligned
    await uploader.erase()
    await uploader.program(image)
    await uploader.verify(image, info.fwSize)
    uploader.reboot()

    expect(fake.erased).toBe(true)
    expect(fake.flash.subarray(0, 1001)).toEqual(image)
    expect(phases).toEqual(['sync', 'erase', 'program', 'verify', 'reboot'])
  })

  it('verify fails loudly when the flash content differs', async () => {
    const fake = FakeBootloader.create(140, 4096)
    const uploader = new PxUploader(fake.link)
    await uploader.sync()
    const image = testImage(512)
    await uploader.erase()
    await uploader.program(image)
    fake.flash[100] = fake.flash[100]! ^ 0xff // simulate a bad write
    await expect(uploader.verify(image, 4096)).rejects.toThrow(/verify FAILED/)
  })

  it('reports progress through programming', async () => {
    const fake = FakeBootloader.create(9, 8192)
    const pcts: number[] = []
    const uploader = new PxUploader(fake.link, { onProgress: (p) => pcts.push(p) })
    await uploader.sync()
    await uploader.erase()
    await uploader.program(testImage(2048))
    expect(pcts.at(-1)).toBe(100)
    expect(pcts.length).toBeGreaterThan(3)
  })

  it('times out with a useful message when nothing answers', async () => {
    const silent = new ByteQueue(() => {})
    const uploader = new PxUploader(silent)
    await expect(uploader.sync(2)).rejects.toThrow(/bootloader mode/)
  })
})

describe('bootloaderCrc32', () => {
  it('matches an independent bitwise implementation', () => {
    // Same algorithm computed without the table: reflected poly 0xEDB88320,
    // init 0, no final xor (px_uploader.py's variant).
    const bitwise = (bytes: Uint8Array): number => {
      let state = 0
      for (const byte of bytes) {
        let c = (state ^ byte) & 0xff
        for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
        state = (c ^ (state >>> 8)) >>> 0
      }
      return state >>> 0
    }
    const data = testImage(300)
    expect(bootloaderCrc32(data)).toBe(bitwise(data))
    // And it chains: crc(a+b) == crc(b, crc(a)).
    const a = data.subarray(0, 130)
    const b = data.subarray(130)
    expect(bootloaderCrc32(b, bootloaderCrc32(a))).toBe(bootloaderCrc32(data))
  })
})
