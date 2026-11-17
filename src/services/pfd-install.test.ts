import { describe, expect, it } from 'vitest'
import {
  downloadRelease,
  globRegExp,
  insideLayout,
  installOnCard,
  latestRelease,
  manifestUrl,
  parseManifest,
  RELEASE_URL,
  whichRadio,
  type PfdRelease,
} from './pfd-install'

// A card as the File System Access API shows one: folders of files, looked up
// without regard to case as FAT does, keeping each name's own spelling.
interface Node {
  name: string
  files: Map<string, { name: string; data: string }>
  dirs: Map<string, Node>
}
const node = (name: string): Node => ({ name, files: new Map(), dirs: new Map() })

function notFound() {
  return new DOMException('', 'NotFoundError')
}

function handle(n: Node): FileSystemDirectoryHandle {
  return {
    kind: 'directory',
    name: n.name,
    getDirectoryHandle(name: string, opts?: { create?: boolean }) {
      const key = name.toLowerCase()
      let d = n.dirs.get(key)
      if (!d && opts?.create && !n.files.has(key)) n.dirs.set(key, (d = node(name)))
      return d ? Promise.resolve(handle(d)) : Promise.reject(notFound())
    },
    getFileHandle(name: string, opts?: { create?: boolean }) {
      const key = name.toLowerCase()
      if (!n.files.has(key) && !(opts?.create && !n.dirs.has(key))) {
        return Promise.reject(notFound())
      }
      return Promise.resolve({
        kind: 'file',
        name,
        createWritable: () => {
          let data = ''
          return Promise.resolve({
            write: (b: ArrayBuffer) => {
              data += new TextDecoder().decode(b)
              return Promise.resolve()
            },
            close: () => {
              n.files.set(key, { name: n.files.get(key)?.name ?? name, data })
              return Promise.resolve()
            },
          })
        },
      })
    },
    removeEntry(name: string) {
      return n.files.delete(name.toLowerCase()) ? Promise.resolve() : Promise.reject(notFound())
    },
    async *entries() {
      for (const f of [...n.files.values()]) yield [f.name, { kind: 'file', name: f.name }]
      for (const d of [...n.dirs.values()]) yield [d.name, handle(d)]
    },
  } as unknown as FileSystemDirectoryHandle
}

/** A card holding `paths`, each file's content its own path. */
function card(paths: string[], name = 'E:\\') {
  const root = node(name)
  for (const p of paths) {
    const segs = p.split('/')
    let n = root
    for (const s of segs.slice(0, -1)) {
      const key = s.toLowerCase()
      if (!n.dirs.has(key)) n.dirs.set(key, node(s))
      n = n.dirs.get(key)!
    }
    const last = segs[segs.length - 1]!
    n.files.set(last.toLowerCase(), { name: last, data: p })
  }
  const list = (n: Node = root, prefix = ''): string[] => [
    ...[...n.files.values()].map((f) => prefix + f.name),
    ...[...n.dirs.values()].flatMap((d) => list(d, `${prefix}${d.name}/`)),
  ]
  const read = (p: string) => {
    let n: Node | undefined = root
    const segs = p.toLowerCase().split('/')
    for (const s of segs.slice(0, -1)) n = n?.dirs.get(s)
    return n?.files.get(segs[segs.length - 1]!)?.data
  }
  return { dir: handle(root), list: () => list().sort(), read }
}

async function sha256(text: string): Promise<string> {
  const d = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text).buffer as ArrayBuffer),
  )
  return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('')
}

// Each file's content is its `from` path.
const SOURCES: Record<string, [string, string][]> = {
  edgetx: [
    ['src/edgetx/main.lua', 'WIDGETS/LoftyPFD/main.lua'],
    ['src/core/bits.lua', 'WIDGETS/LoftyPFD/core/bits.lua'],
    ['src/edgetx/tool.lua', 'SCRIPTS/TOOLS/LoftyPFD.lua'],
    ['audio/en/armed.wav', 'SOUNDS/en/lofty/armed.wav'],
  ],
  ethos: [
    ['src/ethos/main.lua', 'scripts/loftypfd/main.lua'],
    ['src/core/bits.lua', 'scripts/loftypfd/core/bits.lua'],
    ['audio/en/armed.wav', 'scripts/loftypfd/audio/en/armed.wav'],
  ],
}

