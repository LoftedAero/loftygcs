// Decoder for ArduPilot's packed parameter blob, served over MAVFTP as
// @PARAM/param.pck. Ported from pymavlink's param_ftp.py (GPL-3.0).
//
// Layout: header <magic u16, num_params u16, total_params u16>, then per
// parameter: <type/flags u8, common_len:4|name_len-1:4 u8, name bytes,
// value bytes>. Names are front-coded against the previous name
// (common_len shared chars). Zero padding bytes may appear between records
// (the device aligns records to read-block boundaries).

const MAGIC = 0x671b
const MAGIC_WITH_DEFAULTS = 0x671c

/** AP_Param storage types, and their MAV_PARAM_TYPE equivalents. */
const VALUE_LEN: Record<number, number> = { 1: 1, 2: 2, 3: 4, 4: 4 }
const AP_TO_MAV_TYPE: Record<number, number> = { 1: 2, 2: 4, 3: 6, 4: 9 }

export interface PckParam {
  name: string
  value: number
  /** MAV_PARAM_TYPE, ready for PARAM_SET. */
  mavType: number
  defaultValue?: number
}

export interface PckResult {
  params: PckParam[]
  totalParams: number
}

function readValue(view: DataView, offset: number, apType: number): number {
  switch (apType) {
    case 1:
      return view.getInt8(offset)
    case 2:
      return view.getInt16(offset, true)
    case 3:
      return view.getInt32(offset, true)
    case 4:
      return view.getFloat32(offset, true)
    default:
      throw new Error(`param.pck: unknown AP type ${apType}`)
  }
}

export function decodeParamPck(data: Uint8Array): PckResult {
  if (data.length < 6) throw new Error('param.pck: too short')
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const magic = view.getUint16(0, true)
  const withDefaults = magic === MAGIC_WITH_DEFAULTS
  if (magic !== MAGIC && !withDefaults) {
    throw new Error(`param.pck: bad magic 0x${magic.toString(16)}`)
  }
  const totalParams = view.getUint16(4, true)

  const params: PckParam[] = []
  const decoder = new TextDecoder()
  let pos = 6
  let lastName = ''
  while (pos < data.length) {
    // Skip block-alignment padding.
    while (pos < data.length && data[pos] === 0) pos++
    if (pos >= data.length) break
    if (pos + 2 > data.length) throw new Error('param.pck: truncated record header')

    const typeByte = data[pos]!
    const lenByte = data[pos + 1]!
    const flags = (typeByte >> 4) & 0x0f
    const apType = typeByte & 0x0f
    const nameLen = ((lenByte >> 4) & 0x0f) + 1
    const commonLen = lenByte & 0x0f
    const vlen = VALUE_LEN[apType]
    if (!vlen) throw new Error(`param.pck: unknown AP type ${apType} at ${pos}`)
    const hasDefault = withDefaults && (flags & 1) !== 0
    const recordLen = 2 + nameLen + vlen + (hasDefault ? vlen : 0)
    if (pos + recordLen > data.length) throw new Error('param.pck: truncated record')

    const name =
      lastName.slice(0, commonLen) + decoder.decode(data.subarray(pos + 2, pos + 2 + nameLen))
    const value = readValue(view, pos + 2 + nameLen, apType)
    const param: PckParam = { name, value, mavType: AP_TO_MAV_TYPE[apType]! }
    if (hasDefault) {
      param.defaultValue = readValue(view, pos + 2 + nameLen + vlen, apType)
    }
    params.push(param)
    lastName = name
    pos += recordLen
  }
  return { params, totalParams }
}
