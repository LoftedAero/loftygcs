// Pulling a dataflash log off the vehicle over MAVFTP.
//
// ArduPilot keeps them in /APM/LOGS, numbered, with LASTLOG.TXT naming the
// most recent. Reading them over FTP rather than the old LOG_REQUEST_DATA
// protocol because it is the same client the parameters already use and it
// is markedly faster -- but the speed is relative: a ten-megabyte log over a
// 57600-baud telemetry radio is most of an hour, and over USB it is a
// minute. That difference is the whole reason progress is reported here and
// the transfer can be abandoned.

import { connectionService } from './connection'
import { useLogStore, type VehicleLog } from '../stores/log-store'
import { serializeParamFile } from '../protocol/param-file'

/**
 * Where logs live, most likely first.
 *
 * Real ArduPilot mounts its SD card at /APM and keeps them in /APM/LOGS.
 * SITL has no card: it runs on the host filesystem rooted at its working
 * directory, so its logs are at /logs. Both were found by asking a vehicle
 * rather than assuming, and probing in order costs one round trip on the
 * hardware case and gets the simulator right for free.
 */
const LOG_DIRS = ['/APM/LOGS', '/logs']

/**
 * Whether a directory entry is a log rather than the bookkeeping beside it.
 *
 * ArduPilot writes LASTLOG.TXT into the same directory, and some builds
 * leave a .cur or an index file there too.
 */
function isLog(name: string): boolean {
  return /\.bin$/i.test(name)
}

/** Sort newest-first by the number ArduPilot names them with. */
function logNumber(name: string): number {
  const m = /(\d+)/.exec(name)
  return m ? Number(m[1]) : 0
}

/** The first log directory this vehicle actually has, with its contents. */
async function findLogDir(): Promise<{ dir: string; logs: VehicleLog[] }> {
  let lastError: unknown = null
  for (const dir of LOG_DIRS) {
    try {
      const entries = await connectionService.listFiles(dir)
      const logs = entries
        .filter((e) => e.kind === 'file' && isLog(e.name))
        .map((e) => ({ name: e.name, path: `${dir}/${e.name}`, size: e.size ?? 0 }))
        .sort((a, b) => logNumber(b.name) - logNumber(a.name))
      // A directory that exists but holds no logs is still the right
      // directory -- the vehicle simply has not flown. Keep it.
      return { dir, logs }
    } catch (err) {
      lastError = err
      // Only a missing directory is worth trying the next candidate for; a
      // timeout means the link is the problem and the next one will too.
      if (!isMissing(err)) throw err
    }
  }
  throw lastError ?? new Error('no log directory on this vehicle')
}

function isMissing(err: unknown): boolean {
  return err instanceof Error && /FileNotFound/.test(err.message)
}

/** List the logs on the vehicle. */
export async function listVehicleLogs(): Promise<void> {
  const store = useLogStore.getState()
  store.setVehicleStatus({ kind: 'listing' })
  try {
    const { dir, logs } = await findLogDir()
    useLogStore.getState().setVehicleLogs(logs)
    useLogStore.getState().setVehicleStatus(
      logs.length === 0
        ? { kind: 'error', text: `No logs in ${dir}. Has this vehicle flown since its last format?` }
        : { kind: 'idle' },
    )
  } catch (err) {
    useLogStore.getState().setVehicleStatus({ kind: 'error', text: describe(err) })
  }
}

/**
 * Download one log and open it.
 *
 * The bytes are handed straight to the parser rather than saved first: the
 * point of downloading it here is to look at it, and a copy on disk is a
 * separate thing the user can ask for once they know it is the right log.
 */
export async function downloadVehicleLog(log: VehicleLog): Promise<void> {
  const store = useLogStore.getState()
  store.setVehicleStatus({ kind: 'downloading', name: log.name, got: 0, total: log.size })
  try {
    const bytes = await connectionService.downloadFile(log.path)
    useLogStore.getState().setVehicleStatus({ kind: 'idle' })
    useLogStore.getState().loadBytes(log.name, bytes)
  } catch (err) {
    useLogStore.getState().setVehicleStatus({ kind: 'error', text: describe(err) })
  }
}

/** Save the log currently open to a file, so it need not be fetched twice. */
export function saveOpenLog(name: string, bytes: Uint8Array): void {
  download(name, bytes, 'application/octet-stream')
}

/**
 * Write the parameters a log carries out as a .param file.
 *
 * The same format the Parameters screen imports and exports, so a
 * configuration recovered from a flight can be compared against a vehicle
 * or loaded onto one -- which is most of why anyone wants it. It is the
 * configuration the aircraft was flying under, not whatever it holds now.
 */
export function saveLogParams(logName: string, params: ReadonlyMap<string, number>): void {
  const entries = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => ({ name, value }))
  const base = logName.replace(/\.[^.]+$/, '')
  download(`${base}.param`, serializeParamFile(entries), 'text/plain')
}

/** Hand a blob to the browser as a download. */
function download(name: string, data: string | Uint8Array, type: string): void {
  const blob = new Blob([data as unknown as BlobPart], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  // Revoked next tick: doing it synchronously can beat the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function describe(err: unknown): string {
  if (!(err instanceof Error)) return String(err)
  // A NAK code on its own tells a pilot nothing.
  if (isMissing(err)) return `No log directory on this vehicle (looked in ${LOG_DIRS.join(' and ')}).`
  if (/timed out/.test(err.message)) {
    // Two quite different causes, and nothing here can tell them apart:
    // firmware without MAVFTP never answers at all, and a loaded telemetry
    // radio drops the replies. Naming one would be a guess. (Demo mode is
    // the first case -- its vehicle deliberately has no MAVFTP.)
    return 'No answer from the vehicle. It may not support MAVFTP, or the link may be dropping it — a telemetry radio often does. Over USB this usually works.'
  }
  return err.message
}
