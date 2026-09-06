import { afterEach, describe, expect, it, vi } from 'vitest'
import { prefetchTerrainForView, terrainTilesForArea } from './terrain'
import { tileUrl } from './tile-math'
import { TERRAIN_URL } from './terrain'

// The view prefetcher, on the degraded no-IndexedDB path jsdom provides:
// nothing is stored, so every wanted tile becomes a fetch -- which makes the
// fetch list a faithful record of what the prefetcher decided to want.

afterEach(() => vi.unstubAllGlobals())

// Around SITL's Canberra home: one z12 terrain tile.
const FIELD = { north: -35.35, south: -35.38, east: 149.18, west: 149.15 }

const ok = () => Promise.resolve({ ok: true, blob: () => Promise.resolve(new Blob(['x'])) })

describe('elevation following the view', () => {
  it('fetches the settled view its terrain tiles', async () => {
    const urls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn((u: string) => {
        urls.push(u)
        return ok()
      }),
    )
    await prefetchTerrainForView(FIELD)
    const wanted = terrainTilesForArea(FIELD).map((t) => tileUrl(TERRAIN_URL, t))
    expect(wanted.length).toBeGreaterThan(0)
    expect(urls.sort()).toEqual(wanted.sort())
  })

  it('fetches nothing for a continent', async () => {
    // The same cap as everything else that touches terrain: there is no
    // useful elevation answer for a world view, and speculative traffic is
    // only defensible while it stays tiny.
    const f = vi.fn(ok)
    vi.stubGlobal('fetch', f)
    await prefetchTerrainForView({ north: 60, south: -60, east: 170, west: -170 })
    expect(f).not.toHaveBeenCalled()
  })

  it('coalesces pans to the newest view', async () => {
    // Three settles arrive while the first fetch is still in flight. The
    // middle one is ground nobody stopped on; only the first and the last
    // views may be fetched.
    const a = FIELD
    const b = { north: 40.0, south: 39.98, east: -105.2, west: -105.22 }
    const c = { north: 51.5, south: 51.48, east: -0.1, west: -0.12 }
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const urls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (u: string) => {
        urls.push(u)
        await gate
        return { ok: true, blob: () => Promise.resolve(new Blob(['x'])) }
      }),
    )
    const first = prefetchTerrainForView(a)
    void prefetchTerrainForView(b)
    void prefetchTerrainForView(c)
    release()
    await first
    const of = (bounds: typeof a) => terrainTilesForArea(bounds).map((t) => tileUrl(TERRAIN_URL, t))
    for (const url of of(c)) expect(urls).toContain(url)
    for (const url of of(b)) expect(urls).not.toContain(url)
  })
})
