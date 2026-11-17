import { writeFile } from './radio-maps'

// Installs or updates Lofty PFD on a radio's card from its latest release.
//
// The release's manifest.json is Lofty PFD's (its docs/architecture.md,
// "Installing from Lofty GCS"): for each radio, every file with its place on
// the card, size and hash, and the rules for what an install removes. Both
// GitHub hosts used here send CORS headers, so this works in Chrome as well
// as the desktop app. The card is reached as in radio-maps.ts.

const REPO = 'LoftedAero/loftypfd'
export const RELEASE_URL = `https://api.github.com/repos/${REPO}/releases/latest`
export const manifestUrl = (tag: string) =>
  `https://raw.githubusercontent.com/${REPO}/${tag}/manifest.json`

/** The manifest format this build reads. */
const FORMAT = 1

export interface PfdFile {
  from: string
  to: string
  size: number
  sha256: string
}

export interface PfdRadio {
  /** The manifest's key: `edgetx`, `ethos`. */
  key: string
  /** Where Lofty PFD's scripts live; its presence names the radio. */
  folder: string
  /** Paths only this radio's cards hold. */
  signs: string[]
  /** Folders the release owns: what it no longer lists there is removed. */
  owned: string[]
  /** Globs removed wherever they match, unless the release lists the file. */
  remove: string[]
  files: PfdFile[]
}

export interface PfdRelease {
  version: string
  /** Each file's address, with `{version}` and `{from}` to fill. */
  files: string
  radios: PfdRadio[]
}

const RADIO_LABELS: Record<string, string> = { edgetx: 'EdgeTX', ethos: 'Ethos' }

export function radioLabel(key: string): string {
  return RADIO_LABELS[key] ?? key
}

/**
 * A path the manifest may write or remove: relative and inside the card. The
 * manifest comes from the network, so nothing in it may climb out of the
 * folder the pilot picked.
 */
function safePath(p: unknown): p is string {
  if (typeof p !== 'string' || p === '' || p.startsWith('/') || p.includes('\\')) return false
  return p.split('/').every((s) => s !== '' && s !== '.' && s !== '..' && !s.includes(':'))
}

function strings(v: unknown): string[] | null {
  return Array.isArray(v) && v.every(safePath) ? v : null
}

const unreadable = () => new Error("The release's file list could not be read.")

/**
 * The release from its manifest, which must be format 1 and carry the
 * version its tag names. Throws a user-readable Error.
 */
export function parseManifest(json: unknown, tag: string): PfdRelease {
  if (typeof json !== 'object' || json === null) throw unreadable()
  const m = json as Record<string, unknown>
  if (m.format !== FORMAT) throw new Error('This Lofty PFD release needs a newer Lofty GCS.')
  if (typeof m.version !== 'string' || m.version !== tag.replace(/^v/, '')) {
    throw new Error("The release's file list does not match its version.")
  }
  if (typeof m.files !== 'string' || !m.files.startsWith('https://')) throw unreadable()
  if (typeof m.radios !== 'object' || m.radios === null) throw unreadable()
  const radios: PfdRadio[] = []
  for (const [key, value] of Object.entries(m.radios as Record<string, unknown>)) {
    const r = value as Record<string, unknown>
    const signs = strings(r.signs)
    const owned = strings(r.owned)
    const remove = strings(r.remove)
    if (!safePath(r.folder) || !signs || !owned || !remove || !Array.isArray(r.files)) {
      throw unreadable()
    }
    const files = r.files.map((f: Record<string, unknown>) => {
      if (
        typeof f?.from !== 'string' ||
        !safePath(f.to) ||
        typeof f.size !== 'number' ||
        typeof f.sha256 !== 'string' ||
        !/^[0-9a-f]{64}$/i.test(f.sha256)
      ) {
        throw unreadable()
      }
      return { from: f.from, to: f.to, size: f.size, sha256: f.sha256.toLowerCase() }
    })
    radios.push({ key, folder: r.folder, signs, owned, remove, files })
  }
  if (radios.length === 0) throw unreadable()
  return { version: m.version, files: m.files, radios }
}

type Fetcher = (url: string) => Promise<Response>

