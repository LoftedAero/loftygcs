// ArduPilot .apj firmware files: a JSON envelope holding a zlib-compressed
// base64 image plus the board identity the bootloader must match.
// DecompressionStream exists in every home this code runs in (browser,
// worker, Node 18+), so no zlib dependency.

export interface ApjFirmware {
  image: Uint8Array
  imageSize: number
  boardId: number
  boardRevision: number
  description: string
  version: string
  gitHash: string
}

async function inflate(compressed: Uint8Array): Promise<Uint8Array> {
  // 'deflate' is the zlib-wrapped format .apj uses (not 'deflate-raw').
  const ds = new DecompressionStream('deflate')
  const stream = new Blob([compressed as BlobPart]).stream().pipeThrough(ds)
  const out = new Uint8Array(await new Response(stream).arrayBuffer())
  return out
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export async function parseApj(text: string): Promise<ApjFirmware> {
  let json: Record<string, unknown>
  try {
    json = JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new Error('not an .apj file (invalid JSON)')
  }
  if (typeof json.image !== 'string' || typeof json.board_id !== 'number') {
    throw new Error('not an .apj file (missing image or board_id)')
  }
  const image = await inflate(base64ToBytes(json.image))
  const imageSize = typeof json.image_size === 'number' ? json.image_size : image.length
  if (image.length !== imageSize) {
    // Truth is the decompressed bytes; a mismatched header is corruption.
    throw new Error(`corrupt .apj: image is ${image.length} bytes, header says ${imageSize}`)
  }
  return {
    image,
    imageSize,
    boardId: json.board_id,
    boardRevision: typeof json.board_revision === 'number' ? json.board_revision : 0,
    description: typeof json.description === 'string' ? json.description : '',
    version: typeof json.version === 'string' ? json.version : '',
    gitHash: typeof json.git_identity === 'string' ? json.git_identity : '',
  }
}
