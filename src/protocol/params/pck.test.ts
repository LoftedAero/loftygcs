import { describe, expect, it } from 'vitest'
import { decodeParamPck } from './pck'

// Build a synthetic param.pck the way ArduPilot's AP_Filesystem does:
// front-coded names, per-type value sizes, zero padding allowed between
// records. The SITL integration test validates against the real generator;
// this one pins the decoder's handling of each mechanism.
function buildPck(
  params: { name: string; value: number; apType: number }[],
  { pad = 0 } = {},
): Uint8Array {
  const chunks: number[] = []
  chunks.push(0x1b, 0x67) // magic 0x671b LE
  chunks.push(params.length & 0xff, params.length >> 8)
  chunks.push(params.length & 0xff, params.length >> 8) // total == num
  let last = ''
  for (const p of params) {
    let common = 0
    while (common < Math.min(15, p.name.length, last.length) && p.name[common] === last[common]) {
      common++
    }
    const tail = p.name.slice(common)
    chunks.push(p.apType) // no flags
    chunks.push(((tail.length - 1) << 4) | common)
    for (const ch of tail) chunks.push(ch.charCodeAt(0))
    const buf = new Uint8Array(4)
    const view = new DataView(buf.buffer)
    const sizes: Record<number, number> = { 1: 1, 2: 2, 3: 4, 4: 4 }
    if (p.apType === 1) view.setInt8(0, p.value)
    else if (p.apType === 2) view.setInt16(0, p.value, true)
    else if (p.apType === 3) view.setInt32(0, p.value, true)
    else view.setFloat32(0, p.value, true)
    for (let i = 0; i < sizes[p.apType]!; i++) chunks.push(buf[i]!)
    for (let i = 0; i < pad; i++) chunks.push(0)
    last = p.name
  }
  return new Uint8Array(chunks)
}

describe('param.pck decoder', () => {
  it('decodes all four value types with front-coded names', () => {
    const source = [
      { name: 'BATT_MONITOR', value: 4, apType: 1 },
      { name: 'BATT_CAPACITY', value: 5000, apType: 3 },
      { name: 'BATT_LOW_VOLT', value: 14.5, apType: 4 },
      { name: 'RC1_MIN', value: 1100, apType: 2 },
    ]
    const { params, totalParams } = decodeParamPck(buildPck(source))
    expect(totalParams).toBe(4)
    expect(params.map((p) => p.name)).toEqual(source.map((p) => p.name))
    expect(params[0]).toMatchObject({ value: 4, mavType: 2 })
    expect(params[1]).toMatchObject({ value: 5000, mavType: 6 })
    expect(params[2]!.value).toBeCloseTo(14.5)
    expect(params[2]!.mavType).toBe(9)
    expect(params[3]).toMatchObject({ value: 1100, mavType: 4 })
  })

  it('skips zero padding between records', () => {
    const { params } = decodeParamPck(
      buildPck(
        [
          { name: 'AHRS_EKF_TYPE', value: 3, apType: 1 },
          { name: 'AHRS_GPS_GAIN', value: 1, apType: 4 },
        ],
        { pad: 5 },
      ),
    )
    expect(params).toHaveLength(2)
    expect(params[1]!.name).toBe('AHRS_GPS_GAIN')
  })

  it('rejects a bad magic', () => {
    expect(() => decodeParamPck(new Uint8Array([0, 0, 1, 0, 1, 0]))).toThrow(/magic/)
  })
})
