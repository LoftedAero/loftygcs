// MAVFTP packet layout, carried inside FILE_TRANSFER_PROTOCOL's 251-byte
// payload array. Ported from the definitions in pymavlink's mavftp.py and
// ArduPilot's AP_Filesystem docs (GPL-3.0 heritage).
//
//   seq(u16) session(u8) opcode(u8) size(u8) req_opcode(u8)
//   burst_complete(u8) padding(u8) offset(u32) data[0..239]

export const FTP_HEADER_SIZE = 12
export const FTP_MAX_DATA = 239

export const FtpOp = {
  None: 0,
  TerminateSession: 1,
  ResetSessions: 2,
  ListDirectory: 3,
  OpenFileRO: 4,
  ReadFile: 5,
  CreateFile: 6,
  WriteFile: 7,
  RemoveFile: 8,
  CreateDirectory: 9,
  RemoveDirectory: 10,
  OpenFileWO: 11,
  TruncateFile: 12,
  Rename: 13,
  CalcFileCRC32: 14,
  BurstReadFile: 15,
  Ack: 128,
  Nak: 129,
} as const

export const FtpError = {
  None: 0,
  Fail: 1,
  FailErrno: 2,
  InvalidDataSize: 3,
  InvalidSession: 4,
  NoSessionsAvailable: 5,
  EndOfFile: 6,
  UnknownCommand: 7,
  FileExists: 8,
  FileProtected: 9,
  FileNotFound: 10,
} as const

export interface FtpPacket {
  seq: number
  session: number
  opcode: number
  size: number
  reqOpcode: number
  burstComplete: number
  offset: number
  data: Uint8Array
}

export function encodeFtpPacket(p: {
  seq: number
  session: number
  opcode: number
  offset: number
  data?: Uint8Array
  /** Overrides the size field: ReadFile puts its byte count here, with no data. */
  size?: number
}): number[] {
  const data = p.data ?? new Uint8Array(0)
  const buf = new Uint8Array(FTP_HEADER_SIZE + FTP_MAX_DATA) // full-size, zero-padded
  const view = new DataView(buf.buffer)
  view.setUint16(0, p.seq, true)
  buf[2] = p.session
  buf[3] = p.opcode
  buf[4] = p.size ?? data.length
  buf[5] = 0 // req_opcode: only meaningful in replies
  buf[6] = 0 // burst_complete
  buf[7] = 0 // padding
  view.setUint32(8, p.offset, true)
  buf.set(data, FTP_HEADER_SIZE)
  // FILE_TRANSFER_PROTOCOL wants a plain number[] for its uint8_t[251] field.
  return Array.from(buf)
}

export function decodeFtpPacket(payload: number[] | Uint8Array): FtpPacket {
  const buf = payload instanceof Uint8Array ? payload : new Uint8Array(payload)
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const size = buf[4] ?? 0
  return {
    seq: view.getUint16(0, true),
    session: buf[2] ?? 0,
    opcode: buf[3] ?? 0,
    size,
    reqOpcode: buf[5] ?? 0,
    burstComplete: buf[6] ?? 0,
    offset: view.getUint32(8, true),
    data: buf.slice(FTP_HEADER_SIZE, FTP_HEADER_SIZE + size),
  }
}
