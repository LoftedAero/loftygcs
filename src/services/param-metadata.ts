// Official ArduPilot parameter metadata (descriptions, ranges, bitmasks,
// units), generated from the firmware's own source by param_parse.py.
//
// Matched to the vehicle's firmware version where possible, since parameters
// are added, renamed and rescaled between releases. When the version is
// unknown or unpublished, the current release's metadata is used and the
// screen says so.
//
// autotest.ardupilot.org publishes one format per path, with the vehicle
// spelled differently in each tree, so both readers live here:
//
//   /Parameters/<ArduCopter>/apm.pdef.json          the current release
//   /Parameters/versioned/<Copter>/stable-4.5.7/apm.pdef.xml   a release
//
// Every load failure degrades to editable parameters without hints. Responses
// are cached with the Cache API so the app works offline after one fetch.

import type { FirmwareVersion } from '../protocol/types'

export interface ParamMeta {
  displayName?: string
  description?: string
  units?: string
  range?: { low: number; high: number }
  values?: Record<number, string>
  bitmask?: Record<number, string>
  rebootRequired?: boolean
  increment?: number
}

const VEHICLE_TO_PDEF: Record<string, string> = {
  Copter: 'ArduCopter',
  Plane: 'ArduPlane',
  Rover: 'Rover',
  Sub: 'ArduSub',
}

/** The versioned tree names vehicles differently from the current one. */
const VEHICLE_TO_VERSIONED: Record<string, string> = {
  Copter: 'Copter',
  Plane: 'Plane',
  Rover: 'Rover',
  Sub: 'Sub',
  Tracker: 'Tracker',
}

const BASE = 'https://autotest.ardupilot.org/Parameters'

const CACHE_NAME = 'loftgcs-pdef'

function parseKeyedList(raw: unknown): Record<number, string> | undefined {
  // The generator emits either {"0": "Disabled", ...} or "0:Disabled,1:...".
  if (raw && typeof raw === 'object') {
    const out: Record<number, string> = {}
    for (const [k, v] of Object.entries(raw)) out[Number(k)] = String(v)
    return out
  }
  if (typeof raw === 'string' && raw.includes(':')) {
    const out: Record<number, string> = {}
    for (const part of raw.split(',')) {
      const [k, ...rest] = part.split(':')
      if (k !== undefined && rest.length) out[Number(k.trim())] = rest.join(':').trim()
    }
    return out
  }
  return undefined
}

function normalizeEntry(raw: Record<string, unknown>): ParamMeta {
  const meta: ParamMeta = {}
  if (typeof raw.DisplayName === 'string') meta.displayName = raw.DisplayName
  if (typeof raw.Description === 'string') meta.description = raw.Description
  if (typeof raw.Units === 'string') meta.units = raw.Units
  if (raw.Range && typeof raw.Range === 'object') {
    const r = raw.Range as { low?: unknown; high?: unknown }
    const low = Number(r.low)
    const high = Number(r.high)
    if (Number.isFinite(low) && Number.isFinite(high)) meta.range = { low, high }
  }
  const values = parseKeyedList(raw.Values)
  if (values) meta.values = values
  const bitmask = parseKeyedList(raw.Bitmask)
  if (bitmask) meta.bitmask = bitmask
  if (raw.RebootRequired === 'True' || raw.RebootRequired === true) meta.rebootRequired = true
  const inc = Number(raw.Increment)
  if (Number.isFinite(inc) && inc > 0) meta.increment = inc
  return meta
}

async function cachedFetch(url: string): Promise<Response> {
  try {
    const cache = await caches.open(CACHE_NAME)
    const fresh = await fetch(url).catch(() => null)
    if (fresh?.ok) {
      await cache.put(url, fresh.clone())
      return fresh
    }
    const hit = await cache.match(url)
    if (hit) return hit
    throw new Error(`no network and no cached copy for ${url}`)
  } catch (err) {
    // Cache API unavailable (some contexts): plain fetch or bust.
    const r = await fetch(url)
    if (!r.ok) throw err instanceof Error ? err : new Error(String(err))
    return r
  }
}

/**
 * Which published version to ask for: the newest release not newer than the
 * vehicle's. A newer one would describe parameters this firmware lacks.
 */
export function bestVersion(
  available: readonly string[],
  want: { major: number; minor: number; patch: number },
): string | null {
  const rank = (v: string) => {
    const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v)
    return m ? Number(m[1]) * 1e6 + Number(m[2]) * 1e3 + Number(m[3]) : -1
  }
  const target = want.major * 1e6 + want.minor * 1e3 + want.patch
  let best: string | null = null
  let bestRank = -1
  for (const v of available) {
    const r = rank(v)
    if (r < 0 || r > target) continue
    if (r > bestRank) {
      bestRank = r
      best = v
    }
  }
  return best
}