async function manifest(version = '0.2.0') {
  const files = async (key: string) =>
    Promise.all(
      SOURCES[key]!.map(async ([from, to]) => ({
        from,
        to,
        size: from.length,
        sha256: await sha256(from),
      })),
    )
  return {
    format: 1,
    name: 'Lofty PFD',
    version,
    repository: 'LoftedAero/loftypfd',
    files: 'https://raw.githubusercontent.com/LoftedAero/loftypfd/v{version}/{from}',
    radios: {
      edgetx: {
        folder: 'WIDGETS/LoftyPFD',
        signs: ['RADIO/radio.yml'],
        owned: ['WIDGETS/LoftyPFD/core', 'SOUNDS/en/lofty'],
        remove: [
          'WIDGETS/LoftyPFD/**/*.luac',
          'SCRIPTS/TOOLS/LoftyPFD.luac',
          'WIDGETS/LoftyPFD/replay.txt',
        ],
        files: await files('edgetx'),
      },
      ethos: {
        folder: 'scripts/loftypfd',
        signs: ['sdcard.cpuid', 'radio.cpuid'],
        owned: ['scripts/loftypfd/core', 'scripts/loftypfd/audio/en'],
        remove: ['scripts/loftypfd/**/*.luac', 'scripts/loftypfd/replay.txt'],
        files: await files('ethos'),
      },
    },
  }
}

