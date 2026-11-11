import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  copyToRadio,
  findRadioFolder,
  formatIndex,
  mergeIndex,
  parseIndex,
  plainCredit,
  tilePath,
} from './radio-maps'

// Every tile is stored; the copy is what is under test.
vi.mock('./tile-cache', () => ({
  prefetchTiles: () => Promise.resolve({ done: 0, total: 0, cached: 0, failed: 0 }),
  getTile: () => Promise.resolve(new Blob(['png'])),
}))

// A writable card holding `room` files, keyed by path.
function card(room = Infinity) {
  const files = new Map<string, unknown>()
  const at = (path: string): FileSystemDirectoryHandle =>
    ({
      name: path,
      getDirectoryHandle: (name: string) => Promise.resolve(at(`${path}/${name}`)),
      getFileHandle: (name: string) =>
        Promise.resolve({
          createWritable: () =>
            Promise.resolve({
              write: (data: unknown) => {
                if (files.size >= room)
                  return Promise.reject(new DOMException('', 'QuotaExceededError'))
                files.set(`${path}/${name}`, data)
                return Promise.resolve()
              },
              close: () => Promise.resolve(),
            }),
          getFile: () => Promise.resolve(new Blob([String(files.get(`${path}/${name}`))])),
        }),
    }) as unknown as FileSystemDirectoryHandle
  return { files, folder: { radio: 'EdgeTX', dir: at('') } }
}

function stubCanvas() {
  vi.stubGlobal('createImageBitmap', () => Promise.resolve({ width: 1, height: 1, close() {} }))
  vi.stubGlobal(
    'OffscreenCanvas',
    class {
      getContext() {
        return { fillRect() {}, drawImage() {} }
      }
      convertToBlob() {
        return Promise.resolve(new Blob(['jpeg']))
      }
    },
  )
}

const LAYER = { id: 'satellite', label: 'Satellite', url: '', attribution: '&copy; Esri' }
const BOUNDS = { north: 1, south: 0, east: 1, west: 0 }
const TILES = [
  { z: 14, x: 1, y: 1 },
  { z: 15, x: 2, y: 2 },
  { z: 16, x: 4, y: 4 },
]

describe('copying to a card', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('writes every tile and the index', async () => {
    stubCanvas()
    const { files, folder } = card()
    expect(await copyToRadio(folder, LAYER, TILES, BOUNDS, () => {})).toEqual({
      written: 3,
      missing: 0,
    })
    expect(files.has('/maps/satellite/16/4/4.jpg')).toBe(true)
    expect(parseIndex(String(files.get('/maps/index.txt')))[0]).toMatchObject({
      minZoom: 14,
      maxZoom: 16,
    })
  })

  it('stops at a card that cannot be written, rather than failing each tile', async () => {
    stubCanvas()
    const { files, folder } = card(1)
    await expect(copyToRadio(folder, LAYER, TILES, BOUNDS, () => {})).rejects.toThrow()
    expect(files.size).toBe(1)
  })

  it('indexes what a stopped copy wrote', async () => {
    stubCanvas()
    const { files, folder } = card()
    const stop = new AbortController()
    const result = await copyToRadio(
      folder,
      LAYER,
      TILES,
      BOUNDS,
      (p) => {
        if (p.done === TILES.length + 2) stop.abort()
      },
      stop.signal,
    )
    expect(result.written).toBe(2)
    expect(parseIndex(String(files.get('/maps/index.txt')))[0]).toMatchObject({
      minZoom: 14,
      maxZoom: 15,
    })
  })
})

// A directory tree standing in for a card: only what findRadioFolder asks.
function dir(name: string, children: Record<string, unknown> = {}): FileSystemDirectoryHandle {
  return {
    name,
    getDirectoryHandle: (child: string) => {
      const sub = children[child]
      return sub ? Promise.resolve(sub) : Promise.reject(new DOMException('NotFoundError'))
    },
  } as unknown as FileSystemDirectoryHandle
}

