// Build the web app and zip it for upload to a static host.
//
//   node scripts/package-web.mjs
//
// Produces dist/LoftGCS_<version>_web.zip, whose contents unzip straight
// into a bucket or a Pages drop -- the build already uses base './', so it
// works from a domain root or any subpath without being rebuilt.
//
// Two things a host has to get right, so they are stated here rather than
// discovered: it must be HTTPS (Web Serial refuses to exist otherwise, and
// the USB connection is the whole point of the web channel), and index.html
// should not be cached for long or testers will keep loading a stale build
// after an update.
import { execFileSync } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { createDeflateRaw } from 'node:zlib'

const version = JSON.parse(readFileSync('package.json', 'utf8')).version
const out = path.resolve('dist', `LoftGCS_${version}_web.zip`)

console.log('building the web bundle…')
execFileSync(process.execPath, [path.join('node_modules', 'vite', 'bin', 'vite.js'), 'build'], {
  stdio: 'inherit',
})

const root = path.resolve('dist-web')
if (!existsSync(root)) {
  console.error('dist-web/ is missing; the build did not produce anything')
  process.exit(1)
}
mkdirSync(path.dirname(out), { recursive: true })

/** Every file under dist-web, as posix-style paths relative to it. */
function walk(dir, base = '') {
  const files = []
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    const rel = base ? `${base}/${name}` : name
    if (statSync(full).isDirectory()) files.push(...walk(full, rel))
    else files.push({ full, rel })
  }
  return files
}

// A minimal zip writer rather than a dependency: this runs once per release
// and the format's stored/deflate subset is a page of code.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function deflate(buf) {
  return new Promise((resolve, reject) => {
    const chunks = []
    const z = createDeflateRaw({ level: 9 })
    z.on('data', (d) => chunks.push(d))
    z.on('end', () => resolve(Buffer.concat(chunks)))
    z.on('error', reject)
    z.end(buf)
  })
}

const files = walk(root)
const stream = createWriteStream(out)
const central = []
let offset = 0
const write = (buf) => {
  stream.write(buf)
  offset += buf.length
}

for (const f of files) {
  const data = readFileSync(f.full)
  const comp = await deflate(data)
  const name = Buffer.from(f.rel, 'utf8')
  const crc = crc32(data)

  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4) // version needed
  local.writeUInt16LE(0, 6) // flags
  local.writeUInt16LE(8, 8) // deflate
  local.writeUInt16LE(0, 10) // time
  local.writeUInt16LE(0x21, 12) // date: any valid value
  local.writeUInt32LE(crc, 14)
  local.writeUInt32LE(comp.length, 18)
  local.writeUInt32LE(data.length, 22)
  local.writeUInt16LE(name.length, 26)
  local.writeUInt16LE(0, 28)

  const start = offset
  write(local)
  write(name)
  write(comp)

  const dir = Buffer.alloc(46)
  dir.writeUInt32LE(0x02014b50, 0)
  dir.writeUInt16LE(20, 4)
  dir.writeUInt16LE(20, 6)
  dir.writeUInt16LE(0, 8)
  dir.writeUInt16LE(8, 10)
  dir.writeUInt16LE(0, 12)
  dir.writeUInt16LE(0x21, 14)
  dir.writeUInt32LE(crc, 16)
  dir.writeUInt32LE(comp.length, 20)
  dir.writeUInt32LE(data.length, 24)
  dir.writeUInt16LE(name.length, 28)
  dir.writeUInt32LE(start, 42)
  central.push(Buffer.concat([dir, name]))
}

const centralStart = offset
for (const c of central) write(c)
const end = Buffer.alloc(22)
end.writeUInt32LE(0x06054b50, 0)
end.writeUInt16LE(central.length, 8)
end.writeUInt16LE(central.length, 10)
end.writeUInt32LE(offset - centralStart, 12)
end.writeUInt32LE(centralStart, 16)
write(end)

await new Promise((resolve) => stream.end(resolve))
const kb = Math.round(statSync(out).size / 1024)
console.log(`\n${path.relative(process.cwd(), out)}  (${files.length} files, ${kb} KB)`)
console.log('Serve over HTTPS, and do not cache index.html for long.')
