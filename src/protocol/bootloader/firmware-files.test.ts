// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { deflateSync } from 'node:zlib'
import { parseApj } from './apj'
import { parseIntelHex } from './intel-hex'

describe('parseApj', () => {
  it('decodes the zlib/base64 image and board identity', async () => {
    const image = new Uint8Array(1000).map((_, i) => (i * 31) & 0xff)
    const apjText = JSON.stringify({
      board_id: 140,
      image_size: image.length,
      image: Buffer.from(deflateSync(image)).toString('base64'),
      description: 'test firmware',
      version: '4.7.0',
    })
    const fw = await parseApj(apjText)
    expect(fw.boardId).toBe(140)
    expect(fw.image).toEqual(image)
    expect(fw.description).toBe('test firmware')
  })

  it('rejects non-apj files with a plain message', async () => {
    await expect(parseApj('MZ\x90\x00binary')).rejects.toThrow(/invalid JSON/)
    await expect(parseApj('{"foo": 1}')).rejects.toThrow(/missing image/)
  })

  it('rejects a size mismatch as corruption', async () => {
    const image = new Uint8Array(64)
    const apjText = JSON.stringify({
      board_id: 9,
      image_size: 65,
      image: Buffer.from(deflateSync(image)).toString('base64'),
    })
    await expect(parseApj(apjText)).rejects.toThrow(/corrupt/)
  })
})

function hexLine(addr: number, type: number, data: number[]): string {
  const bytes = [data.length, (addr >> 8) & 0xff, addr & 0xff, type, ...data]
  const sum = (0x100 - (bytes.reduce((a, b) => a + b, 0) & 0xff)) & 0xff
  return ':' + [...bytes, sum].map((b) => b.toString(16).padStart(2, '0')).join('')
}

describe('parseIntelHex', () => {
  it('handles extended linear addresses and merges contiguous records', () => {
    const text = [
      hexLine(0, 0x04, [0x08, 0x00]), // upper = 0x0800_0000
      hexLine(0x0000, 0x00, [1, 2, 3, 4]),
      hexLine(0x0004, 0x00, [5, 6, 7, 8]),
      hexLine(0x1000, 0x00, [9, 9]), // gap -> new segment
      hexLine(0, 0x01, []),
    ].join('\n')
    const segments = parseIntelHex(text)
    expect(segments).toHaveLength(2)
    expect(segments[0]!.address).toBe(0x08000000)
    expect([...segments[0]!.data]).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(segments[1]!.address).toBe(0x08001000)
  })

  it('rejects a bad checksum', () => {
    const good = hexLine(0, 0x00, [1, 2, 3])
    const bad = good.slice(0, -2) + '00'
    expect(() => parseIntelHex(bad)).toThrow(/checksum/)
  })

  it('rejects non-hex input', () => {
    expect(() => parseIntelHex('{"image": "..."}')).toThrow(/not an Intel HEX/)
  })
})
