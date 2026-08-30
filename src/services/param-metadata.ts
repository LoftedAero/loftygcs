// Official ArduPilot parameter metadata (descriptions, ranges, bitmasks,
// units) from the autotest server's generated apm.pdef.json. Metadata is
// decoration: every load failure degrades to "params editable, no hints",
// never to a blocked UI. Responses are cached with the Cache API so the app
// works offline at the field after one successful fetch.

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

export async function fetchParamMetadata(
  vehicleName: string,
): Promise<Record<string, ParamMeta>> {
  const pdefVehicle = VEHICLE_TO_PDEF[vehicleName]
  if (!pdefVehicle) return {}
  // The un-versioned path tracks the current stable release. Version-matched
  // lookup (from AUTOPILOT_VERSION) is a refinement for when we request that
  // message during discovery.
  const url = `https://autotest.ardupilot.org/Parameters/${pdefVehicle}/apm.pdef.json`
  const res = await cachedFetch(url)
  const json = (await res.json()) as Record<string, unknown>

  // Structure: { "GROUP_": { "PARAM_NAME": {...} }, "json": version }.
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
