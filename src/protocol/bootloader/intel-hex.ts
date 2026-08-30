// Intel HEX parser for the *_with_bl.hex images the DFU recovery path
// flashes. Produces contiguous segments; the flasher erases and writes each
// at its absolute address.

export interface HexSegment {
  address: number
  data: Uint8Array
}

export function parseIntelHex(text: string): HexSegment[] {
  let upperAddress = 0
  const segments: HexSegment[] = []
  let current: { address: number; bytes: number[] } | null = null

  const flush = () => {
    if (current && current.bytes.length > 0) {
      segments.push({ address: current.address, data: new Uint8Array(current.bytes) })
    }
    current = null
  }

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === '') continue
    if (!line.startsWith(':')) throw new Error('not an Intel HEX file')
    const bytes: number[] = []
    for (let i = 1; i < line.length; i += 2) {
      bytes.push(Number.parseInt(line.slice(i, i + 2), 16))
    }
    const [count, addrHi, addrLo, type] = bytes
    if (
      count === undefined ||
      addrHi === undefined ||
      addrLo === undefined ||
      type === undefined ||
      bytes.length !== count + 5
    ) {
      throw new Error('malformed HEX record')
    }
    const sum = bytes.reduce((a, b) => a + b, 0) & 0xff
    if (sum !== 0) throw new Error('HEX checksum failure')
    const data = bytes.slice(4, 4 + count)

    switch (type) {
      case 0x00: {
        const address = upperAddress + (addrHi << 8) + addrLo
        if (current && current.address + current.bytes.length === address) {
          current.bytes.push(...data)
        } else {
          flush()
          current = { address, bytes: [...data] }
        }
        break
      }
      case 0x01: // EOF
        flush()
        return segments
      case 0x04: // extended linear address
        upperAddress = ((data[0]! << 8) + data[1]!) << 16
        break
      case 0x02: // extended segment address
        upperAddress = ((data[0]! << 8) + data[1]!) << 4
        break
      case 0x03:
      case 0x05:
        break // start-address records: irrelevant to flashing
      default:
        throw new Error(`unsupported HEX record type ${type}`)
    }
  }
  flush()
  return segments
}
