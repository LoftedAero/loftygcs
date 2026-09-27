// Pulling a dataflash log off the vehicle over MAVFTP.
//
// ArduPilot keeps logs numbered in /APM/LOGS, with LASTLOG.TXT naming the
// most recent. MAVFTP is used rather than LOG_REQUEST_DATA because it is
// faster and already used for parameters. A ten-megabyte log still takes a
// minute over USB and most of an hour over a 57600-baud radio, hence the
// progress reporting and cancel.

import { connectionService } from './connection'
import { useLogStore, type VehicleLog } from '../stores/log-store'
import { serializeParamFile } from '../protocol/param-file'

/**
 * Where logs live, most likely first: hardware mounts the SD card at /APM,
 * while SITL keeps them in /logs under its working directory.
 */
const LOG_DIRS = ['/APM/LOGS', '/logs']

/**
 * Whether a directory entry is a log. The directory also holds LASTLOG.TXT
 * and, on some builds, a .cur or index file.
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
      // An empty directory is still the right one; the vehicle has not flown.
      return { dir, logs }
    } catch (err) {
      lastError = err
      // Only a missing directory moves on to the next candidate; a timeout
      // means the link is the problem.
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
    useLogStore
      .getState()
      .setVehicleStatus(
        logs.length === 0
          ? {
              kind: 'error',
              text: `No logs in ${dir}. Has this vehicle flown since its last format?`,
            }
          : { kind: 'idle' },
      )
  } catch (err) {
    useLogStore.getState().setVehicleStatus({ kind: 'error', text: describe(err) })
  }
}

/** Download one log and open it. Saving to disk is a separate action. */
export async function downloadVehicleLog(log: VehicleLog): Promise<void> {
  const store = useLogStore.getState()
  store.setVehicleStatus({ kind: 'downloading', name: log.name, got: 0, total: log.size })
  try {
    const bytes = await connectionService.downloadFile(log.path)
    useLogStore.getState().setVehicleStatus({ kind: 'idle' })
    useLogStore.getState().loadBytes(log.name, bytes)
  } catch (err) {
    // A cancel is not an error; the list simply returns.
    useLogStore
      .getState()
      .setVehicleStatus(isCancel(err) ? { kind: 'idle' } : { kind: 'error', text: describe(err) })
  }
}

/** Stop the download in progress; it ends quietly, back at the list. */
export function cancelVehicleLogDownload(): void {
  void connectionService.cancelDownload().catch(() => {})
}

/**
 * A read stopped on purpose. Matched on the message because errors lose
 * their class crossing the worker boundary.
 */
function isCancel(err: unknown): boolean {
  return err instanceof Error && /transfer canceled/.test(err.message)
}

/** Save the log currently open to a file, so it need not be fetched twice. */
export function saveOpenLog(name: string, bytes: Uint8Array): void {
  download(name, bytes, 'application/octet-stream')
}

/**
 * Save the parameters recorded in a log as a .param file, in the format the
 * Parameters screen imports, so a flight's configuration can be compared
 * against or loaded onto a vehicle.
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
  if (isMissing(err))
    return `No log directory on this vehicle (looked in ${LOG_DIRS.join(' and ')}).`
  if (/timed out/.test(err.message)) {
    // Either the firmware lacks MAVFTP (as the demo vehicle does) or a busy
    // telemetry radio drops the replies; nothing here can tell which.
    return 'No answer from the vehicle. It may not support MAVFTP, or the link may be dropping it — a telemetry radio often does. Over USB this usually works.'
  }
  return err.message
}
