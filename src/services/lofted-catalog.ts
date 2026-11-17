// Reads the Lofted Aero flight controller catalog (protocol/lofted-boards.ts)
// from LoftedAero/ardupilot-builds, a repository of its own so that cloning the
// ArduPilot source does not download every published image.
// raw.githubusercontent.com sends CORS headers where GitHub's release downloads
// do not, which is what lets the browser build read it too.

import {
  boardsIn,
  parseCatalogIndex,
  parseRelease,
  type BoardEntry,
  type CatalogFile,
  type CatalogRelease,
} from '../protocol/lofted-boards'

const BASE = 'https://raw.githubusercontent.com/LoftedAero/ardupilot-builds/main'

export type Fetcher = (url: string) => Promise<Response>

async function get(url: string, fetcher: Fetcher): Promise<Response> {
  let res: Response
  try {
    res = await fetcher(url)
  } catch {
    throw new Error('Could not reach GitHub.')
  }
  if (res.status === 403 || res.status === 429) {
    throw new Error('GitHub is refusing requests for now. Try again later.')
  }
  if (res.status === 404) throw new Error('No Lofty GCS firmware catalog is published.')
  if (!res.ok) throw new Error(`GitHub answered ${res.status}.`)
  return res
}

async function json(url: string, fetcher: Fetcher): Promise<unknown> {
  const res = await get(url, fetcher)
  try {
    return await res.json()
  } catch {
    throw new Error(`${url.slice(BASE.length + 1)} is not valid JSON.`)
  }
}

/**
 * Every board in the catalog with every release that has it. A release that
 * fails to parse is skipped rather than hiding the rest; it is reported only
 * when nothing parses.
 */
export async function loadCatalog(fetcher: Fetcher = (u) => fetch(u)): Promise<BoardEntry[]> {
  const names = parseCatalogIndex(await json(`${BASE}/index.json`, fetcher))
  const results = await Promise.allSettled(
    names.map(async (name) =>
      parseRelease(name, await json(`${BASE}/releases/${name}/boards.json`, fetcher)),
    ),
  )
  const releases = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
  if (releases.length === 0 && results.length > 0) {
    const first = results[0] as PromiseRejectedResult
    throw first.reason instanceof Error
      ? first.reason
      : new Error('The firmware catalog could not be read.')
  }
  return boardsIn(releases)
}

// One read per session: GitHub's raw host is cached and rate limited, and the
// Firmware screen remounts on every visit. A failure is forgotten so the next
// visit tries again.
let cached: Promise<BoardEntry[]> | null = null
export function catalog(): Promise<BoardEntry[]> {
  cached ??= loadCatalog().catch((e: unknown) => {
    cached = null
    throw e
  })
  return cached
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data as BufferSource))
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** One image of a release, checked against its size and hash before it is returned. */
export async function downloadCatalogFile(
  release: CatalogRelease,
  file: CatalogFile,
  fetcher: Fetcher = (u) => fetch(u),
): Promise<Uint8Array> {
  const res = await get(`${BASE}/releases/${release.name}/${file.file}`, fetcher)
  const data = new Uint8Array(await res.arrayBuffer())
  if (data.length !== file.size || (await sha256Hex(data)) !== file.sha256) {
    throw new Error(`${file.file} does not match the release.`)
  }
  return data
}