/** GitHub as the installer sees it, serving `version` and counting requests. */
function github(m: object, tag: string, corrupt?: string) {
  const asked: string[] = []
  const fetcher = (url: string) => {
    asked.push(url)
    if (url === RELEASE_URL) return Promise.resolve(Response.json({ tag_name: tag }))
    if (url === manifestUrl(tag)) return Promise.resolve(Response.json(m))
    const from = url.replace(/^.*\/v[\d.]+\//, '')
    return Promise.resolve(new Response(from === corrupt ? from.toUpperCase() : from))
  }
  return { fetcher, asked }
}

async function release(): Promise<PfdRelease> {
  return parseManifest(await manifest(), 'v0.2.0')
}

describe('the release', () => {
  it('reads the latest tag, then its manifest', async () => {
    const { fetcher, asked } = github(await manifest(), 'v0.2.0')
    const r = await latestRelease(fetcher)
    expect(r.version).toBe('0.2.0')
    expect(r.radios.map((x) => x.key)).toEqual(['edgetx', 'ethos'])
    expect(asked).toEqual([
      RELEASE_URL,
      'https://raw.githubusercontent.com/LoftedAero/loftypfd/v0.2.0/manifest.json',
    ])
  })

  it('refuses a manifest of another format or version', async () => {
    const m = await manifest()
    expect(() => parseManifest({ ...m, format: 2 }, 'v0.2.0')).toThrow(/newer Lofty GCS/)
    expect(() => parseManifest(m, 'v0.3.0')).toThrow(/does not match/)
  })

  it('refuses a manifest that would write outside the card', async () => {
    const m = await manifest()
    for (const to of ['../x.lua', '/x.lua', 'WIDGETS\\x.lua', 'C:/x.lua', 'a//b']) {
      const bad = structuredClone(m)
      bad.radios.edgetx.files[0]!.to = to
      expect(() => parseManifest(bad, 'v0.2.0')).toThrow(/could not be read/)
    }
  })

  it('names GitHub refusing the request', async () => {
    const fetcher = () => Promise.resolve(new Response('', { status: 403 }))
    await expect(latestRelease(fetcher)).rejects.toThrow(/refusing/)
    await expect(latestRelease(() => Promise.reject(new TypeError()))).rejects.toThrow(
      /Could not reach GitHub/,
    )
  })
})

describe('globs', () => {
  it('matches within a name and across folders, ignoring case', () => {
    const re = globRegExp('WIDGETS/LoftyPFD/**/*.luac')
    expect(re.test('WIDGETS/LoftyPFD/main.luac')).toBe(true)
    expect(re.test('widgets/loftypfd/core/bits.luac')).toBe(true)
    expect(re.test('WIDGETS/LoftyPFD/main.lua')).toBe(false)
    expect(re.test('WIDGETS/Other/main.luac')).toBe(false)
    expect(globRegExp('a/*.txt').test('a/b/c.txt')).toBe(false)
    expect(globRegExp('a/menu.txt').test('a/menuxtxt')).toBe(false)
  })
})

describe('which radio', () => {
  it('goes by the folder Lofty PFD is in, then by the signs', async () => {
    const r = await release()
    const edgetx = await whichRadio(card(['WIDGETS/LoftyPFD/main.lua']).dir, r)
    expect(edgetx).toMatchObject({ radio: { key: 'edgetx' }, update: true })
    expect(await whichRadio(card(['sdcard.cpuid']).dir, r)).toMatchObject({
      radio: { key: 'ethos' },
      update: false,
    })
    // The folder outranks a sign of the other radio.
    expect(
      await whichRadio(card(['scripts/loftypfd/main.lua', 'RADIO/radio.yml']).dir, r),
    ).toMatchObject({ radio: { key: 'ethos' } })
  })

  it('leaves the pilot to say when nothing tells', async () => {
    const r = await release()
    expect(await whichRadio(card(['notes.txt']).dir, r)).toBeNull()
    expect(await whichRadio(card(['RADIO/radio.yml', 'radio.cpuid']).dir, r)).toBeNull()
  })

  it('knows a folder inside the layout from a card', async () => {
    const r = await release()
    expect(insideLayout(card([], 'WIDGETS').dir, r)).toBe('WIDGETS')
    expect(insideLayout(card([], 'loftypfd').dir, r)).toBe('loftypfd')
    expect(insideLayout(card([]).dir, r)).toBeNull()
  })
})

describe('installing', () => {
  it('downloads every file, checked', async () => {
    const r = await release()
    const { fetcher, asked } = github(await manifest(), 'v0.2.0')
    const seen: number[] = []
    const data = await downloadRelease(r, r.radios[0]!, (p) => seen.push(p.done), fetcher)
    expect(data.size).toBe(4)
    expect(asked).toContain(
      'https://raw.githubusercontent.com/LoftedAero/loftypfd/v0.2.0/src/core/bits.lua',
    )
    expect(seen.at(-1)).toBe(r.radios[0]!.files.reduce((n, f) => n + f.size, 0))
  })

  it('refuses a file that does not match the release', async () => {
    const r = await release()
    const { fetcher } = github(await manifest(), 'v0.2.0', 'src/core/bits.lua')
    await expect(downloadRelease(r, r.radios[0]!, () => {}, fetcher)).rejects.toThrow(
      'src/core/bits.lua does not match the release.',
    )
  })

  it('replaces what the release owns and keeps the rest', async () => {
    const r = await release()
    const radio = r.radios[0]!
    const { fetcher } = github(await manifest(), 'v0.2.0')
    const data = await downloadRelease(r, radio, () => {}, fetcher)
    const c = card([
      'RADIO/radio.yml',
      'WIDGETS/LoftyPFD/main.lua',
      'WIDGETS/LoftyPFD/main.luac',
      'WIDGETS/LoftyPFD/core/bits.luac',
      'WIDGETS/LoftyPFD/core/old.lua',
      'WIDGETS/LoftyPFD/replay.txt',
      'WIDGETS/LoftyPFD/maps/index.txt',
      'WIDGETS/LoftyPFD/maps/satellite/14/1/1.jpg',
      'WIDGETS/LoftyPFD/captures/c1.txt',
      'SCRIPTS/TOOLS/LoftyPFD.luac',
      'SCRIPTS/TOOLS/Other.lua',
      'SOUNDS/en/lofty/gone.wav',
      'SOUNDS/en/other.wav',
    ])
    await installOnCard(c.dir, radio, data, () => {})
    expect(c.list()).toEqual(
      [
        'RADIO/radio.yml',
        'SCRIPTS/TOOLS/LoftyPFD.lua',
        'SCRIPTS/TOOLS/Other.lua',
        'SOUNDS/en/lofty/armed.wav',
        'SOUNDS/en/other.wav',
        'WIDGETS/LoftyPFD/captures/c1.txt',
        'WIDGETS/LoftyPFD/core/bits.lua',
        'WIDGETS/LoftyPFD/main.lua',
        'WIDGETS/LoftyPFD/maps/index.txt',
        'WIDGETS/LoftyPFD/maps/satellite/14/1/1.jpg',
      ].sort(),
    )
    expect(c.read('WIDGETS/LoftyPFD/main.lua')).toBe('src/edgetx/main.lua')
    expect(c.read('WIDGETS/LoftyPFD/maps/index.txt')).toBe('WIDGETS/LoftyPFD/maps/index.txt')
  })

  it('installs onto a card that has never held Lofty PFD', async () => {
    const r = await release()
    const radio = r.radios[1]!
    const { fetcher } = github(await manifest(), 'v0.2.0')
    const data = await downloadRelease(r, radio, () => {}, fetcher)
    const c = card(['sdcard.cpuid'])
    await installOnCard(c.dir, radio, data, () => {})
    expect(c.list()).toEqual([
      'scripts/loftypfd/audio/en/armed.wav',
      'scripts/loftypfd/core/bits.lua',
      'scripts/loftypfd/main.lua',
      'sdcard.cpuid',
    ])
  })
})