describe('radio maps', () => {
  it('writes credits the radio can draw', () => {
    // The street layer's, as map-layers.ts writes it.
    expect(plainCredit('&copy; OpenStreetMap contributors')).toBe('© OpenStreetMap contributors')
    expect(plainCredit('<a href="x">A|B</a> &amp; C')).toBe('A/B & C')
  })

  it('round-trips the index Lofty PFD reads', () => {
    const text = formatIndex([
      {
        id: 'satellite',
        label: 'Satellite',
        minZoom: 13,
        maxZoom: 19,
        center: { lat: -35.3632, lon: 149.1652 },
        credit: 'Imagery © Esri',
      },
    ])
    expect(text.split('\n')[1]).toBe(
      'satellite|Satellite|13|19|-35.363200|149.165200|Imagery © Esri',
    )
    expect(parseIndex(text)).toEqual([
      {
        id: 'satellite',
        label: 'Satellite',
        minZoom: 13,
        maxZoom: 19,
        center: { lat: -35.3632, lon: 149.1652 },
        credit: 'Imagery © Esri',
      },
    ])
  })

  it('widens a layer it copies again and keeps the others', () => {
    const before = formatIndex([
      { id: 'street', label: 'Street', minZoom: 10, maxZoom: 15, center: null, credit: 'OSM' },
      {
        id: 'satellite',
        label: 'Satellite',
        minZoom: 12,
        maxZoom: 16,
        center: null,
        credit: 'Esri',
      },
    ])
    const after = parseIndex(
      mergeIndex(before, {
        id: 'satellite',
        label: 'Satellite',
        minZoom: 14,
        maxZoom: 18,
        center: { lat: 1, lon: 2 },
        credit: 'Esri',
      }),
    )
    expect(after.map((e) => e.id)).toEqual(['street', 'satellite'])
    expect(after[1]).toMatchObject({ minZoom: 12, maxZoom: 18, center: { lat: 1, lon: 2 } })
    expect(parseIndex(mergeIndex('', after[0]!))).toHaveLength(1)
  })

  it('puts a tile where the radio looks for it', () => {
    expect(tilePath('satellite', { z: 17, x: 119845, y: 79316 })).toEqual([
      'maps',
      'satellite',
      '17',
      '119845',
      '79316.jpg',
    ])
  })

  it('finds Lofty PFD on either radio, or not at all', async () => {
    const edgetx = dir('LoftyPFD', { core: dir('core') })
    const ethos = dir('loftypfd', { core: dir('core') })
    expect(
      await findRadioFolder(dir('SD', { WIDGETS: dir('WIDGETS', { LoftyPFD: edgetx }) })),
    ).toEqual({
      radio: 'EdgeTX',
      dir: edgetx,
    })
    expect(
      await findRadioFolder(dir('SD', { scripts: dir('scripts', { loftypfd: ethos }) })),
    ).toEqual({
      radio: 'Ethos',
      dir: ethos,
    })
    expect((await findRadioFolder(ethos))?.radio).toBe('Ethos')
    expect(await findRadioFolder(dir('SD', { WIDGETS: dir('WIDGETS') }))).toBeNull()
  })

  it('accepts any folder on the path the dialog shows, down to Lofty PFD', async () => {
    const edgetx = dir('LoftyPFD', { core: dir('core'), maps: dir('maps') })
    const ethos = dir('loftypfd', { core: dir('core') })
    expect(await findRadioFolder(dir('WIDGETS', { LoftyPFD: edgetx }))).toEqual({
      radio: 'EdgeTX',
      dir: edgetx,
    })
    // A card formatted on another system may spell the top folder in lower case.
    expect((await findRadioFolder(dir('scripts', { loftypfd: ethos })))?.radio).toBe('Ethos')
    expect((await findRadioFolder(dir('SCRIPTS', { loftypfd: ethos })))?.radio).toBe('Ethos')
    // Nothing above a picked maps folder can be read.
    expect(await findRadioFolder(dir('maps'))).toBeNull()
  })
})
