import { connectionService } from './connection'
import { joinPath, parentPath, useFilesStore } from '../stores/files-store'
import type { FtpDirEntry } from '../protocol/ftp/mavftp'

// Browsing and editing the vehicle's SD card over MAVFTP.
//
// For what ArduPilot keeps as files rather than parameters: Lua scripts, OSD
// fonts, terrain tiles and the like.
//
// Writing is much slower than reading: there is no burst write and ArduPilot
// serves one FTP request at a time, so a file goes up 239 bytes per round
// trip. A 40 kB script takes around twenty seconds over USB and minutes over
// a telemetry radio.

/** Uploads beyond this would take far too long over MAVFTP. */
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024

/**
 * Where to open, tried in order: hardware mounts the card at /APM, while
 * SITL has no card and its root is the working directory.
 */
const START_DIRS = ['/APM', '/']

/**
 * The FTP root is a merged view of the real filesystem and ArduPilot's
 * virtual mounts (@ROMFS, @SYS, @PARAM). A file written there never shows up
 * in the listing, so uploads are refused there.
 */
export function isMergedRoot(path: string): boolean {
  return path === '/'
}

function describe(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err)
  // Translate ArduPilot's NAK codes into plain language.
  if (/FileNotFound/.test(text)) return 'No such file or directory on the vehicle'
  if (/FileProtected/.test(text)) return 'The vehicle refused: the file is protected'
  if (/FileExists/.test(text)) return 'Something with that name is already there'
  if (/FailErrno/.test(text)) return 'The vehicle refused the operation'
  // Some third-party autopilots have no MAVFTP.
  if (/timed out/.test(text)) return 'No answer — this vehicle may not support MAVFTP file access'
  return text
}

/** List a directory and show it. */
export async function listPath(path: string): Promise<void> {
  const store = useFilesStore.getState()
  store.setStatus({ kind: 'busy', text: `Listing ${path}…` })
  try {
    const entries = await connectionService.listFiles(path)
    useFilesStore.getState().setListing(path, entries)
    useFilesStore.getState().setStatus({ kind: 'idle' })
  } catch (err) {
    // Keep the current path on failure.
    useFilesStore.getState().setStatus({ kind: 'error', text: describe(err) })
  }
}

export function enterDirectory(name: string): Promise<void> {
  return listPath(joinPath(useFilesStore.getState().path, name))
}

export function goUp(): Promise<void> {
  return listPath(parentPath(useFilesStore.getState().path))
}

export function refresh(): Promise<void> {
  return listPath(useFilesStore.getState().path)
}

/** Open the first directory this vehicle actually has. */
export async function openStart(): Promise<void> {
  const store = useFilesStore.getState()
  store.setStatus({ kind: 'busy', text: 'Listing…' })
  for (const dir of START_DIRS) {
    try {
      const entries = await connectionService.listFiles(dir)
      useFilesStore.getState().setListing(dir, entries)
      useFilesStore.getState().setStatus({ kind: 'idle' })
      return
    } catch (err) {
      // Only a missing directory moves on to the next candidate; a timeout
      // means the link is the problem.
      if (!(err instanceof Error && /FileNotFound/.test(err.message))) {
        useFilesStore.getState().setStatus({ kind: 'error', text: describe(err) })
        return
      }
    }
  }
  useFilesStore
    .getState()
    .setStatus({ kind: 'error', text: 'No readable directory on this vehicle' })
}

/** Download a file and save it to disk. */
export async function downloadEntry(entry: FtpDirEntry): Promise<void> {
  const store = useFilesStore.getState()
  const path = joinPath(store.path, entry.name)
  store.setTransfer({ name: entry.name, dir: 'read', got: 0, total: entry.size ?? 0 })
  store.setStatus({ kind: 'busy', text: `Reading ${entry.name}…` })
  try {
    const bytes = await connectionService.downloadFile(path)
    saveBytes(entry.name, bytes)
    useFilesStore.getState().setStatus({ kind: 'done', text: `Saved ${entry.name}` })
  } catch (err) {
    useFilesStore.getState().setStatus({ kind: 'error', text: describe(err) })
  } finally {
    useFilesStore.getState().setTransfer(null)
  }
}

/** Upload a local file into the directory being shown. */
export async function uploadFile(file: File): Promise<void> {
  const store = useFilesStore.getState()
  if (file.size > MAX_UPLOAD_BYTES) {
    store.setStatus({
      kind: 'error',
      text: `${file.name} is ${Math.round(file.size / 1024)} kB. Anything over ${
        MAX_UPLOAD_BYTES / 1024 / 1024
      } MB belongs on the card directly — over MAVFTP it would take hours.`,
    })
    return
  }
  const path = joinPath(store.path, file.name)
  const bytes = new Uint8Array(await file.arrayBuffer())
  store.setTransfer({ name: file.name, dir: 'write', got: 0, total: bytes.length })
  store.setStatus({ kind: 'busy', text: `Writing ${file.name}…` })
  try {
    await connectionService.uploadFile(path, bytes)
    useFilesStore.getState().setStatus({ kind: 'done', text: `Wrote ${file.name}` })
    await refresh()
  } catch (err) {
    useFilesStore.getState().setStatus({ kind: 'error', text: describe(err) })
  } finally {
    useFilesStore.getState().setTransfer(null)
  }
}

/** Delete a file or an empty directory. The caller confirms first. */
export async function removeEntry(entry: FtpDirEntry): Promise<void> {
  const store = useFilesStore.getState()
  const path = joinPath(store.path, entry.name)
  store.setStatus({ kind: 'busy', text: `Deleting ${entry.name}…` })
  try {
    if (entry.kind === 'directory') await connectionService.removeDirectory(path)
    else await connectionService.removeFile(path)
    useFilesStore.getState().setStatus({ kind: 'done', text: `Deleted ${entry.name}` })
    await refresh()
  } catch (err) {
    useFilesStore.getState().setStatus({ kind: 'error', text: describe(err) })
  }
}

export async function makeDirectory(name: string): Promise<void> {
  const store = useFilesStore.getState()
  store.setStatus({ kind: 'busy', text: `Creating ${name}…` })
  try {
    await connectionService.createDirectory(joinPath(store.path, name))
    useFilesStore.getState().setStatus({ kind: 'done', text: `Created ${name}` })
    await refresh()
  } catch (err) {
    useFilesStore.getState().setStatus({ kind: 'error', text: describe(err) })
  }
}

export async function renameEntry(entry: FtpDirEntry, to: string): Promise<void> {
  const store = useFilesStore.getState()
  const dir = store.path
  store.setStatus({ kind: 'busy', text: `Renaming ${entry.name}…` })
  try {
    await connectionService.renameFile(joinPath(dir, entry.name), joinPath(dir, to))
    useFilesStore.getState().setStatus({ kind: 'done', text: `Renamed to ${to}` })
    await refresh()
  } catch (err) {
    useFilesStore.getState().setStatus({ kind: 'error', text: describe(err) })
  }
}

function saveBytes(name: string, bytes: Uint8Array): void {
  const url = URL.createObjectURL(
    new Blob([bytes as unknown as BlobPart], { type: 'application/octet-stream' }),
  )
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  // Revoked on the next tick: revoking synchronously can beat the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
