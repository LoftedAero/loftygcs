// Payload (de)serialization driven by mavlink-mappings' field tables.
// node-mavlink's parser needs Node streams and cannot run in a worker, so the
// byte-level work is done here, with offsets, sizes and CRC-extra constants
// taken from mavlink-mappings rather than hand-transcribed.
import { minimal, standard, common, ardupilotmega } from 'mavlink-mappings'
import type { DecodedMessage, FieldValue } from './types'

interface FieldDef {
  name: string
  offset: number
  type: string
  /** 0 for a scalar, element count for an array. */
  length: number
  /** Element size in bytes. */
  size: number
}

export interface MessageClass {
  MSG_ID: number
  MSG_NAME: string
  PAYLOAD_LENGTH: number
  MAGIC_NUMBER: number
  FIELDS: FieldDef[]
}

// Later dialects win on msgid collisions; ardupilotmega extends common.
const REGISTRY = new Map<number, MessageClass>()
const BY_NAME = new Map<string, MessageClass>()
for (const dialect of [
  minimal.REGISTRY,
  standard.REGISTRY,
  common.REGISTRY,
  ardupilotmega.REGISTRY,
]) {
  for (const [id, cls] of Object.entries(dialect)) {
    const mc = cls as unknown as MessageClass
    REGISTRY.set(Number(id), mc)
    BY_NAME.set(mc.MSG_NAME, mc)
  }
}

export function messageById(msgid: number): MessageClass | undefined {
  return REGISTRY.get(msgid)
}

export function messageByName(name: string): MessageClass | undefined {
  return BY_NAME.get(name)
}

function readScalar(view: DataView, offset: number, type: string): number | bigint {
  switch (type) {
    case 'uint8_t':
    case 'uint8_t_mavlink_version':
      return view.getUint8(offset)
    case 'int8_t':
      return view.getInt8(offset)
    case 'uint16_t':
      return view.getUint16(offset, true)
    case 'int16_t':
      return view.getInt16(offset, true)
    case 'uint32_t':
      return view.getUint32(offset, true)
    case 'int32_t':
      return view.getInt32(offset, true)
    case 'uint64_t':
      return view.getBigUint64(offset, true)
    case 'int64_t':
      return view.getBigInt64(offset, true)
    case 'float':
      return view.getFloat32(offset, true)
    case 'double':
      return view.getFloat64(offset, true)
    default:
      throw new Error(`unknown MAVLink field type ${type}`)
  }
}

function writeScalar(view: DataView, offset: number, type: string, value: number | bigint) {
  const n = typeof value === 'bigint' ? value : Math.trunc(value)
  switch (type) {
    case 'uint8_t':
    case 'uint8_t_mavlink_version':
      view.setUint8(offset, Number(n))
      break
    case 'int8_t':
      view.setInt8(offset, Number(n))
      break
    case 'uint16_t':
      view.setUint16(offset, Number(n), true)
      break
    case 'int16_t':
      view.setInt16(offset, Number(n), true)
      break
    case 'uint32_t':
      view.setUint32(offset, Number(n), true)
      break
    case 'int32_t':
      view.setInt32(offset, Number(n), true)
      break
    case 'uint64_t':
      view.setBigUint64(offset, BigInt(n), true)
      break
    case 'int64_t':
      view.setBigInt64(offset, BigInt(n), true)
      break
    case 'float':
      view.setFloat32(offset, typeof value === 'bigint' ? Number(value) : value, true)
      break
    case 'double':
      view.setFloat64(offset, typeof value === 'bigint' ? Number(value) : value, true)
      break
    default:
      throw new Error(`unknown MAVLink field type ${type}`)
  }
}

export function decodePayload(cls: MessageClass, payload: Uint8Array): Record<string, FieldValue> {
  // MAVLink v2 truncates trailing zero bytes; the decoder works over the
  // full-length payload so field offsets stay valid.
  let full = payload
  if (payload.length < cls.PAYLOAD_LENGTH) {
    full = new Uint8Array(cls.PAYLOAD_LENGTH)
    full.set(payload)
  }
  const view = new DataView(full.buffer, full.byteOffset, full.byteLength)
  const fields: Record<string, FieldValue> = {}
  for (const f of cls.FIELDS) {
    // Array fields carry their element type as e.g. "char[]" / "uint16_t[]".
    const elemType = f.type.endsWith('[]') ? f.type.slice(0, -2) : f.type
    if (f.length === 0) {
      fields[f.name] = readScalar(view, f.offset, elemType)
    } else if (elemType === 'char') {
      // char arrays are NUL-padded strings on the wire.
      const bytes = full.subarray(f.offset, f.offset + f.length)
      const end = bytes.indexOf(0)
      fields[f.name] = new TextDecoder().decode(end === -1 ? bytes : bytes.subarray(0, end))
    } else {
      const arr: number[] = []
      for (let i = 0; i < f.length; i++) {
        arr.push(Number(readScalar(view, f.offset + i * f.size, elemType)))
      }
      fields[f.name] = arr
    }
  }
  return fields
}

export function encodePayload(cls: MessageClass, fields: Record<string, FieldValue>): Uint8Array {
  const buf = new Uint8Array(cls.PAYLOAD_LENGTH)
  const view = new DataView(buf.buffer)
  for (const f of cls.FIELDS) {
    const value = fields[f.name]
    if (value === undefined) continue // unset fields stay zero, matching the wire default
    const elemType = f.type.endsWith('[]') ? f.type.slice(0, -2) : f.type
    if (f.length === 0) {
      writeScalar(view, f.offset, elemType, value as number | bigint)
    } else if (elemType === 'char') {
      const bytes = new TextEncoder().encode(String(value)).subarray(0, f.length)
      buf.set(bytes, f.offset)
    } else {
      const arr = value as number[]
      for (let i = 0; i < Math.min(arr.length, f.length); i++) {
        writeScalar(view, f.offset + i * f.size, elemType, arr[i] ?? 0)
      }
    }
  }
  return buf
}

export function decodeFrameFields(
  msgid: number,
  payload: Uint8Array,
): { msgName: string; fields: Record<string, FieldValue> } | null {
  const cls = REGISTRY.get(msgid)
  if (!cls) return null
  return { msgName: cls.MSG_NAME, fields: decodePayload(cls, payload) }
}

export type { DecodedMessage }
