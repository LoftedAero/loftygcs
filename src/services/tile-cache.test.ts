import { afterEach, describe, expect, it, vi } from 'vitest'
import { prefetchTiles } from './tile-cache'
import type { TileCoord } from './tile-math'

// jsdom has no IndexedDB, which is the interesting half of the contract:
// with no store at all the cache must still fetch, still report progress,
// and still never throw at the caller. Everything below therefore runs on
// the degraded path on purpose -- it is the path a browser in private mode
// and a machine with storage denied both take.

const grid = (n: number): TileCoord[] => Array.from({ length: n }, (_, i) => ({ z: 15, x: i, y: 0 }))

afterEach(() => vi.unstubAllGlobals())

const ok = () => Promise.resolve({ ok: true, blob: () => Promise.resolve(new Blob(['x'])) })

describe('prefetching tiles', () => {
  it('fetches every tile once and reports progress along the way', async () => {
    const fetched: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        fetched.push(url)
        return ok()
      }),
    )
    const seen: number[] = []
    const result = await prefetchTiles(
      'esri',
      'https://x/{z}/{y}/{x}',
      grid(10),
      (p) => seen.push(p.done),
      undefined,
      3,
    )
    expect(result).toMatchObject({ done: 10, total: 10, failed: 0 })
    expect(new Set(fetched).size).toBe(10)
    // Progress arrives once per tile, monotonically -- a bar that jumps back
    // is worse than no bar.
    expect(seen).toHaveLength(10)
    expect([...seen].sort((a, b) => a - b)).toEqual(seen)
  })

  it('counts a refused tile instead of abandoning the rest', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        url.endsWith('/3') ? Promise.resolve({ ok: false, status: 404 }) : ok(),
      ),
    )
    const result = await prefetchTiles('esri', 'https://x/{z}/{y}/{x}', grid(6), () => {})
    expect(result).toMatchObject({ done: 6, failed: 1 })
  })

  it('survives a network that throws', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
    const result = await prefetchTiles('esri', 'https://x/{z}/{y}/{x}', grid(4), () => {})
    expect(result).toMatchObject({ done: 4, failed: 4 })
  })

  it('stops where it is asked to, without counting the remainder as failures', async () => {
    const controller = new AbortController()
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        controller.abort()
        return ok()
      }),
    )
    // One worker so the abort lands after exactly one tile.
    const result = await prefetchTiles(
      'esri',
      'https://x/{z}/{y}/{x}',
      grid(50),
      () => {},
      controller.signal,
      1,
    )
    expect(result.done).toBeLessThan(50)
    expect(result.failed).toBe(0)
  })

  it('does nothing, quietly, when there is nothing to fetch', async () => {
    const fetchSpy = vi.fn(ok)
    vi.stubGlobal('fetch', fetchSpy)
    const result = await prefetchTiles('esri', 'https://x/{z}/{y}/{x}', [], () => {})
    expect(result).toMatchObject({ done: 0, total: 0 })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
