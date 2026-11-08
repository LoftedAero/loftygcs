// Pulling a dataflash log off the vehicle.
//
// MAVFTP first: ArduPilot keeps logs on an SD card as numbered files in
// /APM/LOGS, and a burst read is about ten times faster than the log
// protocol. A board that logs to an onboard flash chip has no files, so when
// MAVFTP shows no logs the list comes from MAVLink's log protocol
// (protocol/log-transfer.ts), as Mission Planner reads them. A ten-megabyte
// log still takes a minute over USB and most of an hour over a 57600-baud
// radio, hence the progress reporting and cancel.

import { connectionService } from './connection'
import { useLogStore, type VehicleLog } from '../stores/log-store'
import { useVehicleStore } from '../stores/vehicle-store'
import { serializeParamFile } from '../protocol/param-file'
import type { LogEntryInfo } from '../protocol/log-transfer'

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

/** The logs in the first log directory this vehicle has, newest first. */
async function findLogDir(): Promise<VehicleLog[]> {
  let lastError: unknown = null
  for (const dir of LOG_DIRS) {
    try {
      const entries = await connectionService.listFiles(dir)
      const logs = entries
        .filter((e) => e.kind === 'file' && isLog(e.name))
        .map((e) => ({ name: e.name, path: `${dir}/${e.name}`, size: e.size ?? 0 }))
        .sort((a, b) => logNumber(b.name) - logNumber(a.name))
      // An empty directory ends the search; a vehicle has only one.
      return logs
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

/**
 * The vehicle answers the log protocol only while disarmed (MAVFTP works
 * either way).
 */
const DISARM_TEXT = 'Disarm to read logs from this vehicle.'

/**
 * A list entry's name. The protocol never gives a log's own number, so it is
 * named by its time, as Mission Planner names it, or else by its entry.
 */
export function entryName(e: LogEntryInfo): string {
  if (e.timeUtc <= 0) return `log-${e.id}.bin`
  const d = new Date(e.timeUtc * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}.bin`
  )
}

/** The logs the log protocol lists, newest first. */
async function listEntries(): Promise<VehicleLog[]> {
  const entries = await connectionService.listLogs()
  return entries
    .map((e) => ({ name: entryName(e), size: e.size, entry: e.id }))
    .sort((a, b) => b.entry - a.entry)
}

/** List the logs on the vehicle. */
export async function listVehicleLogs(): Promise<void> {
  const store = useLogStore.getState()
  store.setVehicleStatus({ kind: 'listing' })
  try {
    let logs: VehicleLog[] = []
    try {
      logs = await findLogDir()
    } catch {
      // No log directory, or no MAVFTP: the log protocol may still answer.
    }
    if (logs.length === 0) {
      if (useVehicleStore.getState().armed) throw new Error(DISARM_TEXT)
      logs = await listEntries()
    }
    useLogStore.getState().setVehicleLogs(logs)
    useLogStore
      .getState()
      .setVehicleStatus(
        logs.length === 0 ? { kind: 'error', text: 'No logs on the vehicle.' } : { kind: 'idle' },
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
    if ('entry' in log && useVehicleStore.getState().armed) throw new Error(DISARM_TEXT)
    const bytes =
      'path' in log
        ? await connectionService.downloadFile(log.path)
        : await connectionService.downloadLog(log.entry, log.size)
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
 * A read stopped on purpose (MAVFTP or the log protocol). Matched on the
 * message because errors lose their class crossing the worker boundary.
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
  if (isMissing(err)) return 'The log is no longer on the vehicle.'
  if (/timed out/.test(err.message)) {
    // A busy telemetry radio drops the replies.
    return 'No answer from the vehicle. Try connecting over USB.'
  }
  return err.message
}