/** The stable versions the server publishes metadata for, newest last. */
export function parseVersionIndex(html: string): string[] {
  // Scrapes directory names from the index page rather than parsing its format.
  const out = new Set<string>()
  for (const m of html.matchAll(/stable-(\d+\.\d+\.\d+)\//g)) out.add(m[1]!)
  return [...out]
}

async function versionedUrl(
  vehicleName: string,
  firmware: FirmwareVersion,
): Promise<{ url: string; label: string } | null> {
  const dir = VEHICLE_TO_VERSIONED[vehicleName]
  if (!dir) return null
  const index = `${BASE}/versioned/${dir}/`
  try {
    const res = await cachedFetch(index)
    const version = bestVersion(parseVersionIndex(await res.text()), firmware)
    if (!version) return null
    return { url: `${index}stable-${version}/apm.pdef.xml`, label: version }
  } catch {
    // No index, no version match; the caller falls back to the current one.
    return null
  }
}

/**
 * Reads the XML form: one <param> per parameter with <field> children and a
 * <values> block. Vehicle parameters are prefixed ("ArduCopter:SYSID_THISMAV")
 * and library ones are not, so the prefix is stripped.
 */
export function parsePdefXml(text: string): Record<string, ParamMeta> {
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('parameter metadata is not readable XML')
  }
  const out: Record<string, ParamMeta> = {}
  for (const el of doc.getElementsByTagName('param')) {
    const raw = el.getAttribute('name')
    if (!raw) continue
    const name = raw.includes(':') ? raw.slice(raw.indexOf(':') + 1) : raw
    const meta: ParamMeta = {}
    const humanName = el.getAttribute('humanName')
    const documentation = el.getAttribute('documentation')
    if (humanName) meta.displayName = humanName
    if (documentation) meta.description = documentation

    const fields = new Map<string, string>()
    for (const f of el.getElementsByTagName('field')) {
      const key = f.getAttribute('name')
      if (key) fields.set(key, (f.textContent ?? '').trim())
    }
    const units = fields.get('Units')
    if (units) meta.units = units
    const range = fields.get('Range')
    if (range) {
      // "0 10", space separated, unlike the JSON's {low, high}.
      const [low, high] = range.split(/\s+/).map(Number)
      if (Number.isFinite(low) && Number.isFinite(high)) meta.range = { low: low!, high: high! }
    }
    const increment = Number(fields.get('Increment'))
    if (Number.isFinite(increment) && increment > 0) meta.increment = increment
    if (fields.get('RebootRequired') === 'True') meta.rebootRequired = true

    const bitmask = parseKeyedList(fields.get('Bitmask'))
    if (bitmask) meta.bitmask = bitmask

    // For a bitmask parameter <values> lists mask values, not bit numbers,
    // so it is read only when there is no Bitmask field.
    if (!bitmask) {
      const values: Record<number, string> = {}
      for (const v of el.getElementsByTagName('value')) {
        const code = Number(v.getAttribute('code'))
        if (Number.isFinite(code)) values[code] = (v.textContent ?? '').trim()
      }
      if (Object.keys(values).length > 0) meta.values = values
    }
    out[name] = meta
  }
  return out
}

/** Read the JSON form: { "GROUP_": { "PARAM": {...} }, "json": version }. */
function parsePdefJson(json: Record<string, unknown>): Record<string, ParamMeta> {
  const flat: Record<string, ParamMeta> = {}
  for (const group of Object.values(json)) {
    if (!group || typeof group !== 'object') continue
    for (const [name, entry] of Object.entries(group)) {
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        flat[name] = normalizeEntry(entry as Record<string, unknown>)
      }
    }
  }
  return flat
}

export interface ParamMetadataResult {
  params: Record<string, ParamMeta>
  /** What was actually loaded, for the screen to show. */
  source: string
}

export async function fetchParamMetadata(
  vehicleName: string,
  firmware: FirmwareVersion | null,
): Promise<ParamMetadataResult> {
  const pdefVehicle = VEHICLE_TO_PDEF[vehicleName]
  if (!pdefVehicle) return { params: {}, source: 'none' }

  if (firmware && firmware.major > 0) {
    const match = await versionedUrl(vehicleName, firmware)
    if (match) {
      try {
        const res = await cachedFetch(match.url)
        return { params: parsePdefXml(await res.text()), source: match.label }
      } catch {
        // Published but unfetchable: fall back to the current release.
      }
    }
  }

  const res = await cachedFetch(`${BASE}/${pdefVehicle}/apm.pdef.json`)
  const json = (await res.json()) as Record<string, unknown>
  return { params: parsePdefJson(json), source: 'latest release' }
}