async function get(url: string, fetcher: Fetcher): Promise<Response> {
  let res: Response
  try {
    res = await fetcher(url)
  } catch {
    throw new Error('Could not reach GitHub.')
  }
  // Unauthenticated API calls are limited per address, and the limit answers 403.
  if (res.status === 403 || res.status === 429) {
    throw new Error('GitHub is refusing requests for now. Try again later.')
  }
  if (res.status === 404) throw new Error('No Lofty PFD release is published.')
  if (!res.ok) throw new Error(`GitHub answered ${res.status}.`)
  return res
}

/** The latest published release (GitHub's `latest` skips pre-releases). */
export async function latestRelease(fetcher: Fetcher = (u) => fetch(u)): Promise<PfdRelease> {
  const info = (await (await get(RELEASE_URL, fetcher)).json().catch(() => null)) as {
    tag_name?: unknown
  } | null
  if (typeof info?.tag_name !== 'string') throw unreadable()
  const tag = info.tag_name
  const json = (await (await get(manifestUrl(tag), fetcher)).json().catch(() => null)) as unknown
  return parseManifest(json, tag)
}

// --- the card ----------------------------------------------------------

type Dir = FileSystemDirectoryHandle

async function dirAt(root: Dir, segments: readonly string[]): Promise<Dir | null> {
  let dir = root
  try {
    for (const name of segments) dir = await dir.getDirectoryHandle(name)
    return dir
  } catch {
    return null
  }
}

async function exists(root: Dir, path: string): Promise<boolean> {
  const segments = path.split('/')
  const parent = await dirAt(root, segments.slice(0, -1))
  if (!parent) return false
  const name = segments[segments.length - 1]!
  for (const open of [() => parent.getFileHandle(name), () => parent.getDirectoryHandle(name)]) {
    try {
      await open()
      return true
    } catch {
      // Not that kind of entry.
    }
  }
  return false
}

/**
 * The radio this card is from: the one whose Lofty PFD folder is there, else
 * the one whose signs are, else null for the pilot to say. `update` says
 * Lofty PFD is already on the card.
 */
export async function whichRadio(
  card: Dir,
  release: PfdRelease,
): Promise<{ radio: PfdRadio; update: boolean } | null> {
  const installed: PfdRadio[] = []
  for (const r of release.radios) {
    if (await dirAt(card, r.folder.split('/'))) installed.push(r)
  }
  if (installed.length === 1) return { radio: installed[0]!, update: true }
  const signed: PfdRadio[] = []
  for (const r of release.radios) {
    for (const s of r.signs) {
      if (await exists(card, s)) {
        signed.push(r)
        break
      }
    }
  }
  if (signed.length !== 1) return null
  return { radio: signed[0]!, update: installed.includes(signed[0]!) }
}

/**
 * The picked folder's name when it is one of the folders an install writes
 * into, not a card's root: installing there would nest Lofty PFD a level too
 * deep, where the radio never looks.
 */
export function insideLayout(picked: Dir, release: PfdRelease): string | null {
  const names = new Set<string>()
  for (const r of release.radios) {
    for (const p of [r.folder, ...r.owned, ...r.files.map((f) => f.to.replace(/\/[^/]*$/, ''))]) {
      for (const s of p.split('/')) names.add(s.toLowerCase())
    }
  }
  return names.has(picked.name.toLowerCase()) ? picked.name : null
}

