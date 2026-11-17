// The binding UID ExpressLRS derives from a binding phrase: the first six
// bytes of the MD5 of the compiler flag its build system once passed,
// `-DMY_BINDING_PHRASE="<phrase>"`. A phrase of four to six comma-separated
// numbers (0-255) is taken as the UID itself. Ported from `generateUID` in
// ExpressLRS's `binary_configurator.py`. MD5 is not available from Web
// Crypto, hence the small implementation below.

export function bindingUid(phrase: string): Uint8Array {
  const parts = phrase.split(',')
  if (
    parts.length >= 4 &&
    parts.length <= 6 &&
    parts.every((p) => /^\d+$/.test(p) && Number(p) < 256)
  ) {
    const out = new Uint8Array(6)
    out.set(
      parts.map((p) => Number(p)),
      6 - parts.length,
    )
    return out
  }
  return md5(new TextEncoder().encode(`-DMY_BINDING_PHRASE="${phrase}"`)).subarray(0, 6)
}

const S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14,
  20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6,
  10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
]
const K = Array.from(
  { length: 64 },
  (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0,
)

/** RFC 1321 MD5. */
export function md5(data: Uint8Array): Uint8Array {
  const bitLen = data.length * 8
  const padded = new Uint8Array((((data.length + 8) >> 6) + 1) * 64)
  padded.set(data)
  padded[data.length] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(padded.length - 8, bitLen >>> 0, true)
  view.setUint32(padded.length - 4, Math.floor(bitLen / 2 ** 32), true)

  let a0 = 0x67452301
  let b0 = 0xefcdab89
  let c0 = 0x98badcfe
  let d0 = 0x10325476
  const m = new Uint32Array(16)
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) m[i] = view.getUint32(off + i * 4, true)
    let a = a0
    let b = b0
    let c = c0
    let d = d0
    for (let i = 0; i < 64; i++) {
      let f: number
      let g: number
      if (i < 16) {
        f = (b & c) | (~b & d)
        g = i
      } else if (i < 32) {
        f = (d & b) | (~d & c)
        g = (5 * i + 1) % 16
      } else if (i < 48) {
        f = b ^ c ^ d
        g = (3 * i + 5) % 16
      } else {
        f = c ^ (b | ~d)
        g = (7 * i) % 16
      }
      const sum = (a + f + K[i]! + m[g]!) >>> 0
      a = d
      d = c
      c = b
      b = (b + ((sum << S[i]!) | (sum >>> (32 - S[i]!)))) >>> 0
    }
    a0 = (a0 + a) >>> 0
    b0 = (b0 + b) >>> 0
    c0 = (c0 + c) >>> 0
    d0 = (d0 + d) >>> 0
  }
  const out = new Uint8Array(16)
  const ov = new DataView(out.buffer)
  ov.setUint32(0, a0, true)
  ov.setUint32(4, b0, true)
  ov.setUint32(8, c0, true)
  ov.setUint32(12, d0, true)
  return out
}
