import { describe, expect, it } from 'vitest'
import { bindingUid, md5 } from './uid'
import {
  compareVersions,
  configureFirmware,
  espImageChip,
  espImageEnd,
  optionsJson,
  type ElrsTargetConfig,
} from './firmware'

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('')

describe('md5', () => {
  it('matches the RFC 1321 vectors', () => {
    const enc = new TextEncoder()
    expect(hex(md5(new Uint8Array(0)))).toBe('d41d8cd98f00b204e9800998ecf8427e')
    expect(hex(md5(enc.encode('abc')))).toBe('900150983cd24fb0d6963f7d28e17f72')
    // Crosses several 64-byte blocks.
    expect(hex(md5(enc.encode('a'.repeat(1000))))).toBe('cabe45dcc9ae5b66ba86600cca6b8ba8')
  })
})

describe('bindingUid', () => {
  it('hashes the phrase as ExpressLRS does', () => {
    // Values from Python's hashlib over the same flag string.
    expect([...bindingUid('test')]).toEqual([79, 4, 253, 130, 33, 85])
    expect([...bindingUid('my secret phrase')]).toEqual([38, 78, 91, 116, 245, 234])
  })

  it('takes four to six numbers as the UID itself, right-aligned', () => {
    expect([...bindingUid('1,2,3,4')]).toEqual([0, 0, 1, 2, 3, 4])
    expect([...bindingUid('10,20,30,40,50,60')]).toEqual([10, 20, 30, 40, 50, 60])
    // Out of range, or too few: a phrase like any other.
    expect([...bindingUid('1,2,3,256')]).not.toEqual([0, 0, 1, 2, 3, 0])
    expect(bindingUid('1,2,3').length).toBe(6)
  })
})

/** An ESP32 image with the given segment sizes and a chip id. */
function fakeImage(segments: number[], chip = 5, trailer = 0): Uint8Array {
  const body = segments.reduce((n, s) => n + 8 + s, 0)
  const end = ((24 + body + 16) & ~15) + 32
  const img = new Uint8Array(end + trailer)
  img[0] = 0xe9
  img[1] = segments.length
  img[12] = chip & 0xff
  img[13] = chip >> 8
  let pos = 24
  for (const s of segments) {
    new DataView(img.buffer).setUint32(pos + 4, s, true)
    pos += 8 + s
  }
  img.fill(0xaa, end)
  return img
}

const target: ElrsTargetConfig = {
  product_name: 'NewBeeDrone Diversity 2.4Ghz RX V2',
  lua_name: 'NBD C3 2400RX',
  layout_file: 'Generic C3 2400 PA.json',
  overlay: { power_rxen: -1, ant_ctrl: 18 },
  platform: 'esp32-c3',
  firmware: 'Unified_ESP32C3_2400_RX',
}

describe('ESP images', () => {
  it('reads the chip id and refuses what is not an image', () => {
    expect(espImageChip(fakeImage([100]))).toBe(5)
    expect(espImageChip(fakeImage([100], 0))).toBe(0)
    expect(espImageChip(new Uint8Array(32))).toBeNull()
  })

  it('finds the end after the segments, checksum padding and hash', () => {
    const img = fakeImage([100, 37, 4000], 5, 500)
    expect(espImageEnd(img)).toBe(img.length - 500)
    expect(() => espImageEnd(fakeImage([100]).subarray(0, 60))).toThrow(/truncated/)
  })
})

describe('configureFirmware', () => {
  const opts = {
    uid: bindingUid('test'),
    wifiOnInterval: 60,
    uartBaud: 420000,
    lockOnFirstConnection: true,
    flashDiscriminator: 1234,
  }

  it('appends identity, options and the layout with its overlay, replacing any old trailer', () => {
    const img = fakeImage([64], 5, 300)
    const end = img.length - 300
    const out = configureFirmware(img, target, { serial_rx: 20, power_rxen: 5 }, opts)
    expect(out.length).toBe(end + 128 + 16 + 512 + 2048)
    expect(out.subarray(0, end)).toEqual(img.subarray(0, end))
    const text = (at: number, len: number) =>
      new TextDecoder().decode(out.subarray(at, at + len)).replace(/\0+$/, '')
    expect(text(end, 128)).toBe(target.product_name)
    expect(text(end + 128, 16)).toBe(target.lua_name)
    expect(JSON.parse(text(end + 144, 512))).toEqual({
      'flash-discriminator': 1234,
      uid: [79, 4, 253, 130, 33, 85],
      'wifi-on-interval': 60,
      'rcvr-uart-baud': 420000,
      'lock-on-first-connection': true,
    })
    expect(JSON.parse(text(end + 656, 2048))).toEqual({
      serial_rx: 20,
      power_rxen: -1,
      ant_ctrl: 18,
    })
  })

  it('leaves the UID out when there is no phrase', () => {
    expect(JSON.parse(optionsJson({ ...opts, uid: null }))).not.toHaveProperty('uid')
  })
})

describe('compareVersions', () => {
  it('compares each part as a number', () => {
    expect(compareVersions('3.10.0', '3.9.2')).toBeGreaterThan(0)
    expect(compareVersions('3.6.3', '3.6.3')).toBe(0)
    expect(compareVersions('3.5.0', '3.6.3')).toBeLessThan(0)
  })
})