/** A manifest glob: `*` and `?` within a name, `**` across folders. FAT ignores case. */
export function globRegExp(pattern: string): RegExp {
  const segments = pattern.split('/')
  let re = ''
  segments.forEach((s, i) => {
    const last = i === segments.length - 1
    if (s === '**') {
      re += last ? '.*' : '(?:[^/]+/)*'
      return
    }
    for (const c of s) {
      re += c === '*' ? '[^/]*' : c === '?' ? '[^/]' : c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
    if (!last) re += '/'
  })
  return new RegExp(`^${re}$`, 'i')
}

interface Entry {
  path: string
  parent: Dir
  name: string
}

type Listable = Dir & { entries(): AsyncIterable<[string, FileSystemHandle]> }

/** Every file under `dir`, `depth` folders down at most. */
async function* filesUnder(dir: Dir, prefix: string, depth: number): AsyncGenerator<Entry> {
  for await (const [name, handle] of (dir as Listable).entries()) {
    const path = `${prefix}${name}`
    if (handle.kind === 'file') yield { path, parent: dir, name }
    else if (depth > 0) yield* filesUnder(handle as Dir, `${path}/`, depth - 1)
  }
}

/** The files on the card a glob matches, listing only below its fixed folders. */
async function* matching(card: Dir, pattern: string): AsyncGenerator<Entry> {
  const segments = pattern.split('/')
  const fixed = segments.findIndex((s) => /[*?]/.test(s))
  if (fixed < 0) {
    const parent = await dirAt(card, segments.slice(0, -1))
    const name = segments[segments.length - 1]!
    if (parent && (await exists(parent, name))) yield { path: pattern, parent, name }
    return
  }
  const base = await dirAt(card, segments.slice(0, fixed))
  if (!base) return
  const re = globRegExp(pattern)
  const rest = segments.slice(fixed)
  const depth = rest.includes('**') ? Infinity : rest.length - 1
  const prefix = fixed > 0 ? `${segments.slice(0, fixed).join('/')}/` : ''
  for await (const e of filesUnder(base, prefix, depth)) if (re.test(e.path)) yield e
}

export interface InstallProgress {
  phase: 'download' | 'write'
  done: number
  total: number
}

async function sha256(data: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data))
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Concurrent downloads, as a courtesy to GitHub. */
const CONCURRENCY = 6

/**
 * Every file the radio's release lists, each checked against its size and
 * hash. Throws before anything is returned if one fails, so a bad download
 * never reaches the card. Progress is in bytes.
 */
export async function downloadRelease(
  release: PfdRelease,
  radio: PfdRadio,
  onProgress: (p: InstallProgress) => void,
  fetcher: Fetcher = (u) => fetch(u),
): Promise<Map<string, ArrayBuffer>> {
  const total = radio.files.reduce((n, f) => n + f.size, 0)
  let done = 0
  const out = new Map<string, ArrayBuffer>()
  const queue = [...radio.files]
  const worker = async () => {
    for (let f = queue.shift(); f; f = queue.shift()) {
      const url = release.files.replace('{version}', release.version).replace('{from}', f.from)
      const data = await (await get(url, fetcher)).arrayBuffer().catch(() => null)
      if (!data) throw new Error('Could not reach GitHub.')
      if (data.byteLength !== f.size || (await sha256(data)) !== f.sha256) {
        throw new Error(`${f.from} does not match the release.`)
      }
      out.set(f.to, data)
      done += f.size
      onProgress({ phase: 'download', done, total })
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  return out
}

/**
 * Writes a downloaded release onto the card by its rules: what `remove`
 * matches goes, then whatever an owned folder holds that the release does
 * not list, then every file is written. Everything else on the card, the
 * maps and captures among it, stays.
 *
 * Rejects when the card cannot be written; by then it may be half updated,
 * which a second install repairs.
 */
export async function installOnCard(
  card: Dir,
  radio: PfdRadio,
  data: ReadonlyMap<string, ArrayBuffer>,
  onProgress: (p: InstallProgress) => void,
): Promise<void> {
  const listed = new Set(radio.files.map((f) => f.to.toLowerCase()))
  // Collected before removing, since an entry removed mid-listing can end it.
  const stale: Entry[] = []
  for (const pattern of radio.remove) {
    for await (const e of matching(card, pattern)) stale.push(e)
  }
  for (const folder of radio.owned) {
    const dir = await dirAt(card, folder.split('/'))
    if (dir) for await (const e of filesUnder(dir, `${folder}/`, Infinity)) stale.push(e)
  }
  for (const e of stale) {
    if (listed.has(e.path.toLowerCase())) continue
    // Already gone when two rules matched it.
    await e.parent.removeEntry(e.name).catch((err: unknown) => {
      if ((err as DOMException)?.name !== 'NotFoundError') throw err
    })
  }
  const total = radio.files.length
  let done = 0
  for (const f of radio.files) {
    await writeFile(card, f.to.split('/'), data.get(f.to)!)
    onProgress({ phase: 'write', done: ++done, total })
  }
}
